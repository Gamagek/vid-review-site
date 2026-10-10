import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const clientId = 'fake-client.access';
const clientSecret = 'fake-private-service-secret';
const apiKey = 'fake-private-portainer-key';
const fingerprint = createHash('sha256').update(clientId).digest('hex');
const originalEnv = [{ name: 'EXISTING_SECRET', value: 'fake-existing-stack-secret' }];
const baseline = 'services:\n  app:\n    image: previous-reviewed-image\n';
const candidate = readFileSync(join(root, 'ops/portainer/vidbest-v56.yaml'), 'utf8');
const stack = { Id: 27, Name: 'video-site', EndpointId: 3, Type: 2, Env: originalEnv };

function run(t, { args = ['--check-only'], env = {}, responses, health = false, unchanged = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vidbest-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const auditPath = join(dir, 'requests.json');
  const mockPath = join(dir, 'fetch.mjs');
  const mock = `
    import assert from 'node:assert/strict';
    import { writeFileSync } from 'node:fs';
    const audit = [];
    const replies = ${JSON.stringify(responses ?? null)};
    globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
    globalThis.fetch = async (url, options) => {
      assert.equal(url.origin, 'https://portainer.megasale.win');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers['X-API-Key'], ${JSON.stringify(apiKey)});
      assert.equal(options.headers['CF-Access-Client-Id'], ${JSON.stringify(clientId)});
      assert.equal(options.headers['CF-Access-Client-Secret'], ${JSON.stringify(clientSecret)});
      assert.equal(options.headers.Accept, 'application/json');
      audit.push({ method: options.method, path: url.pathname, body: options.body ? JSON.parse(options.body) : null });
      writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify(audit));
      if (replies) {
        const reply = replies[audit.length - 1];
        assert.ok(reply, 'Unexpected additional API request');
        return new Response(reply.body, { status: reply.status ?? 200, headers: reply.headers ?? { 'Content-Type': 'application/json' } });
      }
      let data;
      if (url.pathname === '/api/stacks/27' && options.method === 'GET') data = ${JSON.stringify(stack)};
      else if (url.pathname === '/api/stacks/27/file') data = { StackFileContent: ${JSON.stringify(unchanged ? candidate : baseline)} };
      else if (options.method === 'PUT') data = {};
      else if (url.pathname === '/api/endpoints/3/docker/containers/json') data = ${JSON.stringify(health ? ['app', 'cloudflared', 'rapidapi-tester'].map(service => ({ Labels: { 'com.docker.compose.project': 'video-site', 'com.docker.compose.service': service }, State: 'running', Status: 'Up (healthy)' })) : [])};
      else throw new Error('Unexpected API path');
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    };
  `;
  writeFileSync(mockPath, mock);
  const variables = { ...process.env, PORTAINER_URL: 'https://portainer.megasale.win', PORTAINER_API_KEY: apiKey,
    PORTAINER_STACK_ID: '27', PORTAINER_ENDPOINT_ID: '3', PORTAINER_STACK_FILE: 'ops/portainer/vidbest-v56.yaml',
    CF_ACCESS_CLIENT_ID: clientId, CF_ACCESS_CLIENT_SECRET: clientSecret,
    CF_ACCESS_EXPECTED_CLIENT_ID_SHA256: fingerprint, PORTAINER_AUTO_DEPLOY_ENABLED: 'false', ...env };
  let status = 0;
  let output;
  try {
    output = execFileSync(process.execPath, ['--import', mockPath, 'scripts/deploy-portainer.mjs', ...args],
      { cwd: root, env: variables, encoding: 'utf8', stdio: 'pipe', timeout: 15000 });
  } catch (error) {
    status = error.status;
    output = String(error.stdout) + String(error.stderr);
  }
  const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, 'utf8')) : [];
  for (const secret of [clientId, clientSecret, apiKey, originalEnv[0].value]) assert.ok(!output.includes(secret), 'Credential was logged');
  return { status, output, audit };
}

test('read-only preflight authenticates both GETs and reads stack YAML without any write', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /READ-ONLY PREFLIGHT PASSED/);
  assert.match(result.output, /Client ID identity verified/);
  assert.deepEqual(result.audit.map(x => [x.method, x.path]), [['GET', '/api/stacks/27'], ['GET', '/api/stacks/27/file']]);
});

test('direct invocation defaults to read-only even with the production flag enabled', t => {
  const result = run(t, { args: [], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' } });
  assert.equal(result.status, 0, result.output);
  assert.ok(result.audit.every(x => x.method === 'GET'));
});

test('wrong Client ID or policy UUID fails before sending credentials', t => {
  const result = run(t, { env: { CF_ACCESS_CLIENT_ID: '530a942e-7c6f-4740-96c3-5a029e9e59ab' } });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /credential identity mismatch/);
  assert.match(result.output, /token UUID was supplied instead of a Client ID/);
  assert.equal(result.audit.length, 0);
});

test('protected hostname requires both service-token credentials', t => {
  const result = run(t, { env: { CF_ACCESS_CLIENT_ID: '', CF_ACCESS_CLIENT_SECRET: '' } });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /service token is required/);
  assert.equal(result.audit.length, 0);
});

test('writes require explicit --deploy and the production flag; conflicting modes fail closed', t => {
  for (const args of [['--deploy'], ['--deploy', '--check-only'], ['--unknown']]) {
    const result = run(t, { args });
    assert.notEqual(result.status, 0);
    assert.equal(result.audit.length, 0);
  }
});

test('Access redirect reports status and MIME without following or logging sensitive location/body', t => {
  const sensitive = 'SENSITIVE_QUERY_AND_COOKIE';
  const result = run(t, { responses: [{ status: 302, headers: { 'Content-Type': 'text/html; charset=utf-8',
    Location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login?token=' + sensitive,
    'Set-Cookie': sensitive }, body: sensitive }] });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /HTTP 302; Content-Type: text\/html/);
  assert.match(result.output, /Cloudflare Access login redirect/);
  assert.ok(!result.output.includes(sensitive));
  assert.equal(result.audit.length, 1);
});

test('401, 403, 502 and HTML application shell are safely distinguished', t => {
  for (const status of [401, 403, 502, 200]) {
    const result = run(t, { responses: [{ status, headers: { 'Content-Type': 'text/html' }, body: 'PRIVATE_RESPONSE_BODY' }] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, new RegExp('HTTP ' + status));
    assert.match(result.output, /text\/html/);
    assert.ok(!result.output.includes('PRIVATE_RESPONSE_BODY'));
    assert.equal(result.audit.length, 1);
  }
});

test('malformed and empty JSON never passes preflight or logs response contents', t => {
  for (const body of ['', 'PRIVATE_MALFORMED_JSON']) {
    const result = run(t, { responses: [{ body }] });
    assert.notEqual(result.status, 0);
    assert.ok(!result.output.includes('PRIVATE_MALFORMED_JSON'));
    assert.doesNotMatch(result.output, /PREFLIGHT PASSED/);
  }
});

test('wrong stack identity or missing existing environment prevents further requests', t => {
  for (const change of [{ Id: 28 }, { Name: 'other-stack' }, { EndpointId: 4 }, { Type: 1 }, { Env: undefined }]) {
    const result = run(t, { responses: [{ body: JSON.stringify({ ...stack, ...change }) }] });
    assert.notEqual(result.status, 0);
    assert.equal(result.audit.length, 1);
  }
});

test('unreadable stack source fails before preflight success', t => {
  const result = run(t, { responses: [{ body: JSON.stringify(stack) }, { body: JSON.stringify({ StackFileContent: '' }) }] });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Cannot back up/);
  assert.ok(result.audit.every(x => x.method === 'GET'));
});

test('explicit healthy deployment preserves all existing environment values and disables prune/pull', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, health: true });
  assert.equal(result.status, 0, result.output);
  const writes = result.audit.filter(x => x.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { StackFileContent: candidate, Env: originalEnv, Prune: false, PullImage: false });
});

test('failed health rolls back the previous YAML and environment without deletes', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' } });
  assert.notEqual(result.status, 0);
  const writes = result.audit.filter(x => x.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, { StackFileContent: baseline, Env: originalEnv, Prune: false, PullImage: false });
  assert.ok(result.audit.every(x => ['GET', 'PUT'].includes(x.method)));
});

test('unchanged YAML avoids redeploying running production containers', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, unchanged: true });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /No stack content changes/);
  assert.ok(result.audit.every(x => x.method === 'GET'));
});
