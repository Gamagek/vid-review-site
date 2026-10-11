import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortainerClient, readDockerInventory } from '../scripts/portainer-client.mjs';

const base = new URL('https://portainer.megasale.win');
const privateValue = 'PRIVATE_REQUEST_OR_RESPONSE_DETAILS';
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

function harness(t, replies, readOnly = true) {
  const requests = [], logs = [], waits = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    assert.ok(reply, 'Unexpected additional request');
    return reply;
  });
  const api = createPortainerClient({ base, headers: { 'X-API-Key': privateValue }, readOnly,
    log: line => logs.push(line), wait: async ms => { waits.push(ms); } });
  t.after(() => assert.ok(!logs.join('\n').includes(privateValue)));
  return { api, requests, logs, waits };
}

test('bounded GET retry recovers from timeout and resets the request signal', async t => {
  const { api, requests, waits } = harness(t, [new DOMException(privateValue, 'TimeoutError'), json({ Id: 27 })]);
  assert.deepEqual(await api('/api/stacks/27'), { Id: 27 });
  assert.equal(requests.length, 2);
  assert.deepEqual(waits, [2000]);
  assert.notEqual(requests[0].options.signal, requests[1].options.signal);
  assert.ok(requests.every(r => r.options.method === 'GET' && r.options.redirect === 'manual'));
});

test('GET retries transient 502/524 responses and fails closed after three attempts', async t => {
  const { api, requests, logs } = harness(t, [502, 524, 524].map(status =>
    new Response(privateValue, { status, headers: { 'Content-Type': 'text/html' } })));
  await assert.rejects(api('/api/stacks/27'), error => error.httpStatus === 524);
  assert.equal(requests.length, 3);
  assert.ok(logs.some(line => line.includes('HTTP 502')));
  assert.ok(logs.some(line => line.includes('HTTP 524')));
});

test('PUT transport failure and 524 are sent once, even when retries were requested', async t => {
  for (const reply of [new DOMException(privateValue, 'TimeoutError'),
    Object.assign(new TypeError(privateValue), { cause: { code: 'ECONNRESET', message: privateValue } }),
    new Response(privateValue, { status: 524 })]) {
    const { api, requests, waits } = harness(t, [reply], false);
    await assert.rejects(api('/api/stacks/27?endpointId=3', { method: 'PUT', body: {}, retries: 2 }));
    assert.equal(requests.length, 1);
    assert.deepEqual(waits, []);
    t.mock.restoreAll();
  }
});

test('Access auth failures, invalid JSON and TLS failures never retry or reveal private data', async t => {
  for (const reply of [
    new Response(privateValue, { status: 401 }),
    new Response(privateValue, { status: 403 }),
    new Response(privateValue, { status: 302, headers: { Location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login?secret=' + privateValue } }),
    new Response(privateValue, { headers: { 'Content-Type': 'application/json' } }),
    Object.assign(new TypeError(privateValue), { cause: { code: 'CERT_HAS_EXPIRED', message: privateValue } })
  ]) {
    const { api, requests } = harness(t, [reply]);
    await assert.rejects(api('/api/stacks/27'), error => !error.message.includes(privateValue));
    assert.equal(requests.length, 1);
    t.mock.restoreAll();
  }
});

test('response body disconnect is bounded and only GET may retry it', async t => {
  const broken = () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(privateValue)); } }),
    { headers: { 'Content-Type': 'application/json' } });
  const { api, requests } = harness(t, [broken(), json([])]);
  assert.deepEqual(await api('/api/endpoints/3/docker/containers/json'), []);
  assert.equal(requests.length, 2);
  t.mock.restoreAll();
  const write = harness(t, [broken()], false);
  await assert.rejects(write.api('/api/stacks/27', { method: 'PUT', body: {} }), /response body/);
  assert.equal(write.requests.length, 1);
});

test('read-only mode refuses writes and off-origin paths before sending credentials', async t => {
  const { api, requests } = harness(t, []);
  await assert.rejects(api('/api/stacks/27', { method: 'PUT' }), /Read-only mode/);
  await assert.rejects(api('https://untrusted.example/api/stacks/27'), /configured API origin/);
  assert.equal(requests.length, 0);
});

test('snapshot metadata and a working Docker version never substitute for live inventory health', async t => {
  const calls = [], output = [], inventoryError = new Error('Live inventory unavailable');
  t.mock.method(console, 'error', line => output.push(line));
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path.includes('/containers/json')) throw inventoryError;
    if (path === 'api/endpoints/3') return { Id: 3, Status: 1, Snapshots: [{ Time: 1 }] };
    return { ApiVersion: '1.45', MinAPIVersion: '1.24' };
  };
  await assert.rejects(readDockerInventory(api, 3, '/api/endpoints/3/docker/containers/json'), error => error === inventoryError);
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(1).every(c => c.options.retries === 0 && c.options.timeout === 10000));
  assert.match(output.join('\n'), /diagnostic only, not a live health result/);
});
