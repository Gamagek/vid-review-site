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
    querySelector(name) { return { ".tile-media": media, ".preview-surface": surface, ".media-fallback": fallback, ".preview-status": status, ".tile-media > img": cover }[name] || surface.querySelector(name); } };
  media.closest = () => card;
  const cards = [card], timers = new Map(), timerDelays = new Map(); let nextTimer = 0;
  const scope = { document: { hidden: false, addEventListener() {}, querySelectorAll() { return cards; }, createElement: element },
    window: { innerHeight: 800, setTimeout(fn, delay) { timers.set(++nextTimer, fn); timerDelays.set(nextTimer, delay); return nextTimer; }, clearTimeout(id) { timers.delete(id); timerDelays.delete(id); } },
    navigator: { connection: { saveData } }, matchMedia() { return { matches: reducedMotion }; }, URL, URLSearchParams, location: { origin: "https://vid.best" } };
  runInNewContext(source + "\nthis.testState = previewState;", scope);
  scope.mountFacebookFacade(card);
  function addCard(id = "163") {
    const nextSurface = element(), nextMedia = element(), nextStatus = element(), nextFallback = element();
    const next = { ...card, dataset: { ...card.dataset, videoId: id, videoSource: "https://www.facebook.com/reel/" + id },
      querySelector(name) { return { ".tile-media": nextMedia, ".preview-surface": nextSurface, ".media-fallback": nextFallback, ".preview-status": nextStatus, ".tile-media > img": cover }[name] || nextSurface.querySelector(name); } };
    delete next.dataset.previewReady;
    delete next.dataset.facebookPlayerMounted;
    delete next.dataset.facebookSurfaceBound;
    nextMedia.closest = () => next;
    cards.push(next);
    scope.mountFacebookFacade(next);
    return { card: next, surface: nextSurface, media: nextMedia, status: nextStatus };
  }
  function runTimer(delay) {
    const id = [...timerDelays].find(([id, ms]) => ms === delay && timers.has(id))?.[0];
    assert.ok(id, "expected timer " + delay);
    const fn = timers.get(id); timers.delete(id); timerDelays.delete(id); fn();
  }
  return { surface, fallback, status, media, card, scope, timers, timerDelays, addCard, runTimer };
}

function installSdk(h) {
  const mounts = [], callbacks = new Map();
  h.scope.window.VidBestFacebookPreview = {
    preload() {},
    mount(surface, options) {
      const host = h.scope.document.createElement('div'); host.className = 'facebook-sdk-player'; surface.children.push(host);
      const controller = { plays: 0, pauses: 0, destroyed: false, play() { this.plays++; }, pause() { this.pauses++; }, destroy() { this.destroyed = true; surface.children = surface.children.filter(node => node !== host); } };
      mounts.push({ surface, options, controller, host }); callbacks.set(surface, options.onState);
      return controller;
    },
  };
  return { mounts, callbacks };
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

test("a visible Facebook tile starts before a neighbouring YouTube preview", () => {
  const h = facade();
  const status = { textContent: "" };
  const youtube = {
    isConnected: true,
    dataset: {
      videoProvider: "youtube",
      videoEmbed: "https://www.youtube-nocookie.com/embed/example",
    },
    classList: { add() {}, remove() {} },
    querySelector(selector) { return selector === ".preview-status" ? status : null; },
  };
  h.scope.testState.visibility.set(youtube, 0.95);
  h.scope.testState.visibility.set(h.card, 0.75);
  h.scope.chooseVisibleCandidate();
  assert.equal(h.scope.testState.candidateCard, h.card);
  assert.equal(h.timers.size, 1);
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
  assert.equal(observed, h.media);
  h.scope.handleVisibility([{ target: h.media, isIntersecting: true, intersectionRatio: 0.9 }]);
  assert.equal(h.scope.testState.candidateCard, h.card);
  assert.equal(h.scope.safeFacebookDirectEmbed("", "http://www.facebook.com/reel/123"), "");
  assert.equal(h.scope.safeFacebookDirectEmbed("", "https://facebook.com.evil.test/reel/123"), "");
});

test("Facebook watch and permalink links keep their identity when tracking is removed", () => {
  const h = facade();
  for (const input of ["https://www.facebook.com/watch/?v=123&fbclid=tracking", "https://www.facebook.com/permalink.php?story_fbid=456&id=789&rdid=tracking"]) {
    for (const embed of ["", "https://www.facebook.com/plugins/video.php?href=" + encodeURIComponent(input)]) {
      const player = new URL(h.scope.safeFacebookDirectEmbed(embed, input));
      const href = new URL(player.searchParams.get("href"));
      assert.equal(href.searchParams.get("fbclid"), null);
      assert.equal(href.searchParams.get("rdid"), null);
      if (href.pathname === "/watch/") assert.equal(href.searchParams.get("v"), "123");
      else {
        assert.equal(href.searchParams.get("story_fbid"), "456");
        assert.equal(href.searchParams.get("id"), "789");
      }
    }
  }
});

test("Facebook readiness preserves the poster until playback and re-entry reuses the same official player", () => {
  const h=facade();
  let mounts=0, plays=0, pauses=0, callback;
  h.scope.window.VidBestFacebookPreview={mount(surface,options){
    mounts++; callback=options.onState;
    const host=h.scope.document.createElement('div');host.className='facebook-sdk-player';surface.children.push(host);
    return {play(){plays++;},pause(){pauses++;},destroy(){throw Error('Scrolling alone must not destroy a reusable player');}};
  }};
  const poster=h.surface.children[0];
  h.scope.mountFacebookDirectPlayer(h.card);
  callback('ready');
  assert.notEqual(poster.hidden,true);
  callback('playing');
  assert.equal(poster.hidden,true);
  h.scope.stopPreview(h.card);
  assert.equal(pauses,1);
  assert.equal(poster.hidden,false);
  h.scope.mountFacebookDirectPlayer(h.card);
  assert.equal(mounts,1);
  assert.equal(plays,1);
  callback('playing');
  assert.equal(poster.hidden,true);
});

test("equal viewport notifications cannot steal a focused Facebook player while it is loading", () => {
  const h = facade(), second = h.addCard(); installSdk(h);
  h.scope.decorateVideoCards();
  h.scope.handleVisibility([{ target: h.media, isIntersecting: true, intersectionRatio: 0.9 }, { target: second.media, isIntersecting: true, intersectionRatio: 0.9 }]);
  h.runTimer(0);
  second.media.listeners.get('focusin')(); h.runTimer(0);
  h.scope.chooseVisibleCandidate();
  assert.equal(h.scope.testState.activeCard, second.card);
  assert.equal(h.scope.testState.candidateCard, null);
  assert.equal(h.scope.testState.facebookRotationTimer, null);
});

test("hover warms and starts the requested tile instead of the first equally visible card", () => {
  const h = facade(), second = h.addCard(); const sdk = installSdk(h);
  h.scope.decorateVideoCards();
  h.scope.handleVisibility([{ target: h.media, isIntersecting: true, intersectionRatio: 1 }, { target: second.media, isIntersecting: true, intersectionRatio: 1 }]); h.runTimer(0);
  sdk.callbacks.get(h.surface)('ready');
  assert.equal(sdk.mounts.length, 2);
  assert.equal(sdk.mounts[1].options.autoplay, false);
  sdk.callbacks.get(second.surface)('ready');
  assert.notEqual(second.surface.children[0].hidden, true);
  second.media.listeners.get('pointerenter')({ pointerType: 'mouse' }); h.runTimer(0);
  assert.equal(sdk.mounts.length, 2);
  assert.equal(sdk.mounts[1].controller.plays, 1);
  h.scope.chooseVisibleCandidate();
  assert.equal(h.scope.testState.activeCard, second.card);
  assert.equal(h.scope.testState.candidateCard, null);
});

test("mobile visible Facebook tiles get short turns without simultaneous playback or full-grid mounts", () => {
  const h = facade(), second = h.addCard(), third = h.addCard('164'); const sdk = installSdk(h);
  h.scope.handleVisibility([h.card, second.card, third.card].map(target => ({ target, isIntersecting: true, intersectionRatio: 1 }))); h.runTimer(0);
  sdk.callbacks.get(h.surface)('ready'); sdk.callbacks.get(h.surface)('playing');
  assert.equal(sdk.mounts.length, 2);
  h.runTimer(6500); h.runTimer(0);
  assert.equal(h.scope.testState.activeCard, second.card);
  assert.equal(sdk.mounts[0].controller.pauses, 1);
  sdk.callbacks.get(second.surface)('playing');
  assert.equal(h.scope.testState.facebookControllers.size, 2);
  assert.equal(sdk.mounts[0].controller.destroyed, true);
  assert.equal(sdk.mounts[2].options.autoplay, false);
  h.runTimer(6500); h.runTimer(0);
  assert.equal(h.scope.testState.activeCard, third.card);
  assert.equal(sdk.mounts[1].controller.pauses, 1);
});

test("a stalled autoplay yields to another visible tile without an automatic retry loop", () => {
  const h = facade(), second = h.addCard(); const sdk = installSdk(h);
  h.scope.handleVisibility([h.card, second.card].map(target => ({ target, isIntersecting: true, intersectionRatio: 1 }))); h.runTimer(0);
  sdk.callbacks.get(h.surface)('blocked'); h.runTimer(1000); h.runTimer(0);
  assert.equal(h.scope.testState.activeCard, second.card);
  sdk.callbacks.get(second.surface)('playing');
  assert.equal(h.scope.testState.facebookRotationTimer, null);
  assert.equal(h.scope.testState.facebookUnavailable.has(h.card), true);
});

test("explicit sound cancels automatic rotation; hiding the page cancels the queued turn", () => {
  const h = facade(), second = h.addCard(); const sdk = installSdk(h);
  h.scope.handleVisibility([h.card, second.card].map(target => ({ target, isIntersecting: true, intersectionRatio: 1 }))); h.runTimer(0);
  sdk.callbacks.get(h.surface)('playing');
  h.surface.children[1].listeners.get('click')({ preventDefault() {}, stopPropagation() {} });
  assert.equal(h.scope.testState.soundCard, h.card);
  assert.equal(h.scope.testState.facebookRotationTimer, null);
  h.scope.document.hidden = true; h.scope.stopPreview();
  assert.equal(h.scope.testState.activeCard, null);
  assert.equal(h.scope.testState.facebookRotationTimer, null);
  assert.equal(h.scope.testState.soundCard, null);
});
