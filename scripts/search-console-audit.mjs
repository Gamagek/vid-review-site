#!/usr/bin/env node
import { createHash, createPrivateKey, createSign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://vid.best';
const SITEMAP = ORIGIN + '/sitemap.xml';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters';
const USER_AGENT = 'VidBest-SEO-Audit/1.0 (owner crawlability monitoring)';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_URLS = 1000;
const MAX_SITEMAPS = 50;

class AuditError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const safeCode = error => error instanceof AuditError ? error.code : 'internal_error';
const decode = text => String(text).replace(/&(?:amp|lt|gt|quot|apos);/g,
  entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]);
const plain = text => decode(String(text).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attribute = (tag, name) => decode(tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i'))?.[2] || '');
const delay = ms => new Promise(done => setTimeout(done, ms));

// Only public Vid.Best pages and XML sitemaps may be fetched or written to reports.
export function publicUrl(value) {
  let url;
  try { url = new URL(value, ORIGIN); } catch { throw new AuditError('unsafe_public_url'); }
  const safePath = /^\/(?:$|robots\.txt$|sitemap\.xml$|sitemaps\/[a-z0-9-]+\.xml$|videos$|privacy$|terms$|category\/[a-z0-9-]+$|watch\/[^/]+$)/.test(url.pathname);
  const safeQuery = !url.search || (url.pathname === '/videos' && /^\?page=[1-9]\d{0,4}$/.test(url.search));
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || !safePath || !safeQuery) throw new AuditError('unsafe_public_url');
  return url.href;
}

async function boundedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new AuditError('response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new AuditError('response_too_large'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function request(fetchImpl, url, options = {}, wait = delay) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options, redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': USER_AGENT, ...options.headers },
      });
    } catch {
      if (attempt === 2) throw new AuditError('network_or_timeout');
      await wait(1000 * (attempt + 1));
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const seconds = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      await wait(Math.min(30000, seconds > 0 ? seconds * 1000 : 1000 * (attempt + 1)));
      continue;
    }
    return response;
  }
}

export function parseSitemap(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/<(?:sitemapindex|urlset)\b/.test(xml)) throw new AuditError('invalid_sitemap_xml');
  const index = /<sitemapindex\b/.test(xml);
  if (!xml.includes('http://www.sitemaps.org/schemas/sitemap/0.9') || !xml.trim().endsWith(index ? '</sitemapindex>' : '</urlset>')) throw new AuditError('invalid_sitemap_xml');
  const locations = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match => publicUrl(decode(match[1].trim())));
  if (!locations.length) throw new AuditError('empty_sitemap');
  if (index && locations.some(url => !url.endsWith('.xml'))) throw new AuditError('invalid_sitemap_index');
  return { index, locations };
}

export function robotsAllows(robots, path) {
  const groups = [];
  let group = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const match = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group && value) group.rules.push({ allow: key === 'allow', value });
  }
  const specific = groups.filter(g => g.agents.includes('googlebot'));
  const applicable = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  let selected = { length: -1, allow: true };
  for (const rule of applicable.flatMap(g => g.rules)) {
    const expression = rule.value.split('*').map(part => part.replace(/[.+?^{}()|[\]\\]/g, '\\$&')).join('.*');
    if (new RegExp('^' + expression).test(path) && (rule.value.length > selected.length
      || (rule.value.length === selected.length && rule.allow))) selected = { length: rule.value.length, allow: rule.allow };
  }
  return selected.allow;
}

async function discover(fetchImpl, wait) {
  const pending = [SITEMAP], maps = [], urls = new Set();
  while (pending.length) {
    const url = pending.shift();
    if (maps.some(map => map.url === url)) continue;
    if (maps.length >= MAX_SITEMAPS) throw new AuditError('sitemap_budget_exceeded');
    const response = await request(fetchImpl, url, {}, wait);
    const type = response.headers.get('content-type') || '';
    if (response.status !== 200 || !/xml/i.test(type)) {
      await response.body?.cancel(); throw new AuditError('sitemap_http_' + response.status);
    }
    const parsed = parseSitemap(await boundedText(response));
    const head = await request(fetchImpl, url, { method: 'HEAD' }, wait);
    await head.body?.cancel();
    if (head.status !== 200) throw new AuditError('sitemap_head_http_' + head.status);
    maps.push({ url, status: response.status, headStatus: head.status, entries: parsed.locations.length });
    if (parsed.index) pending.push(...parsed.locations);
    else for (const location of parsed.locations) urls.add(location);
    if (urls.size > MAX_URLS) throw new AuditError('public_audit_budget_exceeded');
  }
  return { maps, urls: [...urls] };
}

async function auditPage(url, robots, fetchImpl, wait) {
  const page = { url, errors: [], warnings: [] };
  if (!robotsAllows(robots, new URL(url).pathname)) page.errors.push('googlebot_blocked_by_robots');
  try {
    const head = await request(fetchImpl, url, { method: 'HEAD' }, wait);
    page.headStatus = head.status;
    await head.body?.cancel();
    if (head.status !== 200) page.errors.push('head_http_' + head.status);
    const started = Date.now();
    const response = await request(fetchImpl, url, {}, wait);
    page.getStatus = response.status;
    page.responseMs = Date.now() - started;
    page.contentType = (response.headers.get('content-type') || '').split(';')[0];
    if (response.status !== 200 || page.contentType !== 'text/html') {
      await response.body?.cancel(); page.errors.push('page_http_or_content_type'); return page;
    }
    const html = await boundedText(response);
    const tags = [...html.matchAll(/<(?:link|meta)\b[^>]*>/gi)].map(match => match[0]);
    const declared = tags.filter(tag => /\brel\s*=/.test(tag) && attribute(tag, 'rel').toLowerCase() === 'canonical');
    page.canonical = declared.length === 1 ? publicUrl(attribute(declared[0], 'href')) : '';
    if (page.canonical !== url) page.errors.push('canonical_mismatch');
    const robotsTag = tags.filter(tag => attribute(tag, 'name').toLowerCase() === 'robots').map(tag => attribute(tag, 'content')).join(' ');
    if (/\b(?:noindex|none)\b/i.test(robotsTag + ' ' + response.headers.get('x-robots-tag'))) page.errors.push('page_noindex');
    page.title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 200);
    if (!page.title || !/<h1\b/i.test(html)) page.errors.push('missing_title_or_heading');
    page.links = [];
    for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
      try { page.links.push(publicUrl(attribute(match[0], 'href'))); } catch { /* Exclude source/admin/action links. */ }
    }
    page.links = [...new Set(page.links)];
    if (new URL(url).pathname.startsWith('/watch/')) {
      const review = plain(html.match(/<section\b[^>]*class=["'][^"']*\breview-copy\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i)?.[1] || '');
      page.reviewWords = review.split(/\s+/).filter(Boolean).length;
      page.reviewHash = createHash('sha256').update(review).digest('hex');
      if (!review) page.errors.push('review_text_missing_from_html');
      else if (page.reviewWords < 100) page.warnings.push('short_review_needs_editorial_check');
      if (/(?:^|[-/])(?:demo|player-test)(?:-|$)/i.test(new URL(url).pathname)) page.warnings.push('demo_page_needs_editorial_check');
    }
  } catch (error) { page.errors.push(safeCode(error)); }
  return page;
}

export async function googleAccessToken(secret, { fetchImpl = globalThis.fetch, wait = delay, now = Date.now() } = {}) {
  let credentials, key;
  try {
    credentials = JSON.parse(secret);
    if (credentials.type !== 'service_account' || !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(credentials.client_email)) throw new Error();
    key = createPrivateKey(credentials.private_key);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error();
  } catch { throw new AuditError('invalid_service_account_secret'); }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issued = Math.floor(now / 1000);
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
    iss: credentials.client_email, scope: SCOPE, aud: TOKEN_URL, iat: issued, exp: issued + 3600,
  });
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const response = await request(fetchImpl, TOKEN_URL, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
  }, wait);
  if (response.status !== 200) { await response.body?.cancel(); throw new AuditError('google_oauth_http_' + response.status); }
  let data;
  try { data = JSON.parse(await boundedText(response)); } catch { throw new AuditError('invalid_google_oauth_response'); }
  if (!data.access_token || data.token_type?.toLowerCase() !== 'bearer') throw new AuditError('invalid_google_oauth_response');
  return data.access_token;
}

async function readSitemapProcessing(fetchImpl, property, sitemap, headers, wait) {
  try {
    const response = await request(fetchImpl, property + '/sitemaps/' + encodeURIComponent(sitemap), {headers}, wait);
    if (!response.ok) { await response.body?.cancel(); return {status:'not_verified',error:'google_sitemap_status_http_' + response.status}; }
    const feed = JSON.parse(await boundedText(response));
    if (feed.path !== sitemap) throw new AuditError('invalid_google_sitemap_status');
    const state = {status:'verified'};
    if (typeof feed.isPending === 'boolean') state.isPending = feed.isPending;
    for (const field of ['lastDownloaded','lastSubmitted']) {
      if (typeof feed[field] === 'string' && /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(feed[field])) state[field] = feed[field].slice(0,40);
    }
    for (const field of ['errors','warnings']) if (/^\d{1,12}$/.test(String(feed[field]))) state[field] = Number(feed[field]);
    return state;
  } catch (error) { return {status:'not_verified',error:safeCode(error)}; }
}

export async function syncSearchConsole(urls, { secret = '', site = 'sc-domain:vid.best', budget = 200,
  reviewSitemaps = [], fetchImpl = globalThis.fetch, wait = delay, now = Date.now(), getToken = googleAccessToken,
  progress = () => {} } = {}) {
  const result = { status: secret ? 'pending' : 'not_configured', authenticated: false,
    propertyVerified: false, sitemapSubmitted: false, inspections: [] };
  if (!secret) { result.requiredSecret = 'GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON'; return result; }
  let stage = 'authenticate';
  try {
    if (!['sc-domain:vid.best', ORIGIN + '/'].includes(site)) throw new AuditError('invalid_search_console_property');
    const maps = [...new Set(reviewSitemaps.map(publicUrl))];
    if (maps.length > 10 || maps.some(url => !/^https:\/\/vid\.best\/sitemaps\/videos-[1-9]\d*\.xml$/.test(url))) throw new AuditError('invalid_review_sitemap');

    progress('Google credentials configured; requesting OAuth access.');
    const token = await getToken(secret, { fetchImpl, wait, now });
    result.authenticated = true;
    progress('Google OAuth authentication succeeded.');
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const property = 'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(site);
    stage = 'verify_property_access';
    const access = await request(fetchImpl, property, { headers }, wait);
    if (access.status !== 200) { await access.body?.cancel(); throw new AuditError('google_property_http_' + access.status); }
    const info = JSON.parse(await boundedText(access));
    if (!['siteOwner', 'siteFullUser'].includes(info.permissionLevel)) throw new AuditError('search_console_full_access_required');
    result.propertyVerified = true;
    progress('Full or Owner Search Console property access verified.');
    stage = 'submit_sitemap';
    const submit = await request(fetchImpl, property + '/sitemaps/' + encodeURIComponent(SITEMAP), { method: 'PUT', headers }, wait);
    if (!submit.ok) { await submit.body?.cancel(); throw new AuditError('google_sitemap_http_' + submit.status); }
    await submit.body?.cancel();
    result.sitemapSubmitted = true;
    progress('Published sitemap accepted by Google.');
    // Acceptance is not proof that Google downloaded the index or its children.
    result.sitemapProcessing = await readSitemapProcessing(fetchImpl, property, SITEMAP, headers, wait);
    result.reviewSitemaps = [];
    stage = 'submit_review_sitemaps';
    for (const sitemap of maps) {
      const response = await request(fetchImpl, property + '/sitemaps/' + encodeURIComponent(sitemap), {method:'PUT',headers}, wait);
      if (!response.ok) { await response.body?.cancel(); throw new AuditError('google_review_sitemap_http_' + response.status); }
      await response.body?.cancel();
      const processing = await readSitemapProcessing(fetchImpl, property, sitemap, headers, wait);
      result.reviewSitemaps.push({url:sitemap,submitted:true,processing});
      progress('Review sitemap accepted by Google; processing: ' + processing.status + '; pending: ' + (processing.isPending ?? 'not_verified') + '; last downloaded: ' + (processing.lastDownloaded || 'not_reported') + '.');
    }
    stage = 'inspect_index_status';
    const reviews = [...new Set(urls.map(publicUrl).filter(url => new URL(url).pathname.startsWith('/watch/')))].sort();
    const limit = Math.min(200, Math.max(0, Number.isFinite(Number(budget)) ? Number(budget) : 200));
    const offset = Math.floor(now / 86400000) * limit % Math.max(1, reviews.length);
    const selected = reviews.slice(offset).concat(reviews.slice(0, offset)).slice(0, limit);
    result.totalReviews = reviews.length;
    result.inspectionBudget = limit;
    progress('Reading stored Google index status for ' + selected.length + ' reviews.');
    for (const url of selected) {
      // Under 240 calls/minute; stop the entire run on quota/auth failures.
      await wait(250);
      const response = await request(fetchImpl, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionUrl: url, siteUrl: site, languageCode: 'en-US' }),
      }, wait);
      if (!response.ok) { await response.body?.cancel(); throw new AuditError('google_inspection_http_' + response.status); }
      const data = JSON.parse(await boundedText(response));
      const state = data.inspectionResult?.indexStatusResult;
      if (!state) throw new AuditError('invalid_google_inspection_response');
      const row = { url };
      for (const field of ['verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'pageFetchState', 'lastCrawlTime']) {
        if (typeof state[field] === 'string') row[field] = state[field].slice(0, 200);
      }
      for (const field of ['googleCanonical', 'userCanonical']) {
        if (state[field]) { try { row[field] = publicUrl(state[field]); } catch { row[field] = 'outside_canonical_public_routes'; } }
      }
      result.inspections.push(row);
      if (result.inspections.length % 10 === 0 || result.inspections.length === selected.length) {
        progress('Google inspections completed: ' + result.inspections.length + '/' + selected.length + '.');
      }
    }
    result.status = 'success';
  } catch (error) { result.status = 'failed'; result.stage = stage; result.error = safeCode(error); }
  return result;
}

export async function runAudit({ fetchImpl = globalThis.fetch, wait = delay, secret = '',
  site, budget, now = Date.now(), getToken, progress = () => {} } = {}) {
  const report = { generatedAt: new Date(now).toISOString(), productionWrites: false, errors: [], pages: [] };
  try {
    progress('Starting public crawlability checks.');
    const robots = await request(fetchImpl, ORIGIN + '/robots.txt', {}, wait);
    if (robots.status !== 200) { await robots.body?.cancel(); throw new AuditError('robots_http_' + robots.status); }
    const robotsText = await boundedText(robots);
    const robotsHead = await request(fetchImpl, ORIGIN + '/robots.txt', { method: 'HEAD' }, wait);
    report.robotsHeadStatus = robotsHead.status;
    await robotsHead.body?.cancel();
    if (robotsHead.status !== 200) report.errors.push('robots_head_http_' + robotsHead.status);
    const discovered = await discover(fetchImpl, wait);
    report.sitemaps = discovered.maps;
    report.discoveredReviewCount = discovered.urls.filter(url => new URL(url).pathname.startsWith('/watch/')).length;
    progress('Sitemap discovery complete; published reviews: ' + report.discoveredReviewCount + '.');
    const pending = [...discovered.urls], visited = new Set();
    while (pending.length) {
      const batch = pending.splice(0, 3).filter(url => !visited.has(url));
      for (const url of batch) visited.add(url);
      if (visited.size > MAX_URLS) throw new AuditError('public_audit_budget_exceeded');
      const pages = await Promise.all(batch.map(url => auditPage(url, robotsText, fetchImpl, wait)));
      report.pages.push(...pages);
      if (report.pages.length % 25 < pages.length) progress('Public pages checked: ' + report.pages.length + '.');
      for (const page of pages) for (const url of page.links || []) {
        if (new URL(url).pathname === '/videos' && !visited.has(url) && !pending.includes(url)) pending.push(url);
      }
    }
    const links = new Set(report.pages.flatMap(page => page.links || []));
    report.unlinkedReviews = discovered.urls.filter(url => new URL(url).pathname.startsWith('/watch/') && !links.has(url));
    if (report.unlinkedReviews.length) report.errors.push('review_urls_missing_from_html_links');
    const hashes = new Map();
    for (const page of report.pages) {
      if (page.reviewHash && page.reviewWords) {
        if (hashes.has(page.reviewHash)) page.warnings.push('duplicate_review_text');
        else hashes.set(page.reviewHash, page.url);
      }
      delete page.reviewHash;
    }
    report.failedPages = report.pages.filter(page => page.errors.length).length;
    report.publicAuditStatus = !report.errors.length && !report.failedPages ? 'success' : 'failed';
    progress('Public checks complete: ' + report.publicAuditStatus + '; pages checked: ' + report.pages.length + '.');
    report.searchConsole = report.publicAuditStatus === 'success'
      ? await syncSearchConsole(discovered.urls, { secret, site, budget, now, fetchImpl, wait, getToken, progress,
          reviewSitemaps: discovered.maps.map(map => map.url).filter(url => /\/sitemaps\/videos-\d+\.xml$/.test(url)) })
      : { status: 'skipped_public_audit_failed', sitemapSubmitted: false, inspections: [] };
  } catch (error) { report.errors.push(safeCode(error)); report.publicAuditStatus = 'failed'; }
  return report;
}

export function summary(report) {
  const google = report.searchConsole;
  const indexed = google?.inspections?.filter(row => row.verdict === 'PASS').length || 0;
  const coverageCount = state => google?.inspections?.filter(row => row.coverageState === state).length || 0;
  return [
    'Vid.Best public SEO audit: ' + report.publicAuditStatus,
    'Published review URLs discovered: ' + (report.discoveredReviewCount || 0),
    'Pages checked: ' + report.pages.length + '; technical failures: ' + (report.failedPages || 0),
    report.errors.length ? 'Audit errors: ' + report.errors.join(', ') : '',
    'Editorial warnings: ' + report.pages.filter(page => page.warnings.length).length,
    'Search Console: ' + (google?.status || 'not_run'),
    'Google OAuth authentication: ' + (google?.authenticated ? 'success' : 'not_verified'),
    'Search Console property access: ' + (google?.propertyVerified ? 'verified' : 'not_verified'),
    'Sitemap submitted to Google: ' + Boolean(google?.sitemapSubmitted),
    google?.sitemapProcessing ? 'Google sitemap processing: ' + google.sitemapProcessing.status
      + '; pending: ' + (google.sitemapProcessing.isPending ?? 'not_verified')
      + '; last downloaded: ' + (google.sitemapProcessing.lastDownloaded || 'not_reported')
      + '; errors: ' + (google.sitemapProcessing.errors ?? 'not_reported')
      + '; warnings: ' + (google.sitemapProcessing.warnings ?? 'not_reported') : '',
    google?.sitemapProcessing?.error ? 'Sitemap processing diagnostic: ' + google.sitemapProcessing.error : '',

    google?.reviewSitemaps?.length ? 'Review sitemaps submitted separately: ' + google.reviewSitemaps.length + '; processing: ' + JSON.stringify(google.reviewSitemaps.map(row => row.processing)) : '',
    'Stored Google index inspections: ' + (google?.inspections?.length || 0) + '; PASS: ' + indexed,
    google?.inspections?.length ? 'Stored Google coverage: discovered/not indexed: ' + coverageCount('Discovered - currently not indexed')
      + '; unknown to Google: ' + coverageCount('URL is unknown to Google')
      + '; crawled/not indexed: ' + coverageCount('Crawled - currently not indexed') : '',
    google?.error ? 'Google stage: ' + google.stage + '; error: ' + google.error : '',
    google?.status === 'not_configured' ? 'Required GitHub Actions secret: GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON' : '',
    'Production writes: none. URL Inspection reads stored index status; it does not request indexing.',
  ].filter(Boolean).join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await runAudit({
    secret: process.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON || '',
    site: process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY || 'sc-domain:vid.best',
    budget: process.env.GOOGLE_SEARCH_CONSOLE_INSPECTIONS || 200,
    progress: message => console.log('[SEO audit] ' + message),
  });
  await writeFile('seo-audit-report.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('seo-audit-summary.txt', summary(report));
  console.log(summary(report));
  if (report.publicAuditStatus !== 'success' || report.searchConsole?.status === 'failed') process.exitCode = 1;
}
