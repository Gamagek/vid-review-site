import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the bridge against a media element without requiring provider network access.
function bridgeHarness() {
  const listeners = new Map(), messages = [], handlers = new Map();
  const parent = { postMessage(data) { messages.push(data); } };
  let plays = 0, pauses = 0;
  const video = {
    dataset: {}, readyState: 2, paused: true,
    addEventListener(name, fn) { handlers.set(name, fn); },
    play() { plays++; this.paused = false; return Promise.resolve(); },
    pause() { pauses++; this.paused = true; },
  };
  const stage = { querySelector() { return null; }, querySelectorAll() { return [video]; } };
  const document = {
    body: { dataset: { viewerEmbed: '1', videoProvider: 'raw' } }, baseURI: 'https://example.com/watch/test',
    querySelector() { return stage; },
  };
  runInNewContext(readFileSync(new URL('../public/swipe-player-bridge.js', import.meta.url), 'utf8'), {
    document, parent, URL, MutationObserver: class { observe() {} },
    window: { addEventListener(name, fn) { listeners.set(name, fn); } },
  });
  function command(data, source = parent, origin = 'https://example.com') {
    listeners.get('message')({ source, origin, data: { channel: 'vidbest-viewer', type: 'playback', ...data } });
  }
  return { video, messages, handlers, command, counts: () => ({ plays, pauses }) };
}

test('preparing media buffers without autoplay; only the active card plays and deactivation pauses', () => {
  const h = bridgeHarness();
  assert.equal(h.video.preload, 'auto');
  assert.equal(h.video.autoplay, false);
  assert.equal(h.counts().plays, 0);
  assert.ok(h.messages.some((message) => message.type === 'ready'));
  h.command({ active: true, muted: true });
  assert.equal(h.counts().plays, 1);
  assert.equal(h.video.muted, true);
  h.command({ active: false, paused: true });
  assert.equal(h.video.paused, true);
  h.handlers.get('playing')(); // Late provider autoplay must also be stopped.
  assert.equal(h.video.paused, true);
  assert.equal(h.counts().plays, 1);
});

test('playback bridge rejects other windows/origins and reports ended only for the active card', () => {
  const h = bridgeHarness();
  h.command({ active: true }, {});
  h.command({ active: true }, undefined, 'https://other.example');
  assert.equal(h.counts().plays, 0);
  h.handlers.get('ended')();
  assert.equal(h.messages.filter((message) => message.type === 'ended').length, 0);
  h.command({ active: true, muted: false });
  assert.equal(h.video.muted, false);
  h.handlers.get('ended')();
  assert.equal(h.messages.filter((message) => message.type === 'ended').length, 1);
});
