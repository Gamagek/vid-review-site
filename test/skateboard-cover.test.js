import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../src/seo-edge.js';

const origin = 'https://vid.best';
const source = 'https://www.tiktok.com/@phpetstars/video/7376458900440190214';
const cover = `${origin}/review-covers/dog-skateboard-illustrated-v1.webp`;
const reviewArt = `${origin}/review-illustrations/the-extreme-skateboarding-corgi-is-this-viral-stunt-real-or-fake-v1.webp`;
const oldPoster = 'https://p16-common-sign.tiktokcdn-eu.com/tos-maliva-p-0068/oMnBJGAfie0mFBA3IIk6RcmDQEaEJ6Gw1UXlQ6~tplv-tiktokx-origin.image';
const migration = readFileSync(new URL('../migrations/0040_skateboard_symbolic_cover.sql', import.meta.url), 'utf8');
const original = {
  id: 32, slug: 'the-extreme-skateboarding-corgi-is-this-viral-stunt-real-or-fake',
  title: 'The Extreme Skateboarding Corgi: Is This Viral Stunt Real or Fake',
  source_url: source + '?fixture_tracking=old', media_type: 'tiktok',
  primary_category: 'Social Media & Trending', subcategory: 'TikTok Viral Challenges',
  thumbnail_url: oldPoster + '?fixture_signature=expired', published: 1,
  description: 'Owner description, not independently verified footage.',
  review_text: 'Substantial owner review remains unchanged, including its final paragraph.',
  seo_title: 'Owner SEO title', seo_description: 'Owner SEO description', seo_tags: '["owner"]',
  created_at: '2026-09-25T18:55:37.183Z', updated_at: '2026-09-25T18:55:37.183Z',
  views: 37, reaction_count: 5, comments_count: 2,
  source_page_url: source, redistribution_certified: 0,
  cache_status: 'none', cache_attempts: 0,
};
const cached = {
  video_id: '7376458900440190214', share_url: source,
  title: 'A dog on a skateboard#dog #puppy #funny #fyp #dogsoftiktok',
  author_name: 'pawchew', author_url: 'https://www.tiktok.com/@phpetstars',
  thumbnail_url: oldPoster + '?fixture_signature=expired',
  fetched_at: '2026-10-06T12:00:25.723Z', updated_at: '2026-10-06T12:00:25.723Z',
};

function context(overrides = {}, cacheOverrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of [
    '0001_initial.sql', '0002_discovery_requests.sql', '0003_security_rate_limits.sql',
    '0004_maintenance_indexes.sql', '0005_source_video_metadata.sql', '0009_app_settings.sql',
    '0010_video_analysis.sql', '0014_member_notifications.sql', '0016_rights_certified_r2_cache.sql',
    '0017_authorized_auto_cache.sql', '0018_tiktok_oembed_cache.sql', '0019_tiktok_oembed_backfill.sql',
    '0020_member_personalization.sql', '0022_facebook_readable_slugs.sql', '0030_facebook_preview_jobs.sql',
  ]) sqlite.exec(readFileSync(new URL('../migrations/' + path, import.meta.url), 'utf8'));
  function insert(table, row) {
    const keys = Object.keys(row);
    sqlite.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...Object.values(row));
  }
  insert('videos', { ...original, ...overrides });
  insert('videos', { ...original, id: 12, slug: 'other-owner-record', title: 'Other owner record',
    primary_category: 'Funny & Comedy', published: 0 });
  if (cacheOverrides !== null) insert('tiktok_oembed_cache', { ...cached, ...cacheOverrides });
  function statement(sql, params = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return sqlite.prepare(sql).get(...params) || null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...params) }; },
      async run() { throw new Error('Unexpected mutation during read-only verification'); },
    };
  }
  return {
    sqlite,
    env: { PUBLIC_BASE_URL: origin, DB: { prepare: statement,
      async batch(statements) { return Promise.all(statements.map(s => s.all())); } } },
    ctx: { waitUntil() { throw new Error('Unexpected background mutation'); } },
  };
}

test('the symbolic cover changes exactly one field once, preserving all dates, text, cache and other records', (t) => {
  const c = context(); t.after(() => c.sqlite.close());
  const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
  const cache = c.sqlite.prepare('SELECT * FROM tiktok_oembed_cache').all();
  c.sqlite.exec(migration);
  assert.equal(c.sqlite.prepare('SELECT changes() AS count').get().count, 1);
  assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all().map(r => ({ ...r })),
    before.map(r => ({ ...r, ...(r.id === 32 ? { thumbnail_url: cover } : {}) })));
  assert.deepEqual(c.sqlite.prepare('SELECT * FROM tiktok_oembed_cache').all(), cache);
  c.sqlite.exec(migration);
  assert.equal(c.sqlite.prepare('SELECT changes() AS count').get().count, 0);
});

test('owner covers/edits, refreshed paths, drafts, protected topics and changed source identities fail closed', () => {
  for (const overrides of [
    { thumbnail_url: null }, { thumbnail_url: '' }, { thumbnail_url: '/review-covers/owner.webp' },
    { thumbnail_url: cover }, { thumbnail_url: oldPoster + '.new?fixture_signature=new' },
    { updated_at: '2026-10-16T00:00:00Z' }, { created_at: '2026-10-16T00:00:00Z' },
    { title: 'Owner edited title' }, { published: 0 }, { id: 81 },
    { slug: 'saiyaara-a-cinematic-romance' }, { slug: 'summer-inverted-7332342275151760642' },
    { primary_category: 'Funny & Comedy' }, { subcategory: 'Skits & Sketches' },
    { media_type: 'facebook' }, { source_url: source + '9' },
    { source_url: source.replace('@phpetstars', '@different') },
  ]) {
    const c = context(overrides);
    try {
      const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
      c.sqlite.exec(migration);
      assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
    } finally { c.sqlite.close(); }
  }
});

test('the broad subject requires the exact saved source/creator/title evidence and never updates that evidence', () => {
  for (const overrides of [null, { video_id: '9999999999999999999' },
    { share_url: source + '9' }, { author_name: 'Other creator' },
    { author_url: 'https://www.tiktok.com/@different' }, { title: 'An unrelated upload' },
  ]) {
    const c = context({}, overrides);
    try {
      const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
      c.sqlite.exec(migration);
      assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
    } finally { c.sqlite.close(); }
  }
});

test('the reviewed labelled illustration is a bounded exact WebP, not a source-frame substitution', () => {
  const bytes = readFileSync(new URL('../public/review-covers/dog-skateboard-illustrated-v1.webp', import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  assert.equal(bytes.length, 108624);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '4c033b0fecaefaa3791f34262f61a696c67e988a694e0d9b60e2a116c126354c');
});

async function request(c, path) {
  return worker.fetch(new Request(origin + path, { headers: { 'User-Agent': 'VidBest-SEO-Audit/1.0' } }), c.env, c.ctx);
}

test('server first paint and API select the labelled illustration without inventing source dates or footage', async (t) => {
  const c = context(); t.after(() => c.sqlite.close()); c.sqlite.exec(migration);
  const before = c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all();
  const response = await request(c, '/watch/' + original.slug);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(`<meta property="og:image" content="${reviewArt}">`));
  const image = html.match(/<img class="tiktok-preview-card-image"[^>]*>/)?.[0];
  assert.ok(image.includes(`src="${cover}"`));
  assert.ok(image.includes('object-fit:contain'));
  assert.ok(html.includes('Illustrated cover · not a video frame'));
  assert.ok(html.includes(original.review_text));
  assert.ok(html.includes(`<link rel="canonical" href="${origin}/watch/${original.slug}">`));
  assert.doesNotMatch(html, /Last updated|<iframe|<video/);
  const graph = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1])['@graph'];
  const page = graph.find(x => x['@type'] === 'WebPage');
  assert.equal(page.primaryImageOfPage, reviewArt);
  assert.equal(page.datePublished, original.created_at);
  assert.equal(page.dateModified, original.updated_at);
  assert.equal(graph.find(x => x['@type'] === 'VideoObject'), undefined);
  const api = await (await request(c, '/api/videos?q=Skateboarding')).json();
  assert.equal(api.videos[0].thumbnail_url, cover);
  assert.deepEqual(c.sqlite.prepare('SELECT * FROM videos ORDER BY id').all(), before);
});

test('sitemap uses the crawlable cover while retaining the genuine review lastmod and source link', async (t) => {
  const c = context(); t.after(() => c.sqlite.close()); c.sqlite.exec(migration);
  const xml = await (await request(c, '/sitemaps/videos-1.xml')).text();
  assert.ok(xml.includes('<video:thumbnail_loc>' + cover + '</video:thumbnail_loc>'));
  assert.ok(xml.includes('<lastmod>' + original.updated_at + '</lastmod>'));
  assert.ok(xml.includes(origin + '/watch/' + original.slug));
  assert.equal(c.sqlite.prepare('SELECT source_url FROM videos WHERE id=32').get().source_url, original.source_url);
});
