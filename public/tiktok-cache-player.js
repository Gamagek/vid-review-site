// Runs in a separate same-origin document so each deliberate open gets one
// official embed script evaluation, and closing the parent destroys playback.
(() => {
  const status = document.getElementById("cache-status");
  const host = document.getElementById("tiktok-embed-host");
  const link = document.getElementById("tiktok-source");
  const retryKey = "vidbest:tiktokmedia:retry-until:v1";
  const limitedMessage = "TikTok cache requests are limited to 20 videos per viewer per day. Your request is currently limited; please try again later.";
  let started = false;

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

  function notify(state, message) {
    status.textContent = message;
    window.parent.postMessage({ channel: "vidbest-tiktok-oembed", video_id: host.dataset.videoId || "", state, message }, location.origin);
  }

  async function start() {
    if (started) return;
    started = true;
    try {
      const source = new URL(link.href);
      const match = source.pathname.match(/^\/@([A-Za-z0-9_.]{1,32})\/video\/(\d{15,25})$/);
      if (source.origin !== "https://www.tiktok.com" || !match) throw new Error("Invalid TikTok source.");
      host.dataset.videoId = match[2];
      let retryUntil = 0;
      try { retryUntil = Number(sessionStorage.getItem(retryKey)); } catch {}
      if (Number.isFinite(retryUntil) && retryUntil > Date.now()) {
        notify("error", limitedMessage);
        return;
      }
      const endpoint = new URL("https://tiktokmedia.megasale.win/api/watch");
      endpoint.searchParams.set("url", source.href);
      // Direct browser call preserves the API's per-viewer allowance. Do not
      // proxy all visitors under a server IP or cache away the viewer counter.
      const result = await fetch(endpoint.href, {
        credentials: "omit", redirect: "error", cache: "no-store",
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000),
      });
      if (result.status === 429) {
        const retry = result.headers.get("Retry-After");
        const seconds = /^\d+$/.test(retry || "") ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
        const delay = Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 60;
        try { sessionStorage.setItem(retryKey, String(Date.now() + delay * 1000)); } catch {}
        await result.body?.cancel();
        notify("error", limitedMessage);
        return; // Never bypass the allowance with local metadata or another host.
      }
      if (!result.ok) {
        await result.body?.cancel();
        notify("error", "Cached TikTok details could not load. Please use the source link below or try again later.");
        return; // No polling, reload, alternate upstream or automatic retry.
      }
      const data = await readJson(result);
      const metadata = data?.oembed;
      const returnedId = String(metadata?.html || "").match(/data-video-id=["'](\d+)["']/)?.[1];
      if (data?.status !== "success" || metadata?.type !== "video" || metadata.provider_name !== "TikTok" || returnedId !== match[2] ||
          metadata.author_url !== `https://www.tiktok.com/@${match[1]}`) throw new Error("Different TikTok video returned.");
      const remaining = Number.isInteger(data.remaining_today) && data.remaining_today >= 0 && data.remaining_today <= 20
        ? ` ${data.remaining_today} video requests left today.` : "";

      // Construct DOM from validated text. Never insert API-provided HTML/scripts.
      const blockquote = document.createElement("blockquote");
      blockquote.className = "tiktok-embed";
      blockquote.setAttribute("cite", source.href);
      blockquote.setAttribute("data-video-id", match[2]);
      blockquote.setAttribute("data-embed-from", "oembed");
      const section = document.createElement("section");
      const author = document.createElement("a");
      author.href = `https://www.tiktok.com/@${match[1]}`;
      author.target = "_blank";
      author.rel = "noopener noreferrer";
      author.textContent = String(metadata.author_name || "@" + match[1]).slice(0, 120);
      const caption = document.createElement("p");
      caption.textContent = String(metadata.title || "TikTok video").slice(0, 2200);
      section.append(author, caption);
      blockquote.append(section);
      host.replaceChildren(blockquote);
      const script = document.createElement("script");
      script.src = "https://www.tiktok.com/embed.js";
      script.async = true;
      script.addEventListener("error", () => notify("error", "TikTok's embed script could not load. Please use the source link below."), { once: true });
      script.addEventListener("load", () => notify("loading", "TikTok's official player is loading. Availability depends on TikTok and your region." + remaining), { once: true });
      notify("loading", "Opening TikTok's official player from cached details…" + remaining);
      document.body.append(script);
    } catch {
      notify("error", "The TikTok embed could not load. No automatic retry was made; please use the source link below.");
    }
  }
  void start();
})();
