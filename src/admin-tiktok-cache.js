// Administrative authorization for one specific TikTok cache request.
// Only the authenticated admin API calls these functions; never expose the secret.
const IGNORE_IDS = new Set(["7332342275151760642", "7669587518156705056"]);
const encoder = new TextEncoder();

export function tikTokCacheCandidate(row) {
  if (!row || Number(row.redistribution_certified) !== 1 || row.r2_key || row.cache_source_url || row.media_type !== "tiktok") return null;
  try {
    const url = new URL(String(row.source_url || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["www.tiktok.com", "tiktok.com"].includes(url.hostname.toLowerCase())) return null;
    const id = url.pathname.match(/^\/@[a-zA-Z0-9_.]{1,32}\/video\/(\d{15,25})\/?$/)?.[1];
    if (!id || IGNORE_IDS.has(id)) return null;
    return { id, url: `https://www.tiktok.com${url.pathname.replace(/\/$/, '')}` };
  } catch { return null; }
}

export async function dispatchAdminTikTokCache(env, row) {
  const source = tikTokCacheCandidate(row);
  if (!source) throw new Error("Video must have saved redistribution rights and a valid, uncached TikTok URL");
  const secret = String(env.CACHE_HOOK_SECRET || env.VIDBEST_CACHE_HOOK_SECRET || "");
  if (secret.length < 32) throw new Error("CACHE_HOOK_SECRET not configured");
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const message = ts + "\n" + nonce + "\n" + source.id + "\n" + source.url;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  const signature = Array.from(signatureBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  let res;
  try {
    res = await fetch("https://video.megasale.win/cache/authorized", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      "x-vidbest-cache-timestamp": ts,
      "x-vidbest-cache-nonce": nonce,
      "x-vidbest-cache-signature": signature,
    },
    body: JSON.stringify({ id: source.id, url: source.url }),
    });
  } catch {
    throw new Error("Portainer cache gateway could not be reached within 8 seconds. The job will retry automatically.");
  }
  if (res.status !== 202) {
    const header = res.headers.get('Retry-After');
    const seconds = /^\d+$/.test(header || '') ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
    await res.body?.cancel();
    const message = res.status >= 300 && res.status < 400
      ? 'Cache gateway redirected the signed request. Redirects are not followed; check the tunnel route.'
      : [401, 403].includes(res.status)
        ? 'Cache gateway rejected authorization. Check that CACHE_HOOK_SECRET matches in the Worker and Portainer.'
        : res.status === 503
          ? 'Cache gateway is unavailable or its webhook is disabled. Check Portainer CACHE_HOOK_SECRET, TESTER_TOKEN and RAPIDAPI_CACHE_ENABLED.'
          : `Cache gateway returned HTTP ${res.status}. Check the Node app and tunnel health.`;
    throw Object.assign(new Error(message), { retry: Math.max(900, Number.isFinite(seconds) ? Math.min(604800, seconds) : 0) });
  }
  const payload = await readAcknowledgment(res);
  if (payload?.status !== 'queued' || String(payload.video_id) !== source.id) throw new Error('Gateway did not acknowledge the requested video ID.');
  return { status: "queued", video_id: source.id };
}

async function readAcknowledgment(response) {
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel();
    throw new Error('Cache gateway returned a non-JSON response. Check the app:8080 tunnel route.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Cache gateway returned an empty response.');
  let text = '', size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error('Cache gateway response is too large.'); }
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text + decoder.decode()); }
    catch { throw new Error('Cache gateway returned invalid JSON.'); }
  } finally { reader.releaseLock(); }
}
