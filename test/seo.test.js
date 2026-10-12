import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import seoWorker from "../src/seo-edge.js";

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

test("redirects www to the canonical origin", async () => {
  const context = createContext();
  const response = await request(context, "https://www.vid.best/");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), "https://vid.best/");
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
      VALUES (?,?,?,?,'facebook','Technology','Web Development','An original review',?,1,'2024-01-02T03:04:05Z','2024-01-02T03:04:05Z')`)
      .run(`facebook-poster-${i}`, `Facebook review ${i}`, source,
        `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(source)}`,
        `https://scontent.xx.fbcdn.net/poster-${i}.jpg?expires=old`);
  }
  const before = context.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
  const sitemap = await (await request(context, 'https://vid.best/sitemaps/videos-1.xml')).text();
  const poster = sitemap.match(/<video:thumbnail_loc>(https:\/\/vid.best\/api\/facebook\/thumbnail\?id=\d+&amp;v=[a-f0-9]+)<\/video:thumbnail_loc>/)[1];
  assert.doesNotMatch(sitemap, /NaN|expires=old|scontent/);
  for (const path of ['/watch/facebook-poster-1','/category/technology','/videos']) {
    const html = await (await request(context, `https://vid.best${path}`, {headers:{'User-Agent':'Googlebot'}})).text();
    assert.ok(html.includes(poster) || html.includes(poster.replace('https://vid.best', '')));
    assert.doesNotMatch(html, /expires=old|scontent/);
  }
  const robots = await (await request(context, 'https://vid.best/robots.txt')).text();
  assert.match(robots, /Disallow: \/api\/\n/);
  assert.match(robots, /Allow: \/api\/facebook\/thumbnail\n/);
  assert.match(robots, /Allow: \/api\/instagram\/thumbnail\n/);
  assert.deepEqual(context.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
});
