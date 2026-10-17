import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEditorial, readPublishedLibrary} from '../scripts/editorial-quality-audit.mjs';

const row = (id, fields = {}) => ({id, slug: `review-${id}`, published: 1,
  primary_category: 'Music', description: 'A specific source and a useful question.', review_text: 'A distinct review.', ...fields});
const paragraph = 'A source-specific comparison should explain what a choice contributes to the work and where that choice becomes less convincing for its intended audience.';

test('screening counts repeated review paragraphs once per document, separately from generic introductions', () => {
  const report = auditEditorial([
    row(1, {description: 'In this fresh, deeply analytical review, we explore everything.', review_text: `${paragraph}\n\n${paragraph}`}),
    row(2, {review_text: paragraph.replaceAll(' ', '  ')}),
    row(3, {primary_category: 'Funny & Comedy', review_text: 'A different text.'}),
  ]);
  assert.deepEqual(report.counts, {records: 3, flagged: 2, genericListingIntros: 1, repeatedParagraphGroups: 1});
  assert.deepEqual(report.repeatedParagraphs[0].recordIds, [1, 2]);
  assert.equal(report.records[2].protectedTopic, true);
  assert.match(report.limitation, /No AI detection/);
  assert.ok(!JSON.stringify(report).includes(paragraph));
});

test('private URLs and complete text are not included in a screening report', () => {
  const report = auditEditorial([row(1, {source_url: 'https://example.invalid/?token=private', review_text: 'A private example sentence.'})]);
  assert.ok(!JSON.stringify(report).includes('token'));
  assert.ok(!JSON.stringify(report).includes('private example'));
  assert.match(report.records[0].contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(auditEditorial([row(2, {published: true})]).counts.records, 1);
  assert.throws(() => auditEditorial([row(1), row(1)]), /Invalid/);
  assert.throws(() => auditEditorial([row(1, {published: 0})]), /Invalid/);
});

test('popularity screening includes plural views and streams without rewriting source text', () => {
  for (const review_text of ['Surpassing 700 million views.', 'Amassing hundreds of millions of views.',
    'Accumulating tens of millions of streams.', 'Over one billion streams.', '2 BILLION VIEWS.',
    'The claim of millions of views is disputed.']) {
    const source = [row(191, {review_text}), row(999, {primary_category: 'Funny & Comedy', review_text: 'Three million streams.'})];
    const saved = structuredClone(source);
    const report = auditEditorial(source);
    assert.equal(report.screeningVersion, 2);
    assert.deepEqual(report.records[0].flags, ['claim_needs_source_review'], review_text);
    assert.deepEqual(report.records[1].flags, ['claim_needs_source_review']);
    assert.equal(report.records[1].protectedTopic, true);
    assert.deepEqual(source, saved);
    assert.ok(!JSON.stringify(report).includes(review_text));
    assert.match(report.limitation, /Screening signals only/);
  }
});

test('popularity screening avoids incidental million/billion or streaming terminology', () => {
  for (const review_text of ['The title is A Million Dreams.', 'A billion stars in the artwork.',
    'The producer views streaming as distribution.', 'Thoughts of millions; views differ.',
    'The stream flows under a bridge.']) {
    assert.deepEqual(auditEditorial([row(1, {review_text})]).records[0].flags, [], review_text);
  }
});

test('failed and incomplete library requests never become a successful empty inventory', async () => {
  await assert.rejects(readPublishedLibrary(async () => new Response('{}', {status: 503})), /503/);
  await assert.rejects(readPublishedLibrary(async () => Response.json({videos: [], pagination: {total: 1, offset: 0, limit: 48}})), /Incomplete/);
  const empty = await readPublishedLibrary(async () => Response.json({videos: [], pagination: {total: 0, offset: 0, limit: 48}}));
  assert.deepEqual(empty, []);
});

test('pagination uses read-only canonical requests and rejects an inventory that changes mid-read', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url, options});
    const offset = Number(new URL(url).searchParams.get('offset'));
    return Response.json({videos: offset === 0 ? Array.from({length: 48}, (_, i) => row(i + 1)) : [row(49)],
      pagination: {total: 49, offset, limit: 48}});
  };
  assert.equal((await readPublishedLibrary(fetcher)).length, 49);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url.startsWith('https://vid.best/api/videos?') && call.options.redirect === 'error' && !call.options.method));
  assert.match(calls[0].options.headers['User-Agent'], /^VidBest-SEO-Audit/);
  await assert.rejects(readPublishedLibrary(async url => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return Response.json({videos: offset ? [] : Array.from({length: 48}, (_, i) => row(i + 1)), pagination: {total: offset ? 48 : 49, offset, limit: 48}});
  }), /changing library/);
});
