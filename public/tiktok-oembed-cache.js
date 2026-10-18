// Browser-session metadata reuse, not a cache of TikTok video/audio bytes.
(() => {
  if (window.VidBestTikTokOEmbedCache) return;
  const TTL = 30 * 60 * 1000;
  const RETRY_KEY = "vidbest:tiktokmedia:retry-until:v1";
  const PREFIX = "vidbest:tiktokmedia:oembed:v1:";
  const pending = new Map();
  const memory = new Map();
  let limitedUntil = 0;

  function source(value) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/@([A-Za-z0-9_.]{1,32})\/video\/(\d{15,25})$/);
    if (url.origin !== "https://www.tiktok.com" || url.username || url.password || url.search || url.hash || !match) throw new Error("Invalid TikTok source.");
    return { url: url.href, username: match[1], id: match[2], key: PREFIX + match[1] + ":" + match[2] };
  }

  function read(key) {
    try { return memory.get(key) || JSON.parse(sessionStorage.getItem(key)); }
    catch { return memory.get(key); }
  }
  function write(key, record) {
    memory.set(key, record);
    try { sessionStorage.setItem(key, JSON.stringify(record)); } catch {}
    if (memory.size > 20) {
      const oldest = memory.keys().next().value;
      memory.delete(oldest);
      try { sessionStorage.removeItem(oldest); } catch {}
    }
  }
  function unavailable(code, until) {
    return Object.assign(new Error(code === "limited" ? "TikTok metadata requests are currently limited." : "TikTok details are temporarily unavailable."), { code, retryUntil: until });
  }
  function retryDeadline(response) {
    const raw = response.headers.get("Retry-After");
    const seconds = /^\d+$/.test(raw || "") ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
    const until = Date.now() + seconds * 1000;
    return Number.isSafeInteger(seconds) && seconds > 0 && Number.isSafeInteger(until) ? until : Date.now() + 60000;
  }
  function currentLimit() {
    try { limitedUntil = Math.max(limitedUntil, Number(sessionStorage.getItem(RETRY_KEY)) || 0); } catch {}
    return limitedUntil;
  }

  async function readJson(response) {
    if (!(response.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) throw new Error("Expected JSON.");
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 65536) throw new Error("Oversized metadata.");
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
  }

  function normalize(data, share) {
    const metadata = data?.oembed;
    const returnedId = String(metadata?.html || "").match(/data-video-id=["'](\d+)["']/)?.[1];
    if (data?.status !== "success" || metadata?.type !== "video" || metadata.provider_name !== "TikTok" ||
        returnedId !== share.id || metadata.author_url !== `https://www.tiktok.com/@${share.username}`) throw new Error("Different TikTok video returned.");
    return {
      id: share.id, username: share.username,
      author_name: String(metadata.author_name || "@" + share.username).slice(0, 120),
      title: String(metadata.title || "TikTok video").slice(0, 2200),
      remaining_today: Number.isInteger(data.remaining_today) && data.remaining_today >= 0 && data.remaining_today <= 20 ? data.remaining_today : null,
    }; // Never persist raw HTML, scripts, signed poster URLs or video URLs.
  }

  function valid(record, share) {
    const m = record?.metadata;
    return record?.state === "ready" && record.until > Date.now() && record.until <= Date.now() + TTL &&
      Number.isFinite(record.checkedAt) && record.checkedAt <= Date.now() &&
      m?.id === share.id && m.username === share.username &&
      typeof m.author_name === "string" && m.author_name.length <= 120 && typeof m.title === "string" && m.title.length <= 2200 &&
      (m.remaining_today === null || Number.isInteger(m.remaining_today) && m.remaining_today >= 0 && m.remaining_today <= 20);
  }

  async function lookup(value, load) {
    const share = source(value);
    const deadline = currentLimit();
    if (deadline > Date.now()) throw unavailable("limited", deadline); // Known 429 always takes precedence over a prior success.
    const cached = read(share.key);
    if (valid(cached, share)) return { metadata: { ...cached.metadata }, checkedAt: cached.checkedAt, reused: true };
    if (cached?.state === "error" && cached.until > Date.now()) throw unavailable(cached.code, cached.until);
    if (pending.has(share.key)) return pending.get(share.key);

    const task = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const endpoint = new URL("https://tiktokmedia.megasale.win/api/watch");
        endpoint.searchParams.set("url", share.url);
        // The isolated document supplies its own browser fetch. No server proxy,
        // new general-site CSP origin, background polling or upstream fallback.
        const result = await load(endpoint.href, {
          credentials: "omit", redirect: "error", cache: "no-store",
          headers: { Accept: "application/json" }, signal: controller.signal,
        });
        if (!result.ok) {
          const until = retryDeadline(result);
          if (result.status === 429) {
            limitedUntil = Math.max(limitedUntil, until);
            try { sessionStorage.setItem(RETRY_KEY, String(limitedUntil)); } catch {}
            await result.body?.cancel().catch(() => {});
            throw unavailable("limited", limitedUntil);
          }
          await result.body?.cancel().catch(() => {});
          throw unavailable("unavailable", until);
        }
        const metadata = normalize(await readJson(result), share);
        const checkedAt = Date.now();
        write(share.key, { state: "ready", metadata, checkedAt, until: checkedAt + TTL });
        return { metadata: { ...metadata }, checkedAt, reused: false };
      } catch (error) {
        const until = Number.isFinite(error?.retryUntil) && error.retryUntil > Date.now() ? error.retryUntil : Date.now() + 60000;
        const code = error?.code === "limited" ? "limited" : "unavailable";
        write(share.key, { state: "error", code, until });
        throw unavailable(code, until);
      } finally { clearTimeout(timer); }
    })().finally(() => pending.delete(share.key));
    pending.set(share.key, task);
    return task;
  }

  window.VidBestTikTokOEmbedCache = Object.freeze({ lookup });
})();
