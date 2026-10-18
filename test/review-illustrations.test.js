import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import illustrations from '../src/review-illustrations.json' with { type: 'json' };
import { reviewIllustration, reviewPreviewIllustration } from '../src/review-illustrations.js';

test('sidebar artwork assets have unique verified WebP bytes and complete bounded provenance', () => {
  const prompts = JSON.parse(readFileSync(new URL('../docs/review-illustration-prompts.json', import.meta.url)));
  const paths = new Set();
  for (const item of illustrations) {
    assert.match(item.path, /^\/review-illustrations\/[a-z0-9-]+-v\d+\.webp$/);
    assert.ok(!paths.has(item.path)); paths.add(item.path);
    const bytes = readFileSync(new URL('../public' + item.path, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(bytes.length, item.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    assert.ok(bytes.length < 300_000, 'sidebar assets stay bounded');
    assert.ok(item.width >= 1200 && item.height >= 675);
    assert.match(item.alt, /AI-generated.*not video footage/);
    assert.match(item.caption, /not a frame/);
    const prompt = prompts.images.find(row => row.id === item.id);
    assert.equal(prompt.sha256, item.sha256);
    assert.ok(prompt.prompt.includes('AI-GENERATED REVIEW ILLUSTRATION'));
  }
});

test('owner title, source, slug and publication changes disable stale illustration matches', () => {
  for (const item of illustrations) {
    const row = {id:item.id,slug:item.slug,title:item.expectedTitle,source_url:item.sourceUrl,published:1};
    assert.equal(reviewIllustration(row)?.path, item.path);
    for (const change of [{slug:'owner-new-slug'},{title:'Owner changed title'},{source_url:'https://example.org/another-video'},{published:0},{published:false}]) {
      assert.equal(reviewIllustration({...row,...change}), null);
    }
    assert.equal(reviewIllustration({...row,source_url:row.source_url+'?si=public-tracking'} )?.path,item.path);
  }
  assert.equal(reviewIllustration({id:99999}),null);
  const fb=illustrations.find(row=>row.id===149);
  assert.equal(reviewIllustration({id:fb.id,slug:fb.slug,title:fb.expectedTitle,source_url:'https://www.facebook.com/watch/?v=not-the-same-video'}),null);
});

test('only audited placeholder identities get a review-art preview; owner poster changes win', () => {
  const enabled = illustrations.filter(item => item.previewFallbackFrom);
  assert.equal(enabled.length, 8);
  for (const art of enabled) {
    const row = { id:art.id, slug:art.slug, title:art.expectedTitle,
      source_url:art.sourceUrl, published:1, thumbnail_url:art.previewFallbackFrom };
    const before = structuredClone(row);
    assert.equal(reviewPreviewIllustration(row)?.path, art.path);
    for (const change of [{thumbnail_url:'/review-covers/new-owner-poster.webp'},
      {thumbnail_url:'https://images.example.org/owner.jpg'}, {title:'Owner new title'},
      {source_url:'https://www.facebook.com/reel/another/'}, {published:0}]) {
      assert.equal(reviewPreviewIllustration({...row,...change}), null);
    }
    assert.deepEqual(row, before);
  }
  const working = illustrations.find(item => item.id === 162);
  assert.equal(reviewPreviewIllustration({id:working.id,slug:working.slug,title:working.expectedTitle,
    source_url:working.sourceUrl,published:1,thumbnail_url:'/facebook-previews/outdoor-challenge-comedy-v1.jpg'}),null);
});
