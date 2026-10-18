import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import change from '../content/editorial-quality/2026-10-18-quiet-presence.json' with {type: 'json'};
import {auditEditorial} from '../scripts/editorial-quality-audit.mjs';
import worker from '../src/seo-edge.js';

const migration = readFileSync(new URL('../migrations/0046_quiet_presence_accuracy.sql', import.meta.url), 'utf8');
const record = change.records[0];
const headings = text => text.split('\n').filter(line => /^[^\p{L}\p{N}]*[1-4]\. /u.test(line));

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql', '0016_rights_certified_r2_cache.sql', '0017_authorized_auto_cache.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const insert = row => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO videos (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
  };
  insert({...record.before, views: 107, reaction_count: 13, comments_count: 4});
  insert({...record.before, id: 999, slug: 'protected-owner-review', primary_category: 'Funny & Comedy'});
  return db;
}

test('Quiet Presence migration changes only the intended three accuracy/context fields and is idempotent', () => {
  const db = fixture();
  const before = db.prepare('SELECT * FROM videos ORDER BY id').all();
  db.exec(migration);
  assert.equal(db.prepare('SELECT changes() AS n').get().n, 1);
  const after = db.prepare('SELECT * FROM videos ORDER BY id').all();
  assert.deepEqual({...after[0]}, {...before[0], ...record.after});
  assert.deepEqual({...after[1]}, {...before[1]});
  assert.deepEqual(Object.keys(record.after).sort(), ['description', 'review_text', 'seo_description']);
  db.exec(migration);
  assert.equal(db.prepare('SELECT changes() AS n').get().n, 0);
  assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(), after);
  db.close();
});

test('Quiet Presence accuracy correction preserves owner paragraphs, headings and source limits', () => {
  const {before, after} = record;
  const blocks = before.review_text.split('\n\n');
  assert.equal(blocks[0], after.review_text.split('\n\n')[0]);
  assert.deepEqual(headings(after.review_text), headings(before.review_text));
  assert.equal(headings(after.review_text).length, 4);
  for (const index of [2, 3, 4, 5, 6]) assert.ok(after.review_text.includes(blocks[index]), String(index));
  for (const obsolete of ['the visuals alone are enough to lower your heart rate',
    'it instantly transports the viewer', 'quick, effective mental reset for anyone',
    'Just watching these beautiful, tranquil frames for a few seconds can significantly lower stress levels']) {
    assert.ok(!after.review_text.includes(obsolete), obsolete);
  }
  for (const expected of ['did not include a fresh listen or full-footage inspection',
    'not a demonstrated medical result', 'do not test this reel', 'what happens after the clip',
    'this review’s way of discussing attention and pause',
    'https://www.nccih.nih.gov/health/meditation-and-mindfulness-effectiveness-and-safety']) {
    assert.ok(after.review_text.includes(expected), expected);
  }
  assert.doesNotMatch(after.seo_description, /healing|find inner peace/i);
  assert.doesNotMatch(Object.values(after).join(' '), /Last updated|TRUNCATED/);
  assert.ok(change.remainingReview.includes('not been independently re-verified'));
  assert.ok(change.scope.includes('seo_description'));
});

test('every guarded owner change, unpublished state or protected category fails closed', () => {
  const alternatives = Object.fromEntries(Object.entries(record.before).map(([key, value]) => [
    key, key === 'id' ? 998 : key === 'media_type' ? 'youtube' : key === 'cache_status' ? 'failed' :
      ['featured', 'trending', 'published', 'redistribution_certified'].includes(key) ? 1 - value : key === 'primary_category' ? 'Funny & Comedy' :
      typeof value === 'number' ? value + 7 : value === null ? 'owner-edit' : value + ' (owner edit)',
  ]));
  for (const [key, value] of Object.entries(alternatives)) {
    const db = fixture();
    db.prepare(`UPDATE videos SET ${key} = ? WHERE id = 45`).run(value);
    const before = db.prepare('SELECT * FROM videos ORDER BY id').all();
    db.exec(migration);
    assert.equal(db.prepare('SELECT changes() AS n').get().n, 0, key);
    assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(), before, key);
    db.close();
  }
});

test('activity changes are preserved and do not prevent the bounded correction', () => {
  const db = fixture();
  db.exec('UPDATE videos SET views = 1024, reaction_count = 88, comments_count = 9 WHERE id = 45');
  db.exec(migration);
  const row = db.prepare('SELECT * FROM videos WHERE id = 45').get();
  assert.equal(row.description, record.after.description);
  assert.equal(row.views, 1024);
  assert.equal(row.reaction_count, 88);
  assert.equal(row.comments_count, 9);
  assert.equal(row.created_at, record.before.created_at);
  assert.equal(row.updated_at, record.before.updated_at);
  db.close();
});

test('source preimage matches the dated queue and bounded listing remains non-generic', () => {
  const hash = createHash('sha256').update(JSON.stringify([record.before.description, record.before.review_text])).digest('hex');
  assert.equal(hash, 'fcd910a9a1015356d5e9827a803b63545aff483b65db10c4ffa4f214f0434b64');
  const before = auditEditorial([record.before]);
  const after = auditEditorial([{...record.before, ...record.after}]);
  assert.equal(before.counts.genericListingIntros, 0);
  assert.ok(after.records[0].flags.includes('health_claim_needs_source_review')); // Qualified/rejected wording is still a candidate.
  assert.equal(after.counts.genericListingIntros, 0);
  assert.equal(change.records.length, 1);
  assert.equal(record.before.primary_category, 'Music');
  assert.equal(record.before.thumbnail_url, 'https://vid.best/review-covers/quiet-presence-source-poster-v1.jpg');
});

test('public API, server review, canonical, schema and sitemap preserve source, poster and dates', async t => {
  const db = fixture();
  t.after(() => db.close());
  for (const name of [
    '0002_discovery_requests.sql', '0003_security_rate_limits.sql', '0004_maintenance_indexes.sql',
    '0005_source_video_metadata.sql', '0009_app_settings.sql', '0010_video_analysis.sql',
    '0014_member_notifications.sql', '0018_tiktok_oembed_cache.sql', '0019_tiktok_oembed_backfill.sql',
    '0020_member_personalization.sql', '0022_facebook_readable_slugs.sql', '0030_facebook_preview_jobs.sql',
  ]) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  db.exec(migration);
  const before = db.prepare('SELECT * FROM videos ORDER BY id').all();
  function statement(sql, params = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return db.prepare(sql).get(...params) || null; },
      async all() { return {success: true, results: db.prepare(sql).all(...params)}; },
      async run() { throw new Error('Unexpected verification write'); },
    };
  }
  const origin = 'https://vid.best';
  const env = {PUBLIC_BASE_URL: origin, DB: {prepare: statement,
    async batch(statements) { return Promise.all(statements.map(s => s.all())); }}};
  const ctx = {waitUntil() { throw new Error('Unexpected background mutation'); }};
  const request = path => worker.fetch(new Request(origin + path, {
    headers: {'User-Agent': 'VidBest-SEO-Audit/1.0 (editorial regression)'},
  }), env, ctx);
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const response = await request('/watch/' + record.before.slug);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(`<link rel="canonical" href="${origin}/watch/${record.before.slug}">`));
  assert.ok(html.includes(`<meta property="og:image" content="${record.before.thumbnail_url}">`));
  assert.ok(html.includes(escape(record.after.description)));
  for (const paragraph of record.after.review_text.split('\n\n')) assert.ok(html.includes(escape(paragraph)), paragraph);
  assert.doesNotMatch(html, /Last updated|Illustrated cover/);
  const graph = JSON.parse(html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1])['@graph'];
  const page = graph.find(node => node['@type'] === 'WebPage');
  assert.equal(page.datePublished, record.before.created_at);
  assert.equal(page.dateModified, record.before.updated_at);
  assert.equal(page.primaryImageOfPage, record.before.thumbnail_url);
  const apiResponse = await request('/api/videos/' + record.before.slug);
  assert.equal(apiResponse.status, 200);
  const api = await apiResponse.json();
  const video = api.video || api;
  assert.equal(video.description, record.after.description);
  assert.equal(video.review_text, record.after.review_text);
  assert.equal(video.seo_title, record.before.seo_title);
  assert.equal(video.seo_description, record.after.seo_description);
  assert.ok(html.includes(escape(record.after.seo_description)));
  assert.equal(video.thumbnail_url, record.before.thumbnail_url);
  const xml = await (await request('/sitemaps/videos-1.xml')).text();
  assert.ok(xml.includes(`<loc>${origin}/watch/${record.before.slug}</loc>`));
  assert.ok(xml.includes(`<lastmod>${record.before.updated_at}</lastmod>`));
  assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(), before);
});
