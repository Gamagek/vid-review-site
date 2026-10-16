import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import change from '../content/editorial-quality/2026-10-16.json' with {type: 'json'};

const migration = readFileSync(new URL('../migrations/0041_source_based_editorial_quality.sql', import.meta.url), 'utf8');
const headings = text => text.split('\n').filter(line => /\b\d+\. /.test(line));

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  for (const record of change.records) {
    const row = {...record.before, featured: 1, trending: 1, views: 107, reaction_count: 13, comments_count: 4};
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO videos (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
  }
  const owner = {...change.records[0].before, id: 999, slug: 'owner-review', primary_category: 'Funny & Comedy'};
  const keys = Object.keys(owner);
  db.prepare(`INSERT INTO videos (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => owner[key]));
  return db;
}

test('editorial migration changes only three intended text pairs and preserves all other columns', () => {
  const db = fixture();
  const before = db.prepare('SELECT * FROM videos ORDER BY id').all();
  db.exec(migration);
  const after = db.prepare('SELECT * FROM videos ORDER BY id').all();
  for (let index = 0; index < before.length; index++) {
    const patch = change.records.find(record => record.id === before[index].id);
    assert.deepEqual({...after[index]}, {...before[index], ...(patch?.after || {})});
    if (patch) {
      assert.deepEqual(Object.keys(patch.after).sort(), ['description', 'review_text']);
      assert.deepEqual(headings(after[index].review_text), headings(before[index].review_text));
      assert.equal(after[index].review_text.split('\n')[0], before[index].review_text.split('\n')[0]);
      assert.ok(!/Titanic|Lakmal Suranjith|delivery blimps|TRUNCATED/.test(after[index].review_text));
      assert.equal(after[index].primary_category, 'Social Media & Trending');
    }
  }
  db.exec(migration);
  assert.equal(db.prepare('SELECT changes() AS n').get().n, 0);
  assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(), after);
  db.close();
});

test('each guarded owner edit or draft state is retained instead of being overwritten', () => {
  for (const field of ['description', 'review_text', 'seo_title', 'thumbnail_url', 'updated_at', 'published', 'primary_category']) {
    const db = fixture();
    for (const record of change.records) {
      const value = field === 'published' ? 0 : field === 'primary_category' ? 'Funny & Comedy' : `Owner changed ${field}`;
      db.prepare(`UPDATE videos SET ${field} = ? WHERE id = ?`).run(value, record.id);
    }
    const before = db.prepare('SELECT * FROM videos ORDER BY id').all();
    db.exec(migration);
    assert.deepEqual(db.prepare('SELECT * FROM videos ORDER BY id').all(), before, field);
    db.close();
  }
});

test('one changed source skips that record while independent unchanged records can receive their corrections', () => {
  const db = fixture();
  db.prepare('UPDATE videos SET source_url = ? WHERE id = 150').run('https://www.facebook.com/reel/owner-source/');
  const held = db.prepare('SELECT * FROM videos WHERE id = 150').get();
  db.exec(migration);
  assert.deepEqual(db.prepare('SELECT * FROM videos WHERE id = 150').get(), held);
  for (const id of [145, 152]) {
    const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    const expected = change.records.find(record => record.id === id);
    assert.equal(row.description, expected.after.description);
    assert.equal(row.review_text, expected.after.review_text);
  }
  db.close();
});
