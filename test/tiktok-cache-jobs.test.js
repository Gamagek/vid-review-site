import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { dispatchAdminTikTokCache } from '../src/admin-tiktok-cache.js';
import { processAdminTikTokCacheJobs, retryAdminTikTokCache, adminTikTokCacheStatus } from '../src/tiktok-cache-jobs.js';
import { cacheTikTokThumbnail, processTikTokThumbnailJobs, thumbnailKey, validThumbnailSource } from '../src/tiktok-thumbnail-cache.js';

const videoId = '7578945803910270230';
const source = `https://www.tiktok.com/@toop5_/video/${videoId}`;
const secret = 'test-only-cache-hook-secret-longer-than-32';
const valid = { id: 81, redistribution_certified: 1, media_type: 'tiktok', source_url: source, r2_key: null };

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE videos (id INTEGER PRIMARY KEY, source_url TEXT, media_type TEXT,
    redistribution_certified INTEGER DEFAULT 1, r2_key TEXT, cache_source_url TEXT,
    cache_status TEXT DEFAULT 'none', cache_error TEXT, cache_attempts INTEGER DEFAULT 0,
    cache_next_attempt_at TEXT, cached_at TEXT, thumbnail_url TEXT, published INTEGER DEFAULT 1);
    CREATE TABLE app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
    CREATE TABLE tiktok_oembed_cache (video_id TEXT PRIMARY KEY, thumbnail_url TEXT, fetched_at TEXT);`);
  db.prepare('INSERT INTO videos(id, source_url, media_type) VALUES (81, ?, ?)').run(source, 'tiktok');
  const wrap = (sql, bindings = []) => ({
    bind: (...args) => wrap(sql, args),
    first: async () => db.prepare(sql).get(...bindings) || null,
    all: async () => ({ results: db.prepare(sql).all(...bindings) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...bindings).changes) } }),
  });
  const objects = new Map();
  const env = { CACHE_HOOK_SECRET: secret, DB: { prepare: sql => wrap(sql) }, BUCKET: {
    head: async key => objects.get(key) || null,
    put: async (key, bytes, options) => objects.set(key, { bytes, size: bytes.byteLength,
      uploaded: new Date(), httpMetadata: options.httpMetadata }),
  } };
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; db.close(); });
  return { db, env, objects, row: () => db.prepare('SELECT * FROM videos WHERE id=81').get() };
}
const accepted = () => Response.json({ status: 'queued', video_id: videoId }, { status: 202 });
const due = db => db.exec("UPDATE videos SET cache_next_attempt_at = datetime('now', '-1 second')");

test('cache webhook uses manual redirects and the exact v55 HMAC contract', async t => {
  fixture(t);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://video.megasale.win/cache/authorized');
    assert.equal(options.redirect, 'manual');
    const body = JSON.parse(options.body), h = options.headers;
    assert.deepEqual(body, { id: videoId, url: source });
    const expected = createHmac('sha256', secret).update(
      h['x-vidbest-cache-timestamp'] + '\n' + h['x-vidbest-cache-nonce'] + '\n' + body.id + '\n' + body.url).digest('hex');
    assert.equal(h['x-vidbest-cache-signature'], expected);
    assert.ok(!options.body.includes(secret));
    return accepted();
  };
  assert.equal((await dispatchAdminTikTokCache({ CACHE_HOOK_SECRET: secret },
    { ...valid, source_url: source + '?tracking=removed' })).status, 'queued');
  assert.equal(calls, 1);
});

test('redirects, HTML and mismatched video acknowledgments cannot be mistaken for successful caching', async t => {
  fixture(t);
  for (const response of [new Response('', { status: 302, headers: { Location: 'https://other.example/' } }),
    new Response('<html>failure</html>', { status: 202, headers: { 'Content-Type': 'text/html' } }),
    Response.json({ status: 'queued', video_id: '7332342275151760642' }, { status: 202 })]) {
    let calls = 0;
    globalThis.fetch = async (_, options) => { calls++; assert.equal(options.redirect, 'manual'); return response; };
    await assert.rejects(dispatchAdminTikTokCache({ CACHE_HOOK_SECRET: secret }, valid));
    assert.equal(calls, 1);
  }
});

test('concurrent cron and manual requests share a persistent D1 lease; only real R2 data marks complete', async t => {
  const { env, row, objects } = fixture(t);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return accepted(); };
  await Promise.all([processAdminTikTokCacheJobs(env), retryAdminTikTokCache(env, 81)]);
  assert.equal(calls, 1);
  assert.equal(row().cache_status, 'running');
  assert.equal(row().cache_attempts, 1);
  assert.equal((await (await adminTikTokCacheStatus(env, 81)).json()).status, 'queued');
  objects.set(`uploads/tiktok/${videoId}.mp4`, { size: 50000, uploaded: new Date(), httpMetadata: { contentType: 'video/mp4' } });
  assert.equal((await (await adminTikTokCacheStatus(env, 81)).json()).status, 'complete');
  assert.equal(calls, 1);
  assert.equal(row().source_url, source);
  assert.equal(row().media_type, 'tiktok');
  assert.equal(row().r2_key, null);
});

test('502 failures persist a retry, 429 honors Retry-After, and missing uploads stop after three dispatches', async t => {
  const { env, row, db } = fixture(t);
  globalThis.fetch = async () => new Response('Bad gateway', { status: 502 });
  await processAdminTikTokCacheJobs(env);
  assert.equal(row().cache_status, 'failed');
  assert.match(row().cache_error, /HTTP 502/);
  assert.ok(row().cache_next_attempt_at);
  due(db);
  globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '7200' } });
  await processAdminTikTokCacheJobs(env);
  assert.ok(Date.parse(row().cache_next_attempt_at + 'Z') > Date.now() + 7100000);
  db.exec("UPDATE videos SET cache_status='none', cache_attempts=0, cache_next_attempt_at=NULL");
  let calls = 0;
  globalThis.fetch = async () => { calls++; return accepted(); };
  for (let i = 0; i < 4; i++) { due(db); await processAdminTikTokCacheJobs(env); }
  assert.equal(calls, 3);
  assert.equal(row().cache_status, 'failed');
  assert.match(row().cache_error, /no playable R2 object/);
  assert.deepEqual(await processAdminTikTokCacheJobs(env), []);
});

test('storage failures never start downloads; status checks never consume scraper requests', async t => {
  const { env, row } = fixture(t);
  env.BUCKET.head = async () => { throw new Error('storage offline'); };
  globalThis.fetch = async () => { assert.fail('must not contact Portainer'); };
  await processAdminTikTokCacheJobs(env);
  assert.match(row().cache_error, /R2 storage could not be checked/);
  assert.equal((await adminTikTokCacheStatus(env, 81)).status, 503);
});

test('cron leaves uncertified, protected and owner-direct-source jobs alone', async t => {
  const { env, db } = fixture(t);
  globalThis.fetch = async () => assert.fail('not authorized');
  for (const sql of ["UPDATE videos SET redistribution_certified=0",
    "UPDATE videos SET redistribution_certified=1, source_url='https://www.tiktok.com/@user/video/7669587518156705056'",
    `UPDATE videos SET source_url='${source}', cache_source_url='https://media.example/video.mp4'`]) {
    db.exec(sql);
    assert.deepEqual(await processAdminTikTokCacheJobs(env), []);
  }
});

test('thumbnail caching uses bounded validated images, retains titles separately, and reuses R2', async t => {
  const { env, db, objects } = fixture(t);
  const url = 'https://p16.tiktokcdn.com/cover.jpg';
  db.prepare('INSERT INTO tiktok_oembed_cache VALUES (?, ?, ?)').run(videoId, url, new Date().toISOString());
  const image = new Uint8Array([255,216,255,224,0,0]);
  let calls = 0;
  globalThis.fetch = async (_, options) => { calls++; assert.equal(options.redirect, 'manual');
    return new Response(image, { headers: { 'Content-Type': 'image/jpeg' } }); };
  assert.equal((await processTikTokThumbnailJobs(env))[0].status, 'complete');
  assert.equal(objects.get(thumbnailKey(videoId)).size, image.length);
  assert.match(db.prepare('SELECT thumbnail_url FROM videos').get().thumbnail_url, /vid\.best\/media\/uploads\/tiktok-thumbnails/);
  await cacheTikTokThumbnail(env, { id: 81, video_id: videoId, thumbnail_url: url });
  assert.equal(calls, 1);
  assert.deepEqual(await processTikTokThumbnailJobs(env), []);
});

test('thumbnail errors keep original metadata and cooldown prevents repeated CDN requests', async t => {
  const { env, db, objects } = fixture(t);
  const url = 'https://p16.tiktokcdn.com/cover.jpg';
  db.prepare('INSERT INTO tiktok_oembed_cache VALUES (?, ?, ?)').run(videoId, url, new Date().toISOString());
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('<html>Access Denied</html>', { headers: { 'Content-Type': 'image/jpeg' } }); };
  assert.equal((await processTikTokThumbnailJobs(env))[0].status, 'failed');
  assert.deepEqual(await processTikTokThumbnailJobs(env), []);
  assert.equal(calls, 1);
  assert.equal(objects.size, 0);
  assert.equal(db.prepare('SELECT thumbnail_url FROM tiktok_oembed_cache').get().thumbnail_url, url);
  for (const value of ['https://tiktokcdn.com.attacker.example/x', 'https://secret@p16.tiktokcdn.com/x', 'http://p16.tiktokcdn.com/x', 'https://127.0.0.1/x']) assert.equal(validThumbnailSource(value), null);
});

test('Saiyaara caches its pinned image once across concurrent warmups and cron', async t => {
  const { warmSaiyaaraPoster, SAIYAARA_POSTER, SAIYAARA_ID } = await import('../src/tiktok-thumbnail-cache.js');
  const { db, env, objects } = fixture(t);
  db.prepare('UPDATE videos SET source_url = ?').run(`https://www.tiktok.com/@saiyaara.4ever/video/${SAIYAARA_ID}`);
  db.prepare('INSERT INTO tiktok_oembed_cache VALUES (?, ?, ?)').run(SAIYAARA_ID, 'https://p16.tiktokcdn.com/expired.jpg', new Date().toISOString());
  let calls = 0;
  globalThis.fetch = async url => {
    calls++; assert.equal(url, SAIYAARA_POSTER);
    return new Response(new Uint8Array([255,216,255,224,0,0]), { headers: { 'Content-Type': 'image/jpeg' } });
  };
  await Promise.all([warmSaiyaaraPoster(env), warmSaiyaaraPoster(env), processTikTokThumbnailJobs(env)]);
  assert.equal(calls, 1); assert.ok(objects.has(thumbnailKey(SAIYAARA_ID)));
  assert.equal(validThumbnailSource(SAIYAARA_POSTER), null);
  assert.equal(validThumbnailSource(SAIYAARA_POSTER + '?other=1', SAIYAARA_ID), null);
  assert.equal(validThumbnailSource(SAIYAARA_POSTER, SAIYAARA_ID), SAIYAARA_POSTER);
});
