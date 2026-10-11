#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targets = [
  { name: 'Vid.Best Worker', url: 'https://vid.best/api/health', json: true },
  { name: 'Video gateway', url: 'https://video.megasale.win/health', json: false }
];

export async function checkProductionHealth({ fetchImpl = globalThis.fetch, log = console.log,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const failures = [];
  for (const target of targets) {
    let healthy = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetchImpl(target.url, { method: 'GET', redirect: 'manual',
          headers: { Accept: target.json ? 'application/json' : 'text/plain' }, signal: AbortSignal.timeout(15000) });
        log('PUBLIC READ-ONLY HEALTH: ' + target.name + ' -> HTTP ' + response.status + '; attempt ' + attempt + '/2');
        if (response.status !== 200) throw new Error('Unexpected HTTP status');
        const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (target.json) {
          if (mime !== 'application/json') throw new Error('Unexpected health MIME');
          const data = await response.json();
          if (data.status !== 'ok' || data.service !== 'Vid.Best') throw new Error('Unexpected health body');
          log('PUBLIC READ-ONLY HEALTH PASSED: Vid.Best Worker');
        } else {
          const body = (await response.text()).trim();
          if (mime !== 'text/plain' || !/^OK [A-Za-z0-9_.-]{1,96}$/.test(body)) throw new Error('Unexpected gateway health body');
          log('PUBLIC READ-ONLY HEALTH PASSED: Video gateway; version=' + body.slice(3));
        }
        healthy = true;
        break;
      } catch {
        // Never expose a response body or a nested fetch error to Actions logs.
        log('PUBLIC READ-ONLY HEALTH UNVERIFIED: ' + target.name + '; attempt ' + attempt + '/2');
        if (attempt === 1) await wait(2000);
      }
    }
    if (!healthy) failures.push(target.name);
  }
  if (failures.length) throw new Error('Public production health not verified: ' + failures.join(', '));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await checkProductionHealth();
}
