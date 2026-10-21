import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const ORIGIN = 'https://vid.best';
const allArt = JSON.parse(fs.readFileSync(new URL('../src/review-illustrations.json', import.meta.url)));
const productionQueue = JSON.parse(fs.readFileSync(new URL('../docs/review-image-queue.json', import.meta.url)));
const idsArg = process.argv.find(value => value.startsWith('--ids='));
const latest = process.argv.includes('--batch=latest');
assert.ok(!(idsArg && latest), 'Choose explicit IDs or the latest production batch');
const requested = idsArg ? idsArg.slice(6).split(',').map(Number) : latest
  ? productionQueue.lastImageProductionBatch?.recordIds : null;
assert.ok(!requested || requested.every(id => Number.isSafeInteger(id) && id > 0), 'Use published illustration IDs');
const art = requested ? allArt.filter(item => requested.includes(item.id)) : allArt.slice(-10);
assert.ok(art.length > 0 && art.length <= 10, 'Verify one batch of up to ten illustrations');
assert.ok(!requested || new Set(requested).size === art.length, 'Every requested ID must have a manifest entry');
const headers = {'User-Agent': 'VidBest-SEO-Audit/illustrations-2.0'};
const get = async path => {
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN, 'First-party verification only');
  const response = await fetch(url, {headers, redirect: 'manual', signal: AbortSignal.timeout(20000)});
  assert.equal(response.status, 200, url.pathname);
  return response;
};
const verifyImageBytes = async (path, expected, mime) => {
  const response = await get(path);
  assert.equal(response.headers.get('content-type')?.split(';')[0], mime);
  assert.ok(!/noindex|none/i.test(response.headers.get('x-robots-tag') || ''), 'Image must allow indexing');
  if (response.headers.has('content-length')) assert.equal(Number(response.headers.get('content-length')), expected.bytes);
  const chunks = []; let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > expected.bytes) { await reader.cancel(); throw Error('Oversized asset'); }
    chunks.push(value);
  }
  assert.equal(length, expected.bytes);
  assert.equal(crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), expected.sha256);
};
const locations = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const entryFor = (xml, canonical) => [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)]
  .find(match => match[1].includes('<loc>' + xmlEscape(canonical) + '</loc>'))?.[1];
const hasImage = (xml, canonical, image) => entryFor(xml, canonical)?.includes('<image:loc>' + xmlEscape(image) + '</image:loc>');
const result = {
  checkedAt: new Date().toISOString(), requestedIds: art.map(item => item.id), results: [], failures: [],
  inspectionCalls: 0, sitemapSubmissions: 0, videoProviderRequests: 0, d1Writes: 0,
  limit: 'Live HTTP/hash/HTML/sitemap associations only; no Google indexing, AdSense or source video/audio/playback claim.'
};

try {
  const root = await (await get('/sitemap.xml')).text();
  const imageIndex = await (await get('/image-sitemap.xml')).text();
  const robots = await (await get('/robots.txt')).text();
  assert.ok(!root.includes('<loc>' + ORIGIN + '/image-sitemap.xml</loc>'), 'No nested sitemap indexes');
  assert.ok(robots.includes('Sitemap: ' + ORIGIN + '/image-sitemap.xml'));
  const children = locations(root);
  assert.ok(children.some(url => /\/images-editorial-\d+\.xml$/.test(url)), 'Preserve first-party editorial maps');
  assert.ok(children.some(url => /\/images-source-\d+\.xml$/.test(url)), 'Preserve source image maps');
  const maps = new Map();
  for (const url of [...new Set([...children, ...locations(imageIndex)])]) {
    const body = await (await get(url)).text();
    assert.ok(body.includes('<urlset '), url);
    assert.ok(!body.includes('<sitemapindex'), url);
    maps.set(new URL(url).pathname, body);
  }
  const combined = [...maps].filter(([path]) => /\/images-\d+\.xml$/.test(path)).map(([, body]) => body).join('');
  const editorial = [...maps].filter(([path]) => /\/images-editorial-\d+\.xml$/.test(path)).map(([, body]) => body).join('');
  const source = [...maps].filter(([path]) => /\/images-source-\d+\.xml$/.test(path)).map(([, body]) => body).join('');
  const videos = [...maps].filter(([path]) => /\/videos-\d+\.xml$/.test(path)).map(([, body]) => body).join('');
  result.rootChildren = children;
  result.imageMapPages = [...combined.matchAll(/<url>/g)].length;
  result.imageEntries = [...combined.matchAll(/<image:loc>/g)].length;

  for (const item of art) {
    try {
      await verifyImageBytes(item.path, item, 'image/webp');
      if (item.previousPath) {
        const previous = await fetch(ORIGIN + item.previousPath, {headers, redirect: 'manual', signal: AbortSignal.timeout(20000)});
        assert.equal(previous.status, 301);
        assert.equal(previous.headers.get('location'), ORIGIN + item.path);
        await previous.body?.cancel();
      }
      const canonical = ORIGIN + '/watch/' + item.slug;
      const image = ORIGIN + item.path;
      const html = await (await get(canonical)).text();
      assert.ok(html.includes('src="' + image + '"'));
      assert.ok(html.includes(item.caption));
      if (item.displayWatermark === 'vid.best') {
        assert.ok(html.includes('<span class="watch-review-watermark" aria-hidden="true">vid.best</span>'));
      }
      assert.ok(!/AI[\s-]*generated/i.test(item.alt + item.caption));
      const schema = JSON.parse(html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
      const page = schema['@graph'].find(node => node['@type'] === 'WebPage');
      const video = schema['@graph'].find(node => node['@type'] === 'VideoObject');
      const originalPublished = productionQueue.lastImageProductionBatch?.expectedPublishDates?.[item.id];
      if (originalPublished) assert.equal(page.datePublished, originalPublished, 'Original review publication date');
      assert.equal(page.image.contentUrl, image);
      assert.equal(page.primaryImageOfPage, image);
      assert.ok(!video?.thumbnailUrl?.includes(image));
      assert.ok(html.includes('<meta property="og:image" content="' + image + '">'));
      assert.ok(html.includes('<meta name="twitter:image" content="' + image + '">'));
      assert.ok(hasImage(combined, canonical, image));
      assert.ok(hasImage(editorial, canonical, image));
      assert.ok(hasImage(videos, canonical, image));
      let dualImage = false;
      let sourceCopyVerified = false;
      const sourceImageUrl = item.sourceImage?.path ? ORIGIN + item.sourceImage.path : item.sourceImage?.url;
      if (item.sourceImage) {
        if (item.sourceImage.path) {
          await verifyImageBytes(item.sourceImage.path, item.sourceImage, 'image/jpeg');
          sourceCopyVerified = true;
        }
        const sidebar = html.match(/<aside class="watch-review-images"[\s\S]*?<\/aside>/)?.[0];
        assert.ok(sidebar, 'Both images must be server rendered');
        assert.ok(sidebar.indexOf('data-review-image="source"') < sidebar.indexOf('data-review-image="artwork"'));
        assert.equal((sidebar.match(/<img /g) || []).length, 2);
        assert.ok(sidebar.includes('src="' + sourceImageUrl.replaceAll('&', '&amp;') + '"'));
        assert.ok(sidebar.includes('src="' + image + '"'));
        assert.ok(video.thumbnailUrl.includes(item.sourceImage.url), 'Original source thumbnail preserved');
        assert.ok(hasImage(combined, canonical, sourceImageUrl));
        assert.ok(hasImage(source, canonical, sourceImageUrl));
        assert.ok(hasImage(videos, canonical, sourceImageUrl));
        assert.ok(!hasImage(editorial, canonical, sourceImageUrl));
        assert.ok(!hasImage(source, canonical, image));
        dualImage = true;
      }
      if (item.previewFallbackFrom || item.previewFallbackThumbnailSha256) {
        const payload = await (await get('/api/videos/' + item.slug)).json();
        assert.equal(payload.video.review_preview_url, item.path);
        if (item.previewFallbackThumbnailSha256) assert.equal(payload.video.preview_poster_url, item.path);
      }
      result.results.push({id: item.id, slug: item.slug, assetPath: item.path, status: 200, mime: 'image/webp',
        bytes: item.bytes, sha256: item.sha256, pageAssociation: true, socialMetadataAssociation: true,
        imageSitemapAssociation: true, separatedEditorialAndSourceMaps: true,
        dualImageSourceFirst: dualImage, sourceImage: sourceImageUrl || null,
        sourceCopyVerified, sourceCopySha256: sourceCopyVerified ? item.sourceImage.sha256 : null,
        artworkDisplayWatermark: item.displayWatermark || null,
        videoThumbnailUnchanged: true, datePublished: page.datePublished, dateModified: page.dateModified});
    } catch (error) {
      result.failures.push({id: item.id, error: String(error)});
    }
  }
} catch (error) {
  result.failures.push({stage: 'sitemap-preflight', error: String(error)});
}
result.allPassed = result.failures.length === 0 && result.results.length === art.length;
fs.writeFileSync('review-illustration-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({checkedAt: result.checkedAt, requested: art.length, liveVerified: result.results.length,
  allPassed: result.allPassed, failures: result.failures, inspectionCalls: 0, sitemapSubmissions: 0}));
if (!result.allPassed) process.exitCode = 1;
