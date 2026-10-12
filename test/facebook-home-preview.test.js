import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
function facade({ saveData = false, reducedMotion = false } = {}) {
  function element() {
    return { style: {}, dataset: {}, listeners: new Map(), children: [], attributes: {},
      classList: { add() {}, remove() {} },
      setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(name, fn) { this.listeners.set(name, fn); },
      replaceChildren(...children) { this.children = children; },
      querySelector(selector) { return this.children.find(c => c.className?.split(" ").includes(selector.slice(1))) || null; },
    };
  }
  const surface = element(), fallback = element(), status = element(), media = element();
  const cover = { complete: true, naturalWidth: 384 };
  const card = { isConnected: true, dataset: { videoId: "162", videoProvider: "facebook", videoTitle: "Outdoor challenge", videoSource: "https://www.facebook.com/reel/123?tracking=private", videoThumbnail: "/facebook-previews/tiny.jpg" },
    classList: { add() {}, remove() {} }, getBoundingClientRect() { return { top: 0, bottom: 216 }; },
    querySelector(name) { return { ".tile-media": media, ".preview-surface": surface, ".media-fallback": fallback, ".preview-status": status, ".tile-media > img": cover }[name] || null; } };
  const timers = new Map(); let nextTimer = 0;
  const scope = { document: { hidden: false, addEventListener() {}, querySelectorAll() { return [card]; }, createElement: element },
    window: { innerHeight: 800, setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); } },
    navigator: { connection: { saveData } }, matchMedia() { return { matches: reducedMotion }; }, URL, URLSearchParams, location: { origin: "https://vid.best" } };
  runInNewContext(source + "\nthis.testState = previewState;", scope);
  scope.mountFacebookFacade(card);
  return { surface, fallback, status, card, scope, timers };
}

test("Facebook poster appears immediately; a visible tile starts its muted official player without a tap", () => {
  const h = facade();
  assert.equal(h.surface.children[0].src, "/facebook-previews/tiny.jpg");
  assert.equal(h.surface.children[0].width, 384);
  assert.equal(h.fallback.hidden, true);
  h.scope.handleVisibility([{ target: h.card, isIntersecting: true, intersectionRatio: 0.9 }]);
  assert.equal(h.timers.size, 1);
  [...h.timers.values()][0]();
  const iframe = h.surface.children[0], url = new URL(iframe.src);
  assert.equal(url.hostname, "www.facebook.com");
  assert.equal(url.searchParams.get("autoplay"), "true");
  assert.equal(url.searchParams.get("muted"), "true");
  assert.equal(url.searchParams.get("href"), "https://www.facebook.com/reel/123");
  assert.equal(h.card.dataset.facebookPlayerMounted, "1");
  assert.equal(h.scope.testState.activeCard, h.card);
});

test("scrolling out destroys the Facebook player and restores its instant poster, ready for re-entry", () => {
  const h = facade();
  h.scope.mountFacebookDirectPlayer(h.card);
  h.scope.handleVisibility([{ target: h.card, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(h.card.dataset.facebookPlayerMounted, undefined);
  assert.equal(h.scope.testState.activeCard, null);
  assert.equal(h.surface.children[0].src, "/facebook-previews/tiny.jpg");
  h.scope.mountFacebookDirectPlayer(h.card);
  assert.equal(h.card.dataset.facebookPlayerMounted, "1");
});

test("Data Saver and reduced motion retain posters and allow explicit playback", () => {
  for (const options of [{ saveData: true }, { reducedMotion: true }]) {
    const h = facade(options);
    h.scope.handleVisibility([{ target: h.card, isIntersecting: true, intersectionRatio: 1 }]);
    assert.equal(h.timers.size, 0);
    h.surface.children[1].listeners.get("click")({ preventDefault() {}, stopPropagation() {} });
    assert.equal(h.card.dataset.facebookPlayerMounted, "1");
  }
});

test("an unavailable Facebook poster leaves the provider fallback visible instead of a blank cover", () => {
  const h = facade(), poster = h.surface.children[0];
  poster.listeners.get("error")();
  assert.equal(poster.hidden, true);
  assert.equal(h.fallback.hidden, false);
  assert.equal(h.surface.style.background, "transparent");
});

test("Facebook tiles are observed and unsafe non-HTTPS sources cannot become players", () => {
  const h = facade(); let observed;
  h.scope.testState.observer = { observe(card) { observed = card; } };
  h.scope.decorateVideoCards();
  assert.equal(observed, h.card);
  assert.equal(h.scope.safeFacebookDirectEmbed("", "http://www.facebook.com/reel/123"), "");
  assert.equal(h.scope.safeFacebookDirectEmbed("", "https://facebook.com.evil.test/reel/123"), "");
});
