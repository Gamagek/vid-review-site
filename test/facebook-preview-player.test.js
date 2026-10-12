import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/facebook-preview-player.js", import.meta.url), "utf8");
function setup() {
  const subscriptions = new Map(), sdkEvents = new Map(), calls = [];
  const frame = {};
  const container = { isConnected: true, children: [], append(host) { this.children.push(host); }, getBoundingClientRect() { return { width: 384 }; } };
  const instance = { mute() { calls.push("mute"); }, unmute() { calls.push("unmute"); }, play() { calls.push("play"); }, pause() { calls.push("pause"); },
    subscribe(event, handler) { subscriptions.set(event, handler); }, unsubscribe(event) { subscriptions.delete(event); } };
  const fb = { XFBML: { parse(node, done) { calls.push("parse"); done(); } },
    Event: { subscribe(name, handler) { sdkEvents.set(name, handler); }, unsubscribe(name) { sdkEvents.delete(name); } } };
  const scope = { document: { createElement() { return { dataset: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, querySelector() { return frame; }, remove() { container.children = container.children.filter(c => c !== this); } }; } },
    window: { FB: fb, setTimeout() { return 1; }, clearTimeout() {} } };
  runInNewContext(source, scope);
  const states = [];
  const controller = scope.window.VidBestFacebookPreview.mount(container, { source: "https://www.facebook.com/reel/123", title: "Real video", onState(value) { states.push(value); } });
  return { container, frame, states, controller, sdkEvents, subscriptions, instance, calls };
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
