import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index.js";

const secret = "correct-horse-battery-staple-admin-secret";
const reactionSalt = "separate-rate-limit-and-reaction-secret";
const migrations = ["0001_initial.sql", "0002_discovery_requests.sql", "0003_security_rate_limits.sql"];

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
