import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import seoWorker from "../src/seo-edge.js";
import { stableTikTokImage } from "../src/tiktok-image.js";

const migrations = [
  "0001_initial.sql",
  "0002_discovery_requests.sql",
  "0003_security_rate_limits.sql",
  "0004_maintenance_indexes.sql",
  "0005_source_video_metadata.sql",
  "0006_test_player_and_comment_images.sql",
  "0007_universal_video_experience.sql",
  "0008_verified_demo_metadata.sql",
  "0009_app_settings.sql",
  "0010_video_analysis.sql",
  "0011_spirituality_buddhism.sql",
  "0022_facebook_readable_slugs.sql",
  "0030_facebook_preview_jobs.sql",
];

class TestD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new TestD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) || null;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    this.database.prepare(this.sql).run(...this.bindings);
    return { success: true };
  }
}

class TestD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new TestD1Statement(this.database, sql);
  }
}

function createContext(overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }

  return {
    sqlite,
    env: {
      APP_NAME: "Vid.Best",
      PUBLIC_BASE_URL: "https://vid.best",
      DB: new TestD1Database(sqlite),
      ASSETS: {
        async fetch() {
          return new Response(`<!doctype html><html><head><title>Vid.Best — Video Review & Discovery</title><meta name="description" content="Discover thoughtful video reviews, tutorials, culture, technology, education and trending stories on Vid.Best."><meta property="og:title" content="Vid.Best — Video Review & Discovery"></head><body><main><h1>Find videos worth <em>your time.</em></h1></main><footer>Footer</footer></body></html>`, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        },
      },
      ...overrides,
    },
    ctx: { waitUntil() {} },
  };
}

function request(context, url, init = {}) {
  return seoWorker.fetch(new Request(url, init), context.env, context.ctx);
}

test("redirects the legacy home subdomain to the canonical origin", async () => {
  const context = createContext();
  const response = await request(context, "https://home.vid.best/watch/example");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), "https://vid.best/watch/example");
});

test("www GET and HEAD redirect public paths and queries before accessing any production binding", async () => {
  const unavailable = () => { throw new Error("Canonical redirects must not need data or assets"); };
  const context = createContext({ DB: { prepare: unavailable }, ASSETS: { fetch: unavailable } });
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/", "/robots.txt", "/ads.txt", "/sitemap.xml", "/privacy", "/daily-weekly-best/films", "/watch/a%20review?topic=music%26film&page=2"]) {
      const response = await request(context, "https://www.vid.best" + path, { method });
      assert.equal(response.status, 301);
      assert.equal(response.headers.get("Location"), "https://vid.best" + path);
      assert.equal(await response.text(), "");
    }
  }
});

test("server-rendered Unicode and escaped review titles remain present without client-side JavaScript", async () => {
  const context = createContext();
  const row = context.sqlite.prepare("SELECT id, slug, views FROM videos WHERE published = 1 ORDER BY id LIMIT 1").get();
  context.sqlite.prepare("UPDATE videos SET title = ?, seo_title = ? WHERE id = ?")
    .run("✨ Learning & friendship — <a new perspective>", "✨ Learning & friendship — <a new perspective>", row.id);
  const response = await request(context, "https://vid.best/watch/" + row.slug, {
    headers: { "User-Agent": "VidBest-SEO-Audit/1.0" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)];
  assert.equal(titles.length, 1);
  assert.match(titles[0][1], /✨ Learning &amp; friendship — &lt;a new perspective&gt;/);
  assert.ok(html.includes('rel="canonical" href="https://vid.best/watch/' + row.slug + '"'));
  assert.equal(context.sqlite.prepare("SELECT views FROM videos WHERE id = ?").get(row.id).views, row.views);
});

test("HTTP public pages redirect to HTTPS with their path and query intact", async () => {
  const context = createContext();
  for (const method of ["GET", "HEAD"]) {
    const response = await request(context, "http://vid.best/watch/example?q=music&utm_source=owner", { method });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("Location"), "https://vid.best/watch/example?q=music&utm_source=owner");
    assert.equal(await response.text(), "");
  }
});

test("canonical redirects cannot treat a double-slash path as another hostname", async () => {
  const context = createContext();
  for (const origin of ["http://vid.best", "https://home.vid.best", "https://www.vid.best"]) {
    const response = await request(context, origin + "//outside.example/path?item=1");
    assert.equal(response.status, 301);
    const target = new URL(response.headers.get("Location"));
    assert.equal(target.origin, "https://vid.best");
    assert.equal(target.pathname, "//outside.example/path");
    assert.equal(target.search, "?item=1");
  }
});

test("homepage query/filter URLs are noindex while the root remains crawlable", async () => {
  const context = createContext();
  const response = await request(context, "https://vid.best/?q=technology&sort=trending");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex,follow/);
  const html = await response.text();
  assert.match(html, /Vid\.Best — Video Reviews, Tutorials & Discoveries/);
  assert.match(html, /Video reviews, tutorials &amp; discoveries worth <em>your time\.<\/em>/);
  assert.match(html, /href="https:\/\/vid\.best\/category\/technology"/);
});

test("category hubs are server-rendered, linked with real anchors, and structured", async () => {
  const context = createContext();
  for (let i = 1; i <= 3; i += 1) {
    context.sqlite.prepare(
      `INSERT INTO videos (
        slug, title, source_url, media_type, primary_category, subcategory,
        description, review_text, published, updated_at
      ) VALUES (?, ?, ?, 'raw', 'Technology', 'Web Development', ?, ?, 1, ?)`,
    ).run(
      `technology-${i}`,
      `Technology review ${i}`,
      `https://example.com/${i}.mp4`,
      `Useful technology description ${i}`,
      `Original review notes ${i}`,
      `2026-09-${10 + i}T00:00:00.000Z`,
    );
  }

  const response = await request(context, "https://vid.best/category/technology");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("X-Robots-Tag"), /index,follow/);
  const html = await response.text();
  assert.match(html, /<h1>Technology video reviews<\/h1>/);
  assert.match(html, /href="https:\/\/vid\.best\/watch\/technology-1"/);
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(html, /"@type":"ItemList"/);
});

test("only substantive category hubs enter the category sitemap", async () => {
  const context = createContext();
  for (let i = 1; i <= 3; i += 1) {
    context.sqlite.prepare(
      `INSERT INTO videos (
        slug, title, source_url, media_type, primary_category, subcategory, published
      ) VALUES (?, ?, ?, 'raw', ?, ?, 1)`,
    ).run(
      `tech-${i}`,
      `Tech ${i}`,
      `https://example.com/tech-${i}.mp4`,
      "Technology",
      "Web Development",
    );
  }
  context.sqlite.prepare(
    `INSERT INTO videos (
      slug, title, source_url, media_type, primary_category, subcategory, published
    ) VALUES ('music-1', 'Music 1', 'https://example.com/music.mp4', 'raw', 'Music', 'Music Videos', 1)`,
  ).run();

  const response = await request(context, "https://vid.best/sitemap.xml");
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.match(xml, /https:\/\/vid\.best\/sitemaps\/videos-1\.xml/);
  assert.match(xml, /https:\/\/vid\.best\/sitemaps\/categories\.xml/);

  const categories = await request(context, "https://vid.best/sitemaps/categories.xml");
  const categoryXml = await categories.text();
  assert.match(categoryXml, /https:\/\/vid\.best\/category\/technology/);
  assert.doesNotMatch(categoryXml, /https:\/\/vid\.best\/category\/music/);
});


test("video pages expose a crawlable category breadcrumb", async () => {
  const context = createContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
      slug, title, source_url, media_type, primary_category, subcategory, description, published
    ) VALUES ('breadcrumb-video', 'Breadcrumb video', 'https://example.com/breadcrumb.mp4', 'raw', 'Technology', 'Web Development', 'A crawlable breadcrumb test video', 1)`,
  ).run();

  const response = await request(context, "https://vid.best/watch/breadcrumb-video");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /class="vidbest-seo-breadcrumb"/);
  assert.match(html, /href="https:\/\/vid\.best\/category\/technology"/);
  assert.match(html, /"item":"https:\/\/vid\.best\/category\/technology"/);
});

test("homepage publishes escaped review links without JavaScript and excludes drafts and empty topics", async () => {
  const context = createContext();
  const insert = context.sqlite.prepare(`INSERT INTO videos
    (slug, title, source_url, media_type, primary_category, subcategory, published)
    VALUES (?, ?, 'https://example.com/video.mp4', 'raw', 'Technology', 'Web Development', ?)`);
  insert.run("visible-review", "Useful <review> & details", 1);
  insert.run("private-draft", "Private draft", 0);
  const response = await request(context, "https://vid.best/");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /id="vidbest-recent-reviews"/);
  assert.match(html, /href="https:\/\/vid.best\/watch\/visible-review">Useful &lt;review&gt; &amp; details<\/a>/);
  assert.doesNotMatch(html, /private-draft|Private draft/);
  assert.doesNotMatch(html, /href="https:\/\/vid.best\/category\/other"/);
  assert.equal(response.headers.get("X-Robots-Tag"), null);
});

test("tracking URLs keep canonical eligibility while functional queries remain noindex", async () => {
  const context = createContext();
  for (const query of ["utm_source=chatgpt&utm_medium=link", "gclid=test", "fbclid=test"]) {
    const response = await request(context, `https://vid.best/?${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Robots-Tag"), null);
  }
  for (const query of ["utm_source=chatgpt&q=music", "category=Music", "login_token=test"]) {
    const response = await request(context, `https://vid.best/?${query}`);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex,follow");
  }
});

test("duplicate public paths permanently redirect without losing functional parameters", async () => {
  const context = createContext();
  for (const [from, to] of [
    ["/index.html?q=music", "/?q=music"],
    ["/videos/", "/videos"],
    ["/category/technology/", "/category/technology"],
    ["/watch/example/?utm_source=chatgpt", "/watch/example?utm_source=chatgpt"],
    ["/privacy/", "/privacy"],
  ]) {
    const response = await request(context, `https://vid.best${from}`);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("Location"), `https://vid.best${to}`);
  }
});

test("legacy query-style TikTok watch gateway is no longer intercepted by SEO edge", async () => {
  const context = createContext();
  const response = await request(context, "https://vid.best/watch?user=example&id=6718335390845095173");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /video\.megasale\.win/);
  assert.doesNotMatch(html, /sig=[a-f0-9]{64}/);
  const source = readFileSync(new URL("../src/seo-edge.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /signedWatchResponse/);
  assert.doesNotMatch(source, /SIGN_SECRET/);
  assert.match(source, /frame-src[^;]*video\.megasale\.win/);
});
test("category thumbnail URLs retain letters and digits during text normalization", async () => {
  const context = createContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug, title, source_url, media_type, primary_category, subcategory, published, thumbnail_url)
    VALUES ('thumbnail-test', 'Thumbnail test', 'https://example.com/v.mp4', 'raw', 'Other', 'Other', 1, ?)`)
    .run("https://example.com/uploads/Fun-sun-012.jpg");
  const response = await request(context, "https://vid.best/category/other");
  assert.match(await response.text(), /src="https:\/\/example.com\/uploads\/Fun-sun-012.jpg"/);
});

test("homepage enrichment is not skipped by an old static asset validator", async () => {
  const context = createContext();
  context.env.ASSETS.fetch = async (request) => {
    assert.equal(request.headers.get("If-None-Match"), null);
    assert.equal(request.headers.get("If-Modified-Since"), null);
    return new Response('<html><head><meta name="robots" content="index,follow"></head><body><main></main><footer></footer></body></html>', {
      headers: { "Content-Type": "text/html", ETag: '"asset-only"' },
    });
  };
  const response = await request(context, "https://vid.best/?q=music", {
    headers: { "If-None-Match": '"asset-only"', "If-Modified-Since": "Mon, 21 Sep 2026 00:00:00 GMT" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("ETag"), null);
  assert.match(await response.text(), /<meta name="robots" content="noindex,follow">/);
});

test("HEAD has GET status and MIME, an empty body and no review view writes", async () => {
  const context = createContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,review_text,published,views)
    VALUES ('head-review','HEAD review','https://example.com/test.mp4','raw','Technology','Web Development','Actual review text',1,5)`).run();
  for (const path of ['/robots.txt', '/sitemaps/videos-1.xml', '/sitemap.xml', '/videos', '/watch/head-review']) {
    const head = await request(context, 'https://vid.best' + path, { method: 'HEAD' });
    assert.equal(head.status, 200, path);
    assert.equal(await head.text(), '', path);
    assert.match(head.headers.get('Content-Type'), /(?:text|xml)/);
  }
  for (const agent of ['Googlebot', 'bingbot', 'Google-InspectionTool', 'VidBest-SEO-Audit/1.0']) {
    assert.equal((await request(context, 'https://vid.best/watch/head-review', { headers: { 'User-Agent': agent } })).status, 200);
  }
  assert.equal(context.sqlite.prepare("SELECT views FROM videos WHERE slug='head-review'").get().views, 5);
  await request(context, 'https://vid.best/watch/head-review', { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140.0' } });
  assert.equal(context.sqlite.prepare("SELECT views FROM videos WHERE slug='head-review'").get().views, 6);
  const missing = await request(context, 'https://vid.best/watch/missing', { method: 'HEAD' });
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), '');
  assert.equal((await request(context, 'https://vid.best/watch/head-review/invalid')).status, 404);
});

test("related review links are in public HTML and never expose drafts", async () => {
  const context = createContext();
  const insert = context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,review_text,published)
    VALUES (?,?,'https://example.com/test.mp4','raw','Technology','Web Development','Useful original text',?)`);
  insert.run('current-review', 'Current review', 1);
  insert.run('related-public', 'Related <review>', 1);
  insert.run('related-draft', 'Secret draft', 0);
  const html = await (await request(context, 'https://vid.best/watch/current-review')).text();
  const related = html.match(/<section id="vidbest-related-reviews"[\s\S]*?<\/section>/)?.[0];
  assert.match(related, /href="https:\/\/vid.best\/watch\/related-public"/);
  assert.match(related, /Related &lt;review&gt;/);
  assert.doesNotMatch(related, /related-draft|Secret draft|current-review/);
});

test("the crawlable directory covers libraries beyond the old 200 review limit", async () => {
  const context = createContext();
  context.sqlite.prepare('UPDATE videos SET published=0').run();
  const insert = context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,published)
    VALUES (?,?,'https://example.com/test.mp4','raw','Technology','Web Development',1)`);
  for (let i = 1; i <= 201; i++) insert.run('library-' + i, 'Review ' + i);
  const urls = new Set();
  for (const page of [1, 2, 3]) {
    const url = 'https://vid.best/videos' + (page > 1 ? '?page=' + page : '');
    const response = await request(context, url);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(html.includes('<link rel="canonical" href="' + url + '">'));
    for (const match of html.matchAll(/href="(https:\/\/vid.best\/watch\/library-\d+)"/g)) urls.add(match[1]);
    if (page < 3) assert.ok(html.includes('rel="next" href="https://vid.best/videos?page=' + (page + 1) + '"'));
  }
  assert.equal(urls.size, 201);
  assert.equal((await request(context, 'https://vid.best/videos?page=4')).status, 404);
  assert.equal((await request(context, 'https://vid.best/videos?page=abc')).status, 404);
  const duplicate = await request(context, 'https://vid.best/videos?page=1');
  assert.equal(duplicate.status, 301);
  assert.equal(duplicate.headers.get('Location'), 'https://vid.best/videos');
});

test("a directory database failure returns retryable 503 instead of an empty indexable 200", async () => {
  const response = await request(createContext({ DB: { prepare() { throw new Error('DB unavailable'); } } }), 'https://vid.best/videos');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
});

test("video sitemap uses TikTok player locations and only verified video publication dates", async () => {
  const context = createContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,published)
    VALUES ('tiktok-map','TikTok review','https://www.tiktok.com/@creator/video/1234567890123456789','tiktok','Technology','Web Development','Useful video',1)`).run();
  let xml = await (await request(context, 'https://vid.best/sitemaps/videos-1.xml')).text();
  const entry = text => text.match(/<url><loc>https:\/\/vid.best\/watch\/tiktok-map<\/loc>[\s\S]*?<\/url>/)[0];
  assert.match(entry(xml), /<video:player_loc allow_embed="yes">https:\/\/www.tiktok.com\/player\/v1\/1234567890123456789/);
  assert.doesNotMatch(entry(xml), /video:content_loc|video:publication_date/);
  const id = context.sqlite.prepare("SELECT id FROM videos WHERE slug='tiktok-map'").get().id;
  context.sqlite.prepare(`INSERT INTO video_source_metadata (video_id,source_published_at,source_duration)
    VALUES (?,'2024-05-06T07:08:09Z','PT1M2S')`).run(id);
  xml = await (await request(context, 'https://vid.best/sitemaps/videos-1.xml')).text();
  assert.match(entry(xml), /<video:publication_date>2024-05-06T07:08:09Z/);
  assert.match(entry(xml), /<video:duration>62<\/video:duration>/);
});


test("Facebook sitemap, watch page, topic and directory share a crawlable stable poster", async () => {
  const context = createContext();
  for (let i = 1; i <= 3; i++) {
    const source = `https://www.facebook.com/reel/1234567890${i}`;
    context.sqlite.prepare(`INSERT INTO videos
      (slug,title,source_url,embed_url,media_type,primary_category,subcategory,description,thumbnail_url,published,created_at,updated_at)
      VALUES (?,?,?,?,'facebook','Music','Music Videos','An original review',?,1,'2024-01-02T03:04:05Z','2024-01-02T03:04:05Z')`)
      .run(`facebook-poster-${i}`, `Facebook review ${i}`, source,
        `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(source)}`,
        `https://scontent.xx.fbcdn.net/poster-${i}.jpg?expires=old`);
  }
  const before = context.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
  const sitemap = await (await request(context, 'https://vid.best/sitemaps/videos-1.xml')).text();
  const poster = sitemap.match(/<video:thumbnail_loc>(https:\/\/vid.best\/api\/facebook\/thumbnail\?id=\d+&amp;v=[a-f0-9]+)<\/video:thumbnail_loc>/)[1];
  assert.doesNotMatch(sitemap, /NaN|expires=old|scontent/);
  for (const path of ['/watch/facebook-poster-1','/category/music','/videos']) {
    const html = await (await request(context, `https://vid.best${path}`, {headers:{'User-Agent':'Googlebot'}})).text();
    assert.ok(html.includes(poster) || html.includes(poster.replace('https://vid.best', '')));
    if (path === '/category/music') assert.match(html, /<meta property="og:image" content="https:\/\/vid\.best\/api\/facebook\/thumbnail\?id=\d+&amp;v=[a-f0-9]+">/);
    assert.doesNotMatch(html, /expires=old|scontent/);
  }
  const robots = await (await request(context, 'https://vid.best/robots.txt')).text();
  assert.match(robots, /Disallow: \/api\/\n/);
  assert.match(robots, /Allow: \/api\/facebook\/thumbnail\n/);
  assert.match(robots, /Allow: \/api\/instagram\/thumbnail\n/);
  assert.deepEqual(context.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
});

test("curated watch schema attributes the review and never calls a landing page a video file", async () => {
  const context = createContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,thumbnail_url,published)
    VALUES ('external-review', 'Reviewed outdoor scene', 'https://videos.example.com/watch/123',
    'raw', 'Funny & Comedy', 'Skits & Sketches',
    'A written independent review.', 'https://vid.best/review-covers/real.jpg', 1)`).run();
  const html = await (await request(context, 'https://vid.best/watch/external-review')).text();
  const json = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1]);
  const video = json['@graph'].find(item => item['@type'] === 'VideoObject');
  const page = json['@graph'].find(item => item['@type'] === 'WebPage');
  assert.equal(video.contentUrl, undefined);
  assert.equal(video.uploadDate, undefined, 'the review creation date is not the original video upload date');
  assert.equal(video.publisher, undefined, 'curator is not the original video publisher');
  assert.equal(video.interactionStatistic, undefined, 'page visits cannot be claimed as verified video plays');
  assert.equal(page.isBasedOn, 'https://videos.example.com/watch/123');
  assert.equal(page.publisher['@id'], 'https://vid.best#organization');
  assert.match(html, /Open original source/);
  const sitemap = await (await request(context, 'https://vid.best/sitemaps/videos-1.xml')).text();
  const entry = sitemap.match(/<url><loc>https:\/\/vid.best\/watch\/external-review<\/loc>[\s\S]*?<\/url>/)[0];
  assert.doesNotMatch(entry, /<video:video>|<video:content_loc>/);
});

test("only real video-file URLs become contentUrl and sitemap content_loc", async () => {
  const context = createContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,thumbnail_url,published)
    VALUES ('direct-file', 'Hosted MP4 review', 'https://cdn.example.com/clip.mp4?token=test',
    'raw', 'Technology', 'Web Development', 'A real MP4 review',
    'https://vid.best/review-covers/real.jpg', 1)`).run();
  const html = await (await request(context, 'https://vid.best/watch/direct-file')).text();
  const json = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1]);
  const video = json['@graph'].find(item => item['@type'] === 'VideoObject');
  assert.equal(video.contentUrl, 'https://cdn.example.com/clip.mp4?token=test');
  const xml = await (await request(context, 'https://vid.best/sitemaps/videos-1.xml')).text();
  assert.match(xml, /<video:content_loc>https:\/\/cdn.example.com\/clip.mp4\?token=test<\/video:content_loc>/);
});

test("trust pages are readable, discoverable, and respond through the public Worker", async () => {
  const context = createContext();
  for (const route of ["/about", "/editorial", "/contact"]) {
    const response = await request(context, "https://vid.best" + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("Content-Type"), /text\/html/);
    assert.equal((await request(context, "https://vid.best" + route + "/")).status, 301);
    const source = readFileSync(new URL("../public" + route + ".html", import.meta.url), "utf8");
    assert.match(source, new RegExp('<link rel="canonical" href="https://vid\\.best' + route + '">'));
    assert.match(source, /<main class="information-page">/);
    assert.match(source, /<h1>/);
    assert.match(source, /href="\/contact"/);
  }
  const sitemap = await (await request(context, "https://vid.best/sitemaps/pages.xml")).text();
  for (const route of ["/about", "/editorial", "/contact", "/privacy", "/terms"]) {
    assert.ok(sitemap.includes("<loc>https://vid.best" + route + "</loc>"), route);
  }
  const contact = readFileSync(new URL("../public/contact.html", import.meta.url), "utf8");
  assert.match(contact, /mailto:info@vid\.best/);
});

test('the TikTok editorial cover is shared by server-rendered review and sitemap without changing dates or source', async () => {
  const context = createContext();
  context.sqlite.exec(readFileSync(new URL('../migrations/0018_tiktok_oembed_cache.sql', import.meta.url), 'utf8'));
  const source = 'https://www.tiktok.com/@rorozya/video/7622472784039415061';
  const poster = 'https://vid.best/review-covers/meri-aashiqui-illustrated-v1.webp';
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,review_text,thumbnail_url,published,created_at,updated_at)
    VALUES ('cover-review','Meri Aashiqui Tum Se Hi',?,'tiktok','Entertainment, Movies & Games','Movie Trailers',
    'Original owner description','Original owner review',?,1,'2026-09-22T10:53:05.021Z','2026-09-22T20:10:20.017Z')`)
    .run(source, poster);
  const before = context.sqlite.prepare("SELECT * FROM videos WHERE slug='cover-review'").get();
  const response = await request(context, 'https://vid.best/watch/cover-review', {headers: {'User-Agent': 'Googlebot'}});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(poster));
  assert.match(html, /Original owner review/);
  assert.match(html, /<link rel="canonical" href="https:\/\/vid\.best\/watch\/cover-review">/);
  assert.doesNotMatch(html, /Last updated/i);
  const graph = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1])['@graph'];
  const page = graph.find(item => item['@type'] === 'WebPage');
  assert.equal(page.primaryImageOfPage, poster);
  assert.equal(page.isBasedOn, source);
  assert.equal(page.datePublished, before.created_at);
  assert.equal(page.dateModified, before.updated_at);
  assert.equal(graph.find(item => item['@type'] === 'VideoObject'), undefined,
    'a new editorial illustration must not invent the missing source upload date');
  const xml = await (await request(context, 'https://vid.best/sitemaps/videos-1.xml')).text();
  const entry = xml.match(/<url><loc>https:\/\/vid.best\/watch\/cover-review<\/loc>[\s\S]*?<\/url>/)[0];
  assert.ok(entry.includes('<video:thumbnail_loc>' + poster + '</video:thumbnail_loc>'));
  assert.ok(entry.includes('<lastmod>2026-09-22T20:10:20.017Z</lastmod>'));
  assert.deepEqual(context.sqlite.prepare("SELECT * FROM videos WHERE slug='cover-review'").get(), before);
});


test("homepage includes the owner's AdSense account verification meta tag", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<head>[\s\S]*?<meta name="google-adsense-account" content="ca-pub-4485257027995607">[\s\S]*?<\/head>/);
});


test("homepage includes the authorized async AdSense loader once", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const scripts = html.match(/<script async src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-4485257027995607" crossorigin="anonymous"><\/script>/g) || [];
  assert.equal(scripts.length, 1);
});


test("image sitemap and semantic review cover use canonical URLs and never list drafts", async () => {
  const context = createContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,thumbnail_url,published)
    VALUES ('image-map-public','A & B music review','https://video.example.org/a.mp4',
      'raw','Music','Music Videos','A source review','https://vid.best/review-covers/real.webp',1)`).run();
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,thumbnail_url,published)
    VALUES ('image-map-draft','Draft image review','https://video.example.org/d.mp4',
      'raw','Music','Music Videos','Unpublished content','https://vid.best/review-covers/draft.webp',0)`).run();

  const root = await (await request(context, "https://vid.best/sitemap.xml")).text();
  assert.match(root, /<loc>https:\/\/vid\.best\/sitemaps\/images-1\.xml<\/loc>/);
  assert.doesNotMatch(root, /<loc>https:\/\/vid\.best\/image-sitemap\.xml<\/loc>/, "an index must not nest another index");
  for (const [, childUrl] of root.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const child = await (await request(context, childUrl)).text();
    assert.match(child, /<urlset\b/, `${childUrl} must be a sitemap, not another index`);
    assert.doesNotMatch(child, /<sitemapindex\b/);
  }
  const imageIndex = await (await request(context, "https://vid.best/image-sitemap.xml")).text();
  assert.match(imageIndex, /<loc>https:\/\/vid\.best\/sitemaps\/images-1\.xml<\/loc>/);
  const images = await request(context, "https://vid.best/sitemaps/images-1.xml");
  assert.equal(images.status, 200);
  assert.match(images.headers.get("Content-Type"), /application\/xml/);
  const xml = await images.text();
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(xml, /<url><loc>https:\/\/vid\.best\/watch\/image-map-public<\/loc><image:image><image:loc>https:\/\/vid\.best\/review-covers\/real\.webp<\/image:loc><\/image:image><\/url>/);
  assert.doesNotMatch(xml, /image-map-draft|draft\.webp/);

  const videoXml = await (await request(context, "https://vid.best/sitemaps/videos-1.xml")).text();
  assert.match(videoXml, /<image:loc>https:\/\/vid\.best\/review-covers\/real\.webp<\/image:loc>/);
  const html = await (await request(context, "https://vid.best/watch/image-map-public")).text();
  assert.match(html, /<figure class="watch-review-art glass-panel"/);
  assert.match(html, /<img src="https:\/\/vid\.best\/review-covers\/real\.webp"/);
  assert.match(html, /alt="A &amp; B music review — review preview image"/);

  const head = await request(context, "https://vid.best/image-sitemap.xml", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const notFound = await request(context, "https://vid.best/sitemaps/images-9999.xml");
  assert.equal(notFound.status, 404);
});

test('source-associated review covers drive social images while preserving video posters and owner data', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No provider traffic in regression tests'); });
  const manifest = JSON.parse(readFileSync(new URL('../src/review-illustrations.json', import.meta.url)));
  const context = createContext();
  for (const art of manifest) {
    context.sqlite.prepare(`INSERT INTO videos
      (id,slug,title,source_url,media_type,primary_category,subcategory,description,review_text,thumbnail_url,published,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(art.id,art.slug,art.expectedTitle,art.sourceUrl,
      art.id===4?'youtube':'facebook',art.id===4?'Music':'Social Media & Trending','Review',
      'Owner listing remains unchanged','Owner review heading\n\nSubstantial original owner text.',
      'https://vid.best/review-covers/owner-source.jpg',1,'2026-09-16T16:22:59.366Z','2026-10-11T10:00:00.000Z');
    context.sqlite.prepare('INSERT INTO video_source_metadata (video_id,source_published_at) VALUES (?,?)')
      .run(art.id,'2026-01-01T00:00:00.000Z');
  }
  const before = context.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
  const xml = await (await request(context,'https://vid.best/sitemaps/images-1.xml')).text();
  const videoXml = await (await request(context,'https://vid.best/sitemaps/videos-1.xml')).text();
  for (const art of manifest) {
    const html = await (await request(context,'https://vid.best/watch/'+art.slug,{headers:{'User-Agent':'VidBest-SEO-Audit/1.0'}})).text();
    assert.ok(html.includes('src="https://vid.best'+art.path+'"'));
    assert.match(html, /AI-generated review illustration inspired/);
    assert.match(html, /<div class="watch-review-body">\s*<article class="watch-copy glass-panel">/);
    assert.ok(html.indexOf('<!-- review-body -->') < html.indexOf('id="vidbest-related-reviews"'));
    assert.match(html, /Owner listing remains unchanged/);
    assert.match(html, /Substantial original owner text/);
    const graph=JSON.parse(html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'];
    const video=graph.find(row=>row['@type']==='VideoObject');
    const page=graph.find(row=>row['@type']==='WebPage');
    assert.deepEqual(video.thumbnailUrl,['https://vid.best/review-covers/owner-source.jpg']);
    assert.equal(page.image.contentUrl,'https://vid.best'+art.path);
    assert.equal(page.primaryImageOfPage,'https://vid.best'+art.path);
    assert.ok(html.includes('<meta property="og:image" content="https://vid.best'+art.path+'">'));
    assert.ok(html.includes('<meta name="twitter:image" content="https://vid.best'+art.path+'">'));
    assert.match(html, /<meta property="og:image:alt" content="[^\"]*AI-generated/);
    assert.equal(page.datePublished,'2026-09-16T16:22:59.366Z');
    assert.equal(page.dateModified,'2026-10-11T10:00:00.000Z');
    assert.ok(xml.includes('<image:loc>https://vid.best'+art.path+'</image:loc>'));
    assert.ok(videoXml.includes('<image:loc>https://vid.best'+art.path+'</image:loc>'));
    assert.ok(!videoXml.includes('<video:thumbnail_loc>https://vid.best'+art.path));
  }
  assert.deepEqual(context.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(),before);
  context.sqlite.prepare('UPDATE videos SET thumbnail_url=NULL WHERE id=4').run();
  const missingPosterXml=await (await request(context,'https://vid.best/sitemaps/images-1.xml')).text();
  assert.ok(missingPosterXml.includes(manifest.find(row=>row.id===4).path));
  context.sqlite.prepare('UPDATE videos SET published=0 WHERE id=4').run();
  const draftXml=await (await request(context,'https://vid.best/sitemaps/images-1.xml')).text();
  assert.ok(!draftXml.includes(manifest.find(row=>row.id===4).path));
});

test('public Facebook preview artwork is bounded to the audited placeholder and preserves later owner covers', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No provider traffic in regression tests'); });
  const context=createContext();
  const art=JSON.parse(readFileSync(new URL('../src/review-illustrations.json',import.meta.url))).find(x=>x.id===139);
  context.sqlite.prepare(`INSERT INTO videos
    (id,slug,title,source_url,media_type,primary_category,subcategory,description,review_text,thumbnail_url,published)
    VALUES (?,?,?,?,'facebook','Social Media & Trending','Review','Owner listing','Owner review',?,1)`)
    .run(art.id,art.slug,art.expectedTitle,art.sourceUrl,art.previewFallbackFrom);
  const before=context.sqlite.prepare('SELECT * FROM videos WHERE id=139').get();
  const payload=await (await request(context,'https://vid.best/api/videos/'+art.slug)).json();
  assert.equal(payload.video.review_preview_url,art.path);
  assert.equal(payload.video.review_artwork_url,art.path);
  assert.match(payload.video.review_artwork_alt,/AI-generated.*not video footage/);
  assert.deepEqual(context.sqlite.prepare('SELECT * FROM videos WHERE id=139').get(),before);
  context.sqlite.prepare('UPDATE videos SET thumbnail_url=? WHERE id=139').run('/review-covers/owner-new.webp');
  const owner=await (await request(context,'https://vid.best/api/videos/'+art.slug)).json();
  assert.equal(owner.video.review_preview_url,null);
  assert.equal(owner.video.thumbnail_url,'/review-covers/owner-new.webp');
  context.sqlite.prepare('UPDATE videos SET title=? WHERE id=139').run('New owner topic');
  const changed=await (await request(context,'https://vid.best/api/videos/'+art.slug)).json();
  assert.equal(changed.video.review_artwork_url,null);
});

test("image/video sitemaps and watch metadata use stable first-party TikTok posters, never expiring CDN URLs", async () => {
  const context = createContext();
  const expired = "https://p16-common-sign.tiktokcdn-eu.com/poster?x-expires=1660000000&x-signature=expired";
  const source = "https://www.tiktok.com/@creator/video/7669587518156705056";
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,thumbnail_url,published)
    VALUES ('tiktok-stable-image','TikTok preview review',?,'tiktok','Music','Music Videos','Video review',?,1)`)
    .run(source,expired);
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,thumbnail_url,published)
    VALUES ('tiktok-missing-image','Missing TikTok thumbnail',
      'https://www.tiktok.com/@creator/video/7654628449142770958',
      'tiktok','Music','Music Videos','Video review',NULL,1)`).run();
  context.sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,thumbnail_url,published)
    VALUES ('tiktok-draft-image','Private TikTok draft',
      'https://www.tiktok.com/@creator/video/7654628449142770959',
      'tiktok','Music','Music Videos','Unpublished',NULL,0)`).run();
  const url = 'https://vid.best/api/tiktok/cached-poster?id=7669587518156705056';
  const images = await (await request(context,'https://vid.best/sitemaps/images-1.xml')).text();
  const video = await (await request(context,'https://vid.best/sitemaps/videos-1.xml')).text();
  // This isolated SEO-edge harness deliberately serves stubbed HTML assets.
  // Test watch metadata in the app-worker suite; confirm canonical poster here
  // through the pure shared helper and both generated sitemaps.
  assert.ok(images.includes('<image:loc>'+url+'</image:loc>'));
  assert.ok(video.includes('<video:thumbnail_loc>'+url+'</video:thumbnail_loc>'));
  assert.equal(stableTikTokImage({ media_type:"tiktok", source_url:source, thumbnail_url:expired }), url);
  assert.doesNotMatch(images, /x-expires|x-signature|tiktok-draft-image/);
  assert.doesNotMatch(video, /x-expires|x-signature|tiktok-draft-image/);
  assert.match(images,/id=7654628449142770958/);
  assert.match(video,/id=7654628449142770958/);
  // The original owner's metadata is NOT rewritten merely for SEO.
  const unchanged = context.sqlite.prepare("SELECT thumbnail_url FROM videos WHERE slug='tiktok-stable-image'").get();
  assert.equal(unchanged.thumbnail_url, expired);
  const originalCover = 'https://vid.best/review-covers/owner-original.webp';
  context.sqlite.prepare("UPDATE videos SET thumbnail_url=? WHERE slug='tiktok-stable-image'").run(originalCover);
  const owned = await (await request(context,'https://vid.best/sitemaps/images-1.xml')).text();
  assert.match(owned,/https:\/\/vid\.best\/review-covers\/owner-original\.webp/);
});
