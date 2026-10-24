// A single YouTube playlist player with server-rendered links to existing
// independently reviewed videos. No YouTube API, bulk video fetches or D1 writes.
// This module is imported only from the SEO Worker so the main app is unchanged.
export const FANTASTIC_BEASTS_ROUTE = "/playlist/fantastic-beasts-video-collection";
export const FANTASTIC_BEASTS_PLAYLIST_ID = "PLfDrdp3ebgGt_Ew5TiazwOx4U-VBZv10S";
const ORIGIN = "https://vid.best";
const PAGE_URL = ORIGIN + FANTASTIC_BEASTS_ROUTE;
const PLAYLIST_URL = "https://www.youtube.com/playlist?list=" + FANTASTIC_BEASTS_PLAYLIST_ID;
const EMBED_URL = "https://www.youtube.com/embed?listType=playlist&list=" + FANTASTIC_BEASTS_PLAYLIST_ID;

// Only exact IDs the publisher has already supplied and reviewed are listed.
// Do not claim an external playlist's full count or auto-import unknown videos.
// When the next editorial batch is published, add its verified IDs here.
export const FANTASTIC_BEASTS_REVIEW_IDS = Object.freeze([
  "Y9dr2zw-TXQ",
  "guPCBCXrCrs",
  "DaM_wL1ZOM4",
  "Dgvb78SQqLY",
  "yKN2PasVT3c",
]);
const REVIEW_URLS = FANTASTIC_BEASTS_REVIEW_IDS.map(id => "https://www.youtube.com/watch?v=" + id);

const TITLE = "Fantastic Beasts Playlist & Scene-by-Scene Reviews | Vid.Best";
const SUMMARY = "Watch a curated Fantastic Beasts YouTube playlist in one player, then explore original reviews of the trailers, Grindelwald's duel, Credence's confrontation and a film recap.";

function escapeHtml(input) {
  return String(input ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/-->/g, "--\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function validThumbnail(row) {
  if (!row?.thumbnail_url) return "";
  try {
    const url = new URL(row.thumbnail_url, ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    // Only an existing genuine thumbnail URL; do not invent placeholder images.
    if (!["vid.best", "i.ytimg.com", "img.youtube.com"].includes(url.hostname)) return "";
    return url.href;
  } catch { return ""; }
}

function publicationTime(value) {
  const iso = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(iso)) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.valueOf())) return null;
  // Display date in the editorial site's original Asia/Colombo timezone.
  return { iso, display: new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo",
  }).format(date) };
}

function publishedReviewCards(reviews) {
  if (!reviews.length) return '<p class="playlist-empty">Individual reviews will appear here as they are published. <a href="/videos">Browse the full review library</a>.</p>';
  return '<div class="playlist-review-grid">' + reviews.map(review => {
    const url = ORIGIN + "/watch/" + encodeURIComponent(review.slug);
    const name = escapeHtml(review.title);
    const description = escapeHtml(String(review.description || "Read the independent editorial review.").replace(/\s+/g, " ").trim().slice(0, 300));
    const thumb = validThumbnail(review);
    const date = publicationTime(review.created_at);
    const cover = thumb
      ? '<img src="' + escapeHtml(thumb) + '" alt="' + name + ' video thumbnail" loading="lazy" decoding="async" width="640" height="360">'
      : '<span class="playlist-review-cover-placeholder" aria-hidden="true">🎬</span>';
    return '<article class="playlist-review-card">'
      + '<a class="playlist-review-cover" href="' + escapeHtml(url) + '" aria-label="Read ' + name + '">' + cover + '</a>'
      + '<div class="playlist-review-copy">'
      + '<h3><a href="' + escapeHtml(url) + '">' + name + '</a></h3>'
      + '<p>' + description + '</p>'
      + (date ? '<time datetime="' + escapeHtml(date.iso) + '">Published ' + escapeHtml(date.display) + '</time>' : '')
      + '<a class="playlist-review-link" href="' + escapeHtml(url) + '">Read full review →</a>'
      + '</div></article>';
  }).join("") + "</div>";
}

export function renderFantasticBeastsPlaylist(reviews = []) {
  const verified = new Map(
    reviews.filter(row => row && REVIEW_URLS.includes(row.source_url)
      && typeof row.slug === "string" && /^[a-z0-9-]+$/.test(row.slug)
      && typeof row.title === "string" && row.title.trim())
      .map(row => [row.source_url, row])
  );
  const ordered = REVIEW_URLS.map(url => verified.get(url)).filter(Boolean);
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": PAGE_URL + "#webpage",
        url: PAGE_URL,
        name: TITLE,
        description: SUMMARY,
        inLanguage: "en",
        isPartOf: { "@id": ORIGIN + "/#website" },
        breadcrumb: { "@id": PAGE_URL + "#breadcrumb" },
        mainEntity: { "@id": PAGE_URL + "#reviews" },
      },
      {
        "@type": "BreadcrumbList",
        "@id": PAGE_URL + "#breadcrumb",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: ORIGIN + "/" },
          { "@type": "ListItem", position: 2, name: "Fantastic Beasts collection", item: PAGE_URL },
        ],
      },
      {
        "@type": "ItemList",
        "@id": PAGE_URL + "#reviews",
        name: "Published Fantastic Beasts editorial reviews",
        numberOfItems: ordered.length,
        itemListElement: ordered.map((row, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: row.title,
          url: ORIGIN + "/watch/" + encodeURIComponent(row.slug),
        })),
      },
    ],
  };

  return '<!doctype html><html lang="en"><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + escapeHtml(TITLE) + '</title>'
    + '<meta name="description" content="' + escapeHtml(SUMMARY) + '">'
    + '<meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1">'
    + '<link rel="canonical" href="' + PAGE_URL + '">'
    + '<meta property="og:type" content="website"><meta property="og:site_name" content="Vid.Best">'
    + '<meta property="og:url" content="' + PAGE_URL + '">'
    + '<meta property="og:title" content="' + escapeHtml(TITLE) + '">'
    + '<meta property="og:description" content="' + escapeHtml(SUMMARY) + '">'
    + '<meta name="twitter:card" content="summary">'
    + '<link rel="icon" href="/favicon.svg" type="image/svg+xml">'
    + '<link rel="stylesheet" href="/styles.css">'
    + '<link rel="stylesheet" href="/playlist-fantastic-beasts.css">'
    + '<script type="application/ld+json">' + safeJson(graph) + '</script>'
    + '<script src="/playlist-fantastic-beasts.js" defer></script>'
    + '</head><body>'
    + '<header class="site-header compact"><a class="brand" href="/" aria-label="Vid.Best home"><span class="brand-mark">V</span><span>Vid.Best</span></a><nav aria-label="Main navigation"><a class="button ghost" href="/videos">Browse reviews</a></nav></header>'
    + '<main class="playlist-main">'
    + '<nav class="playlist-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true"> / </span><span>Fantastic Beasts collection</span></nav>'
    + '<section class="playlist-intro" aria-labelledby="playlist-title">'
    + '<p class="playlist-eyebrow">🪄 Wizarding World • Playlist & editorial collection</p>'
    + '<h1 id="playlist-title">Fantastic Beasts: video collection & reviews</h1>'
    + '<p>Watch this YouTube playlist through one player, then explore our separate reviews of the official trailers, pivotal duels and an entertaining film recap. These commentaries examine storytelling, performances, editing and sound—not merely plot summaries.</p>'
    + '</section>'
    + '<section class="playlist-feature" aria-labelledby="playlist-watch-title">'
    + '<h2 id="playlist-watch-title">▶ Watch the YouTube playlist</h2>'
    + '<div class="playlist-player-shell" id="playlist-player">'
    + '<button type="button" id="playlist-load" class="playlist-load" aria-label="Load Fantastic Beasts YouTube playlist player"><span class="playlist-play-icon" aria-hidden="true">▶</span><span>Load playlist player</span><small>One YouTube player • loads only after you select this button</small></button>'
    + '</div>'
    + '<p class="playlist-embed-status" id="playlist-status" role="status" aria-live="polite"></p>'
    + '<p class="playlist-source-note">Playback is provided by YouTube. Video owners can restrict embedding, and playlist contents may change. <a href="' + escapeHtml(PLAYLIST_URL) + '" target="_blank" rel="noopener noreferrer">Open the original playlist on YouTube ↗</a></p>'
    + '</section>'
    + '<section class="playlist-reviews" aria-labelledby="playlist-reviews-title">'
    + '<div class="playlist-section-heading"><h2 id="playlist-reviews-title">📚 Published video reviews (' + ordered.length + ')</h2><p>Each review has its own permanent Vid.Best page and original publication date. The playlist and the reviews are not one rehosted video.</p></div>'
    + publishedReviewCards(ordered)
    + '</section>'
    + '<section class="playlist-highlights" aria-labelledby="playlist-highlights-title">'
    + '<h2 id="playlist-highlights-title">⭐ Editorial guide: what to notice</h2>'
    + '<div class="playlist-highlights-grid"><article><h3>🎞️ Two official trailers</h3><p>Compare how the first trailer sets the stakes and the second offers more character and mission detail. Both use familiar Wizarding World imagery to frame a larger conflict.</p></article>'
    + '<article><h3>⚡ Two different confrontations</h3><p>Grindelwald and Dumbledore carry an ideological and personal rivalry, while Credence brings the painful question of family identity and belonging.</p></article>'
    + '<article><h3>🍿 A short-form story recap</h3><p>See how a fast, spoiler-filled recap selects the Qilin election, Newt’s mission and the blood pact as milestones in a more complicated film narrative.</p></article></div>'
    + '<p class="playlist-disclaimer">These are independent editorial observations. Individual videos belong to their respective creators and rights holders. Review links remain available even when an embed is unavailable.</p>'
    + '</section></main>'
    + '<footer class="site-footer"><a class="brand small" href="/"><span class="brand-mark">V</span><span>Vid.Best</span></a><p>Independent reviews and video discovery.</p><span><a href="/about">About</a> · <a href="/editorial">Editorial policy</a> · <a href="/privacy">Privacy</a> · <a href="/contact">Contact</a></span></footer>'
    + '</body></html>';
}

function responseHeaders() {
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=900",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // Strict page-specific exception for the one explicit YouTube iframe.
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; upgrade-insecure-requests",
  });
}

export async function handleFantasticBeastsPlaylist(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== FANTASTIC_BEASTS_ROUTE || !["GET", "HEAD"].includes(request.method)) return null;
  if (url.search) return Response.redirect(PAGE_URL, 301);

  try {
    // One bounded, read-only D1 query. No nonexistent reviews table, no reads
    // of drafts, no polling for 48 videos, no database mutations or date edits.
    const response = await env.DB.prepare(
      "SELECT id,slug,title,source_url,created_at,thumbnail_url,description " +
      "FROM videos WHERE published=1 AND media_type='youtube' AND source_url IN (?,?,?,?,?)"
    ).bind(...REVIEW_URLS).all();
    return new Response(renderFantasticBeastsPlaylist(response.results || []), {
      status: 200,
      headers: responseHeaders(),
    });
  } catch (error) {
    console.error("Fantastic Beasts playlist temporarily unavailable", error?.message || error);
    return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Playlist temporarily unavailable</title><main><h1>Playlist temporarily unavailable</h1><p>Please try again later or <a href="' + PLAYLIST_URL + '">watch on YouTube</a>.</p></main></html>', {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex,follow",
        "Retry-After": "60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
