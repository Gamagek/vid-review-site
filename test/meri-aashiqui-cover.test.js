import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(new URL('../migrations/0038_meri_aashiqui_illustrated_cover.sql', import.meta.url), 'utf8');
const cover = 'https://vid.best/review-covers/meri-aashiqui-illustrated-v1.webp';
const source = 'https://www.tiktok.com/@rorozya/video/7622472784039415061';
const oldPoster = 'https://p16-common-sign.tiktokcdn-eu.com/tos-alisg-p-0037/o4ScgaqIPhFciA8iXBB32AYprAlAIDdkEVAbE~tplv-tiktokx-dmt-logom:tos-alisg-i-0068/oAqElfHI8gQRDTAIAvxEAkCUdByFE37YpfavAD.image';
const original = {
  id: 12, slug: 'tiktok-discovery',
  title: 'Meri Aashiqui Tum Se Hi: A story that tells the deepest beauty of love, The Ultimate Epic Romance & Dramatic Storytelling',
  source_url: source + '?fixture_tracking=old', media_type: 'tiktok',
  primary_category: 'Entertainment, Movies & Games', subcategory: 'Movie Trailers',
  thumbnail_url: oldPoster + '?fixture_signature=expired', published: 1,
  description: 'Owner description unchanged', review_text: 'Substantial owner review unchanged',
  seo_title: 'Owner SEO title', seo_description: 'Owner SEO description', seo_tags: '["owner"]',
  created_at: '2026-09-22T10:53:05.021Z', updated_at: '2026-09-22T20:10:20.017Z',
  views: 37, reaction_count: 5, comments_count: 2,
  source_page_url: source, redistribution_certified: 0,
  cache_status: 'none', cache_attempts: 0,
};

function context(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  for (const path of ['0001_initial.sql', '0016_rights_certified_r2_cache.sql', '0017_authorized_auto_cache.sql']) {
    db.exec(readFileSync(new URL('../migrations/' + path, import.meta.url), 'utf8'));
  }
  const row = { ...original, ...overrides };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO videos (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
  return db;
}

test('the audited TikTok cover migration changes only thumbnail_url and is idempotent', () => {
  const db = context();
  try {
    const before = db.prepare('SELECT * FROM videos WHERE id=12').get();
    db.exec(migration);
    assert.equal(db.prepare('SELECT changes() AS count').get().count, 1);
    assert.deepEqual({ ...db.prepare('SELECT * FROM videos WHERE id=12').get() }, { ...before, thumbnail_url: cover });
    db.exec(migration);
    assert.equal(db.prepare('SELECT changes() AS count').get().count, 0);
  } finally { db.close(); }
});

test('the cover migration preserves custom covers, refreshed poster paths and owner edits', () => {
  for (const overrides of [
    { thumbnail_url: '/review-covers/owner.webp' },
    { thumbnail_url: 'https://vid.best/review-covers/owner.jpg' },
    { thumbnail_url: 'https://p16-common-sign.tiktokcdn-eu.com/new-owner-poster.image?fixture_signature=new' },
    { thumbnail_url: oldPoster + '.different?fixture_signature=new' },
    { updated_at: '2026-10-15T00:00:00Z' },
    { title: 'An owner-edited title' },
  ]) {
    const db = context(overrides);
    try {
      const before = db.prepare('SELECT * FROM videos').all();
      db.exec(migration);
      assert.deepEqual(db.prepare('SELECT * FROM videos').all(), before);
    } finally { db.close(); }
  }
});

test('the cover migration cannot touch drafts, other identities, comedy or changed sources', () => {
  for (const overrides of [
    { published: 0 }, { id: 81 }, { slug: 'saiyaara-a-cinematic-romance' },
    { slug: 'summer-inverted-7332342275151760642' },
    { media_type: 'facebook' }, { primary_category: 'Funny & Comedy' },
    { subcategory: 'Skits & Sketches' },
    { source_url: source + '9?fixture_tracking=old' },
    { source_url: 'https://www.tiktok.com/@different/video/7622472784039415061' },
    { created_at: '2026-10-15T00:00:00Z' },
  ]) {
    const db = context(overrides);
    try {
      const before = db.prepare('SELECT * FROM videos').all();
      db.exec(migration);
      assert.deepEqual(db.prepare('SELECT * FROM videos').all(), before);
    } finally { db.close(); }
  }
});

test('the reviewed illustration is a bounded WebP asset with exact approved bytes', () => {
  const bytes = readFileSync(new URL('../public/review-covers/meri-aashiqui-illustrated-v1.webp', import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  assert.equal(bytes.length, 122154);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '051b38eeb37b41c230778e8f74cec4e0a537926bd1087a1f13495a307a6a6ef0');
});
