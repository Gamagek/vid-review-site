import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProductionHealth } from '../scripts/verify-production-health.mjs';

const okWorker = () => new Response(JSON.stringify({ status: 'ok', service: 'Vid.Best' }), { headers: { 'Content-Type': 'application/json' } });
const okGateway = () => new Response('OK 55-R2-CACHE', { headers: { 'Content-Type': 'text/plain' } });

test('public health uses fixed unauthenticated GET endpoints and verifies both services', async () => {
  const calls = [], replies = [okWorker(), okGateway()], logs = [];
  await checkProductionHealth({ log: line => logs.push(line), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return replies.shift();
  } });
  assert.deepEqual(calls.map(c => c.url), ['https://vid.best/api/health', 'https://video.megasale.win/health']);
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'manual' && !c.options.body));
  assert.equal(logs.filter(l => l.includes('HEALTH PASSED')).length, 2);
});

test('health checks retry a transient failure but never accept an HTML login page', async () => {
  const secret = 'PRIVATE_HEALTH_RESPONSE', logs = [];
  const replies = [new Response(secret, { status: 502 }), okWorker(),
    new Response(secret, { headers: { 'Content-Type': 'text/html' } }),
    new Response(secret, { headers: { 'Content-Type': 'text/html' } })];
  await assert.rejects(checkProductionHealth({ log: line => logs.push(line), wait: async () => {},
    fetchImpl: async () => replies.shift() }), /Video gateway/);
  assert.equal(replies.length, 0);
  assert.ok(!logs.join('\n').includes(secret));
});

test('a failed Worker health still checks the gateway and cannot report full production success', async () => {
  const urls = [];
  await assert.rejects(checkProductionHealth({ log: () => {}, wait: async () => {}, fetchImpl: async url => {
    urls.push(url);
    if (url.includes('vid.best/')) throw new Error('PRIVATE_TRANSPORT_ERROR');
    return okGateway();
  } }), /Vid.Best Worker/);
  assert.equal(urls.filter(url => url.includes('video.megasale.win')).length, 1);
});
