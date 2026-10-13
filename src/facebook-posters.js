// Stable poster URLs and durable thumbnail bytes; full provider videos stay embedded.
function fingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16);
}

function facebookCdnImage(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return "";
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "fbcdn.net" || host.endsWith(".fbcdn.net") || host === "facebook.com" || host.endsWith(".facebook.com"))
      ? url.toString() : "";
  } catch { return ""; }
}

function providerImage(value) {
  const image = facebookCdnImage(value);
  if (!image) return "";
  const url = new URL(image);
  // Facebook video/share pages are HTML, even when pasted into the cover field.
  if ((url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com")) &&
      !/\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) return "";
  return image;
}

export function facebookPosterUrl(row) {
  // Preserve uploaded/custom covers and small bundled previews.
  if (row.thumbnail_url && !facebookCdnImage(row.thumbnail_url)) return row.thumbnail_url;
  const version = fingerprint(row.source_url + "|" + (row.thumbnail_url || ""));
  return `/api/facebook/thumbnail?id=${Number(row.id)}&v=${version}`;
}

async function boundedImage(response) {
  const limit = 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > limit || !response.body) throw new Error("Poster too large");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Poster too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readFacebookPoster(env, row, getPreview) {
  const version = fingerprint(row.source_url + "|" + (row.thumbnail_url || ""));
  const key = `facebook-thumbnails/${Number(row.id)}-${version}`;
  let stored;
  try { stored = await env.BUCKET?.get(key); } catch { /* The provider thumbnail remains a fallback. */ }
  const headers = {
    "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
    "X-Content-Type-Options": "nosniff",
  };
  if (stored) {
    const metadata = new Headers(headers);
    stored.writeHttpMetadata(metadata);
    metadata.set("ETag", stored.httpEtag);
    return new Response(stored.body, { headers: metadata });
  }
  const storedThumbnail = providerImage(row.thumbnail_url);
  const fetchImage = async thumbnail => {
    if (!thumbnail) return null;
    let image;
    try { image = await fetch(thumbnail, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg", "User-Agent": "VidBest-Facebook-Preview/1.0" },
      signal: AbortSignal.timeout(7000),
      redirect: "error",
    }); } catch { return null; }
    const type = (image.headers.get("Content-Type") || "").split(";")[0].toLowerCase();
    if (!image.ok || !/^image\/(?:jpeg|png|webp|avif|gif)$/.test(type)) {
      await image.body?.cancel();
      return null;
    }
    let bytes;
    try { bytes = await boundedImage(image); } catch { return null; }
    return bytes.byteLength ? { bytes, type } : null;
  };
  let result = await fetchImage(storedThumbnail);
  if (!result) {
    let preview;
    try { preview = await getPreview(); } catch { return null; }
    const refreshed = providerImage(preview?.thumbnail_url);
    if (refreshed && refreshed !== storedThumbnail) result = await fetchImage(refreshed);
  }
  if (!result) return null;
  const { bytes, type } = result;
  try { await env.BUCKET?.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: headers["Cache-Control"] } }); } catch { /* Serve valid bytes even when durable storage is temporarily unavailable. */ }
  return new Response(bytes, { headers: { ...headers, "Content-Type": type } });
}
