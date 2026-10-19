import illustrations from "./review-illustrations.json" with { type: "json" };
import { thumbnailKey } from "./tiktok-thumbnail-cache.js";

// Separate editorial artwork; never substitute these for a source video poster.
// Owner source/title/slug changes disable a stale association without touching D1.
function sourceIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const videoId = /(?:^|\.)youtube\.com$/.test(url.hostname) || /(?:^|\.)facebook\.com$/.test(url.hostname)
      ? url.searchParams.get("v") : "";
    return url.origin + url.pathname + (videoId ? `?v=${encodeURIComponent(videoId)}` : "");
  } catch { return ""; }
}

const byId = new Map(illustrations.map((item) => [item.id, Object.freeze(item)]));

// Keep previously shared artwork URLs working without serving superseded lettering.
const previousPaths = new Map(illustrations.filter(item => item.previousPath)
  .map(item => [item.previousPath, item.path]));

export function reviewIllustrationRedirect(path) {
  return previousPaths.get(path) || null;
}

export function reviewIllustration(row) {
  const item = byId.get(Number(row?.id));
  if (!item || row.published === false || row.published === 0 ||
      row.slug !== item.slug || row.title !== item.expectedTitle ||
      sourceIdentity(row.source_url) !== sourceIdentity(item.sourceUrl)) return null;
  return item;
}

// Only the eight audited HTML-as-image placeholders opt in. A new owner
// thumbnail disables this fallback as well as the usual title/source guards.
export function reviewPreviewIllustration(row) {
  const item = reviewIllustration(row);
  return item?.previewFallbackFrom && row.thumbnail_url === item.previewFallbackFrom
    ? item : null;
}

// Only audited missing or generic TikTok posters opt in. Store a digest, never
// a signed CDN address. Any owner image edit or saved source poster wins.
export async function tikTokReviewPreviewIllustration(row, bucket) {
  const item = reviewIllustration(row);
  if (!item?.previewFallbackThumbnailSha256 || !bucket?.head) return null;
  const source = new URL(item.sourceUrl);
  if (source.hostname !== "www.tiktok.com") return null;
  const id = source.pathname.match(/\/video\/(\d{15,25})$/)?.[1];
  if (!id) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.thumbnail_url || ""));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== item.previewFallbackThumbnailSha256) return null;
  let timer;
  try {
    const saved = await Promise.race([
      bucket.head(thumbnailKey(id)),
      new Promise(resolve => { timer = setTimeout(() => resolve(true), 1500); }),
    ]);
    if (saved) return null;
  } catch { return null; }
  finally { clearTimeout(timer); }
  return item;
}
