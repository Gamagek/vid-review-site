import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackup, writeBackup } from '../scripts/portainer-backup.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const clientId = 'fake-client.access';
const clientSecret = 'fake-private-service-secret';
const apiKey = 'fake-private-portainer-key';
const fingerprint = createHash('sha256').update(clientId).digest('hex');
const originalEnv = [{ name: 'EXISTING_SECRET', value: 'fake-existing-stack-secret' }];
const candidate = readFileSync(join(root, 'ops/portainer/vidbest-v56.yaml'), 'utf8');
const baseline = candidate.replace('APP_VERSION: "56-R2-ADMIN-APPROVED-RAPIDAPI-CACHE"', 'APP_VERSION: "previous-reviewed-version"');
const stack = { Id: 27, Name: 'video-site', EndpointId: 3, Type: 2, Status: 1, Env: originalEnv };
const containers = ['app', 'cloudflared', 'rapidapi-tester'].map(service => ({
  Id: 'existing-' + service, ImageID: 'sha256:reviewed-' + service,
  Labels: { 'com.docker.compose.project': 'video-site', 'com.docker.compose.service': service },
  State: 'running', Status: 'Up (healthy)'
}));

function run(t, { args = ['--check-only'], env = {}, responses, health = true, unchanged = false,
  postUpdateHealth = true, rollbackHealth = true, asyncChecks = 2, updateStatus = 200,
  stuck = false, staleBackup = false, missingBackup = false, cachedImageMismatch = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vidbest-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const auditPath = join(dir, 'requests.json');
  const mockPath = join(dir, 'fetch.mjs');
  const backupPath = join(dir, 'stack.enc.json');
  if (args.includes('--deploy') && !missingBackup) {
    writeBackup(backupPath, { version: 1, stackId: 27, endpointId: 3, name: 'video-site',
      yaml: staleBackup ? 'stale YAML' : (unchanged ? candidate : baseline), env: originalEnv }, apiKey);
  }
  const mock = `
    import assert from 'node:assert/strict';
    import { writeFileSync } from 'node:fs';
    const audit = [];
    const replies = ${JSON.stringify(responses ?? null)};
    let liveYaml = ${JSON.stringify(unchanged ? candidate : baseline)};
    let writes = 0;
    let pending = 0;
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
      if (url.pathname === '/api/stacks/27' && options.method === 'GET') {
        data = { ...${JSON.stringify(stack)}, Status: pending > 0 ? 3 : 1 };
        if (pending > 0) pending--;
      }
      else if (url.pathname === '/api/stacks/27/file') data = { StackFileContent: liveYaml };
      else if (options.method === 'PUT') {
        if (${updateStatus} !== 200) return new Response('PRIVATE_RESPONSE_BODY', {
          status: ${updateStatus}, headers: { 'Content-Type': 'application/json' }
        });
        writes++;
        liveYaml = JSON.parse(options.body).StackFileContent;
        pending = ${stuck} ? Infinity : ${asyncChecks};
        data = {};
      }
      else if (url.pathname === '/api/endpoints/3/docker/containers/json') {
        const healthy = writes === 0 ? ${health} : writes === 1 ? ${postUpdateHealth} : ${rollbackHealth};
        data = healthy ? ${JSON.stringify(containers)} : [];
      }
      else if (url.pathname.startsWith('/api/endpoints/3/docker/images/')) {
        data = { Id: ${JSON.stringify(cachedImageMismatch ? 'sha256:unreviewed' : 'sha256:reviewed-cloudflared')} };
      }
      else throw new Error('Unexpected API path');
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    };
  `;
  writeFileSync(mockPath, mock);
  const variables = { ...process.env, PORTAINER_URL: 'https://portainer.megasale.win', PORTAINER_API_KEY: apiKey,
    PORTAINER_STACK_ID: '27', PORTAINER_ENDPOINT_ID: '3', PORTAINER_STACK_FILE: 'ops/portainer/vidbest-v56.yaml',
    CF_ACCESS_CLIENT_ID: clientId, CF_ACCESS_CLIENT_SECRET: clientSecret,
    CF_ACCESS_EXPECTED_CLIENT_ID_SHA256: fingerprint, PORTAINER_AUTO_DEPLOY_ENABLED: 'false', ...env };
  variables.PORTAINER_BACKUP_FILE = missingBackup ? '' : backupPath;
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
  const backup = existsSync(backupPath) ? readBackup(backupPath, apiKey) : null;
  return { status, output, audit, backup };
}

test('read-only preflight authenticates GETs, saves an encrypted backup and verifies baseline health', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /READ-ONLY PREFLIGHT PASSED/);
  assert.match(result.output, /Client ID identity verified/);
  assert.equal(result.audit.length, 4);
  assert.ok(result.audit.every(x => x.method === 'GET'));
  assert.equal(result.backup.yaml, baseline);
  assert.deepEqual(result.backup.env, originalEnv);
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
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, postUpdateHealth: false });
  assert.notEqual(result.status, 0);
  const writes = result.audit.filter(x => x.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, { StackFileContent: baseline, Env: originalEnv, Prune: false, PullImage: false });
  assert.ok(result.audit.every(x => ['GET', 'PUT'].includes(x.method)));
  assert.match(result.output, /Rollback verified/);
});

test('unchanged YAML avoids redeploying running production containers', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, unchanged: true });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /No stack content changes/);
  assert.ok(result.audit.every(x => x.method === 'GET'));
});

test('asynchronous acceptance waits for Active status before checking containers', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, asyncChecks: 3 });
  assert.equal(result.status, 0, result.output);
  const firstWrite = result.audit.findIndex(x => x.method === 'PUT');
  assert.deepEqual(result.audit.slice(firstWrite + 1, firstWrite + 5).map(x => x.path),
    Array(4).fill('/api/stacks/27'));
  assert.match(result.output, /Deployment verified Active and healthy/);
});

test('409 conflict does not roll back another deployment', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, updateStatus: 409 });
  assert.notEqual(result.status, 0);
  assert.equal(result.audit.filter(x => x.method === 'PUT').length, 1);
  assert.doesNotMatch(result.output, /Rollback verified/);
  assert.ok(!result.output.includes('PRIVATE_RESPONSE_BODY'));
});

test('unresolved asynchronous deployment is never interrupted by concurrent rollback', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, stuck: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.audit.filter(x => x.method === 'PUT').length, 1);
  assert.match(result.output, /Cannot safely submit rollback/);
});

test('failed rollback health is reported as failure rather than a restored stack', t => {
  const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' },
    postUpdateHealth: false, rollbackHealth: false });
  assert.notEqual(result.status, 0);
  assert.equal(result.audit.filter(x => x.method === 'PUT').length, 2);
  assert.match(result.output, /Rollback failed/);
  assert.doesNotMatch(result.output, /Rollback verified/);
});

test('missing or stale backup prevents every production write', t => {
  for (const options of [{ missingBackup: true }, { staleBackup: true }]) {
    const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, ...options });
    assert.notEqual(result.status, 0);
    assert.ok(result.audit.every(x => x.method === 'GET'));
  }
});

test('unhealthy baseline and a cached replacement tunnel image fail before deployment', t => {
  for (const options of [{ health: false }, { cachedImageMismatch: true }]) {
    const result = run(t, { args: ['--deploy'], env: { PORTAINER_AUTO_DEPLOY_ENABLED: 'true' }, ...options });
    assert.notEqual(result.status, 0);
    assert.ok(result.audit.every(x => x.method === 'GET'));
  }
});
