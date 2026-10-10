import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { containerFailures, readCompose, verifyPreservation } from '../scripts/portainer-safety.mjs';
import { readBackup, writeBackup } from '../scripts/portainer-backup.mjs';

const source = `
services:
  app:
    image: app:reviewed
    volumes: [app-data:/data]
    ports: ['8080:8080']
    healthcheck:
      test: [CMD, true]
  cloudflared:
    image: cloudflare/cloudflared:reviewed
    command: [tunnel, run]
  rapidapi-tester:
    image: tester:reviewed
volumes:
  app-data:
    external: true
    name: existing-app-data
`;
const previous = () => readCompose(source, 'Live');
const inventory = () => ['app', 'cloudflared', 'rapidapi-tester'].map(name => ({
  Labels: { 'com.docker.compose.project': 'video-site', 'com.docker.compose.service': name },
  State: 'running', Status: 'Up (healthy)'
}));

test('reviewed application update preserves live services, storage and management tunnel', () => {
  const old = previous();
  const candidate = structuredClone(old);
  candidate.services.app.image = 'app:next-reviewed';
  assert.deepEqual(verifyPreservation(old, candidate), ['app', 'cloudflared', 'rapidapi-tester']);
});

test('service removal, mount changes, volume renaming and tunnel edits are refused', () => {
  const changes = [
    c => { delete c.services['rapidapi-tester']; },
    c => { c.services.app.volumes = ['replacement:/data']; },
    c => { c.volumes['app-data'].name = 'replacement'; },
    c => { delete c.volumes['app-data']; },
    c => { c.services.cloudflared.image = 'cloudflare/cloudflared:unreviewed'; },
    c => { c.services.cloudflared.command = ['tunnel', 'other']; },
    c => { c.services.app.ports = ['9000:8080']; },
    c => { c.services.app.network_mode = 'host'; },
    c => { c.services.app.deploy = { replicas: 2 }; },
    c => { c.name = 'another-project'; }
  ];
  for (const change of changes) {
    const old = previous();
    const candidate = structuredClone(old);
    change(candidate);
    assert.throws(() => verifyPreservation(old, candidate));
  }
  const old = previous();
  old.services['additional-live-service'] = { image: 'keep-me:1' };
  assert.throws(() => verifyPreservation(old, previous()), /remove an existing service/);
});

test('anonymous persistent volumes require independent review', () => {
  for (const mount of ['/data', { type: 'volume', target: '/data' }]) {
    const old = previous();
    old.services.app.volumes = [mount];
    assert.throws(() => verifyPreservation(old, structuredClone(old)), /Anonymous persistent volume/);
  }
});

test('invalid YAML and duplicate keys are refused without revealing inline secrets', () => {
  for (const input of ['services: [PRIVATE_INLINE_SECRET', 'services:\n  app: {}\n  app: {secret: PRIVATE_INLINE_SECRET}']) {
    assert.throws(() => readCompose(input, 'Live'), error => {
      assert.equal(error.message, 'Live Compose YAML cannot be parsed safely');
      assert.ok(!error.message.includes('PRIVATE_INLINE_SECRET'));
      return true;
    });
  }
});

test('health verification rejects missing, stopped, unhealthy and starting containers', () => {
  const old = previous();
  assert.deepEqual(containerFailures(inventory(), old), []);
  assert.deepEqual(containerFailures(inventory().slice(1), old), ['app:missing']);
  for (const [field, value, reason] of [
    ['State', 'exited', 'not-running'], ['Status', 'Up (unhealthy)', 'unhealthy'],
    ['Status', 'Up (health: starting)', 'not-healthy-yet']
  ]) {
    const containers = inventory();
    containers[0][field] = value;
    assert.deepEqual(containerFailures(containers, old), ['app:' + reason]);
  }
  const oneoff = inventory();
  oneoff[0].Labels['com.docker.compose.oneoff'] = 'true';
  assert.deepEqual(containerFailures(oneoff, old), ['app:missing']);
  const unrelated = inventory();
  unrelated[0].Labels['com.docker.compose.project'] = 'another-project';
  assert.deepEqual(containerFailures(unrelated, old), ['app:missing']);
});

test('health verification checks every replica and every candidate service', () => {
  const old = previous();
  old.services.app.deploy = { replicas: 2 };
  assert.deepEqual(containerFailures(inventory(), old), ['app:missing']);
  const containers = inventory();
  containers.push({ ...containers[0], State: 'exited' });
  assert.deepEqual(containerFailures(containers, old), ['app:not-running']);
  old.services.newservice = { image: 'new:1' };
  assert.ok(containerFailures(containers, old).includes('newservice:missing'));
});

test('encrypted backup preserves YAML and Env without plaintext, and cannot be overwritten', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vidbest-encrypted-backup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'stack.enc.json');
  const data = { yaml: 'PRIVATE_YAML_SECRET', env: [{ name: 'TOKEN', value: 'PRIVATE_ENV_SECRET' }] };
  const key = 'PRIVATE_BACKUP_KEY';
  writeBackup(path, data, key);
  const raw = readFileSync(path, 'utf8');
  for (const secret of [data.yaml, data.env[0].value, key]) assert.ok(!raw.includes(secret));
  assert.deepEqual(readBackup(path, key), data);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => writeBackup(path, data, key), /Cannot create/);
  assert.throws(() => readBackup(path, 'wrong-key'), /failed authentication/);
  const envelope = JSON.parse(raw);
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString('base64');
  writeFileSync(path, JSON.stringify(envelope));
  assert.throws(() => readBackup(path, key), /failed authentication/);
});

test('workflow uploads backup before any deploy and manual read-only runs stay protected', () => {
  const text = readFileSync(new URL('../.github/workflows/portainer-deploy.yml', import.meta.url), 'utf8');
  const workflow = parse(text);
  assert.equal(workflow.on.workflow_dispatch.inputs.read_only.default, true);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.jobs.deploy.needs, ['validate', 'preflight']);
  assert.match(workflow.jobs.deploy.if, /inputs\.read_only == false/);
  const steps = workflow.jobs.deploy.steps;
  const backup = steps.findIndex(step => step.uses === 'actions/upload-artifact@v4');
  const prepare = steps.findIndex(step => step.run === 'node scripts/deploy-portainer.mjs --check-only');
  const deploy = steps.findIndex(step => step.run === 'node scripts/deploy-portainer.mjs --deploy');
  assert.ok(prepare >= 0 && backup > prepare && deploy > backup);
  assert.equal(steps[backup].with['if-no-files-found'], 'error');
  assert.equal(steps[backup].with.path, '${{ env.PORTAINER_BACKUP_FILE }}');
  // Runner-only paths are established by a step after the runner exists.
  const configure = steps.findIndex(step => step.run?.includes('PORTAINER_BACKUP_FILE=$RUNNER_TEMP/'));
  assert.ok(configure >= 0 && configure < prepare);
  const ci = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.ok(ci.jobs.test.steps.some(step => step.run?.includes('actionlint" -shellcheck=')));
});
