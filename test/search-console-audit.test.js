import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import test from 'node:test';
import { googleAccessToken, parseSitemap, publicUrl, robotsAllows, runAudit, syncSearchConsole, summary } from '../scripts/search-console-audit.mjs';

const noop = async () => {};
const ORIGIN = 'https://vid.best';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const map = locations => '<urlset xmlns="' + NS + '">' + locations.map(url => '<url><loc>' + url + '</loc></url>').join('') + '</urlset>';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const page = (url, links = [], options = {}) => '<html><head><title>Useful review | Vid.Best</title><meta name="robots" content="' + (options.noindex ? 'noindex' : 'index,follow') + '"><link rel="canonical" href="' + (options.canonical || url) + '"></head><body><h1>Useful review</h1>' + (url.includes('/watch/') ? '<section class="review-copy">' + 'Actual video analysis with specific observations. '.repeat(30) + '</section>' : '') + links.map(link => '<a href="' + link + '">Review</a>').join('') + '</body></html>';

function publicSite(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    assert.ok(url.startsWith(ORIGIN + '/'));
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined);
    if (overrides[url]) return overrides[url](options);
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-type': url.endsWith('.xml') ? 'application/xml' : 'text/html' } });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://vid.best/sitemap.xml\n');
    if (url.endsWith('/sitemap.xml')) return new Response('<sitemapindex xmlns="' + NS + '"><sitemap><loc>https://vid.best/sitemaps/pages.xml</loc></sitemap><sitemap><loc>https://vid.best/sitemaps/videos-1.xml</loc></sitemap></sitemapindex>', { headers: { 'content-type': 'application/xml' } });
    if (url.endsWith('/pages.xml')) return new Response(map([ORIGIN + '/', ORIGIN + '/videos']), { headers: { 'content-type': 'application/xml' } });
    if (url.endsWith('/videos-1.xml')) return new Response(map([ORIGIN + '/watch/review-1', ORIGIN + '/watch/review-2']), { headers: { 'content-type': 'application/xml' } });
    const links = url === ORIGIN + '/videos' ? [ORIGIN + '/watch/review-1', ORIGIN + '/videos?page=2'] : url === ORIGIN + '/videos?page=2' ? [ORIGIN + '/watch/review-2'] : [ORIGIN + '/videos'];
    return new Response(page(url, links), { headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls };
}

test('public audit covers all sitemap reviews and HTML pagination without Google credentials or production writes', async () => {
  const fake = publicSite();
  const report = await runAudit({ fetchImpl: fake.fetchImpl, wait: noop });
  assert.equal(report.publicAuditStatus, 'success');
  assert.equal(report.discoveredReviewCount, 2);
  assert.equal(report.pages.length, 5);
  assert.deepEqual(report.unlinkedReviews, []);
  assert.equal(report.productionWrites, false);
  assert.equal(report.searchConsole.status, 'not_configured');
  assert.equal(report.searchConsole.sitemapSubmitted, false);
  assert.ok(fake.calls.every(call => ['GET', 'HEAD'].includes(call.method)));
  assert.match(summary(report), /not_configured/);
  assert.doesNotMatch(summary(report), /Search Console: success/);
});

test('public technical failures prevent Google submission and include safe diagnostics', async () => {
  const url = ORIGIN + '/watch/review-1';
  const fake = publicSite({ [url]: options => options.method === 'HEAD' ? new Response(null, { status: 404 }) : new Response(page(url, [], { noindex: true, canonical: ORIGIN + '/' }), { headers: { 'content-type': 'text/html' } }) });
  let tokenRequests = 0;
  const report = await runAudit({ fetchImpl: fake.fetchImpl, wait: noop, secret: 'configured', getToken: async () => { tokenRequests++; } });
  assert.equal(report.publicAuditStatus, 'failed');
  assert.equal(report.searchConsole.status, 'skipped_public_audit_failed');
  assert.equal(tokenRequests, 0);
  assert.deepEqual(report.pages.find(page => page.url === url).errors, ['head_http_404', 'canonical_mismatch', 'page_noindex']);
});

test('sitemap extraction rejects external, authenticated and private routes, truncated XML and entities', () => {
  for (const url of ['https://evil.example/watch/x', 'https://user:secret@vid.best/watch/x', ORIGIN + '/api/private', ORIGIN + '/watch/x?token=secret', ORIGIN + '/admin']) {
    assert.throws(() => publicUrl(url), /unsafe_public_url/);
  }
  assert.throws(() => parseSitemap('<urlset><loc>https://vid.best/watch/a</loc>'), /invalid_sitemap_xml/);
  assert.throws(() => parseSitemap('<!DOCTYPE x><urlset xmlns="' + NS + '"></urlset>'), /invalid_sitemap_xml/);
});

test('real demo URLs are flagged without misclassifying Demon Hunters or Voldemort reviews', async () => {
  const urls = [ORIGIN + '/watch/golden-kpop-demon-hunters', ORIGIN + '/watch/dumbledore-vs-voldemort', ORIGIN + '/watch/youtube-embed-experience-demo'];
  const fake = publicSite({
    [ORIGIN + '/sitemaps/videos-1.xml']: () => new Response(map(urls), { headers: { 'content-type': 'application/xml' } }),
    [ORIGIN + '/videos']: () => new Response(page(ORIGIN + '/videos', urls), { headers: { 'content-type': 'text/html' } }),
  });
  const report = await runAudit({ fetchImpl: fake.fetchImpl, wait: noop });
  assert.equal(report.publicAuditStatus, 'success');
  for (const url of urls.slice(0, 2)) assert.equal(report.pages.find(row => row.url === url).warnings.includes('demo_page_needs_editorial_check'), false);
  assert.equal(report.pages.find(row => row.url === urls[2]).warnings.includes('demo_page_needs_editorial_check'), true);
});

test('robots checks respect specific Googlebot groups, longest rules, wildcards and allow overrides', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /watch/', '/watch/review'), true);
  assert.equal(robotsAllows('User-agent: *\nAllow: /\nUser-agent: Googlebot\nDisallow: /watch/', '/watch/review'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /watch/*/private$', '/watch/review/private'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /watch/*/private$', '/watch/review/private-extra'), true);
});

test('service account OAuth assertion is RS256, scoped to Search Console and sent only to the fixed Google endpoint', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = JSON.stringify({ type: 'service_account', client_email: 'deploy@vidbest.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://evil.example/token' });
  const token = await googleAccessToken(secret, { now: 1000000, wait: noop, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.method, 'POST');
    const jwt = options.body.get('assertion');
    const [header, payload, signature] = jwt.split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
    assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
      iss: 'deploy@vidbest.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/webmasters',
      aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600,
    });
    assert.equal(createVerify('RSA-SHA256').update(header + '.' + payload).verify(publicKey, Buffer.from(signature, 'base64url')), true);
    return json({ access_token: 'test-token', token_type: 'Bearer' });
  } });
  assert.equal(token, 'test-token');
});

test('malformed credentials never call Google or reveal secret contents in errors', async () => {
  let called = false;
  await assert.rejects(googleAccessToken('private-sentinel-credential', { fetchImpl: async () => { called = true; } }), error => error.message === 'invalid_service_account_secret' && !error.message.includes('sentinel'));
  assert.equal(called, false);
});

test('Search Console submits one sitemap and reads bounded, paced index statuses without indexing API calls', async () => {
  const calls = [], waits = [], progress = [];
  const urls = Array.from({ length: 205 }, (_, i) => ORIGIN + '/watch/review-' + i);
  const result = await syncSearchConsole(urls, { secret: 'configured-secret-sentinel', now: 0, budget: 5000,
    progress: message => progress.push(message),
    getToken: async () => 'test-token-sentinel', wait: async ms => waits.push(ms),
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method || 'GET' });
      assert.equal(options.headers.Authorization, 'Bearer test-token-sentinel');
      assert.equal(options.redirect, 'manual');
      if (options.method === 'PUT') return new Response(null, { status: 204 });
      if (options.method !== 'POST') return json({ permissionLevel: 'siteFullUser' });
      assert.equal(url, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
      const body = JSON.parse(options.body);
      assert.equal(body.siteUrl, 'sc-domain:vid.best');
      return json({ inspectionResult: { indexStatusResult: {
        verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed',
        userCanonical: body.inspectionUrl, googleCanonical: ORIGIN + '/watch/x?secret=sentinel',
        unexpectedSecret: 'hidden-sentinel', inspectionResultLink: 'https://example.com/?token=sentinel',
      } } });
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.authenticated, true);
  assert.equal(result.propertyVerified, true);
  assert.equal(result.sitemapSubmitted, true);
  assert.equal(result.inspections.length, 200);
  assert.equal(new Set(result.inspections.map(row => row.url)).size, 200);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(waits.filter(ms => ms === 250).length, 200);
  assert.doesNotMatch(JSON.stringify(result), /sentinel/);
  assert.doesNotMatch(progress.join('\n'), /sentinel|Authorization|Bearer|private_key|client_email/);
  assert.ok(progress.includes('Google OAuth authentication succeeded.'));
  assert.ok(progress.includes('Full or Owner Search Console property access verified.'));
  assert.equal(progress.at(-1), 'Google inspections completed: 200/200.');
  assert.equal(result.inspections[0].googleCanonical, 'outside_canonical_public_routes');
  assert.ok(calls.every(call => !call.url.includes('indexing.googleapis.com')));
});

test('Google 429 stops inspections after bounded retries and never reports indexing success', async () => {
  let attempts = 0;
  const result = await syncSearchConsole([ORIGIN + '/watch/a', ORIGIN + '/watch/b'], {
    secret: 'configured', getToken: async () => 'test-token', wait: noop,
    fetchImpl: async (url, options) => {
      if (options.method === 'PUT') return new Response(null, { status: 204 });
      if (options.method === 'POST') { attempts++; return json({ error: 'private-sentinel' }, 429); }
      return json({ permissionLevel: 'siteOwner' });
    },
  });
  assert.equal(attempts, 3);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'inspect_index_status');
  assert.equal(result.error, 'google_inspection_http_429');
  assert.equal(result.inspections.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /sentinel/);
});

test('restricted Search Console property access is rejected before sitemap submission', async () => {
  const result = await syncSearchConsole([ORIGIN + '/watch/a'], { secret: 'configured',
    getToken: async () => 'test-token', wait: noop,
    fetchImpl: async (url, options) => { assert.equal(options.method, undefined); return json({ permissionLevel: 'siteRestrictedUser' }); },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.sitemapSubmitted, false);
  assert.equal(result.error, 'search_console_full_access_required');
});
