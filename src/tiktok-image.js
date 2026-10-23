// Stable, public, review-associated TikTok preview image URLs.
// This does NOT download/rehost TikTok video media, and never overwrites the
// editor's original thumbnail field. Prefer owner-selected permanent covers.
// Every other TikTok video uses the first-party poster endpoint, which returns
// an existing authorized R2 thumbnail if cached, otherwise a clearly labelled
// generated preview graphic (not a claimed still from inaccessible footage).
const FIRST_PARTY = "https://vid.best";
const TIKTOK_ID = /\/video\/(\d{15,25})(?:[/?#]|$)/;
const OWNED_IMAGE = /^\/(?:review-covers\/[a-z0-9_-]+\.(?:jpe?g|png|webp|avif)|media\/uploads\/tiktok-thumbnails\/\d{15,25}\.img)$/i;

// Never alter the player/artwork strategy of the four specifically preserved posts.
export const PRESERVED_TIKTOK_THUMBNAIL_IDS = Object.freeze([
  "7603012203595320584", // Proposal
  "7332342275151760642", // Summer Inverted
  "7578945803910270230", // Top 5
  "7669587518156705056", // Saiyaara
]);

export function isPreservedTikTokThumbnailReference(row) {
  const id = String(row?.source_url || "").match(TIKTOK_ID)?.[1] || "";
  return PRESERVED_TIKTOK_THUMBNAIL_IDS.includes(id);
}

// This is an actual first-party R2 copy made from validated original-image
// bytes, not the generic TikTok-branded SVG returned when R2 has no object.
// Reuse exactly one stable URL in Schema.org, HTML and image/video XML.
export function cachedOriginalTikTokImage(row, origin = FIRST_PARTY) {
  if (String(row?.media_type || row?.provider || "").toLowerCase() !== "tiktok" ||
      isPreservedTikTokThumbnailReference(row)) return "";
  const id = String(row?.source_url || "").match(TIKTOK_ID)?.[1];
  if (!id) return "";
  try {
    const value = new URL(String(row?.thumbnail_url || ""), origin);
    return value.origin === origin && !value.search && !value.hash &&
      value.pathname === `/media/uploads/tiktok-thumbnails/${id}.img` ? value.href : "";
  } catch { return ""; }
}

// Source-image XML should describe a real, stable image instead of the
// generic "TikTok / Cached Preview" SVG. A video with no stored/curated image
// remains crawlable via its normal HTML links, but does not masquerade as a
// source still. The four reference posts keep their previous XML behavior.
export function crawlableTikTokSourceImage(row, origin = FIRST_PARTY) {
  if (isPreservedTikTokThumbnailReference(row)) return stableTikTokImage(row, origin);
  const saved = cachedOriginalTikTokImage(row, origin);
  if (saved) return saved;
  try {
    const image = new URL(stableTikTokImage(row, origin), origin);
    if (image.origin === origin && !image.search && !image.hash &&
        /^\/review-covers\/[a-z0-9_-]+\.(?:jpe?g|png|webp|avif)$/i.test(image.pathname)) return image.href;
  } catch {}
  return "";
}

export function stableTikTokImage(row, origin = FIRST_PARTY) {
  const original = String(row?.thumbnail_url || "").trim();
  if (String(row?.media_type || row?.provider || "").toLowerCase() !== "tiktok") return original;
  const id = String(row?.source_url || "").match(TIKTOK_ID)?.[1];
  if (!id) return original;
  const ownedCoverAllowed = row?.primary_category !== "Funny & Comedy" &&
    row?.slug !== "saiyaara-a-cinematic-romance" &&
    row?.slug !== "summer-inverted-7332342275151760642";
  // Priority: an explicitly curated first-party cover stays as selected;
  // otherwise a verified original-source R2 thumbnail wins over the
  // synthetic cached-poster placeholder. Editorial illustration is separate.
  const cachedOriginal = cachedOriginalTikTokImage(row, origin);
  try {
    if (original && ownedCoverAllowed) {
      const image = new URL(original, origin);
      if (image.origin === origin && !image.search && !image.hash &&
          !image.username && !image.password && OWNED_IMAGE.test(image.pathname)) {
        return image.href;
      }
    }
  } catch { /* Expired, invalid or third-party images use the durable poster. */ }
  if (cachedOriginal) return cachedOriginal;
  return `${origin}/api/tiktok/cached-poster?id=${id}`;
}
