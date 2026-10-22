import test from "node:test";
import assert from "node:assert/strict";
import { cachedPublicResponse } from "../src/public-edge-cache.js";

function createCache() {
  const values = new Map();
  return {
    async match(request) { return values.get(request.url)?.clone() || undefined; },
    async put(request, response) { values.set(request.url, response.clone()); },
    clear() { values.clear(); },
  };
}

function createContext() {
  const pending = [];
  return {
    waitUntil(promise) { pending.push(promise); },
    async flush() {
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
}

function createR2() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      const body = objects.get(key);
      return body === undefined ? null : { async json() { return JSON.parse(body); } };
    },
    async put(key, value) { objects.set(key, value); },
  };
}

function publicVideos() {
  return new Response(JSON.stringify({
    videos: [{ id: 12, slug: "verified-review", title: "Verified review" }],
    pagination: { offset: 0, limit: 18, total: 1 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

test("artwork XML releases ignore the previous catalog snapshot while public API cache keys stay stable", async () => {
  const previous = globalThis.caches;
  const cache = createCache();
  globalThis.caches = { default: cache };
  try {
    await cache.put(new Request("https://vid.best/__public_cache/v1/sitemaps/images-editorial-1.xml"),
      new Response('<?xml version="1.0"?><urlset>Old artwork catalog</urlset>', { headers: { "Content-Type": "application/xml" } }));
    await cache.put(new Request("https://vid.best/__public_cache/v1/api/videos"), publicVideos());
    let xmlQueries = 0;
    const ctx = createContext();
    const response = await cachedPublicResponse(new Request("https://vid.best/sitemaps/images-editorial-1.xml"), {}, ctx, () => {
      xmlQueries += 1;
      return new Response('<?xml version="1.0"?><urlset>Current artwork catalog</urlset>', { headers: { "Content-Type": "application/xml" } });
    });
    assert.match(await response.text(), /Current artwork catalog/);
    assert.equal(xmlQueries, 1);
    await ctx.flush();
    const api = await cachedPublicResponse(new Request("https://vid.best/api/videos"), {}, ctx, () => {
      throw new Error("The existing public API cache must survive artwork publication");
    });
    assert.equal(api.headers.get("X-VidBest-Edge-Cache"), "HIT");
  } finally { globalThis.caches = previous; }
});

test("public video listings use edge HIT without a second D1 call, but browser storage stays disabled", async () => {
  const previous = globalThis.caches;
  globalThis.caches = { default: createCache() };
  try {
    const ctx = createContext();
    const env = { BUCKET: createR2() };
    const request = new Request("https://vid.best/api/videos?limit=18&offset=0&sort=newest");
    let databaseQueries = 0;
    const handler = () => { databaseQueries += 1; return publicVideos(); };
    const first = await cachedPublicResponse(request, env, ctx, handler);
    assert.equal(first.headers.get("X-VidBest-Edge-Cache"), "MISS");
    assert.equal(first.headers.get("Cache-Control"), "no-store");
    assert.equal((await first.json()).videos.length, 1);
    await ctx.flush();
    const second = await cachedPublicResponse(request, env, ctx, handler);
    assert.equal(second.headers.get("X-VidBest-Edge-Cache"), "HIT");
    assert.equal(second.headers.get("Cache-Control"), "no-store");
    assert.equal(databaseQueries, 1);
  } finally { globalThis.caches = previous; }
});

test("cold edge can serve fresh R2 snapshot without touching D1", async () => {
  const previous = globalThis.caches;
  globalThis.caches = { default: createCache() };
  try {
    const ctx = createContext();
    const env = { BUCKET: createR2() };
    const request = new Request("https://vid.best/api/videos?featured=1&limit=7");
    await cachedPublicResponse(request, env, ctx, publicVideos);
    await ctx.flush();
    globalThis.caches = { default: createCache() };
    let touchedDatabase = false;
    const replay = await cachedPublicResponse(request, env, ctx, () => {
      touchedDatabase = true;
      throw new Error("D1 unavailable");
    });
    assert.equal(replay.headers.get("X-VidBest-Edge-Cache"), "R2-FRESH");
    assert.equal((await replay.json()).videos.length, 1);
    assert.equal(touchedDatabase, false);
    await ctx.flush();
  } finally { globalThis.caches = previous; }
});

test("recent stale R2 snapshot is a controlled fallback when D1 returns 500", async () => {
  const previous = globalThis.caches;
  globalThis.caches = { default: createCache() };
  try {
    const ctx = createContext();
    const env = { BUCKET: createR2() };
    const request = new Request("https://vid.best/api/videos?limit=18");
    await cachedPublicResponse(request, env, ctx, publicVideos);
    await ctx.flush();
    for (const [key, value] of env.BUCKET.objects) {
      const snapshot = JSON.parse(value);
      snapshot.timestamp -= 10 * 60 * 1000;
      env.BUCKET.objects.set(key, JSON.stringify(snapshot));
    }
    globalThis.caches = { default: createCache() };
    const replay = await cachedPublicResponse(request, env, ctx, () =>
      new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 }));
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("X-VidBest-Edge-Cache"), "R2-STALE");
    assert.equal(replay.headers.get("Cache-Control"), "no-store");
  } finally { globalThis.caches = previous; }
});

test("personalized mini feeds and authorization are never cached", async () => {
  const ctx = createContext();
  const env = { BUCKET: createR2() };
  const member = new Request("https://vid.best/api/home/mini-feed?limit=6", {
    headers: { Cookie: "__Host-vidbest_member=private-secret" },
  });
  const bearer = new Request("https://vid.best/api/videos", {
    headers: { Authorization: "Bearer private-token" },
  });
  assert.equal(await cachedPublicResponse(member, env, ctx, publicVideos), null);
  assert.equal(await cachedPublicResponse(bearer, env, ctx, publicVideos), null);
  assert.equal(env.BUCKET.objects.size, 0);
});

test("failed upstream responses and unknown query parameters do not populate public caches", async () => {
  const previous = globalThis.caches;
  globalThis.caches = { default: createCache() };
  try {
    const ctx = createContext();
    const env = { BUCKET: createR2() };
    const request = new Request("https://vid.best/api/videos?limit=18");
    const failure = await cachedPublicResponse(request, env, ctx,
      () => new Response('{"error":"quota"}', { status: 500, headers: { "Content-Type": "application/json" } }));
    assert.equal(failure.status, 500);
    await ctx.flush();
    assert.equal(env.BUCKET.objects.size, 0);
    assert.equal(await cachedPublicResponse(
      new Request("https://vid.best/api/videos?unknown=1"), env, ctx, publicVideos), null);
  } finally { globalThis.caches = previous; }
});

test("server-rendered homepage SEO HTML is eligible for edge/R2 and has browser no-store", async () => {
  const previous = globalThis.caches;
  globalThis.caches = { default: createCache() };
  try {
    const ctx = createContext();
    const env = { BUCKET: createR2() };
    const page = () => new Response('<!DOCTYPE html><html><body><a href="/watch/review">Review</a></body></html>', {
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "index,follow" },
    });
    const response = await cachedPublicResponse(new Request("https://vid.best/"), env, ctx, page);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Robots-Tag"), "index,follow");
    assert.match(await response.text(), /href="\/watch\/review"/);
    await ctx.flush();
    assert.equal(env.BUCKET.objects.size, 1);
  } finally { globalThis.caches = previous; }
});

test("canonical HTTP and www requests bypass cache so SEO redirects remain intact", async () => {
  const env = { BUCKET: createR2() };
  const ctx = createContext();
  for (const url of ["http://vid.best/", "https://www.vid.best/", "http://vid.best/api/videos"]) {
    assert.equal(await cachedPublicResponse(new Request(url), env, ctx, publicVideos), null);
  }
});

test("R2 replay never refreshes the snapshot timestamp, allowing D1 refresh after five minutes", async () => {
  const previous = globalThis.caches;
  globalThis.caches = { default: createCache() };
  try {
    const ctx = createContext(), env = { BUCKET: createR2() };
    const request = new Request("https://vid.best/api/videos?limit=18&sort=popular");
    await cachedPublicResponse(request, env, ctx, publicVideos);
    await ctx.flush();
    const [[key, value]] = [...env.BUCKET.objects.entries()];
    const oldSnapshot = JSON.parse(value);
    oldSnapshot.timestamp -= 90_000;
    env.BUCKET.objects.set(key, JSON.stringify(oldSnapshot));
    globalThis.caches = { default: createCache() };
    const freshFromR2 = await cachedPublicResponse(request, env, ctx, () => { throw Error("D1 must not be called"); });
    assert.equal(freshFromR2.headers.get("X-VidBest-Edge-Cache"), "R2-FRESH");
    await ctx.flush();
    assert.equal(JSON.parse(env.BUCKET.objects.get(key)).timestamp, oldSnapshot.timestamp);
  } finally { globalThis.caches = previous; }
});
