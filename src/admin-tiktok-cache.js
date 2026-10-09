// Administrative authorization for one specific TikTok cache request.
// Only the authenticated admin API calls these functions; never expose the secret.
const IGNORE_IDS = new Set(["7332342275151760642", "7669587518156705056"]);
const encoder = new TextEncoder();

function candidate(row) {
  if (!row || Number(row.redistribution_certified) !== 1 || row.r2_key || row.media_type !== "tiktok") return null;
  try {
    const url = new URL(String(row.source_url || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["www.tiktok.com", "tiktok.com"].includes(url.hostname.toLowerCase())) return null;
    const id = url.pathname.match(/^\/@[^/]+\/video\/(\d{15,25})\/?$/)?.[1];
    if (!id || IGNORE_IDS.has(id)) return null;
    return { id, url: url.toString() };
  } catch { return null; }
}

export async function dispatchAdminTikTokCache(env, row) {
  const source = candidate(row);
  if (!source) throw new Error("Video must have saved redistribution rights and a valid, uncached TikTok URL");
  const secret = String(env.VIDBEST_CACHE_HOOK_SECRET || "");
  if (secret.length < 32) throw new Error("VIDBEST_CACHE_HOOK_SECRET not configured");
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const message = ts + "\n" + nonce + "\n" + source.id + "\n" + source.url;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  const signature = Array.from(signatureBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const res = await fetch("https://video.megasale.win/cache/authorized", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      "x-vidbest-cache-timestamp": ts,
      "x-vidbest-cache-nonce": nonce,
      "x-vidbest-cache-signature": signature,
    },
    body: JSON.stringify({ id: source.id, url: source.url }),
  });
  if (res.status !== 202) throw new Error("Gateway rejected cache request (HTTP " + res.status + ")");
  return { status: "queued", video_id: source.id };
}

export function maybeQueueAdminTikTokCache(env, ctx, row) {
  if (!candidate(row) || String(env.VIDBEST_AUTO_CACHE_TIKTOK || "1") === "0") return;
  if (!ctx?.waitUntil) return;
  ctx.waitUntil(dispatchAdminTikTokCache(env, row).catch((e) => {
    console.warn("[admin-tiktok-auto-cache]", row.id, String(e?.message || e).slice(0, 200));
  }));
}

export async function retryAdminTikTokCache(env, databaseId) {
  const row = await env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(databaseId).first();
  if (!row) return Response.json({ error: "Video not found" }, { status: 404 });
  if (!candidate(row)) return Response.json({
    error: "Save the video with redistribution rights confirmed and an eligible TikTok URL before caching."
  }, { status: 400 });
  try {
    const result = await dispatchAdminTikTokCache(env, row);
    return Response.json({ success: true, ...result }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: String(error?.message || error).slice(0, 180) }, { status: 502 });
  }
}
