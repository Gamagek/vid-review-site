// Stable, public, review-associated TikTok preview image URLs.
// This does NOT download/rehost TikTok video media, and never overwrites the
// editor's original thumbnail field. Prefer owner-selected permanent covers.
// Every other TikTok video uses the first-party poster endpoint, which returns
// an existing authorized R2 thumbnail if cached, otherwise a clearly labelled
// generated preview graphic (not a claimed still from inaccessible footage).
const FIRST_PARTY = "https://vid.best";
const TIKTOK_ID = /\/video\/(\d{15,25})(?:[/?#]|$)/;
const OWNED_IMAGE = /^\/(?:review-covers\/[a-z0-9_-]+\.(?:jpe?g|png|webp|avif)|media\/uploads\/tiktok-thumbnails\/\d{15,25}\.img)$/i;

// Existing owner-approved exception players and thumbnail presentations.
const REFERENCE_IDS = new Set([
  "7603012203595320584", // Proposal
  "7332342275151760642", // Summer Inverted
  "7578945803910270230", // Top 5
  "7669587518156705056", // Saiyaara
]);

export function preservedTikTokReference(value) {
  const string = String(value || "");
  const id = REFERENCE_IDS.has(string) ? string : string.match(TIKTOK_ID)?.[1];
  return Boolean(id && REFERENCE_IDS.has(id));
}

// A cached-poster URL may return a synthetic SVG when R2 has no genuine cover.
// For search engines, claim a TikTok SOURCE thumbnail only when D1 confirms
// the stable, first-party copy of that exact TikTok ID. Zero R2 HEAD/D1 reads.
export function verifiedTikTokSourceImage(row, origin = FIRST_PARTY) {
  if (String(row?.media_type || row?.provider || "").toLowerCase() !== "tiktok") return "";
  const id = String(row.source_url || "").match(TIKTOK_ID)?.[1];
  if (!id || preservedTikTokReference(id)) return "";
  try {
    const saved = new URL(String(row.thumbnail_url || ""), origin);
    const canonical = new URL("/media/uploads/tiktok-thumbnails/" + id + ".img", origin);
    if (saved.href === canonical.href) return canonical.href;
    // The owner may deliberately choose an original or editorial review cover.
    // It remains the published video poster, not a claimed TikTok frame.
    // Registered conceptual illustrations stay in their separate media fields.
    if (saved.origin === new URL(origin).origin && !saved.search && !saved.hash &&
        /^\/review-covers\/[a-z0-9_-]+\.(?:jpe?g|png|webp|avif)$/i.test(saved.pathname)) return saved.href;
    return "";
  } catch { return ""; }
}

export function stableTikTokImage(row, origin = FIRST_PARTY) {
  const original = String(row?.thumbnail_url || "").trim();
  if (String(row?.media_type || row?.provider || "").toLowerCase() !== "tiktok") return original;
  const id = String(row?.source_url || "").match(TIKTOK_ID)?.[1];
  if (!id) return original;
  const cachedSourceImage = verifiedTikTokSourceImage(row, origin);
  if (cachedSourceImage) return cachedSourceImage;
  const ownedCoverAllowed = row?.primary_category !== "Funny & Comedy" &&
    row?.slug !== "saiyaara-a-cinematic-romance" &&
    row?.slug !== "summer-inverted-7332342275151760642";
  try {
    if (original && ownedCoverAllowed) {
      const image = new URL(original, origin);
      if (image.origin === origin && !image.search && !image.hash &&
          !image.username && !image.password && OWNED_IMAGE.test(image.pathname)) {
        return image.href;
      }
    }
  } catch { /* Expired, invalid or third-party images use the durable poster. */ }
  return `${origin}/api/tiktok/cached-poster?id=${id}`;
}
