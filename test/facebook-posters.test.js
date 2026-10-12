import assert from "node:assert/strict";
import test from "node:test";
import { facebookPosterUrl, readFacebookPoster } from "../src/facebook-posters.js";

function bucket() {
  const data = new Map();
  return {
    async get(key) {
      const value = data.get(key);
      return value && { body: value.bytes, httpEtag: '"cached"', writeHttpMetadata(h) { h.set("Content-Type", value.type); } };
    },
    async put(key, bytes, options) { data.set(key, { bytes, type: options.httpMetadata.contentType }); },
    data,
  };
}
const row = { id: 162, source_url: "https://www.facebook.com/reel/123", thumbnail_url: "https://scontent.xx.fbcdn.net/poster.jpg?expires=old" };

test("poster addresses hide expiring CDN query strings and preserve local custom covers", () => {
  const url = facebookPosterUrl(row);
  assert.match(url, /^\/api\/facebook\/thumbnail\?id=162&v=[a-f0-9]+$/);
  assert.doesNotMatch(url, /expires|fbcdn/);
  assert.notEqual(url, facebookPosterUrl({ ...row, thumbnail_url: row.thumbnail_url + "2" }));
  assert.equal(facebookPosterUrl({ ...row, thumbnail_url: "/facebook-previews/tiny.jpg" }), "/facebook-previews/tiny.jpg");
});

test("a durable thumbnail still renders after the provider URL has expired", async () => {
  const original = globalThis.fetch, env = { BUCKET: bucket() };
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(new Uint8Array([255,216,255,217]), { headers: { "Content-Type": "image/jpeg" } }); };
  try {
    const first = await readFacebookPoster(env, row, () => { throw new Error("Metadata must not be requested"); });
    assert.equal(first.status, 200);
    assert.equal(env.BUCKET.data.size, 1);
    globalThis.fetch = async () => { throw new Error("Expired provider URL"); };
    const second = await readFacebookPoster(env, row, () => { throw new Error("No provider lookup on cache hits"); });
    assert.equal(second.headers.get("Content-Type"), "image/jpeg");
    assert.match(second.headers.get("Cache-Control"), /max-age=604800/);
    assert.deepEqual(new Uint8Array(await second.arrayBuffer()), new Uint8Array([255,216,255,217]));
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test("poster storage rejects HTML, oversized images and non-provider fetch targets", async () => {
  const original = globalThis.fetch, env = { BUCKET: bucket() };
  try {
    globalThis.fetch = async () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } });
    assert.equal(await readFacebookPoster(env, row, async () => null), null);
    globalThis.fetch = async () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "Content-Type": "image/jpeg" } });
    assert.equal(await readFacebookPoster(env, row, async () => null), null);
    globalThis.fetch = async () => { throw new Error("Untrusted hosts must not be fetched"); };
    assert.equal(await readFacebookPoster(env, { ...row, thumbnail_url: "" }, async () => ({ thumbnail_url: "https://internal.invalid/private" })), null);
    assert.equal(env.BUCKET.data.size, 0);
  } finally { globalThis.fetch = original; }
});

test("a Facebook page pasted as a cover uses its actual preview image", async () => {
  const original = globalThis.fetch, env = { BUCKET: bucket() };
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(url);
    return new Response(new Uint8Array([255,216,255,217]), {headers:{'Content-Type':'image/jpeg'}});
  };
  try {
    const response = await readFacebookPoster(env, {...row, thumbnail_url:row.source_url}, async () => ({thumbnail_url:'https://scontent.xx.fbcdn.net/actual.jpg'}));
    assert.equal(response.status, 200);
    assert.deepEqual(requested, ['https://scontent.xx.fbcdn.net/actual.jpg']);
    assert.equal(env.BUCKET.data.size, 1);
  } finally { globalThis.fetch = original; }
});

test("an expired provider image retries a refreshed poster once and caches it", async () => {
  const original = globalThis.fetch, env = { BUCKET: bucket() };
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1
    ? new Response('expired', {status:403})
    : new Response(new Uint8Array([255,216,255,217]), {headers:{'Content-Type':'image/jpeg'}});
  try {
    const response = await readFacebookPoster(env, row, async () => ({thumbnail_url:'https://scontent.xx.fbcdn.net/fresh.jpg'}));
    assert.equal(response.status, 200);
    assert.equal(requests, 2);
    assert.equal(env.BUCKET.data.size, 1);
  } finally { globalThis.fetch = original; }
});
