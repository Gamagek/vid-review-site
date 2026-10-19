import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../src/seo-edge.js';

const origin = 'https://vid.best';
const videoId = '7578945803910270230';
const source = `https://www.tiktok.com/@toop5_/video/${videoId}`;
const poster = `${origin}/media/uploads/tiktok-thumbnails/${videoId}.img`;
const reviewArt = `${origin}/review-illustrations/top-5-most-viewed-tiktoks-ever-billions-of-views-explained-v1.webp`;
const expired = 'https://p16-common-sign.tiktokcdn-eu.com/tos-no1a-p-0037-no/os6BEmTLgJ4RAIdwpxQsaZFYEAFtkdf0BKBWDe~tplv-tiktokx-origin.image';
const migration = readFileSync(new URL('../migrations/0039_top5_existing_source_poster.sql', import.meta.url), 'utf8');
const original = {
  id: 81, slug: 'top-5-most-viewed-tiktoks-ever-billions-of-views-explained',
  title: 'Top 5 Most Viewed TikToks Ever! 🌟🤯 Billions of Views Explained',
  source_url: source + '?fixture_tracking=old', media_type: 'tiktok',
  primary_category: 'Social Media & Trending', subcategory: 'TikTok Viral Challenges',
  thumbnail_url: expired + '?fixture_signature=expired', published: 1,
  description: 'Owner description; ranking claims are not independently verified.',
  review_text: 'Substantial owner review, including its final paragraph.',
  seo_title: 'Owner SEO title', seo_description: 'Owner SEO description', seo_tags: '["owner"]',
  created_at: '2026-10-03T15:34:17.920Z', updated_at: '2026-10-09T21:10:52.165Z',
  views: 37, reaction_count: 5, comments_count: 2,
  source_page_url: source, redistribution_certified: 1,
  cache_status: 'none', cache_attempts: 0,
};
const cached = {
  video_id: videoId, share_url: source,
  title: 'Top 5 most viewed videos on TikTok | #tiktokvideos #bellapoarch #top5 #foryoupage #viral',
  author_name: 'TOP 5', author_url: 'https://www.tiktok.com/@toop5_',
  thumbnail_url: poster, fetched_at: '2026-10-11T13:15:53.094Z', updated_at: '2026-10-11T13:15:53.141Z',
};

function context(videoOverrides = {}, cacheOverrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of [
    '0001_initial.sql', '0002_discovery_requests.sql', '0003_security_rate_limits.sql',
    '0004_maintenance_indexes.sql', '0005_source_video_metadata.sql', '0009_app_settings.sql',
    '0010_video_analysis.sql', '0014_member_notifications.sql', '0016_rights_certified_r2_cache.sql',
    '0017_authorized_auto_cache.sql', '0018_tiktok_oembed_cache.sql', '0019_tiktok_oembed_backfill.sql',
    '0020_member_personalization.sql', '0022_facebook_readable_slugs.sql', '0030_facebook_preview_jobs.sql',
  ]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  function insert(table, row) {
    const keys = Object.keys(row);
    sqlite.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...Object.values(row));
  }
  insert('videos', { ...original, ...videoOverrides });
  insert('videos', { ...original, id: 12, slug: 'other-owner-record', title: 'Other owner record',
    primary_category: 'Funny & Comedy', published: 0 });
  if (cacheOverrides !== null) insert('tiktok_oembed_cache', { ...cached, ...cacheOverrides });
  function statement(sql, params = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return sqlite.prepare(sql).get(...params) || null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...params) }; },
      async run() { throw new Error('Unexpected data mutation during a read-only verification'); },
    };
  }
  const objectBytes = new Uint8Array([255, 216, 255, 224, 255, 217]);
  let objectReads = 0;
  const objectMetadata = {
    size: objectBytes.length, httpEtag: '"existing-source-poster"',
    writeHttpMetadata(headers) { headers.set('Content-Type', 'image/jpeg'); },
  };
  const bucket = {
    async head(key) {
      assert.equal(key, `uploads/tiktok-thumbnails/${videoId}.img`); objectReads++;
      return objectMetadata;
    },
    async get(key) {
      assert.equal(key, `uploads/tiktok-thumbnails/${videoId}.img`); objectReads++;
      return { ...objectMetadata, body: objectBytes };
    },
    async put() { throw new Error('Source poster must not be rehosted'); },
    async delete() { throw new Error('Source poster must not be deleted'); },
  };
  return {
    sqlite, objectBytes, get objectReads() { return objectReads; },
    env: { PUBLIC_BASE_URL: origin,
      DB: { prepare: statement, async batch(statements) { return Promise.all(statements.map(s => s.all())); } },
      BUCKET: bucket },
    ctx: { waitUntil() { throw new Error('Unexpected background mutation'); } },
  };
}

test('the exact existing source-poster repair changes one field once and leaves its cache/other records intact', (t) => {
  const c = context(); t.after(() => c.sqlite.close());
  const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
  const metadata = c.sqlite.prepare('SELECT * FROM tiktok_oembed_cache').all();
  c.sqlite.exec(migration);
  assert.equal(c.sqlite.prepare('SELECT changes() AS count').get().count, 1);
  assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all().map(row => ({ ...row })),
    before.map(row => ({ ...row, ...(row.id === 81 ? { thumbnail_url: poster } : {}) })));
  assert.deepEqual(c.sqlite.prepare('SELECT * FROM tiktok_oembed_cache').all(), metadata);
  assert.equal(c.objectReads, 0, 'migration neither fetches nor copies a media object');
  c.sqlite.exec(migration);
  assert.equal(c.sqlite.prepare('SELECT changes() AS count').get().count, 0);
});

test('owner covers, refreshed image paths, changed identity/dates, drafts and protected topics fail closed', () => {
  for (const overrides of [
    { thumbnail_url: null }, { thumbnail_url: '' }, { thumbnail_url: '/review-covers/owner.webp' },
    { thumbnail_url: poster }, { thumbnail_url: expired + '.new?fixture_signature=refreshed' },
    { thumbnail_url: 'https://p16-common-sign.tiktokcdn-eu.com/new-owner-poster.image' },
    { published: 0 }, { id: 82 }, { slug: 'saiyaara-a-cinematic-romance' },
    { slug: 'summer-inverted-7332342275151760642' }, { media_type: 'facebook' },
    { title: 'A new owner title' }, { primary_category: 'Funny & Comedy' },
    { subcategory: 'Skits & Sketches' }, { source_url: source + '9' },
    { source_url: source.replace('@toop5_', '@different') },
    { created_at: '2026-10-15T00:00:00Z' }, { updated_at: '2026-10-15T00:00:00Z' },
  ]) {
    const c = context(overrides);
    try {
      const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
      c.sqlite.exec(migration);
      assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
    } finally { c.sqlite.close(); }
  }
});

test('missing or mismatched same-video cached source evidence cannot reconnect a poster', () => {
  for (const overrides of [null, { video_id: videoId + '9' }, { share_url: source + '9' },
    { author_name: 'Other source' }, { author_url: 'https://www.tiktok.com/@different' },
    { title: 'An unrelated upload' }, { thumbnail_url: poster + '?private=fixture' },
    { thumbnail_url: poster.replace(videoId, videoId + '9') },
    { thumbnail_url: 'https://elsewhere.example/poster.jpg' },
  ]) {
    const c = context({}, overrides);
    try {
      const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
      c.sqlite.exec(migration);
      assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
    } finally { c.sqlite.close(); }
  }
});

async function request(c, path, method = 'GET') {
  return worker.fetch(new Request(origin + path, {
    method, headers: { 'User-Agent': 'VidBest-SEO-Audit/1.0' },
  }), c.env, c.ctx);
}

test('library, server-delivered review and sitemap share the existing source poster without inventing dates or observations', async (t) => {
  const c = context(); t.after(() => c.sqlite.close()); c.sqlite.exec(migration);
  const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
  const response = await request(c, `/watch/${original.slug}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(`<meta property="og:image" content="${reviewArt}">`));
  assert.ok(html.includes(`<link rel="canonical" href="${origin}/watch/${original.slug}">`));
  assert.ok(html.match(/<img class="tiktok-preview-card-image"[^>]*>/)?.[0].includes(`src="${poster}"`));
  assert.ok(html.includes(original.review_text));
  assert.doesNotMatch(html, /Illustrated cover|Last updated|<iframe|<video/);
  const graph = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1])['@graph'];
  const page = graph.find(item => item['@type'] === 'WebPage');
  assert.equal(page.primaryImageOfPage, reviewArt);
  assert.equal(page.isBasedOn, source, 'public attribution omits only tracking, not the saved source identity');
  assert.equal(page.datePublished, original.created_at);
  assert.equal(page.dateModified, original.updated_at);
  assert.equal(graph.find(item => item['@type'] === 'VideoObject'), undefined,
    'source poster is not an independently verified video upload date');
  const xml = await (await request(c, '/sitemaps/videos-1.xml')).text();
  assert.ok(xml.includes('<video:thumbnail_loc>' + poster + '</video:thumbnail_loc>'));
  assert.ok(xml.includes('<lastmod>' + original.updated_at + '</lastmod>'));
  const libraryResponse = await request(c, '/api/videos?q=Billions');
  assert.equal(libraryResponse.status, 200);
  const library = await libraryResponse.json();
  assert.equal(library.pagination.total, 1);
  assert.equal(library.videos[0].thumbnail_url, poster);
  assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
});

test('the repaired address reuses the existing public image route for GET and HEAD without R2 writes', async (t) => {
  const c = context(); t.after(() => c.sqlite.close());
  const path = `/media/uploads/tiktok-thumbnails/${videoId}.img`;
  const get = await request(c, path);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), c.objectBytes);
  const head = await request(c, path, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), String(c.objectBytes.length));
  assert.equal(await head.text(), '');
  assert.equal(c.objectReads, 2);
});
