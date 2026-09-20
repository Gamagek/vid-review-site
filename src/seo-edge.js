import edgeWorker from "./edge.js";

const CANONICAL_ORIGIN = "https://vid.best";
const LEGACY_HOSTS = new Set(["home.vid.best", "www.vid.best"]);
const MIN_INDEXABLE_CATEGORY_VIDEOS = 3;
const CATEGORY_DESCRIPTIONS = Object.freeze({
  "Entertainment, Movies & Games": "Explore movie trailers, film reviews, gameplay, esports, animation and pop culture video discoveries.",
  "Lifestyle, Health & Fitness": "Explore practical videos about fitness, food habits, mindfulness, daily life, fashion and healthy living.",
  "Environment & Sustainability": "Explore videos about renewable energy, electric mobility, conservation, zero waste and practical eco-technology.",
  "Technology": "Explore video reviews and explainers covering AI, gadgets, software, web development, cybersecurity and technology news.",
  "Food & Cooking": "Explore recipes, street food, baking, restaurant reviews, healthy meals and practical cooking discoveries.",
  "Education": "Explore tutorials, science, history, languages, courses, lectures and Buddhist studies through useful video discoveries.",
  "Funny & Comedy": "Explore sketches, stand-up, pranks, memes, compilations and lighthearted comedy videos.",
  "Music": "Explore music videos, live performances, instrument tutorials, covers and relaxing audio discoveries.",
  "Arts & Culture": "Explore digital art, drawing, architecture, photography, literature and book-related video discoveries.",
  "Adventure & Travel": "Explore travel guides, road trips, camping, hiking and adventure-focused video discoveries.",
  "Business & Economy": "Explore entrepreneurship, finance, e-commerce, marketing, crypto and economy-focused video discoveries.",
  "Social Media & Trending": "Explore YouTube, TikTok, Facebook and Instagram trends plus creator and social-media news.",
  "Spirituality": "Explore Buddhism, meditation, contemplative traditions, sacred texts and comparative spirituality videos.",
  "Other": "Explore useful video discoveries that do not fit the main topic categories."
});

const CATEGORY_ORDER = Object.keys(CATEGORY_DESCRIPTIONS);
const CATEGORY_BY_SLUG = new Map(
  CATEGORY_ORDER.map((name) => [slugify(name), name]),
);

function cleanText(value, maximum, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value)
    .replace(/[\\u0000-\\u001F\\u007F]/g, " ")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function cleanLongText(value, maximum, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/\\u0000/g, "").trim().slice(0, maximum);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function escapeXml(value) {
  return escapeHtml(value);
}

function jsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/-->/g, "--\\u003e");
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function categoryUrl(name) {
  return `${CANONICAL_ORIGIN}/category/${encodeURIComponent(slugify(name))}`;
}

function standardHeaders(contentType, cacheControl = "public, max-age=60") {
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'"
  });
}

function htmlResponse(html, status = 200, robots = "index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1") {
  const headers = standardHeaders("text/html; charset=utf-8");
  headers.set("X-Robots-Tag", robots);
  return new Response(html, { status, headers });
}

function redirectToCanonical(request) {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, CANONICAL_ORIGIN).toString();
  return new Response(null, {
    status: 301,
    headers: {
      Location: target,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function resolveCategory(pathname) {
  const match = pathname.match(/^\/category\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return CATEGORY_BY_SLUG.get(decodeURIComponent(match[1])) || null;
  } catch {
    return null;
  }
}

async function categoryStats(env) {
  const result = await env.DB.prepare(
    `SELECT primary_category, COUNT(*) AS total, MAX(updated_at) AS lastmod
     FROM videos
     WHERE published = 1
     GROUP BY primary_category
     ORDER BY primary_category ASC`,
  ).all();
  return result.results || [];
}

async function categoryRows(env, category) {
  const result = await env.DB.prepare(
    `SELECT v.id, v.slug, v.title, v.description, v.review_text, v.thumbnail_url,
            v.subcategory, v.views, v.created_at, v.updated_at
     FROM videos v
     WHERE v.published = 1 AND v.primary_category = ?
     ORDER BY v.featured DESC, v.trending DESC, v.reaction_count DESC, v.updated_at DESC, v.id DESC
     LIMIT 30`,
  ).bind(category).all();
  return result.results || [];
}

function categoryCard(row) {
  const url = `${CANONICAL_ORIGIN}/watch/${encodeURIComponent(row.slug)}`;
  const description = cleanLongText(row.description || row.review_text || "", 320) ||
    "Open the full Vid.Best review and discovery page.";
  const thumb = row.thumbnail_url ? cleanText(row.thumbnail_url, 2000) : "";
  const image = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(row.title)} thumbnail" loading="lazy" decoding="async" width="640" height="360">`
    : `<span class="media-fallback" aria-hidden="true">▶</span>`;
  const dateValue = row.updated_at || row.created_at || "";
  let dateText = "";
  try {
    dateText = dateValue ? new Date(dateValue).toISOString().slice(0, 10) : "";
  } catch {
    dateText = "";
  }

  return `
    <article class="video-tile glass-panel">
      <a class="tile-media" href="${escapeHtml(url)}" aria-label="Open ${escapeHtml(row.title)}">
        ${image}
        <span class="play-orb" aria-hidden="true">▶</span>
      </a>
      <div class="tile-content">
        <div class="tile-badges">
          <span class="badge">${escapeHtml(row.subcategory)}</span>
        </div>
        <h2><a class="tile-title" href="${escapeHtml(url)}">${escapeHtml(row.title)}</a></h2>
        <p class="tile-description">${escapeHtml(description)}</p>
        <div class="tile-meta">
          <span>${Number(row.views || 0).toLocaleString()} views</span>
          ${dateText ? `<time datetime="${escapeHtml(dateValue)}">${escapeHtml(dateText)}</time>` : ""}
        </div>
      </div>
    </article>`;
}

function categoryPage(category, rows, total) {
  const canonical = categoryUrl(category);
  const description = `${CATEGORY_DESCRIPTIONS[category]} ${total.toLocaleString()} published review${total === 1 ? "" : "s"} are currently in this topic.`;
  const firstThumb = rows.find((row) => row.thumbnail_url)?.thumbnail_url || "";
  const itemList = rows.map((row, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: row.title,
    url: `${CANONICAL_ORIGIN}/watch/${encodeURIComponent(row.slug)}`
  }));
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": canonical,
        url: canonical,
        name: `${category} Video Reviews & Discoveries | Vid.Best`,
        description,
        isPartOf: { "@id": `${CANONICAL_ORIGIN}/#website` },
        mainEntity: { "@id": `${canonical}#items` }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: CANONICAL_ORIGIN + "/" },
          { "@type": "ListItem", position: 2, name: category, item: canonical }
        ]
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#items`,
        name: `${category} videos`,
        itemListElement: itemList
      }
    ]
  };
  const noindex = total < MIN_INDEXABLE_CATEGORY_VIDEOS;
  const relatedCategories = CATEGORY_ORDER
    .filter((name) => name !== category)
    .map((name) => `<a class="button ghost" href="${escapeHtml(categoryUrl(name))}">${escapeHtml(name)}</a>`)
    .join("");
  const cards = rows.map(categoryCard).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(category)} Video Reviews &amp; Discoveries | Vid.Best</title>
  <meta name="description" content="${escapeHtml(description.slice(0, 175))}">
  <meta name="robots" content="${noindex ? "noindex,follow" : "index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1"}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Vid.Best">
  <meta property="og:title" content="${escapeHtml(category)} Video Reviews &amp; Discoveries | Vid.Best">
  <meta property="og:description" content="${escapeHtml(description.slice(0, 175))}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  ${firstThumb ? `<meta property="og:image" content="${escapeHtml(firstThumb)}">` : ""}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(category)} Video Reviews &amp; Discoveries | Vid.Best">
  <meta name="twitter:description" content="${escapeHtml(description.slice(0, 175))}">
  ${firstThumb ? `<meta name="twitter:image" content="${escapeHtml(firstThumb)}">` : ""}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">${jsonForHtml(schema)}</script>
</head>
<body>
  <header class="site-header compact">
    <a class="brand" href="/" aria-label="Vid.Best homepage"><span class="brand-mark">V</span><span>Vid.Best</span></a>
    <a class="button ghost" href="/">Explore all videos</a>
  </header>
  <main class="watch-shell">
    <section class="watch-copy glass-panel">
      <p class="eyebrow">Topic library</p>
      <h1>${escapeHtml(category)} video reviews</h1>
      <p class="lead">${escapeHtml(CATEGORY_DESCRIPTIONS[category])}</p>
      <p>Browse ${total.toLocaleString()} published review${total === 1 ? "" : "s"} in this topic. Each title opens a permanent Vid.Best page with its description, review notes, media details and related discoveries.</p>
      ${noindex ? `<p><strong>This topic is still growing.</strong> It will become a searchable category landing page once it has at least ${MIN_INDEXABLE_CATEGORY_VIDEOS} published reviews.</p>` : ""}
    </section>
    <section class="comments-panel glass-panel" aria-labelledby="category-videos-heading">
      <div class="related-heading"><div><p class="eyebrow">Latest topic discoveries</p><h2 id="category-videos-heading">Videos in ${escapeHtml(category)}</h2></div></div>
      <div class="video-grid">${cards}</div>
    </section>
    <nav class="related-panel glass-panel" aria-label="Other Vid.Best categories">
      <div class="related-heading"><div><p class="eyebrow">Continue exploring</p><h2>More topics</h2></div></div>
      <div class="hero-actions">${relatedCategories}</div>
    </nav>
  </main>
  <footer class="site-footer">
    <a class="brand small" href="/"><span class="brand-mark">V</span><span>Vid.Best</span></a>
    <p>Video review and discovery, designed for curiosity.</p>
  </footer>
</body>
</html>`;
}

async function handleCategory(request, env, category) {
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM videos WHERE published = 1 AND primary_category = ?",
  ).bind(category).first();
  const total = Number(countRow?.total || 0);

  if (!total) {
    return htmlResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Topic not found | Vid.Best</title><link rel="stylesheet" href="/styles.css"></head><body><main class="empty-page"><h1>Topic not found</h1><p>This topic has no published video reviews yet.</p><a class="button primary" href="/">Return home</a></main></body></html>`,
      404,
      "noindex,nofollow"
    );
  }

  const rows = await categoryRows(env, category);
  return htmlResponse(
    categoryPage(category, rows, total),
    200,
    total < MIN_INDEXABLE_CATEGORY_VIDEOS
      ? "noindex,follow"
      : "index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1"
  );
}

async function categorySitemap(env) {
  const stats = await categoryStats(env);
  const entries = stats
    .filter((row) => Number(row?.total || 0) >= MIN_INDEXABLE_CATEGORY_VIDEOS)
    .map((row) =>
      `<url><loc>${escapeXml(categoryUrl(row.primary_category))}</loc>${row.lastmod ? `<lastmod>${escapeXml(row.lastmod)}</lastmod>` : ""}</url>`
    )
    .join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  return new Response(body, {
    status: 200,
    headers: standardHeaders("application/xml; charset=utf-8", "public, max-age=900")
  });
}

async function combinedSitemap(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM videos WHERE published = 1").first();
  const pages = Math.max(1, Math.ceil(Number(row?.total || 0) / 1000));
  const videoSitemaps = Array.from({ length: pages }, (_, index) =>
    `<sitemap><loc>${escapeXml(`${CANONICAL_ORIGIN}/sitemaps/videos-${index + 1}.xml`)}</loc></sitemap>`
  ).join("");

  const stats = await categoryStats(env);
  const hasCategories = stats.some((item) => Number(item?.total || 0) >= MIN_INDEXABLE_CATEGORY_VIDEOS);
  const categoryEntry = hasCategories
    ? `<sitemap><loc>${escapeXml(CANONICAL_ORIGIN + "/sitemaps/categories.xml")}</loc></sitemap>`
    : "";

  const body = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${videoSitemaps}${categoryEntry}</sitemapindex>`;
  return new Response(body, {
    status: 200,
    headers: standardHeaders("application/xml; charset=utf-8", "public, max-age=900")
  });
}

function homepageTopicLinks() {
  return CATEGORY_ORDER.map((name) =>
    `<a href="${escapeHtml(categoryUrl(name))}">${escapeHtml(name)}</a>`
  ).join(" · ");
}

function enrichHomepageHtml(html) {
  let output = String(html);

  if (!output.includes("vidbest-seo-topic-nav")) {
    const nav = `<nav id="vidbest-seo-topic-nav" class="vidbest-seo-topic-nav" aria-label="Explore video review categories">
      <strong>Explore video reviews by topic:</strong>
      <span>${homepageTopicLinks()}</span>
    </nav>`;
    output = output.replace("</footer>", `${nav}</footer>`);
  }

  output = output
    .replace("Vid.Best — Video Review & Discovery", "Vid.Best — Video Reviews, Tutorials & Discoveries")
    .replace("Find videos worth <em>your time.</em>", "Video reviews, tutorials &amp; discoveries worth <em>your time.</em>")
    .replace(
      "Discover thoughtful video reviews, tutorials, culture, technology, education and trending stories on Vid.Best.",
      "Explore original video reviews, tutorials and discoveries across technology, education, culture, travel, food, entertainment and more on Vid.Best."
    )
    .replace(
      'content="Curated video reviews and discoveries across technology, education, culture, travel and more."',
      'content="Explore original video reviews, tutorials and discoveries across technology, education, culture, travel, food, entertainment and more."'
    );

  if (!output.includes('class="vidbest-seo-topic-nav"')) return output;
  if (!output.includes("vidbest-seo-topic-nav-style")) {
    output = output.replace(
      "</head>",
      `<style id="vidbest-seo-topic-nav-style">.vidbest-seo-topic-nav{margin:0 auto;padding:16px 24px;max-width:1200px;font-size:13px;line-height:2}.vidbest-seo-topic-nav a{margin-right:6px;white-space:nowrap}.vidbest-seo-topic-nav strong{display:block;margin-bottom:4px}</style></head>`
    );
  }
  return output;
}

async function passThroughHome(request, env, ctx) {
  const response = await edgeWorker.fetch(request, env, ctx);
  const url = new URL(request.url);
  const headers = new Headers(response.headers);

  if (url.pathname === "/" && url.search) {
    headers.set("X-Robots-Tag", "noindex,follow");
  }

  const contentType = headers.get("Content-Type") || "";
  if (!contentType.includes("text/html")) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  const html = enrichHomepageHtml(await response.text());
  headers.delete("Content-Length");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();

    if (LEGACY_HOSTS.has(hostname) && ["GET", "HEAD"].includes(request.method)) {
      return redirectToCanonical(request);
    }

    const category = resolveCategory(url.pathname);
    if (category && ["GET", "HEAD"].includes(request.method)) {
      return handleCategory(request, env, category);
    }

    if (url.pathname === "/sitemaps/categories.xml" && ["GET", "HEAD"].includes(request.method)) {
      return categorySitemap(env);
    }

    if (url.pathname === "/sitemap.xml" && ["GET", "HEAD"].includes(request.method)) {
      return combinedSitemap(env);
    }

    return passThroughHome(request, env, ctx);
  },

  scheduled(...args) {
    return edgeWorker.scheduled?.(...args);
  }
};
