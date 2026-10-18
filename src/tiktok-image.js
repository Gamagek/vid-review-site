// Stable, public, review-associated TikTok preview image URLs.
// This does NOT download/rehost TikTok video media, and never overwrites the
// editor's original thumbnail field. Prefer owner-selected permanent covers.
// Every other TikTok video uses the first-party poster endpoint, which returns
// an existing authorized R2 thumbnail if cached, otherwise a clearly labelled
// generated preview graphic (not a claimed still from inaccessible footage).
const FIRST_PARTY = "https://vid.best";
const TIKTOK_ID = /\/video\/(\d{15,25})(?:[/?#]|$)/;
const OWNED_IMAGE = /^\/(?:review-covers\/[a-z0-9_/-]+\.(?:jpe?g|png|webp|avif)|media\/uploads\/tiktok-thumbnails\/\d{15,25}\.img)$/i;

export function stableTikTokImage(row, origin = FIRST_PARTY) {
  const original = String(row?.thumbnail_url || "").trim();
  if (String(row?.media_type || row?.provider || "").toLowerCase() !== "tiktok") return original;
  const id = String(row?.source_url || "").match(TIKTOK_ID)?.[1];
  if (!id) return original;
  try {
    if (original) {
      const image = new URL(original, origin);
      if (image.origin === origin && !image.search && !image.hash &&
          !image.username && !image.password && OWNED_IMAGE.test(image.pathname)) {
        return image.href;
      }
    }
  } catch { /* Expired, invalid or third-party images use the durable poster. */ }
  return `${origin}/api/tiktok/cached-poster?id=${id}`;
}
