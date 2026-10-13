import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/facebook-preview-player.js", import.meta.url), "utf8");
function setup({ autoplay = true } = {}) {
  const subscriptions = new Map(), sdkEvents = new Map(), calls = [];
  const frame = {};
  const container = { isConnected: true, children: [], append(host) { this.children.push(host); }, getBoundingClientRect() { return { width: 384 }; } };
  const instance = { mute() { calls.push("mute"); }, unmute() { calls.push("unmute"); }, play() { calls.push("play"); }, pause() { calls.push("pause"); },
    subscribe(event, handler) { subscriptions.set(event, handler); }, unsubscribe(event) { subscriptions.delete(event); } };
  const fb = { XFBML: { parse(node, done) { calls.push("parse"); done(); } },
    Event: { subscribe(name, handler) { sdkEvents.set(name, handler); }, unsubscribe(name) { sdkEvents.delete(name); } } };
  const timers = new Map(); let serial = 0;
  const scope = { document: { createElement() { return { dataset: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, querySelector() { return frame; }, remove() { container.children = container.children.filter(c => c !== this); } }; } },
    window: { FB: fb, setTimeout(fn, delay) { timers.set(++serial, { fn, delay }); return serial; }, clearTimeout(id) { timers.delete(id); } } };
  runInNewContext(source, scope);
  const states = [];
  const controller = scope.window.VidBestFacebookPreview.mount(container, { source: "https://www.facebook.com/reel/123", title: "Real video", autoplay, onState(value) { states.push(value); } });
  return { container, frame, states, controller, sdkEvents, subscriptions, instance, calls, timers };
}

test("official SDK readiness mutes before playing and reports playback only after startedPlaying", async () => {
  const h = setup();
  await Promise.resolve();
  const host = h.container.children[0];
  assert.equal(host.attributes["data-autoplay"], "true");
  h.sdkEvents.get("xfbml.ready")({ type: "video", id: host.id, instance: h.instance });
  assert.deepEqual(h.calls, ["parse", "mute", "play"]);
  assert.deepEqual(h.states, ["loading", "ready"]);
  h.subscriptions.get("startedPlaying")();
  assert.equal(h.states.at(-1), "playing");
  assert.match(h.frame.allow, /autoplay/);
  h.controller.play({ sound: true });
  assert.deepEqual(h.calls.slice(-2), ["unmute", "play"]);
});

test("teardown pauses, unsubscribes and ignores late SDK messages for removed previews", async () => {
  const h = setup(); await Promise.resolve();
  const ready = h.sdkEvents.get("xfbml.ready"), host = h.container.children[0];
  ready({ type: "video", id: "another-widget", instance: h.instance });
  assert.deepEqual(h.calls, ["parse"]);
  ready({ type: "video", id: host.id, instance: h.instance });
  h.controller.destroy();
  assert.equal(h.calls.at(-1), "pause");
  assert.equal(h.subscriptions.size, 0);
  assert.equal(h.sdkEvents.size, 0);
  assert.equal(h.container.children.length, 0);
  ready({ type: "video", id: host.id, instance: h.instance });
  assert.equal(h.calls.at(-1), "pause");
});

test("a scroll pause before SDK readiness prevents offscreen playback until resumed", async () => {
  const h=setup();
  h.controller.pause();
  await Promise.resolve();
  const host=h.container.children[0];
  h.sdkEvents.get('xfbml.ready')({type:'video',id:host.id,instance:h.instance});
  assert.deepEqual(h.calls,['parse','mute','pause']);
  h.controller.play();
  assert.deepEqual(h.calls.slice(-2),['mute','play']);
});

test("teardown removes SDK event subscription handles", async () => {
  const h=setup();let removals=0;
  h.instance.subscribe=()=>({removeListener(){removals++;}});
  await Promise.resolve();
  const host=h.container.children[0];
  h.sdkEvents.get('xfbml.ready')({type:'video',id:host.id,instance:h.instance});
  h.controller.destroy();
  assert.equal(removals,3);
});

test("a warm official player parses paused and plays only when its tile is selected", async () => {
  const h = setup({ autoplay: false }); await Promise.resolve();
  const host = h.container.children[0];
  assert.equal(host.attributes['data-autoplay'], 'false');
  h.sdkEvents.get('xfbml.ready')({ type: 'video', id: host.id, instance: h.instance });
  assert.deepEqual(h.calls, ['parse', 'mute', 'pause']);
  assert.equal(h.timers.size, 0);
  h.controller.play();
  assert.deepEqual(h.calls.slice(-2), ['mute', 'play']);
  h.subscriptions.get('startedPlaying')();
  assert.equal(h.states.at(-1), 'playing');
  assert.equal(h.timers.size, 0);
});

test("an autoplay deadline reports a tap requirement without inventing playback or destroying the player", async () => {
  const h = setup(); await Promise.resolve();
  const host = h.container.children[0];
  h.sdkEvents.get('xfbml.ready')({ type: 'video', id: host.id, instance: h.instance });
  const watchdog = [...h.timers.values()].find(timer => timer.delay === 9000);
  watchdog.fn();
  assert.equal(h.states.at(-1), 'blocked');
  assert.equal(h.container.children.length, 1);
  assert.equal(h.states.includes('playing'), false);
  h.controller.play({ sound: true });
  h.subscriptions.get('startedPlaying')();
  assert.equal(h.states.at(-1), 'playing');
});

test("late startedPlaying cannot restart an offscreen or paused warm player", async () => {
  const h = setup(); await Promise.resolve();
  const host = h.container.children[0];
  h.sdkEvents.get('xfbml.ready')({ type: 'video', id: host.id, instance: h.instance });
  h.controller.pause();
  h.subscriptions.get('startedPlaying')();
  assert.deepEqual(h.calls.slice(-2), ['mute', 'pause']);
  assert.equal(h.states.includes('playing'), false);
  assert.equal(h.timers.size, 0);
  h.controller.destroy();
  assert.equal(h.timers.size, 0);
});
