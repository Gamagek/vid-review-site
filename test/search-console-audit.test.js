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

test('public SEO crawler safely traverses the new image sitemap index and child pages', async () => {
  const imageIndex = ORIGIN + '/image-sitemap.xml';
  const child = ORIGIN + '/sitemaps/images-1.xml';
  const root = '<sitemapindex xmlns="' + NS + '"><sitemap><loc>' + ORIGIN + '/sitemaps/pages.xml</loc></sitemap><sitemap><loc>' + ORIGIN + '/sitemaps/videos-1.xml</loc></sitemap><sitemap><loc>' + imageIndex + '</loc></sitemap></sitemapindex>';
  const fake = publicSite({
    [ORIGIN + '/sitemap.xml']: () => new Response(root, { headers: { 'content-type': 'application/xml' } }),
    [imageIndex]: () => new Response('<sitemapindex xmlns="' + NS + '"><sitemap><loc>' + child + '</loc></sitemap></sitemapindex>', { headers: { 'content-type': 'application/xml' } }),
    [child]: () => new Response('<urlset xmlns="' + NS + '" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>' + ORIGIN + '/watch/review-1</loc><image:image><image:loc>' + ORIGIN + '/review-covers/valid.webp</image:loc></image:image></url></urlset>', { headers: { 'content-type': 'application/xml' } }),
  });
  const report = await runAudit({ fetchImpl: fake.fetchImpl, wait: noop });
  assert.equal(publicUrl(imageIndex), imageIndex);
  assert.equal(publicUrl(child), child);
  for (const url of [imageIndex, child]) {
    assert.throws(() => publicUrl(url + '?token=private'), /unsafe_public_url/);
    assert.throws(() => publicUrl(url + '#secret'), /unsafe_public_url/);
  }
  assert.equal(report.publicAuditStatus, 'success');
  assert.equal(report.discoveredReviewCount, 2, 'sitemap image entry does not create a duplicate review');
  assert.ok(report.sitemaps.some(row => row.url === imageIndex));
  assert.ok(report.sitemaps.some(row => row.url === child));
  assert.equal(report.searchConsole.status, 'not_configured');
  assert.equal(report.productionWrites, false);
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

test('public trust pages in the deployed pages sitemap are audited without widening private-route access', async () => {
  const trustPages = ['/about', '/editorial', '/contact'].map(path => ORIGIN + path);
  const fake = publicSite({
    [ORIGIN + '/sitemaps/pages.xml']: () => new Response(map([ORIGIN + '/', ORIGIN + '/videos', ...trustPages]), { headers: { 'content-type': 'application/xml' } }),
  });
  const report = await runAudit({ fetchImpl: fake.fetchImpl, wait: noop });
  assert.equal(report.publicAuditStatus, 'success');
  assert.equal(report.discoveredReviewCount, 2);
  assert.equal(report.pages.length, 8);
  for (const url of trustPages) {
    assert.equal(publicUrl(url), url);
    const checked = report.pages.find(row => row.url === url);
    assert.deepEqual(checked.errors, []);
    assert.equal(checked.headStatus, 200);
    assert.equal(checked.getStatus, 200);
    assert.equal(checked.canonical, url);
    for (const suffix of ['/admin', '?token=private', '#private']) {
      assert.throws(() => publicUrl(url + suffix), /unsafe_public_url/);
    }
  }
  assert.ok(fake.calls.every(call => ['GET', 'HEAD'].includes(call.method)));
  assert.equal(report.productionWrites, false);
  assert.equal(report.searchConsole.status, 'not_configured');
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


test('Google sitemap acceptance and actual processing are reported separately without response secrets', async () => {
  const result = await syncSearchConsole([], {secret:'configured',getToken:async()=>'private-token',wait:noop,
    fetchImpl:async (url,options)=>{
      if(options.method==='PUT')return new Response(null,{status:204});
      if(url.includes('/sitemaps/'))return json({path:ORIGIN+'/sitemap.xml',isPending:true,lastDownloaded:'2026-10-11T12:00:00Z',errors:'2',warnings:'0',privateData:'private-sentinel',contents:[{private:'private-sentinel'}]});
      return json({permissionLevel:'siteOwner'});
    }});
  assert.equal(result.sitemapSubmitted,true);
  assert.deepEqual(result.sitemapProcessing,{status:'verified',isPending:true,lastDownloaded:'2026-10-11T12:00:00Z',errors:2,warnings:0});
  assert.doesNotMatch(JSON.stringify(result),/private-sentinel|private-token/);
});

test('unavailable sitemap processing status remains unverified rather than falsely reporting zero errors',async()=>{
  const result=await syncSearchConsole([],{secret:'configured',getToken:async()=>'test-token',wait:noop,
    fetchImpl:async(url,options)=>options.method==='PUT'?new Response(null,{status:204}):url.includes('/sitemaps/')?json({private:'hidden-sentinel'},404):json({permissionLevel:'siteOwner'})});
  assert.equal(result.status,'success');
  assert.equal(result.sitemapSubmitted,true);
  assert.deepEqual(result.sitemapProcessing,{status:'not_verified',error:'google_sitemap_status_http_404'});
  assert.doesNotMatch(JSON.stringify(result),/hidden-sentinel/);
});


test('discovered review sitemap can be submitted directly with zero URL inspections',async()=>{
  const calls=[];const child=ORIGIN+'/sitemaps/videos-1.xml';
  const result=await syncSearchConsole([ORIGIN+'/watch/a'],{secret:'configured',budget:0,reviewSitemaps:[child,child],getToken:async()=>'test-token',wait:noop,
    fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method||'GET'});
      if(options.method==='PUT')return new Response(null,{status:204});
      if(url.includes('/sitemaps/'))return json({path:decodeURIComponent(url.split('/sitemaps/')[1]),isPending:true,errors:'0',warnings:'0'});
      return json({permissionLevel:'siteOwner'});
    }});
  assert.equal(result.status,'success');assert.equal(result.inspections.length,0);
  assert.equal(result.inspectionBudget,0);assert.equal(result.reviewSitemaps.length,1);
  assert.equal(result.reviewSitemaps[0].submitted,true);assert.equal(result.reviewSitemaps[0].processing.isPending,true);
  assert.equal(calls.filter(x=>x.method==='PUT').length,2);
  assert.ok(calls.every(x=>!x.url.includes('urlInspection')&&!x.url.includes('indexing.googleapis')));
});

test('private or unrelated sitemap targets are rejected before Google authentication',async()=>{
  for(const url of ['https://outside.example/sitemaps/videos-1.xml',ORIGIN+'/api/private',ORIGIN+'/sitemaps/videos-1.xml?secret=sentinel']){
    let authenticated=false;
    const result=await syncSearchConsole([],{secret:'configured',reviewSitemaps:[url],getToken:async()=>{authenticated=true;throw Error('must not authenticate')},wait:noop});
    assert.equal(authenticated,false);assert.equal(result.status,'failed');assert.doesNotMatch(JSON.stringify(result),/sentinel/);
  }
});

test('diagnostics read root and review processing without changing submissions or spending inspection quota', async () => {
  const calls = [], progress = [];
  const child = ORIGIN + '/sitemaps/videos-1.xml';
  const result = await syncSearchConsole([ORIGIN + '/watch/a'], {
    secret: 'configured', budget: 0, submitSitemaps: false, reviewSitemaps: [child, child],
    getToken: async () => 'private-token-sentinel', wait: noop, progress: message => progress.push(message),
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method || 'GET' });
      assert.equal(options.method, undefined);
      if (!url.includes('/sitemaps/')) return json({ permissionLevel: 'siteOwner' });
      return json({ path: decodeURIComponent(url.split('/sitemaps/')[1]), isPending: false,
        lastSubmitted: '2026-10-14T05:59:57.224Z', lastDownloaded: '2026-10-14T06:00:00Z',
        errors: '0', warnings: '0', contents: [{ indexed: 'private-sentinel' }] });
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.sitemapMode, 'read_only');
  assert.equal(result.sitemapSubmitted, false);
  assert.equal(result.sitemapProcessing.isPending, false);
  assert.equal(result.sitemapProcessing.lastSubmitted, '2026-10-14T05:59:57.224Z');
  assert.equal(result.reviewSitemaps.length, 1);
  assert.equal(result.reviewSitemaps[0].submitted, false);
  assert.equal(result.inspectionBudget, 0);
  assert.deepEqual(result.inspections, []);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.method === 'GET' && !call.url.includes('urlInspection') && !call.url.includes('indexing.googleapis')));
  assert.doesNotMatch(JSON.stringify(result) + progress.join('\n'), /private-sentinel|private-token-sentinel|accepted by Google/);
  const text = summary({ publicAuditStatus: 'success', pages: [], errors: [], searchConsole: result });
  assert.match(text, /Google sitemap mode: read_only/);
  assert.match(text, /Sitemap submitted to Google: false/);
  assert.match(text, /Review sitemap status checks: 1; submitted: 0/);
  assert.match(text, /indexed status: not rechecked in this run/);
  assert.doesNotMatch(text, /PASS:|PASS within|Stored Google coverage:/);
});

test('an unregistered diagnostic sitemap stays unverified without a fallback submission', async () => {
  const methods = [];
  const result = await syncSearchConsole([], {
    secret: 'configured', budget: 0, submitSitemaps: false,
    reviewSitemaps: [ORIGIN + '/sitemaps/videos-1.xml'], getToken: async () => 'test-token', wait: noop,
    fetchImpl: async (url, options) => {
      methods.push(options.method || 'GET');
      return url.includes('/sitemaps/') ? json({ private: 'private-sentinel' }, 404) : json({ permissionLevel: 'siteFullUser' });
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.sitemapSubmitted, false);
  for (const state of [result.sitemapProcessing, result.reviewSitemaps[0].processing]) {
    assert.deepEqual(state, { status: 'not_verified', error: 'google_sitemap_status_http_404' });
    assert.equal(state.errors, undefined);
  }
  assert.ok(methods.every(method => method === 'GET'));
  assert.doesNotMatch(JSON.stringify(result), /private-sentinel/);
});

test('invalid submission mode fails before credentials or Google calls and never leaks input', async () => {
  for (const submitSitemaps of [null, 1, 'false', 'private-sentinel']) {
    let called = false;
    const result = await syncSearchConsole([], {
      secret: 'configured', submitSitemaps, getToken: async () => { called = true; },
      fetchImpl: async () => { called = true; }, wait: noop,
    });
    assert.equal(called, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'invalid_sitemap_submission_mode');
    assert.equal(result.sitemapSubmitted, false);
    assert.doesNotMatch(JSON.stringify(result), /private-sentinel/);
  }
});

test('stored URL Inspection reads can run independently of sitemap submission', async () => {
  const methods = [], review = ORIGIN + '/watch/a';
  const result = await syncSearchConsole([review], {
    secret: 'configured', budget: 1, submitSitemaps: false, getToken: async () => 'test-token', wait: noop,
    fetchImpl: async (url, options) => {
      methods.push(options.method || 'GET');
      if (options.method === 'POST') {
        assert.equal(url, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
        assert.equal(JSON.parse(options.body).inspectionUrl, review);
        return json({ inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' } } });
      }
      return url.includes('/sitemaps/') ? json({ path: ORIGIN + '/sitemap.xml', isPending: false }) : json({ permissionLevel: 'siteOwner' });
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.sitemapSubmitted, false);
  assert.equal(result.inspections.length, 1);
  assert.equal(result.inspections[0].url, review);
  assert.deepEqual(methods, ['GET', 'GET', 'POST']);
});

test('the complete public audit forwards diagnostic mode while keeping authentication out of public requests', async () => {
  const publicFake = publicSite(), googleMethods = [];
  const report = await runAudit({
    secret: 'configured', budget: 0, submitSitemaps: false, getToken: async () => 'test-token', wait: noop,
    fetchImpl: async (url, options) => {
      if (url.startsWith(ORIGIN + '/')) return publicFake.fetchImpl(url, options);
      googleMethods.push(options.method || 'GET');
      return url.includes('/sitemaps/') ? json({ path: decodeURIComponent(url.split('/sitemaps/')[1]), isPending: false }) : json({ permissionLevel: 'siteOwner' });
    },
  });
  assert.equal(report.publicAuditStatus, 'success');
  assert.equal(report.searchConsole.status, 'success');
  assert.equal(report.searchConsole.sitemapMode, 'read_only');
  assert.equal(report.searchConsole.sitemapSubmitted, false);
  assert.equal(report.searchConsole.reviewSitemaps[0].submitted, false);
  assert.ok(publicFake.calls.every(call => ['GET', 'HEAD'].includes(call.method)));
  assert.ok(googleMethods.every(method => method === 'GET'));
  assert.equal(report.productionWrites, false);
});

test('zero inspections never become a zero indexed count, including missing credentials and failures', () => {
  for (const status of ['success', 'not_configured', 'skipped_public_audit_failed', 'failed', undefined]) {
    const text = summary({ publicAuditStatus: 'success', pages: [], errors: [],
      searchConsole: status ? { status, inspections: [], totalReviews: 190, inspectionBudget: 0 } : undefined });
    assert.match(text, /Stored Google index inspections: 0; indexed status: not rechecked in this run/);
    assert.doesNotMatch(text, /PASS:|PASS within|Stored Google coverage:|Inspected review coverage:/);
  }
});

test('inspection summaries separate a complete review set from partial, failed or historical samples', () => {
  const inspections = [
    { verdict: 'PASS', lastCrawlTime: '2026-10-15T12:00:00Z', sitemap: [ORIGIN + '/sitemaps/videos-1.xml'], referringUrls: [ORIGIN + '/videos'] },
    { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' },
  ];
  for (const [status, totalReviews, scope] of [
    ['success', 2, 'complete review set at report time'], ['success', 190, 'partial or unknown review set'],
    ['failed', 2, 'partial or unknown review set'], ['success', undefined, 'partial or unknown review set'],
  ]) {
    const text = summary({ publicAuditStatus: 'success', pages: [], errors: [], generatedAt: '2026-10-15T09:28:11.597Z',
      searchConsole: { status, inspections, totalReviews } });
    assert.match(text, /Report generated: 2026-10-15T09:28:11.597Z/);
    assert.match(text, /Stored Google index inspections: 2; PASS within inspected URLs: 1/);
    assert.ok(text.includes(scope + '; not a site-wide indexed-page count'));
    assert.match(text, /lastCrawlTime recorded: 1; public sitemap association retained: 1; public referring URL retained: 1/);
    assert.match(text, /absent hints do not prove no discovery or crawl/);
  }
});

async function storedDiscoveryFixture(state) {
  const calls = [];
  const result = await syncSearchConsole([ORIGIN + '/watch/a'], {
    secret: 'configured', budget: 1, submitSitemaps: false, getToken: async () => 'private-token-sentinel', wait: noop,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method || 'GET' });
      if (options.method === 'POST') return json({ inspectionResult: { indexStatusResult: state } });
      return url.includes('/sitemaps/') ? json({ path: ORIGIN + '/sitemap.xml', isPending: false }) : json({ permissionLevel: 'siteOwner' });
    },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map(x => x.method), ['GET', 'GET', 'POST']);
  assert.equal(calls.at(-1).url, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
  return result;
}

test('stored Inspection retains supported public discovery hints without fetching them or leaking private URLs', async () => {
  const result = await storedDiscoveryFixture({ verdict: 'NEUTRAL', crawledAs: 'MOBILE',
    sitemap: [ORIGIN + '/sitemaps/videos-1.xml', ORIGIN + '/sitemaps/videos-1.xml', ORIGIN + '/watch/not-a-sitemap',
      ORIGIN + '/sitemap.xml?sig=private-sentinel', 'https://external.example/sitemap.xml', '/sitemap.xml'],
    referringUrls: [ORIGIN + '/', ORIGIN + '/videos', ORIGIN + '/videos', ORIGIN + '/watch/public-review',
      ORIGIN + '/api/account/verify?token=private-sentinel', ORIGIN + '/admin',
      'https://user:private-sentinel@vid.best/watch/a', 'https://external.example/watch/private-sentinel',
      ORIGIN + '/watch/a?sig=private-sentinel', ORIGIN + '/watch/a#private-sentinel', null, 42],
  });
  assert.equal(result.inspections[0].crawledAs, 'MOBILE');
  assert.deepEqual(result.inspections[0].sitemap, [ORIGIN + '/sitemaps/videos-1.xml']);
  assert.deepEqual(result.inspections[0].referringUrls, [ORIGIN + '/', ORIGIN + '/videos', ORIGIN + '/watch/public-review']);
  assert.doesNotMatch(JSON.stringify(result), /private-sentinel|external\.example|private-token/);
  assert.equal(result.inspections[0].lastCrawlTime, undefined);
});

test('discovery hints remain bounded and deduplicated rather than expanding report or request budgets', async () => {
  const result = await storedDiscoveryFixture({ crawledAs: 'DESKTOP',
    sitemap: Array.from({ length: 150 }, (_, i) => ORIGIN + '/sitemaps/videos-' + (i + 1) + '.xml'),
    referringUrls: Array.from({ length: 150 }, (_, i) => ORIGIN + '/watch/review-' + i),
  });
  assert.equal(result.inspections[0].crawledAs, 'DESKTOP');
  assert.equal(result.inspections[0].sitemap.length, 20);
  assert.equal(result.inspections[0].referringUrls.length, 20);
  assert.equal(result.inspectionBudget, 1);
  assert.equal(result.sitemapSubmitted, false);
});

test('missing or malformed Google discovery fields are not invented as evidence', async () => {
  for (const state of [{ verdict: 'NEUTRAL' }, { crawledAs: 'private-sentinel', sitemap: 'private-sentinel', referringUrls: {} }]) {
    const result = await storedDiscoveryFixture(state);
    for (const key of ['crawledAs', 'sitemap', 'referringUrls', 'lastCrawlTime']) assert.equal(Object.hasOwn(result.inspections[0], key), false);
    assert.doesNotMatch(JSON.stringify(result), /private-sentinel/);
  }
});
