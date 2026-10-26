import { validateCatalog } from './core.mjs';

// One read-only export per manual run, reused by the queue, recommendations and preservation guards.
// No migration, DDL, counters, admin API mutation, cache job or database write.
export async function exportCatalog({ token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID,
  fetcher = fetch } = {}) {
  if (!token || !/^[a-f0-9]{32}$/.test(account || '')) throw Error('Supply --catalog or configured read-only Cloudflare credentials');
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/d1a91eb2-1c41-44b8-aff1-24166f2c91f4/query`, {
    method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: `SELECT id,slug,title,source_url,source_page_url,media_type,r2_key,redistribution_certified,
      primary_category,subcategory,description,review_text,seo_title,seo_description,seo_tags,thumbnail_url,created_at,updated_at,published
      FROM videos WHERE published=1 ORDER BY id LIMIT 1001` }), signal: AbortSignal.timeout(30000),
  });
  // No automatic retries on D1 quota or other failures.
  if (!response.ok) throw Error(`Read-only catalog HTTP ${response.status}; no retry or write`);
  const text = await response.text();
  if (text.length > 15_000_000) throw Error('Catalog response exceeds budget');
  const data = JSON.parse(text); const result = data.result?.[0];
  if (!data.success || result?.success === false || !result?.results || result.meta?.rows_written > 0) throw Error('Read-only catalog failed');
  const rows = validateCatalog(result.results);
  // Do not persist private/signed media URLs to a public Actions artifact.
  const held=[];const publicRows=[];
  records:for (const r of rows) {
  for (const key of ['source_url','source_page_url','thumbnail_url']) {
    if (!r[key]) continue;
    const url = new URL(r[key], 'https://vid.best');
    if (url.username || url.password || [...url.searchParams.keys()].some(k => /^(?:token|sig|signature|secret|auth|authorization|expires|expire|exp|x-amz-.+)$/i.test(k))) {
      held.push({id:r.id,field:key,reason:'Private/signed URL requires separate local handling'});
      continue records;
    }
  }
  publicRows.push(r);
  }
  return { rows:publicRows, meta: { held, rows_read: result.meta?.rows_read ?? null, rows_written: result.meta?.rows_written ?? 0,
    observed_at: new Date().toISOString(), limit: 1000, request_count: 1 } };
}
