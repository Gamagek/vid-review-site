import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/swipe-player-bridge.js', import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Exercise media lifecycle and browser rejections without provider network access.
function bridgeHarness({ play, provider = 'raw', connection = {} } = {}) {
  const listeners = new Map(), messages = [], handlers = new Map();
  const parent = { postMessage(data) { messages.push(data); } };
  let plays = 0, pauses = 0, bufferEnd = 0;
  const video = {
    dataset: {}, readyState: 2, paused: true, volume: 1, currentTime: 0, duration: 120,
    buffered: { length: 1, start() { return 0; }, end() { return bufferEnd; } },
    addEventListener(name, fn) { handlers.set(name, fn); },
    play() { plays++; if (play) return play(this); this.paused = false; return Promise.resolve(); },
    pause() { pauses++; this.paused = true; },
  };
  const stage = { querySelector() { return null; }, querySelectorAll() { return [video]; } };
  const document = {
    body: { dataset: { viewerEmbed: '1', videoProvider: provider } }, baseURI: 'https://example.com/watch/test',
    querySelector() { return stage; },
  };
  const window = { addEventListener(name, fn) { listeners.set(name, fn); } };
  runInNewContext(source, {
    document, parent, URL, navigator: { connection: { addEventListener() {}, ...connection } }, MutationObserver: class { observe() {} }, window,
  });
  function command(data, source = parent, origin = 'https://example.com') {
    listeners.get('message')({ source, origin, data: { channel: 'vidbest-viewer', type: 'playback', ...data } });
  }
  return { video, messages, handlers, command, window, buffer(end) { bufferEnd = end; }, counts: () => ({ plays, pauses }) };
}

test('preparing media buffers silently; only the active card plays and late hidden playback is stopped', () => {
  const h = bridgeHarness();
  assert.equal(h.video.preload, 'auto');
  assert.equal(h.video.autoplay, false);
  assert.equal(h.counts().plays, 0);
  assert.ok(h.messages.some((message) => message.type === 'ready'));
  h.command({ active: true, muted: false });
  assert.equal(h.counts().plays, 1);
  assert.equal(h.video.muted, false);
  h.command({ active: false, paused: true, muted: false });
  assert.equal(h.video.muted, true);
  assert.equal(h.video.paused, true);
  h.handlers.get('playing')();
  assert.equal(h.video.paused, true);
  assert.equal(h.counts().plays, 1);
});

test('bridge rejects other windows/origins and reports ended only for the active card', () => {
  const h = bridgeHarness();
  h.command({ active: true }, {});
  h.command({ active: true }, undefined, 'https://other.example');
  assert.equal(h.counts().plays, 0);
  h.handlers.get('ended')();
  assert.equal(h.messages.filter((m) => m.type === 'ended').length, 0);
  h.command({ active: true, muted: false });
  h.handlers.get('ended')();
  assert.equal(h.messages.filter((m) => m.type === 'ended').length, 1);
});

test('audible autoplay rejection retries muted once; a real tap can enable sound', async () => {
  let allowSound = false;
  const h = bridgeHarness({ play(video) {
    if (!video.muted && !allowSound) return Promise.reject({ name: 'NotAllowedError' });
    video.paused = false; return Promise.resolve();
  } });
  h.command({ active: true, muted: false });
  await flush();
  assert.equal(h.counts().plays, 2);
  assert.equal(h.video.muted, true);
  assert.equal(h.video.paused, false);
  assert.equal(h.messages.filter((m) => m.type === 'soundblocked').length, 1);
  assert.equal(h.messages.filter((m) => m.type === 'state').at(-1).muted, true);
  // A repeat ready/status update must not repeatedly attempt blocked audible autoplay.
  h.command({ active: true, muted: false });
  await flush();
  assert.equal(h.messages.filter((m) => m.type === 'soundblocked').length, 1);
  allowSound = true;
  h.window.vidbestPlayback({ channel: 'vidbest-viewer', type: 'playback', active: true, muted: false, gesture: true });
  await flush();
  assert.equal(h.video.muted, false);
  assert.equal(h.messages.filter((m) => m.type === 'state').at(-1).muted, false);
});

test('a delayed play rejection after a swipe cannot restart hidden media', async () => {
  let rejectPlay;
  const h = bridgeHarness({ play: () => new Promise((_, reject) => { rejectPlay = reject; }) });
  h.command({ active: true, muted: false });
  h.command({ active: false, paused: true });
  rejectPlay({ name: 'NotAllowedError' });
  await flush();
  assert.equal(h.counts().plays, 1);
  assert.equal(h.video.paused, true);
  assert.equal(h.messages.some((m) => m.type === 'soundblocked'), false);
});

test('compact seeking is bounded, ignores invalid values, and never seeks hidden cards', () => {
  const h = bridgeHarness();
  h.command({ type: 'seek', seconds: 30 });
  assert.equal(h.video.currentTime, 0);
  h.command({ active: true });
  h.command({ type: 'seek', seconds: 500 });
  assert.equal(h.video.currentTime, 120);
  h.command({ type: 'seek', seconds: -10 });
  assert.equal(h.video.currentTime, 0);
  h.command({ type: 'seek', seconds: NaN });
  assert.equal(h.video.currentTime, 0);
  h.command({ type: 'seek', seconds: 32 });
  h.handlers.get('timeupdate')();
  assert.equal(h.messages.filter((m) => m.type === 'progress').at(-1).seconds, 32);
});

function attachHls(h) {
  const events = new Map();
  const hls = {
    levels: [{ height: 144 }, { height: 720 }], currentLevel: 0, config: {}, stops: 0, starts: 0,
    on(name, fn) { events.set(name, fn); }, stopLoad() { this.stops++; }, startLoad() { this.starts++; },
  };
  h.handlers.get('vidbest:hls-ready')({ detail: { hls, events: { FRAG_BUFFERED: 'buffer', LEVEL_SWITCHED: 'quality' } } });
  return { hls, events };
}

test('HLS next-card preparation is low-quality and bounded; active stable playback releases adaptive quality', () => {
  const h = bridgeHarness({ provider: 'hls' }), { hls, events } = attachHls(h);
  assert.equal(hls.autoLevelCapping, 0);
  h.buffer(6); events.get('buffer')();
  assert.equal(hls.stops, 1);
  assert.equal(h.counts().plays, 0);
  h.command({ active: true, muted: false });
  assert.equal(hls.starts, 1);
  assert.equal(hls.autoLevelCapping, 0);
  h.video.currentTime = 3; h.buffer(4); h.handlers.get('timeupdate')();
  assert.equal(hls.autoLevelCapping, 0, 'keep low quality while the buffer is thin');
  h.buffer(10); h.handlers.get('timeupdate')();
  assert.equal(hls.autoLevelCapping, -1, 'let measured-bandwidth ABR choose a better rendition');
});

test('data saver keeps HLS at the lowest rendition and limits next-card buffering', () => {
  const h = bridgeHarness({ provider: 'hls', connection: { saveData: true } }), { hls, events } = attachHls(h);
  h.buffer(2); events.get('buffer')();
  assert.equal(hls.stops, 1);
  h.command({ active: true });
  h.video.currentTime = 3; h.buffer(15); h.handlers.get('timeupdate')();
  assert.equal(hls.autoLevelCapping, 0);
  assert.equal(bridgeHarness({ connection: { effectiveType: '2g' } }).video.preload, 'metadata');
});

test('HLS initialization uses low startup only for swipe documents, with native HLS left to the browser', async () => {
  const watchSource = readFileSync(new URL('../public/watch.js', import.meta.url), 'utf8');
  for (const [viewerEmbed, nativeHls] of [['1', false], ['0', false], ['1', true]]) {
    let config, event;
    const video = { querySelector: () => ({ src: 'https://example.com/master.m3u8' }), canPlayType: () => nativeHls ? 'maybe' : '', dispatchEvent(e) { event = e; } };
    class Hls {
      static isSupported = () => true;
      static Events = { ERROR: 'error' };
      constructor(options) { config = options; }
      on() {} loadSource() {} attachMedia() {}
    }
    const context = { document: { getElementById: () => true, body: { dataset: { viewerEmbed } }, querySelector: (selector) => selector === "#watch-media-video[data-hls='1']" ? video : null, addEventListener() {} }, window: { Hls }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
    runInNewContext(watchSource, context);
    context.initializeHlsPlayback();
    await flush();
    if (nativeHls) { assert.equal(config, undefined); continue; }
    assert.equal(config.startLevel, viewerEmbed === '1' ? 0 : undefined);
    assert.equal(config.maxBufferLength, viewerEmbed === '1' ? 6 : 30);
    assert.equal(event?.type, viewerEmbed === '1' ? 'vidbest:hls-ready' : undefined);
  }
});

test('YouTube uses the official controls, retries blocked sound once, and supplies the compact timeline', () => {
  const messages = [], listeners = new Map();
  let events, poll, muted = true, plays = 0, pauses = 0;
  const parent = { postMessage: (data) => messages.push(data) };
  const player = {
    isMuted: () => muted, getVolume: () => 100, mute() { muted = true; }, unMute() { muted = false; },
    playVideo() { plays++; }, pauseVideo() { pauses++; }, getDuration: () => 360, getCurrentTime: () => 20,
  };
  const window = { addEventListener: (name, fn) => listeners.set(name, fn) };
  const stage = { querySelector: () => ({}), querySelectorAll: () => [] };
  runInNewContext(source, {
    document: { body: { dataset: { viewerEmbed: '1', videoProvider: 'youtube' } }, baseURI: 'https://example.com/watch/test', querySelector: () => stage, createElement: () => ({}), head: { append() {} } },
    navigator: {}, URL, parent, window, MutationObserver: class { observe() {} }, setInterval(fn) { poll = fn; },
    YT: { Player: class { constructor(_frame, options) { events = options.events; return player; } } },
  });
  window.onYouTubeIframeAPIReady(); events.onReady();
  assert.equal(plays, 0);
  window.vidbestPlayback({ channel: 'vidbest-viewer', type: 'playback', active: true, muted: false });
  assert.equal(muted, false); assert.equal(plays, 1);
  events.onAutoplayBlocked();
  assert.equal(muted, true); assert.equal(plays, 2);
  assert.equal(messages.filter((m) => m.type === 'state').at(-1).soundBlocked, true);
  events.onAutoplayBlocked();
  assert.equal(plays, 2, 'do not loop when even muted playback is blocked');
  poll();
  assert.equal(messages.filter((m) => m.type === 'progress').at(-1).duration, 360);
  window.vidbestPlayback({ channel: 'vidbest-viewer', type: 'playback', active: false, paused: true });
  events.onStateChange({ data: 1 });
  assert.ok(pauses >= 2);
});
