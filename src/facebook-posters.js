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

export async function readFacebookPoster(env, row, getPreview, { cacheOnly = false } = {}) {
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
  // Homepage requests must not wait on a remote Facebook page or signed CDN URL.
  // Scheduled jobs may still fetch approved image bytes and save them into R2.
  if (cacheOnly) return null;
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

// Fast, honest on-site artwork when Facebook does not expose a usable cover.
// Unlike a remote signed image, this is always a valid image and never a broken <img>.
export function facebookPlaceholderResponse(row) {
  const escape = value => String(value || "").replace(/[\\u0000-\\u001f]/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const words = String(row?.title || "Facebook video").trim().split(/\\s+/);
  const lines = [""];
  for (const word of words) {
    const index = lines.length - 1;
    if (lines[index] && (lines[index] + " " + word).length > 32 && lines.length < 3) lines.push(word);
    else lines[index] = (lines[index] ? lines[index] + " " : "") + word;
  }
  const title = lines.slice(0, 3).map((line, index) =>
    '<text x="42" y="' + (194 + 44 * index) + '" fill="#f0f5ff" font-size="28" font-weight="700" font-family="Arial,sans-serif">' +
    escape(line.slice(0, 37)) + '</text>').join("");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Facebook video preview artwork">' +
    '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#1d294c"/><stop offset="1" stop-color="#080c1e"/></linearGradient></defs>' +
    '<rect width="640" height="360" fill="url(#bg)"/><circle cx="580" cy="10" r="165" fill="#3156a8" opacity=".18"/>' +
    '<rect x="28" y="28" rx="16" width="193" height="43" fill="#284783"/>' +
    '<text x="44" y="57" fill="white" font-size="18" font-weight="bold" font-family="Arial,sans-serif">FACEBOOK VIDEO</text>' +
    title + '<rect x="0" y="333" width="640" height="27" fill="#1c335d"/>' +
    '<text x="42" y="351" fill="#b5d3ff" font-size="13" font-family="Arial,sans-serif">Vid.Best • Preview artwork (not video footage)</text></svg>';
  return new Response(svg, { status: 200, headers: {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    "X-Content-Type-Options": "nosniff",
  } });
}
