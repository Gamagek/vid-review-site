import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index.js";
import { refreshSourceMetadata, sanitizeWatchHtml } from "../src/edge.js";

const secret = "correct-horse-battery-staple-admin-secret";
const reactionSalt = "separate-rate-limit-and-reaction-secret";
const migrations = [
  "0001_initial.sql",
  "0002_discovery_requests.sql",
  "0003_security_rate_limits.sql",
  "0004_maintenance_indexes.sql",
  "0005_source_video_metadata.sql",
  "0009_app_settings.sql",
  "0010_video_analysis.sql",
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

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.bindings) || null;
    return column ? row?.[column] ?? null : row;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class TestD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new TestD1Statement(this.database, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function createBucket() {
  const objects = new Map();
  let reads = 0;
  return {
    objects,
    get reads() { return reads; },
    async put(key, body, options) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, options });
    },
    async get(key) {
      reads += 1;
      const item = objects.get(key);
      if (!item) return null;
      return {
        body: item.bytes,
        size: item.bytes.byteLength,
        httpEtag: '"test"',
        writeHttpMetadata(headers) {
          headers.set("Content-Type", item.options.httpMetadata.contentType);
        },
      };
    },
    async head(key) {
      reads += 1;
      const item = objects.get(key);
      if (!item) return null;
      return {
        size: item.bytes.byteLength,
        httpEtag: '"test"',
        writeHttpMetadata(headers) {
          headers.set("Content-Type", item.options.httpMetadata.contentType);
        },
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function createTestContext(overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  const bucket = createBucket();
  const pending = [];
  return {
    sqlite,
    bucket,
    env: {
      ADMIN_SECRET_KEY: secret,
      REACTION_SALT: reactionSalt,
      APP_NAME: "Test",
      DB: new TestD1Database(sqlite),
      BUCKET: bucket,
      ...overrides,
    },
    ctx: { waitUntil(promise) { pending.push(promise); } },
    pending,
  };
}

function send(context, path, init = {}) {
  return worker.fetch(new Request(`https://example.com${path}`, init), context.env, context.ctx);
}

async function login(context) {
  return send(context, "/api/admin/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "CF-Connecting-IP": "192.0.2.1" },
  });
}

test("rejects non-object JSON before processing it", async () => {
  const context = createTestContext();
  const response = await send(context, "/api/discovery-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[]",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: "JSON body must be an object" });
});

test("exchanges the admin secret for an HttpOnly session cookie", async () => {
  const context = createTestContext();
  const response = await login(context);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /^__Host-vidbest_admin=/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(cookie, new RegExp(secret));
});

test("accepts a same-origin cookie session and rejects a cross-origin mutation", async () => {
  const context = createTestContext();
  const cookie = (await login(context)).headers.get("Set-Cookie").split(";", 1)[0];
  const accepted = await send(context, "/api/admin/session", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://example.com" },
  });
  assert.equal(accepted.status, 200);

  const rejected = await send(context, "/api/admin/session", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://attacker.example" },
  });
  assert.equal(rejected.status, 403);
});

test("logout clears the administrator cookie", async () => {
  const context = createTestContext();
  const response = await send(context, "/api/admin/session", { method: "DELETE" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Set-Cookie"), /^__Host-vidbest_admin=;.*Max-Age=0/);
});

test("rate limits repeated failed administrator logins", async () => {
  const context = createTestContext();
  const request = () => send(context, "/api/admin/session", {
    method: "POST",
    headers: { Authorization: "Bearer incorrect-secret", "CF-Connecting-IP": "192.0.2.20" },
  });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await request()).status, 401);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "900");
});

test("does not count repeat discovery requests from the same visitor", async () => {
  const context = createTestContext();
  const request = (ip) => send(context, "/api/discovery-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      "User-Agent": "test-browser",
    },
    body: JSON.stringify({ query: "careful video review" }),
  });

  assert.equal((await request("192.0.2.30")).status, 202);
  assert.equal((await request("192.0.2.30")).status, 202);
  let count = context.sqlite.prepare("SELECT request_count FROM discovery_requests").get().request_count;
  assert.equal(count, 1);

  assert.equal((await request("192.0.2.31")).status, 202);
  count = context.sqlite.prepare("SELECT request_count FROM discovery_requests").get().request_count;
  assert.equal(count, 2);
});

test("rate limits public comments", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (slug, title, source_url, media_type, primary_category, subcategory, published)
     VALUES ('test-video', 'Test video', 'https://example.com/video.mp4', 'raw', 'Technology', 'Web Development', 1)`,
  ).run();
  const request = () => send(context, "/api/videos/1/comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.40",
      "User-Agent": "test-browser",
    },
    body: JSON.stringify({ body: "A useful comment" }),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await request()).status, 202);
  assert.equal((await request()).status, 429);
});

test("accepts a valid raster upload and rejects an oversized upload", async () => {
  const context = createTestContext({ MAX_UPLOAD_BYTES: "1000000" });
  const valid = await send(context, "/api/assets?filename=preview.png", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "image/png",
      "Content-Length": "8",
      "X-File-Name": "preview.png",
    },
    body: "png-data",
  });
  assert.equal(valid.status, 201);
  const uploaded = await valid.json();
  assert.match(uploaded.key, /^uploads\//);
  assert.equal(context.bucket.objects.size, 1);

  const oversized = await send(context, "/api/assets?filename=large.mp4", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "video/mp4",
      "Content-Length": "1000001",
      "X-File-Name": "large.mp4",
    },
    body: "x",
  });
  assert.equal(oversized.status, 413);
});

test("rejects active-content uploads", async () => {
  const context = createTestContext();
  const response = await send(context, "/api/assets?filename=attack.svg", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "image/svg+xml",
      "Content-Length": "11",
      "X-File-Name": "attack.svg",
    },
    body: "<svg></svg>",
  });
  assert.equal(response.status, 415);
});

test("never serves objects outside the managed uploads prefix", async () => {
  const context = createTestContext();
  const response = await send(context, "/media/private/internal-file.mp4");
  assert.equal(response.status, 404);
  assert.equal(context.bucket.reads, 0);
});

test("returns a consistent 504 when Gemini times out", async () => {
  const context = createTestContext({ GEMINI_KEY: "test-key" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
  try {
    const response = await send(context, "/api/ai/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Safe test video",
        primary_category: "Technology",
        subcategory: "Web Development",
      }),
    });
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { success: false, error: "An upstream service timed out" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses a nonce for dynamic JSON-LD and removes unsafe-inline scripts", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, media_type, primary_category, subcategory,
       description, seo_title, seo_description, published
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    "nonce-test", "Nonce test", "https://example.com/video.mp4", "raw",
    "Technology", "Web Development", "Description", "SEO title", "SEO description",
  );
  const response = await send(context, "/watch/nonce-test");
  assert.equal(response.status, 200);
  const policy = response.headers.get("Content-Security-Policy");
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(await response.text(), new RegExp(`<script type="application/ld\\+json" nonce="${nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
});

test("gives AI generation a longer browser timeout than ordinary requests", () => {
  const source = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
  assert.match(source, /url\.startsWith\("\/api\/ai\/generate"\) \? 35000 : 15000/);
});

test("stores new TikTok videos without a legacy player URL", async () => {
  const context = createTestContext();
  const response = await send(context, "/api/videos", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "TikTok official embed test",
      source_url: "https://www.tiktok.com/@example/video/6718335390845095173",
      primary_category: "Social Media & Trending",
      subcategory: "TikTok Viral Challenges",
      published: true,
    }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.video.provider, "tiktok");
  assert.equal(result.video.media_type, "tiktok");
  assert.equal(result.video.embed_url, null);

  const page = await send(context, `/watch/${result.video.slug}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /class="tiktok-embed"/);
  assert.match(html, /data-video-id="6718335390845095173"/);
  assert.doesNotMatch(html, /player\/v1\/6718335390845095173/);
  assert.doesNotMatch(html, /"embedUrl":s*"https:\/\/www\.tiktok\.com\/player\/v1\//);
});

test("normalizes trusted provider URLs into provider-owned embeds", async () => {
  const context = createTestContext();
  const cases = [
    ["Vimeo", "https://vimeo.com/76979871", "vimeo", /^https:\/\/player\.vimeo\.com\/video\/76979871/],
    ["Dailymotion", "https://www.dailymotion.com/video/x84sh87", "dailymotion", /^https:\/\/www\.dailymotion\.com\/embed\/video\/x84sh87/],
    ["Twitch", "https://www.twitch.tv/videos/123456789", "twitch", /^https:\/\/player\.twitch\.tv\/\?video=v123456789/],
    ["Instagram", "https://www.instagram.com/reel/ABC_def-123/", "instagram", /^https:\/\/www\.instagram\.com\/reel\/ABC_def-123\/embed/],
  ];

  for (const [title, sourceUrl, provider, embedPattern] of cases) {
    const response = await send(context, "/api/videos", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${title} provider test`,
        source_url: sourceUrl,
        primary_category: "Technology",
        subcategory: "Web Development",
        published: false,
      }),
    });
    assert.equal(response.status, 201, `${title} should be accepted`);
    const result = await response.json();
    assert.equal(result.video.provider, provider);
    assert.match(result.video.embed_url, embedPattern);
  }
});

test("uses the current request hostname for Twitch playback", async () => {
  const context = createTestContext({ PUBLIC_BASE_URL: "https://home.vid.best" });
  const created = await send(context, "/api/videos", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Twitch playback origin test",
      source_url: "https://www.twitch.tv/videos/123456789",
      primary_category: "Technology",
      subcategory: "Web Development",
      published: true,
    }),
  });
  assert.equal(created.status, 201);

  const page = await send(context, "/watch/twitch-playback-origin-test");
  assert.equal(page.status, 200);
  const html = await page.text();
  const iframeSource = html.match(/<iframe[^>]+src="([^"]+)"/)?.[1] || "";
  assert.match(iframeSource, /parent=example\.com/);
  assert.doesNotMatch(iframeSource, /parent=home\.vid\.best/);
});

test("stores administrator-verified source metadata for non-YouTube providers", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (slug, title, source_url, media_type, primary_category, subcategory, thumbnail_url, published)
     VALUES ('manual-metadata', 'Manual metadata', 'https://vimeo.com/76979871', 'raw', 'Technology', 'Web Development', 'https://example.com/thumb.jpg', 1)`,
  ).run();
  await refreshSourceMetadata(1, "https://vimeo.com/76979871", context.env, {
    source_published_at: "2013-10-15",
    source_duration_seconds: 62,
  }, { replaceExisting: true });

  const metadata = context.sqlite.prepare(
    "SELECT source_published_at, source_duration FROM video_source_metadata WHERE video_id = 1",
  ).get();
  assert.equal(metadata.source_published_at, "2013-10-15T00:00:00.000Z");
  assert.equal(metadata.source_duration, "PT1M2S");

  const sitemap = await send(context, "/sitemaps/videos-1.xml");
  const sitemapXml = await sitemap.text();
  assert.match(sitemapXml, /<video:publication_date>2013-10-15T00:00:00\.000Z<\/video:publication_date>/);
  assert.doesNotMatch(sitemapXml, /parent=home\.vid\.best/);
});

test("creates a persistent D1 salt when REACTION_SALT is not configured", async () => {
  const context = createTestContext({ REACTION_SALT: "" });
  context.sqlite.prepare(
    `INSERT INTO videos (slug, title, source_url, media_type, primary_category, subcategory, published)
     VALUES ('salt-test', 'Salt test', 'https://example.com/salt.mp4', 'raw', 'Technology', 'Web Development', 1)`,
  ).run();

  const response = await send(context, "/api/videos/1/reactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.90",
      "User-Agent": "salt-test-browser",
    },
    body: JSON.stringify({ reaction: "like" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).active, true);
  const stored = context.sqlite.prepare(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'reaction_salt'",
  ).get();
  assert.match(stored.setting_value, /^[0-9a-f]{64}$/);
});

test("deleting a video removes its unreferenced managed R2 thumbnail", async () => {
  const context = createTestContext();
  const upload = await send(context, "/api/assets?filename=delete-me.png", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "image/png",
      "Content-Length": "8",
      "X-File-Name": "delete-me.png",
    },
    body: "png-data",
  });
  const uploaded = await upload.json();
  assert.equal(context.bucket.objects.has(uploaded.key), true);

  const created = await send(context, "/api/videos", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Managed thumbnail cleanup",
      source_url: "https://example.com/video.mp4",
      thumbnail_url: uploaded.url,
      primary_category: "Technology",
      subcategory: "Web Development",
      published: false,
    }),
  });
  const video = (await created.json()).video;

  const removed = await send(context, `/api/videos/${video.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` },
  });
  assert.equal(removed.status, 200);
  assert.equal(context.bucket.objects.has(uploaded.key), false);
});

test("serves the seeded YouTube demo and records privacy-hashed interests", async () => {
  const context = createTestContext();
  context.sqlite.exec(readFileSync(new URL("../migrations/0007_universal_video_experience.sql", import.meta.url), "utf8"));
  context.sqlite.exec(readFileSync(new URL("../migrations/0008_verified_demo_metadata.sql", import.meta.url), "utf8"));
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, media_type, primary_category, subcategory, description, published, views
     ) VALUES (?, ?, ?, 'raw', 'Technology', 'Web Development', ?, 1, 200),
              (?, ?, ?, 'raw', 'Science', 'Space', ?, 1, 10)`,
  ).run(
    "related-web-video", "Related web video", "https://example.com/related.mp4", "A related recommendation",
    "unrelated-space-video", "Unrelated space video", "https://example.com/space.mp4", "A different recommendation",
  );

  const demo = context.sqlite.prepare(
    "SELECT id FROM videos WHERE slug = 'youtube-embed-experience-demo'",
  ).get();
  assert.ok(demo?.id);

  const page = await send(context, "/watch/youtube-embed-experience-demo");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /youtube-nocookie\.com\/embed\/M7lc1UVf-VE/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1">/);
  assert.match(html, /"@graph"/);
  assert.match(html, /id="watch-related"/);
  const sourceMetadata = context.sqlite.prepare(
    "SELECT source_published_at, source_duration FROM video_source_metadata WHERE video_id = ?",
  ).get(demo.id);
  const sanitized = sanitizeWatchHtml(html, sourceMetadata);
  assert.match(sanitized, /VideoObject/);
  assert.match(sanitized, /2013-04-10T17:25:04\.000Z/);
  assert.match(sanitized, /PT15M51S/);

  const headers = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": "192.0.2.70",
    "User-Agent": "recommendation-test-browser",
  };
  const saved = await send(context, `/api/videos/${demo.id}/interest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ signal: "more" }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).score, 5);
  const interest = context.sqlite.prepare("SELECT fingerprint, score FROM viewer_interests").get();
  assert.match(interest.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(interest.score, 5);

  const recommended = await send(context, `/api/videos/${demo.id}/recommendations?limit=2`, { headers });
  assert.equal(recommended.status, 200);
  const result = await recommended.json();
  assert.equal(result.personalized, true);
  assert.equal(result.videos[0].slug, "related-web-video");
});

test("the theater player has modal keyboard and focus behavior", () => {
  const source = readFileSync(new URL("../public/watch.js", import.meta.url), "utf8");
  assert.match(source, /setAttribute\("aria-modal", "true"\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /focusReturn/);
});

test("stores matching analysis and serves crawlable transcripts with WebVTT captions", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (slug, title, source_url, media_type, primary_category, subcategory, thumbnail_url, published)
     VALUES ('caption-test', 'Caption test', 'https://example.com/media/uploads/test.mp4', 'raw', 'Technology', 'Web Development', 'https://example.com/thumb.jpg', 1)`,
  ).run();

  const stored = await send(context, "/api/admin/videos/1/analysis", {
    method: "PUT",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      source_url: "https://example.com/media/uploads/test.mp4",
      transcript: "A reviewed transcript for search visitors.",
      ocr_text: "[0s] Visible title",
      captions_vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nWelcome to Vid.Best",
      language: "en",
      analysis_provider: "teamwork",
    }),
  });
  assert.equal(stored.status, 200);

  const captions = await send(context, "/captions/caption-test.vtt");
  assert.equal(captions.status, 200);
  assert.match(captions.headers.get("Content-Type"), /^text\/vtt/);
  assert.match(await captions.text(), /Welcome to Vid\.Best/);

  const page = await send(context, "/watch/caption-test");
  const html = await page.text();
  assert.match(html, /Read transcript/);
  assert.match(html, /A reviewed transcript for search visitors\./);
  assert.match(html, /<track kind="captions"/);
  assert.match(html, /"transcript":"A reviewed transcript for search visitors\."/);
});

test("removes stale analysis when an administrator changes the media source", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (slug, title, source_url, media_type, primary_category, subcategory, published)
     VALUES ('source-change', 'Source change', 'https://example.com/old.mp4', 'raw', 'Technology', 'Web Development', 0)`,
  ).run();
  context.sqlite.prepare(
    `INSERT INTO video_analysis (video_id, source_url, transcript) VALUES (1, 'https://example.com/old.mp4', 'Old transcript')`,
  ).run();
  const response = await send(context, "/api/videos/1", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Source change",
      source_url: "https://example.com/new.mp4",
      primary_category: "Technology",
      subcategory: "Web Development",
      published: false,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(context.sqlite.prepare("SELECT COUNT(*) AS total FROM video_analysis").get().total, 0);
});

test("starts owned R2 analysis through the authenticated Teamwork API", async () => {
  const teamworkKey = "teamwork-test-key-that-is-longer-than-thirty-two-characters";
  const context = createTestContext({
    TEAMWORK_API_URL: "https://teamwork.example",
    TEAMWORK_API_KEY: teamworkKey,
  });
  const originalFetch = globalThis.fetch;
  let outgoing;
  globalThis.fetch = async (url, options) => {
    outgoing = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "0123456789abcdef0123456789abcdef",
      status: "queued",
      result: null,
      error: null,
      created_at: "2026-09-13T00:00:00Z",
      updated_at: "2026-09-13T00:00:00Z",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await send(context, "/api/ai/analyze-media", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Owned upload",
        source_url: "https://example.com/media/uploads/test.mp4",
        r2_key: "uploads/2026-09-13/test.mp4",
      }),
    });
    assert.equal(response.status, 202);
    assert.equal(outgoing.url, "https://teamwork.example/v1/jobs");
    assert.equal(outgoing.options.headers.Authorization, `Bearer ${teamworkKey}`);
    assert.equal(outgoing.body.media_owned, true);
    assert.equal(outgoing.body.transcribe, true);
    assert.match(outgoing.body.source_url, /\/media\/uploads\/2026-09-13\/test\.mp4$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin uses the official TikTok blockquote preview instead of a raw player iframe", () => {
  const adminSource = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
  assert.match(adminSource, /renderTikTokPreview/);
  assert.match(adminSource, /className = "tiktok-embed"/);
  assert.match(adminSource, /ensureTikTokEmbedScript/);
  assert.doesNotMatch(adminSource, /window\.tiktokEmbed\?\.lib\?\.render/);
  assert.match(adminSource, /provider: "tiktok"/);
});

test("homepage previews wait three seconds and respect reduced-data preferences", () => {
  const player = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(player, /PREVIEW_DELAY_MS = 3000/);
  assert.match(player, /connection\?\.saveData/);
  assert.match(player, /prefers-reduced-motion: reduce/);
  assert.match(player, /previewState\.activeCard/);
  assert.match(appSource, /\/interest`/);
  assert.match(appSource, /\/comments`/);
  assert.match(appSource, /\/reactions`/);
});

test("renders the supplied official Saiyaara TikTok embed without fallback UI", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, embed_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    "tiktok-player-test",
    "Admin data title that must not alter official embed",
    "https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056?_r=1&_t=ZS-99uc1Q5QfSR",
    "https://www.tiktok.com/player/v1/7669587518156705056?controls=1",
    "tiktok",
    "Social Media & Trending",
    "TikTok Trending",
    "Official TikTok embed playback test",
  );

  const page = await send(context, "/watch/tiktok-player-test");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /class="tiktok-embed"/);
  assert.match(html, /data-video-id="7669587518156705056"/);
  assert.match(html, /@saiyaara\.4ever/);
  assert.match(html, /cite="https:\/\/www\.tiktok\.com\/@example\/video\/6718335390845095173"/);
  assert.doesNotMatch(html, /player\/v1\/7669587518156705056/);
  assert.match(html, /data-embed-from="embed_page"/);
  assert.match(html, /fyppppppppppppppppppppppp/);
  assert.match(html, /ahaanpanday/);
  assert.match(html, /aneetpadda/);
  assert.match(html, /saiyaara/);
  assert.match(html, /audio-originale-7669587549221178144/);
  assert.match(html, /data-video-provider="tiktok"/);

  const watchSource = readFileSync(new URL("../public/watch.js", import.meta.url), "utf8");
  assert.doesNotMatch(watchSource, /Play TikTok in popup/);
  assert.doesNotMatch(watchSource, /x-tiktok-player/);
  assert.doesNotMatch(watchSource, /initializeTikTokReliability/);
  assert.doesNotMatch(watchSource, /initializeTikTokPopupFallback/);
});

test("repairs a legacy TikTok record with only its source URL and uses the Saiyaara title", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, 'raw', 'Social Media & Trending', 'TikTok Trending', ?, 1)`,
  ).run(
    "saiyaara-tiktok",
    "Saiyaara movie TikTok",
    "https://www.tiktok.com/@example/video/6718335390845095173",
    "Legacy TikTok source without an embed URL",
  );

  const page = await send(context, "/watch/saiyaara-tiktok");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("<title>Saiyaara; A Cinematic Romance | Vid.Best</title>"));
  assert.ok(html.includes("<h1>Saiyaara; A Cinematic Romance</h1>"));
  assert.ok(html.includes('<blockquote class="tiktok-embed"'));
  assert.ok(html.includes('data-video-id="6718335390845095173"'));
  assert.ok(html.includes('@example'));
  assert.ok(html.includes('data-embed-from="embed_page"'));
  assert.ok(html.includes('https://www.tiktok.com/embed.js'));
  assert.doesNotMatch(html, /Play TikTok in popup/);
  assert.ok(html.includes('data-video-provider="tiktok"'));
});




test("resolves TikTok availability through the authenticated cloud gateway without proxying media", async () => {
  const gatewayKey = "gateway-test-secret-that-is-longer-than-thirty-two-characters";
  const context = createTestContext({
    TIKTOK_GATEWAY_URL: "https://gateway.example/v1/tiktok",
    TIKTOK_GATEWAY_TOKEN: gatewayKey,
  });
  const originalFetch = globalThis.fetch;
  let outgoing;
  globalThis.fetch = async (url, options) => {
    outgoing = { url: String(url), options };
    return new Response(JSON.stringify({
      ok: true,
      provider: "tiktok",
      video_id: "7669587518156705056",
      source_url: "https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056",
      availability: "metadata_available",
      title: "Saiyaara; A Cinematic Romance",
      author_name: "Saiyaara",
      official_embed: true,
      playback_note: "Playback still runs from TikTok in the visitor's browser.",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await send(
      context,
      "/api/admin/tiktok/resolve?url=" + encodeURIComponent("https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056"),
      { method: "GET", headers: { Authorization: `Bearer ${secret}` } },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.gateway.video_id, "7669587518156705056");
    assert.equal(result.gateway.availability, "metadata_available");
    assert.equal(outgoing.url, "https://gateway.example/v1/tiktok/resolve?url=https%3A%2F%2Fwww.tiktok.com%2F%40saiyaara.4ever%2Fvideo%2F7669587518156705056");
    assert.equal(outgoing.options.headers.Authorization, "Bearer " + gatewayKey);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redirects the legacy Saiyaara slug to the permanent SEO slug", async () => {
  const context = createTestContext();
  const response = await send(context, "/watch/fyppppppppppppppppppppppp-fyp-ahaanpanday-aneetpadda-saiyaara");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://example.com/watch/saiyaara-a-cinematic-romance");
});
