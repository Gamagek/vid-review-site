import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index.js";
import { refreshSourceMetadata, sanitizeWatchHtml } from "../src/edge.js";
import seoEdge from "../src/seo-edge.js";

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
  "0014_member_notifications.sql",
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

test("returns a clear configuration error when member email delivery is unavailable", async () => {
  const context = createTestContext();
  const response = await send(context, "/api/account/login", {
    method: "POST",
    headers: { Origin: "https://example.com", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "viewer@example.com" }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Email sign-in is not configured/);
});
test("supports email magic-link account sessions and preferences", async () => {
  const context = createTestContext({
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "Vid.Best <notifications@example.com>",
  });
  const originalFetch = globalThis.fetch;
  let sentEmail;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://api.resend.com/emails") return originalFetch(url, options);
    sentEmail = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: "email-test-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const requested = await send(context, "/api/account/login", {
      method: "POST",
      headers: { Origin: "https://example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "Viewer@example.com" }),
    });
    assert.equal(requested.status, 200);
    assert.deepEqual(sentEmail.to, ["viewer@example.com"]);
    const match = String(sentEmail.html).match(/login_token=([A-Za-z0-9_-]{40,120})/);
    assert.ok(match?.[1]);

    const verified = await send(context, "/api/account/verify", {
      method: "POST",
      headers: { Origin: "https://example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ token: match[1] }),
    });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get("Set-Cookie").split(";", 1)[0];
    assert.match(cookie, /^__Host-vidbest_member=/);

    const me = await send(context, "/api/account/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).member.email, "viewer@example.com");

    const preferences = await send(context, "/api/account/preferences", {
      method: "POST",
      headers: { Origin: "https://example.com", Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ email_notifications: false, category_filter: ["Technology"] }),
    });
    assert.equal(preferences.status, 200);
    const member = (await preferences.json()).member;
    assert.equal(member.email_notifications, false);
    assert.deepEqual(member.category_filter, ["Technology"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("home page contains the account, browser alert and shortcut controls", () => {
  const source = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/notifications.js", import.meta.url), "utf8");
  assert.match(source, /id="notification-hub"/);
  assert.match(source, /id="member-login-form"/);
  assert.match(source, /id="browser-alert-button"/);
  assert.match(source, /id="shortcut-button"/);
  assert.match(source, /id="notification-feed"/);
  assert.match(source, /manifest\.webmanifest/);
  assert.match(script, /Notification\.requestPermission/);
  assert.match(script, /beforeinstallprompt/);
  assert.match(script, /\/api\/notifications\/latest/);
  assert.doesNotMatch(script, /renderNotificationFeed/);
  assert.match(script, /notification-feed-item/);
});

test("home embed previews keep Facebook on the direct-player path", () => {
  const source = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
  assert.match(source, /else if \(provider === "twitch"\)[\s\S]*?url\.searchParams\.set\("parent", location\.hostname\);\s*}\s*return url\.href;/);
  assert.match(source, /const EMBED_PREVIEW_PROVIDERS = new Set\(\["youtube", "vimeo", "dailymotion", "twitch"\]\)/);
  assert.match(source, /function mountFacebookDirectPlayer/);
  assert.match(source, /function safeFacebookDirectEmbed/);
});

test("homepage Facebook tiles use the direct official player", () => {
  const source = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
  assert.match(source, /function mountFacebookDirectPlayer/);
  assert.match(source, /facebook-direct-player/);
  assert.match(source, /const nearViewport = isNearViewport\(card\);[\s\S]*?iframe\.loading = nearViewport \? "eager" : "lazy"/);
  assert.match(source, /iframe\.fetchPriority = nearViewport \? "high" : "auto"/);
  assert.match(source, /plugins\/video\.php/);
  assert.doesNotMatch(source, /function renderFacebookFacade/);
  assert.doesNotMatch(source, /facebook-microlink-preview/);
});

test("signed /watch route rejects bad ids", async () => {
  const context = createTestContext({ ["SIGN_" + "SECRET"]: secret });
  const response = await seoEdge.fetch(
    new Request("https://example.com/watch?user=umbralarchive&id=not-a-number"),
    context.env,
    context.ctx,
  );
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Bad link");
});

test("signed /watch route rejects missing secret without generating a fallback signature", async () => {
  const context = createTestContext();
  const response = await seoEdge.fetch(
    new Request("https://example.com/watch?user=umbralarchive&id=7552567024304540959"),
    context.env,
    context.ctx,
  );
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Not configured");
});

test("signed /watch route returns a signed gateway iframe", async () => {
  const context = createTestContext({ ["SIGN_" + "SECRET"]: secret });
  const response = await seoEdge.fetch(
    new Request("https://example.com/watch?user=umbralarchive&id=7552567024304540959"),
    context.env,
    context.ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");

  const html = await response.text();
  assert.match(
    html,
    /<iframe src="https:\/\/video\.megasale\.win\/\?url=https%3A%2F%2Fwww\.tiktok\.com%2F%40umbralarchive%2Fvideo%2F7552567024304540959&amp;exp=\d+&amp;sig=[a-f0-9]{64}" width="325" height="580" style="border:0;max-width:100%" allow="fullscreen"><\/iframe>/,
  );
});

test("TikTok watch pages include the signed gateway fallback for existing and future records", async () => {
  const context = createTestContext({ ["SIGN_" + "SECRET"]: secret });
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, embed_url, media_type, primary_category, subcategory, description, published
     ) VALUES ('gateway-tiktok-test', 'Gateway TikTok test', 'https://www.tiktok.com/@umbralarchive/video/7552567024304540959', 'https://www.tiktok.com/player/v1/7552567024304540959', 'tiktok', 'Social Media & Trending', 'TikTok Viral Challenges', 'Gateway fallback test', 1)`,
  ).run();

  const page = await send(context, "/watch/gateway-tiktok-test");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-tiktok-gateway-src="https:\/\/video\.megasale\.win\/\?url=/);
  assert.match(html, /data-tiktok-gateway-src="[^"]*sig=[a-f0-9]{64}"/);
});
 
test("Facebook mini preview stays separate from the original-quality watch player", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, embed_url, media_type, primary_category, subcategory, description, published
     ) VALUES ('facebook-mini-preview', 'Facebook preview test', 'https://www.facebook.com/reel/1986667352042256', 'https://www.facebook.com/plugins/video.php?height=314&href=https%3A%2F%2Fwww.facebook.com%2Freel%2F1986667352042256&show_text=false&width=560&t=0', 'facebook', 'Social Media & Trending', 'Facebook Reels Highlights', 'Facebook preview test', 1)`,
  ).run();

  const page = await send(context, "/watch/facebook-mini-preview");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /class="facebook-official-player"/);
  assert.match(html, /autoplay=true/);
  assert.match(html, /muted=true/);
});

test("resolves a Facebook share URL into the official plugin player", async () => {
  const context = createTestContext();
  const share = "https://www.facebook.com/share/v/1EwUUT7MN8/";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) === share) {
      return {
        ok: true,
        url: "https://www.facebook.com/reel/1986667352042256/",
      };
    }
    return originalFetch(url, options);
  };
  try {
    const response = await send(context, "/api/facebook/resolve?url=" + encodeURIComponent(share));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.source_url, "https://www.facebook.com/reel/1986667352042256/");
    const embed = new URL(result.embed_url);
    assert.equal(embed.pathname, "/plugins/video.php");
    assert.equal(embed.searchParams.get("href"), "https://www.facebook.com/reel/1986667352042256/");
    assert.equal(embed.searchParams.get("show_text"), "false");
    assert.equal(embed.searchParams.get("width"), "560");
    assert.equal(embed.searchParams.get("height"), "314");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renders Facebook Reel records through the official responsive plugin URL", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, embed_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, ?, 'facebook', 'Social Media & Trending', 'Facebook Reels Highlights', ?, 1)`,
  ).run(
    "facebook-existing-one",
    "Facebook existing one",
    "https://www.facebook.com/reel/1986667352042256",
    "https://www.facebook.com/broken-old-embed",
    "Facebook playback compatibility test",
  );

  const page = await send(context, "/watch/facebook-existing-one");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /facebook-official-player/);
  assert.doesNotMatch(html, /broken-old-embed/);
  const frame = html.match(/class="facebook-official-player"[^>]+src="([^"]+)"/)?.[1];
  assert.ok(frame);
  const embed = new URL(frame.replace(/&amp;/g, "&"));
  assert.equal(embed.hostname, "www.facebook.com");
  assert.equal(embed.pathname, "/plugins/video.php");
  assert.equal(embed.searchParams.get("href"), "https://www.facebook.com/reel/1986667352042256");
  assert.equal(embed.searchParams.get("show_text"), "false");
  assert.equal(embed.searchParams.get("width"), "560");
  assert.equal(embed.searchParams.get("height"), "314");
  assert.equal(embed.searchParams.get("t"), "0");

  const api = await send(context, "/api/videos/facebook-existing-one");
  assert.equal(api.status, 200);
  const video = (await api.json()).video;
  assert.equal(video.provider, "facebook");
  const storedEmbed = new URL(video.embed_url);
  assert.equal(storedEmbed.searchParams.get("show_text"), "false");
  assert.equal(storedEmbed.searchParams.get("width"), "560");
  assert.equal(storedEmbed.searchParams.get("height"), "314");
});

test("resolves Facebook share-video links to the official video plugin target", async () => {
  const context = createTestContext();
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async (url) => {
    called += 1;
    assert.equal(String(url), "https://www.facebook.com/share/v/1EwUUT7MN8/");
    return {
      ok: true,
      url: "https://www.facebook.com/reel/1986667352042256",
    };
  };
  try {
    const response = await send(
      context,
      "/api/facebook/resolve?url=" + encodeURIComponent("https://www.facebook.com/share/v/1EwUUT7MN8/"),
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(called, 1);
    assert.equal(payload.provider, "facebook");
    assert.equal(payload.source_url, "https://www.facebook.com/reel/1986667352042256");
    const embed = new URL(payload.embed_url);
    assert.equal(embed.hostname, "www.facebook.com");
    assert.equal(embed.pathname, "/plugins/video.php");
    assert.equal(embed.searchParams.get("href"), "https://www.facebook.com/reel/1986667352042256");
    assert.equal(embed.searchParams.get("show_text"), "false");
    assert.equal(embed.searchParams.get("width"), "560");
    assert.equal(embed.searchParams.get("height"), "314");
    assert.equal(embed.searchParams.get("t"), "0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the requested Facebook Reel plugin structure for any Facebook video URL", async () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
  assert.match(source, /height: "314"/);
  assert.match(source, /show_text: "false"/);
  assert.match(source, /width: "560"/);
  assert.match(source, /t: "0"/);
  assert.match(admin, /height=314&href=\$\{encodeURIComponent\(url\.toString\(\)\)\}&show_text=false&width=560&t=0/);
});

test("robots allows public video preview endpoints while keeping admin and API mutations blocked", async () => {
  const context = createTestContext();
  const response = await send(context, "/robots.txt");
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Allow: \/api\/tiktok\/thumbnail/);
  assert.match(body, /Allow: \/api\/tiktok\/preflight/);
  assert.match(body, /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
});

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

test("accepts HLS manifest and segment uploads under the managed HLS prefix", async () => {
  const context = createTestContext();
  const manifest = await send(context, "/api/assets?filename=master.m3u8", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/vnd.apple.mpegurl",
      "Content-Length": "28",
      "X-File-Name": "master.m3u8",
      "X-Asset-Key": "uploads/hls/test/master.m3u8",
      "X-Media-Rights-Confirmed": "1",
    },
    body: "#EXTM3U\n#EXT-X-VERSION:3\nsegment.ts\n",
  });
  assert.equal(manifest.status, 201);
  const uploaded = await manifest.json();
  assert.equal(uploaded.key, "uploads/hls/test/master.m3u8");

  const segment = await send(context, "/api/assets?filename=segment.ts", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "video/mp2t",
      "Content-Length": "3",
      "X-File-Name": "segment.ts",
      "X-Asset-Key": "uploads/hls/test/segment.ts",
      "X-Media-Rights-Confirmed": "1",
    },
    body: "ts!",
  });
  assert.equal(segment.status, 201);
  const segmentResponse = await send(context, "/media/uploads/hls/test/segment.ts");
  assert.equal(segmentResponse.status, 200);
  assert.equal(segmentResponse.headers.get("Content-Type"), "video/mp2t");
});

test("rejects HLS uploads without media rights confirmation", async () => {
  const context = createTestContext();
  const response = await send(context, "/api/assets?filename=master.m3u8", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/vnd.apple.mpegurl",
      "Content-Length": "8",
      "X-File-Name": "master.m3u8",
      "X-Asset-Key": "uploads/hls/test/master.m3u8",
    },
    body: "#EXTM3U",
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /permission to store and serve/i);
});

test("serves HLS manifests with cacheable HLS headers", async () => {
  const context = createTestContext();
  context.bucket.objects.set("uploads/hls/demo/master.m3u8", {
    bytes: new TextEncoder().encode("#EXTM3U\nsegment.ts\n"),
    options: { httpMetadata: { contentType: "application/vnd.apple.mpegurl" } },
  });
  const response = await send(context, "/media/uploads/hls/demo/master.m3u8");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/vnd.apple.mpegurl");
  assert.match(response.headers.get("Access-Control-Allow-Origin"), /\*/);
  assert.match(response.headers.get("Cache-Control"), /max-age=300/);
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

test("uses the optional NGINX TikTok facade for metadata without writing R2 cache files", async () => {
  const context = createTestContext({ TIKTOK_FACADE_API_URL: "https://gateway.example.com/api/tiktok-oembed" });
  const originalFetch = globalThis.fetch;
  const sample = "https://www.tiktok.com/@rorozya/video/7622472784039415061";
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      type: "video",
      title: "ro² (@rorozya) on TikTok",
      author_name: "ro²",
      thumbnail_url: "https://p19-common-sign.tiktokcdn-us.com/example/preview.jpg",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await send(context, "/api/tiktok/preflight?url=" + encodeURIComponent(sample));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.cached, true);
    assert.equal(payload.video_id, "7622472784039415061");
    assert.match(calls[0], /^https:\/\/gateway\.example\.com\/api\/tiktok-oembed\?url=/);
    assert.equal(context.bucket.objects.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("stores TikTok source and renders the PR26-style player", async () => {
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
  assert.match(result.video.embed_url, /^https:\/\/www\.tiktok\.com\/player\/v1\/6718335390845095173\?/);
  assert.equal(result.video.thumbnail_url, null);

  const page = await send(context, `/watch/${result.video.slug}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-vidbest-tiktok-player/);
  assert.match(html, /data-tiktok-id="6718335390845095173"/);
  assert.match(html, /data-tiktok-share=/);
  assert.match(html, /data-tiktok-gateway-src=/);
  assert.match(html, /src="\/tiktok-video-service\.js"/);
  assert.match(html, /src="\/tiktok-audio-lab\.js"/);
  assert.match(html, /src="\/tiktok-audio-lab-ui\.js"/);
  assert.match(html, /src="\/tiktok-player\.js"/);
  assert.doesNotMatch(html, /<iframe[^>]+tiktok-official-player/);
  assert.doesNotMatch(html, /https:\/\/www\.tiktok\.com\/player\/v1\/6718335390845095173\?/);
  assert.ok(!html.includes("https://www.tiktok.com/embed.js"));
});

test("Instagram legacy records receive a dedicated player without needing a database rewrite", async () => {
  const context = createTestContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug, title, source_url, embed_url, media_type, primary_category, subcategory, published)
    VALUES ('instagram-latest', 'Instagram test', ?, ?, 'raw', 'Other', 'Instagram Reel', 1)`)
    .run('https://www.instagram.com/reel/DcAcA_QnOLk/?stkn=old-share',
      'https://www.instagram.com/reel/DcAcA_QnOLk/embed');
  const response = await send(context, '/watch/instagram-latest');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /class="instagram-player"/);
  assert.match(html, /class="instagram-official-player" src="https:\/\/www.instagram.com\/reel\/DcAcA_QnOLk\/embed\/"/);
  assert.match(html, /type="module" src="\/instagram-player.js"/);
  assert.match(html, /href="\/instagram-player.css"/);
  assert.doesNotMatch(html, /src="\/tiktok-player.js"/);
  assert.doesNotMatch(html, /<video id="watch-media-video"/);
});

test("published Instagram records get a same-origin thumbnail fallback when no thumbnail was supplied", async () => {
  const context = createTestContext();
  context.sqlite.prepare(`INSERT INTO videos
    (slug, title, source_url, embed_url, media_type, primary_category, subcategory, published)
    VALUES ('instagram-thumb-fallback', 'Instagram thumbnail fallback', ?, ?, 'raw', 'Other', 'Instagram Reel', 1)`)
    .run(
      'https://www.instagram.com/reel/ABC_def-123/',
      'https://www.instagram.com/reel/ABC_def-123/embed/',
    );

  const response = await send(context, '/api/videos/instagram-thumb-fallback');
  assert.equal(response.status, 200);
  const video = (await response.json()).video;
  assert.ok(video);
  assert.equal(
    video.thumbnail_url,
    '/api/instagram/thumbnail?url=' + encodeURIComponent('https://www.instagram.com/reel/ABC_def-123/'),
  );
});

test("Instagram thumbnail endpoint extracts and serves an allowed public preview image", async () => {
  const context = createTestContext();
  const source = 'https://www.instagram.com/reel/ABC_def-123/';
  const image = 'https://scontent.cdninstagram.com/example/reel-preview.jpg';
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://graph.facebook.com/v26.0/instagram_oembed?")) {
      return new Response(JSON.stringify({
        type: "rich",
        author_name: "example.creator",
        html: "<blockquote class=\"instagram-media\"></blockquote>",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url) === source) {
      return new Response(
        '<html><head><meta property="og:image" content="' + image + '"></head></html>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (String(url) === image) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    throw new Error('Unexpected upstream URL: ' + String(url));
  };

  try {
    const response = await send(
      context,
      '/api/instagram/thumbnail?url=' + encodeURIComponent(source),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/jpeg");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=604800, stale-while-revalidate=2592000");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
    assert.equal(calls[0].startsWith("https://graph.facebook.com/v26.0/instagram_oembed?"), true);
    assert.deepEqual(calls.slice(1), [source, image]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("homepage uses the dedicated Instagram inline player module", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/instagram-preview-card.js", import.meta.url), "utf8");
  assert.match(html, /type="module" src="\\/instagram-preview-card\\.js"/);
  assert.doesNotMatch(html, /type="module" src="\\/instagram-player\\.js"/);
  assert.match(script, /parseInstagramUrl/);
  assert.match(script, /className = "instagram-home-player"/);
  assert.match(script, /frame\\.src = source\\.embedUrl/);
  assert.doesNotMatch(script, /Open on Instagram/);
  assert.doesNotMatch(script, /instagram-preview-modal/);
});

test("Instagram homepage tiles never display the raw media-type badge", () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /card\\.dataset\\.videoProvider === "instagram" \\? "Instagram" : video\\.media_type/);
});

test("Instagram watch player has no obsolete homepage preview hook", () => {
  const source = readFileSync(new URL("../public/instagram-player.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /decoratePreviews/);
  assert.match(source, /source\\.embedUrl/);
});

test("Instagram preview endpoint returns a thumbnail fallback and official Reel embed", async () => {
  const context = createTestContext();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (request) => {
    const url = String(request);
    calls.push(url);
    if (url.startsWith("https://graph.facebook.com/v26.0/instagram_oembed?")) {
      return new Response(JSON.stringify({
        type: "rich",
        author_name: "example.creator",
        author_url: "https://www.instagram.com/example.creator/",
        html: "<blockquote class=\"instagram-media\"></blockquote>",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://www.instagram.com/reel/DcAcA_QnOLk/") {
      return new Response(
        '<meta property="og:title" content="Example Reel"><meta property="og:image" content="https://scontent.cdninstagram.com/example.jpg"><meta property="og:description" content="Example description">',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    throw new Error("Unexpected Instagram upstream request");
  };
  try {
    const response = await send(
      context,
      "/api/instagram/previews?url=" + encodeURIComponent("https://www.instagram.com/reel/DcAcA_QnOLk/?igsh=test"),
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.previews.length, 1);
    assert.equal(payload.previews[0].source_url, "https://www.instagram.com/reel/DcAcA_QnOLk/");
    assert.equal(payload.previews[0].embed_url, "https://www.instagram.com/reel/DcAcA_QnOLk/embed/");
    assert.equal(payload.previews[0].author_name, "example.creator");
    assert.equal(payload.previews[0].title, "Example Reel");
    assert.equal(payload.previews[0].thumbnail_url, "https://scontent.cdninstagram.com/example.jpg");
    assert.equal(payload.previews[0].embed_available, true);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("new Instagram discoveries use clean official URLs", async () => {
  const context = createTestContext();
  const response = await send(context, '/api/admin/discover?q=' + encodeURIComponent(
    'https://www.instagram.com/reels/DcAcA_QnOLk/?igsh=test'),
    { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(response.status, 200);
  const video = (await response.json()).results[0];
  assert.equal(video.provider, 'instagram');
  assert.equal(video.source_url, 'https://www.instagram.com/reel/DcAcA_QnOLk/');
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

test("renders an R2 HLS media record as a browser HLS player", async () => {
  const context = createTestContext();
  const response = await send(context, "/api/videos", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Authorized HLS test",
      r2_key: "uploads/hls/demo/master.m3u8",
      primary_category: "Technology",
      subcategory: "Web Development",
      published: true,
      media_rights_confirmed: true,
    }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.video.media_type, "r2");
  assert.equal(result.video.provider, "hls");
  const page = await send(context, `/watch/${result.video.slug}`);
  const html = await page.text();
  assert.match(html, /data-hls="1"/);
  assert.match(html, /application\/vnd\.apple\.mpegurl/);
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

test("SEO edge exposes a crawlable video index and pages sitemap", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (slug, title, source_url, media_type, primary_category, subcategory, description, published) VALUES
      ('seo-video-one', 'SEO video one', 'https://example.com/video-one.mp4', 'raw', 'Technology', 'Web Development', 'A unique description for search discovery', 1),
      ('seo-video-two', 'SEO video two', 'https://example.com/video-two.mp4', 'raw', 'Education', 'Tutorials & How-Tos', 'Another unique description for search discovery', 1)`,
  ).run();

  const videosPage = await seoEdge.fetch(new Request('https://example.com/videos'), context.env, context.ctx);
  assert.equal(videosPage.status, 200);
  const html = await videosPage.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/vid\.best\/videos">/);
  assert.match(html, /https:\/\/vid\.best\/watch\/seo-video-one/);
  assert.match(html, /https:\/\/vid\.best\/watch\/seo-video-two/);
  assert.match(html, /"@type":"CollectionPage"/);

  const sitemap = await seoEdge.fetch(new Request('https://example.com/sitemap.xml'), context.env, context.ctx);
  assert.equal(sitemap.status, 200);
  const sitemapXml = await sitemap.text();
  assert.match(sitemapXml, /https:\/\/vid\.best\/sitemaps\/pages\.xml/);

  const pages = await seoEdge.fetch(new Request('https://example.com/sitemaps/pages.xml'), context.env, context.ctx);
  assert.equal(pages.status, 200);
  const pagesXml = await pages.text();
  assert.match(pagesXml, /https:\/\/vid\.best\/videos/);
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

test("enriches Facebook share links with a Microlink-style thumbnail and official embed metadata", async () => {
  const context = createTestContext();
  const share = "https://www.facebook.com/share/v/1EwUUT7MN8/";
  const canonical = "https://www.facebook.com/darmalipi/videos/pause-for-a-moment-breathe-observe-dscover-the-profound-peace-of-theravada-vipas/1986667352042256/";
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, media_type, primary_category, subcategory, description, published
     ) VALUES ('facebook-preview-test', 'Fallback title', ?, 'raw', 'Social Media & Trending', 'Facebook Reels Highlights', 'Fallback description', 1)`,
  ).run(share);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === share) {
      return { ok: true, url: canonical };
    }
    if (value === canonical) {
      return new Response(
        `<!doctype html><meta property="og:title" content="Pause for a moment, Breathe, Observe."><meta property="og:description" content="Discover the profound peace of Theravada Vipassana meditation."><meta property="og:image" content="https://scontent.xx.fbcdn.net/test.jpg">`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    throw new Error("Unexpected Facebook request: " + value);
  };
  try {
    const response = await send(context, "/api/videos/facebook-preview-test");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.video.provider, "facebook");
    assert.equal(result.video.thumbnail_url, "https://scontent.xx.fbcdn.net/test.jpg");
    assert.equal(result.video.facebook_preview_title, "Pause for a moment, Breathe, Observe.");
    assert.match(result.video.facebook_preview_description, /Theravada Vipassana/);
    assert.ok(result.video.embed_url.includes("facebook.com/plugins/video.php"));
    assert.match(result.video.embed_url, /show_text=false/);
    assert.match(result.video.embed_url, /width=560/);
    assert.match(result.video.embed_url, /height=314/);
    assert.match(result.video.embed_url, /1986667352042256/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renders existing Facebook share and Reel URLs with the official video plugin", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, media_type, primary_category, subcategory, description, published
     ) VALUES
       ('facebook-share-video', 'Facebook share video', 'https://www.facebook.com/share/v/1EwUUT7MN8/', 'raw', 'Social Media & Trending', 'Facebook Reels Highlights', 'Facebook share test', 1),
       ('facebook-reel-video', 'Facebook reel video', 'https://www.facebook.com/reel/1986667352042256', 'raw', 'Social Media & Trending', 'Facebook Reels Highlights', 'Facebook reel test', 1)`,
  ).run();

  for (const slug of ["facebook-share-video", "facebook-reel-video"]) {
    const page = await send(context, "/watch/" + slug);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<iframe id="watch-media-frame" class="facebook-official-player"/);
    assert.match(html, /https:\/\/www\.facebook\.com\/plugins\/video\.php\?height=314&amp;href=/);
    assert.match(html, /show_text=false/);
    assert.match(html, /width=560/);
    assert.match(html, /t=0/);
    assert.match(html, /allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen"/);
  }
});

test("notification hub hides mail transport details and keeps browser alert controls", () => {
  const source = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /id="browser-alert-button"/);
  assert.match(source, /id="shortcut-button"/);
  assert.doesNotMatch(source, /Email sign-in and new-video emails use your verified sending setup/);
  assert.doesNotMatch(source, />New video emails</);
  assert.match(source, /Account email/);
  assert.match(source, />Email alerts</);
  const script = readFileSync(new URL("../public/notifications.js", import.meta.url), "utf8");
  assert.doesNotMatch(script, /\[object HTMLParagraphElement\]/);
  assert.match(script, /message\.textContent/);
});

test("TikTok keeps separate share preview and player paths", () => {
  const adminSource = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
  assert.match(adminSource, /renderTikTokPreview/);
  assert.match(adminSource, /buildTikTokPlayerUrl/);
  assert.ok(adminSource.includes("https://www.tiktok.com/player/v1/${encodeURIComponent(videoId)}?${params.toString()}"));
  assert.match(adminSource, /className = "tiktok-embed"/);
  assert.match(adminSource, /ensureTikTokAdminEmbedScript/);
  assert.match(adminSource, /TikTok preview needs the normal full sharing link/);
});

test("renders the current Vid.Best TikTok direct player with separate home preview behavior", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, embed_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    "tiktok-player-test",
    "Admin data title",
    "https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056?_r=1&_t=ZS-99uc1Q5QfSR",
    "https://www.tiktok.com/player/v1/7669587518156705056?controls=0",
    "tiktok",
    "Social Media & Trending",
    "TikTok Trending",
    "Official TikTok player test",
  );

  const page = await send(context, "/watch/tiktok-player-test");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-vidbest-tiktok-player/);
  assert.match(html, /data-tiktok-id="7669587518156705056"/);
  assert.match(html, /data-tiktok-gateway-src=/);
  assert.doesNotMatch(html, /<iframe[^>]+tiktok-official-player/);
  assert.doesNotMatch(html, /https:\/\/www\.tiktok\.com\/player\/v1\/7669587518156705056\?/);
  assert.doesNotMatch(html, /class="tiktok-embed"/);
  assert.ok(!html.includes("https://www.tiktok.com/embed.js"));
  assert.match(html, /data-video-provider="tiktok"/);

  const watchSource = readFileSync(new URL("../public/watch.js", import.meta.url), "utf8");
  assert.match(watchSource, /if \(provider === "tiktok"\) return/);

  const tiktokServiceSource = readFileSync(new URL("../public/tiktok-video-service.js", import.meta.url), "utf8");
  assert.match(tiktokServiceSource, /DEFAULT_INTERVAL_MS = 3000/);
  assert.match(tiktokServiceSource, /DEFAULT_MAX_ATTEMPTS = 15/);
  assert.match(tiktokServiceSource, /status === "cached"/);
  assert.match(tiktokServiceSource, /status: "scraping"/);
  assert.match(tiktokServiceSource, /response.status === 404/);
  assert.match(tiktokServiceSource, /buildStreamUrl/);

  const tiktokPlayerSource = readFileSync(new URL("../public/tiktok-player.js", import.meta.url), "utf8");
  assert.match(tiktokPlayerSource, /MAX_ATTEMPTS = 15/);
  assert.match(tiktokPlayerSource, /POLL_INTERVAL_MS = 3000/);
  assert.match(tiktokPlayerSource, /crossorigin/);
  assert.match(tiktokPlayerSource, /VidBestTikTokVideoService/);
  assert.match(tiktokPlayerSource, /pollR2Video/);
  assert.match(tiktokPlayerSource, /Video ready/);
  assert.match(tiktokPlayerSource, /VidBestAudioLab/);
  assert.match(tiktokPlayerSource, /data-fallback-retry/);

  const audioSource = readFileSync(new URL("../public/tiktok-audio-lab.js", import.meta.url), "utf8");
  assert.match(audioSource, /createMediaElementSource/);
  assert.match(audioSource, /createGain/);
  assert.match(audioSource, /createBiquadFilter/);
  assert.match(audioSource, /createStereoPanner/);
  assert.match(audioSource, /context\.resume/);

  const audioUiSource = readFileSync(new URL("../public/tiktok-audio-lab-ui.js", import.meta.url), "utf8");
  assert.match(audioUiSource, /Bass/);
  assert.match(audioUiSource, /Mid/);
  assert.match(audioUiSource, /Treble/);
  assert.match(audioUiSource, /Space/);
  assert.match(audioUiSource, /Master/);
  const homeSource = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
  assert.match(homeSource, /parseTikTokShareUrl/);
  assert.match(homeSource, /loadTikTokFacadePreviews/);
  assert.match(homeSource, /renderTikTokFacade/);
  assert.match(homeSource, /\/api\/tiktok\/previews/);
  assert.doesNotMatch(homeSource, /buildTikTokPreviewPlayerUrl/);
  assert.doesNotMatch(homeSource, /tiktok\/player\/v1/);
  assert.match(homeSource, /PREVIEW_DELAY_MS = 450/);
  assert.doesNotMatch(homeSource, /ensureTikTokEmbedScript/);
  assert.doesNotMatch(homeSource, /className = "tiktok-embed"/);
  assert.match(homeSource, /provider === "tiktok"/);
  assert.match(homeSource, /provider === "facebook"/);
  assert.match(homeSource, /mountFacebookDirectPlayer/);
  assert.match(homeSource, /safeFacebookDirectEmbed/);
  assert.match(homeSource, /facebook-direct-player/);
  assert.match(homeSource, /plugins\/video\.php/);
  assert.doesNotMatch(homeSource, /renderFacebookFacade/);
  assert.doesNotMatch(homeSource, /facebook-microlink-preview/);
  assert.match(homeSource, /tiktok-microlink-preview/);
  assert.match(homeSource, /TikTok preview · tap to open/);

  const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(indexSource, /data-tiktok-gateway-src/);
  assert.match(indexSource, /\/api\/tiktok\/preflight/);
  assert.match(indexSource, /www\.tiktok\.com\/oembed/);
  assert.match(indexSource, /tiktokcdn(?:-[a-z0-9-]+)?\.com/);
});

test("builds a direct Facebook player without the old card facade", () => {
  const homeSource = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
  assert.match(homeSource, /mountFacebookDirectPlayer/);
  assert.match(homeSource, /safeFacebookDirectEmbed/);
  assert.match(homeSource, /plugins\/video\.php/);
  assert.match(homeSource, /const nearViewport = isNearViewport\(card\);[\s\S]*?iframe\.loading = nearViewport \? "eager" : "lazy"/);
  assert.doesNotMatch(homeSource, /renderFacebookFacade/);
  assert.doesNotMatch(homeSource, /facebook-microlink-preview/);
  assert.doesNotMatch(homeSource, /facebook-mini-preview-player/);
});

test("builds a batch TikTok facade preview from the configured facade endpoint", async () => {
  const context = createTestContext({ TIKTOK_FACADE_API_URL: "https://gateway.example.com/tiktok-preview" });
  const share = "https://www.tiktok.com/@rorozya/video/7622472784039415061";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      type: "video",
      title: "Kisah cinta antara pelayan dan majikan",
      author_name: "ro²",
      author_url: "https://www.tiktok.com/@rorozya",
      thumbnail_url: "https://p16-common-sign.tiktokcdn-us.com/example.jpg",
      description: "Kisah cinta antara pelayan dan majikan #meriaashiqui",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await send(context, "/api/tiktok/previews?url=" + encodeURIComponent(share), {
      headers: { Accept: "application/json" },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.previews.length, 1);
    assert.equal(result.previews[0].url, share);
    assert.equal(result.previews[0].author_name, "ro²");
    assert.equal(result.previews[0].description, "Kisah cinta antara pelayan dan majikan #meriaashiqui");
    assert.equal(result.previews[0].thumbnail_url, "https://p16-common-sign.tiktokcdn-us.com/example.jpg");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/gateway\.example\.com\/tiktok-preview\?url=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
  assert.ok(html.includes('data-vidbest-tiktok-player'));
  assert.ok(html.includes('data-tiktok-id="6718335390845095173"'));
  assert.ok(html.includes('data-tiktok-gateway-src='));
  assert.ok(html.includes('data-video-provider="tiktok"'));
  assert.ok(!html.includes('class="tiktok-official-player"'));
});

test("discovers direct TikTok URLs without server-side TikTok requests", async () => {
  const context = createTestContext();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected upstream request");
  };
  try {
    const response = await send(
      context,
      "/api/admin/discover?q=" + encodeURIComponent("https://www.tiktok.com/@example/video/6718335390845095173"),
      { method: "GET", headers: { Authorization: `Bearer ${secret}` } },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.results[0].provider, "tiktok");
    assert.equal(payload.results[0].video_id, "6718335390845095173");
    assert.equal(calls, 0);
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
