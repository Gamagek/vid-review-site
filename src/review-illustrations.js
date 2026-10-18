import illustrations from "./review-illustrations.json" with { type: "json" };

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
