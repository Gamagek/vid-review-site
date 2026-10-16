import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const ORIGIN = 'https://vid.best';
const digest = value => createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const genericIntro = /in this (?:fresh|fun),? (?:deeply )?analytical review|prepare to (?:be moved|laugh out loud)|get ready for the ultimate/i;

// These are review candidates, never plagiarism, AI-authorship or policy verdicts.
export function auditEditorial(rows) {
  if (!Array.isArray(rows)) throw new Error('Expected a published library array');
  const seen = new Set();
  const paragraphs = new Map();
  const records = rows.map(row => {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || !/^[a-z0-9-]+$/.test(row.slug || '') ||
        seen.has(row.id) || ![1, true].includes(row.published) || typeof row.description !== 'string' || typeof row.review_text !== 'string') {
      throw new Error('Invalid, duplicate or unpublished library record');
    }
    seen.add(row.id);
    const flags = [];
    if (!row.description.trim()) flags.push('missing_listing_description');
    if (!row.review_text.trim()) flags.push('missing_review_body');
    if (genericIntro.test(row.description)) flags.push('generic_listing_intro');
    if (/\b(?:million views|scientifically proven|dopamine|cortisol|neuroscience|true story)\b/i.test(row.review_text)) flags.push('claim_needs_source_review');
    for (const part of row.review_text.split(/\n\s*\n/)) {
      const normalized = normalize(part);
      if (normalized.split(' ').length < 20) continue;
      const hash = digest(normalized);
      if (!paragraphs.has(hash)) paragraphs.set(hash, new Set());
      paragraphs.get(hash).add(row.id);
    }
    return {
      id: row.id, slug: row.slug, category: row.primary_category || '',
      protectedTopic: row.primary_category === 'Funny & Comedy',
      contentSha256: digest(JSON.stringify([row.description, row.review_text])),
      flags,
    };
  });
  const repeatedParagraphs = [...paragraphs].filter(([, ids]) => ids.size > 1)
    .map(([sha256, ids]) => ({sha256, recordIds: [...ids].sort((a, b) => a - b)}));
  const repeatedIds = new Set(repeatedParagraphs.flatMap(group => group.recordIds));
  for (const row of records) if (repeatedIds.has(row.id)) row.flags.push('shared_review_paragraph');
  return {
    productionWrites: false,
    scope: 'published library review bodies and listing descriptions; excludes category/listing-page overlap',
    limitation: 'Screening signals only. No AI detection, external plagiarism check, footage verification, Google status or AdSense eligibility score.',
    counts: {records: records.length, flagged: records.filter(row => row.flags.length).length,
      genericListingIntros: records.filter(row => row.flags.includes('generic_listing_intro')).length,
      repeatedParagraphGroups: repeatedParagraphs.length},
    repeatedParagraphs, records,
  };
}

export async function readPublishedLibrary(fetcher = fetch) {
  const rows = [];
  let total;
  for (let offset = 0; total === undefined || offset < total; offset += 48) {
    if (offset >= 5000) throw new Error('Unexpected library size');
    const response = await fetcher(`${ORIGIN}/api/videos?limit=48&offset=${offset}`, {
      redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {'User-Agent': 'VidBest-SEO-Audit/1.0 (editorial screening)', Accept: 'application/json'},
    });
    if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
    const page = await response.json();
    const count = page.pagination?.total;
    if (!Number.isSafeInteger(count) || count < 0 || count > 5000 || !Array.isArray(page.videos) ||
        page.pagination.offset !== offset || page.pagination.limit !== 48 ||
        page.videos.length !== Math.min(48, Math.max(0, count - offset)) || total !== undefined && total !== count) {
      throw new Error('Incomplete or changing library pagination');
    }
    total = count;
    rows.push(...page.videos);
  }
  if (rows.length !== total) throw new Error('Incomplete library');
  auditEditorial(rows); // Reject duplicates or drafts before reporting a complete inventory.
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputIndex = process.argv.indexOf('--input');
  const rows = inputIndex < 0 ? await readPublishedLibrary() : JSON.parse(await readFile(process.argv[inputIndex + 1], 'utf8'));
  const now = new Date().toISOString();
  const report = {generatedAt: now, inputMode: inputIndex < 0 ? 'live_public_api' : 'offline_snapshot',
    observedAt: inputIndex < 0 ? now : null, ...auditEditorial(rows)};
  await writeFile('editorial-quality-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: report.generatedAt, ...report.counts, productionWrites: false}));
}
