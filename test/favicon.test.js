import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker from '../src/seo-edge.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('legacy favicon has one exact same-site permanent asset redirect, not a wildcard', () => {
  const rules = read('../public/_redirects').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  assert.deepEqual(rules, ['/favicon.ico /favicon.svg 301']);
  assert.match(read('../public/favicon.svg'), /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(read('../public/index.html'), /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
});

for (const method of ['GET', 'HEAD']) {
  test(`Worker preserves the Assets favicon redirect and security headers for ${method} without D1 or R2`, async () => {
    const calls = [];
    const response = await worker.fetch(new Request('https://vid.best/favicon.ico', { method }), {
      ASSETS: { async fetch(request) {
        calls.push({ url: request.url, method: request.method });
        return new Response(null, { status: 301, headers: { Location: '/favicon.svg' } });
      } }
    }, { waitUntil() { assert.fail('Favicon must not schedule background work'); } });
    assert.deepEqual(calls, [{ url: 'https://vid.best/favicon.ico', method }]);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), '/favicon.svg');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(await response.text(), '');
  });
}

test('Worker leaves the SVG and unrelated missing assets to Assets without D1 or R2', async () => {
  for (const path of ['/favicon.svg', '/not-a-real-icon.ico']) {
    const isIcon = path === '/favicon.svg';
    const body = isIcon ? read('../public/favicon.svg') : '';
    const response = await worker.fetch(new Request('https://vid.best' + path), {
      ASSETS: { async fetch(request) {
        assert.equal(new URL(request.url).pathname, path);
        return new Response(body, { status: isIcon ? 200 : 404,
          headers: isIcon ? { 'Content-Type': 'image/svg+xml', ETag: '"brand-asset"' } : {} });
      } }
    }, {});
    assert.equal(response.status, isIcon ? 200 : 404);
    assert.equal(response.headers.get('Location'), null);
    if (isIcon) {
      assert.equal(response.headers.get('Content-Type'), 'image/svg+xml');
      assert.equal(response.headers.get('ETag'), '"brand-asset"');
    }
    assert.equal(await response.text(), body);
  }
});
