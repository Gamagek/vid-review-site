// This classification only suppresses view counters; it never grants access.
const CRAWLER_PATTERN = /\b(?:[a-z0-9_-]*(?:bot|crawler|spider)|slurp|bingpreview|google-inspectiontool|facebookexternalhit|whatsapp|vidbest-seo-audit)\b/i;

export function isLikelyCrawler(value) {
  if (typeof value !== "string" && (value?.cf?.botManagement?.verifiedBot
    || value?.cf?.verifiedBotCategory === "Search Engine Crawler")) return true;
  const userAgent = typeof value === "string" ? value : value?.headers?.get?.("User-Agent") || "";
  return CRAWLER_PATTERN.test(userAgent);
}
