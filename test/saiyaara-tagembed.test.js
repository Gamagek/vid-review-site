import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const loader = readFileSync(new URL("../public/saiyaara-tagembed.js", import.meta.url), "utf8");
const home = readFileSync(new URL("../public/home-player.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Saiyaara uses supplied iframe URL and never injects the Tagembed SDK", () => {
  assert.ok(loader.includes("https://widget.tagembed.com/2236794?postId=5592899&caption=1&header=1"));
  assert.doesNotMatch(loader, /embed\.min\.js|tagembed-widget|player\/v1/);
  assert.match(loader, /allow", "autoplay; fullscreen; picture-in-picture; encrypted-media"/);
  assert.match(loader, /data-saiyaara-tagembed-host/);
  assert.doesNotMatch(loader, /IntersectionObserver/);
  assert.match(loader, /mountTilePlayer\(host\)/);
  assert.match(loader, /tagembedTracked/);
  assert.match(styles, /saiyaara-tagembed-frame/);
  assert.doesNotMatch(styles, /saiyaara-tagembed-overlay/);
});

test("homepage preserves a single Saiyaara mini tile on metadata refresh", () => {
  assert.ok(home.includes('card.dataset.videoSlug === "saiyaara-a-cinematic-romance"'));
  assert.match(home, /VidBestSaiyaaraTagembed\.mount\(surface, "tile"\)/);
  assert.match(home, /card\.classList\.contains\("saiyaara-tagembed-tile"\)/);
});

test("Saiyaara mini tile never requests Tagembed until Play; six-second backup stays opt-in", () => {
  let iframeCount = 0;
  let timeout = null;
  const children = [];
  const host = {
    isConnected: true,
    dataset: { saiyaaraPoster: "", saiyaaraSource: "https://www.tiktok.com/@creator/video/7669587518156705056" },
    classList: { add() {} },
    append(node) { children.push(node); node.isConnected = true; },
    prepend(node) { children.unshift(node); node.isConnected = true; },
    querySelector(selector) {
      return children.find((node) =>
        selector === "iframe.saiyaara-tagembed-frame" ? node.className === "saiyaara-tagembed-frame" :
        selector === ".saiyaara-preview-cover" ? node.className === "saiyaara-preview-cover" :
        selector === "[data-saiyaara-backup]" ? node.dataset?.saiyaaraBackup === "1" :
        selector === "[data-saiyaara-tagembed-status]" ? node.dataset?.saiyaaraTagembedStatus === "1" : false
      ) || null;
    },
  };
  const document = {
    readyState: "complete",
    body: { dataset: { viewerEmbed: "0" } },
    querySelectorAll() { return []; },
    createElement(type) {
      if (type === "iframe") iframeCount++;
      const listeners = {};
      return {
        isConnected: false, dataset: {}, style: {}, className: "",
        textContent: "", hidden: false,
        setAttribute(key, value) { this[key] = value; },
        getAttribute(key) { return this[key] || null; },
        addEventListener(name, fn) { listeners[name] = fn; },
        click() { listeners.click?.({ preventDefault() {}, stopPropagation() {} }); },
        dispatch(name) { listeners[name]?.(); },
        append() {},
        focus() {},
        remove() { this.isConnected = false; const i = children.indexOf(this); if (i >= 0) children.splice(i, 1); },
      };
    },
  };
  const context = {
    window: {
      addEventListener() {},
      setTimeout(fn, ms) { if (ms === 6000) timeout = fn; return 10; },
      clearTimeout() {},
      VidBestTikTok: { parse(url) { return { url }; }, showPreview() {} },
    },
    document,
  };
  runInNewContext(loader, context);
  const api = context.window.VidBestSaiyaaraTagembed;
  assert.equal(api.mount(host, "tile"), true);
  assert.equal(iframeCount, 0, "a ready poster must not spend a provider request");
  assert.equal(host.querySelector("iframe.saiyaara-tagembed-frame"), null);
  api.mount(host, "tile");
  assert.equal(iframeCount, 0, "reinitializing cannot spend a widget view");
  const cover = host.querySelector(".saiyaara-preview-cover");
  assert.ok(cover);
  cover.click();
  assert.equal(iframeCount, 1);
  const iframe = host.querySelector("iframe.saiyaara-tagembed-frame");
  assert.equal(iframe.src, api.iframeUrl);
  assert.equal(host.querySelector("[data-saiyaara-backup]").hidden, true);
  iframe.dispatch("load");
  assert.equal(host.querySelector("[data-saiyaara-backup]").hidden, true);
  timeout();
  assert.equal(host.querySelector("[data-saiyaara-backup]").hidden, false,
    "load does not establish that cross-origin TikTok video is playing");
  assert.equal(iframe.isConnected, true, "timer must not replace a potentially playing widget");
  assert.match(styles, /scale\(\.35\)/);
  assert.match(styles, /object-fit: contain !important/);
});

test("all three Saiyaara viewing surfaces use contained, touch-accessible embeds", () => {
  const viewer = readFileSync(new URL("../public/swipe-viewer.js", import.meta.url), "utf8");
  const viewerCss = readFileSync(new URL("../public/swipe-viewer.css", import.meta.url), "utf8");
  assert.match(viewer, /SAIYAARA_SLUG = "saiyaara-a-cinematic-romance"/);
  assert.match(viewer, /SAIYAARA_TAGEMBED_URL/);
  assert.match(viewer, /if \(!desired\(card\)\) return/);
  assert.match(viewer, /card\.el\.classList\.add\("is-interactive", "is-saiyaara-widget"\)/);
  assert.match(viewer, /iframe\.src = SAIYAARA_TAGEMBED_URL/);
  assert.match(viewer, /card\.el\.classList\.remove\("is-playing", "is-interactive", "is-saiyaara-widget", "is-tiktok-gateway"\)/);
  assert.match(viewerCss, /\.swipe-card\.is-saiyaara-widget \.swipe-gesture \{ display: none !important; \}/);
  assert.match(viewerCss, /\.swipe-card\.is-saiyaara-widget \.swipe-frame-host > iframe\.swipe-saiyaara-tagembed/);
  assert.match(styles, /#watch-player\[data-saiyaara-player="1"\]\.is-mini \.watch-player-stage/);
  assert.match(styles, /#watch-player\[data-saiyaara-player="1"\]\.is-theater \.watch-player-stage/);
});

test("homepage mini tile holds a poster until tapped without claiming auto sound", () => {
  assert.match(loader, /saiyaara-preview-cover/);
  assert.match(loader, /Show Saiyaara video player and sound controls/);
  assert.match(loader, /cover\.addEventListener\("click"/);
  assert.match(loader, /cover\.hidden = true/);
  assert.match(home, /const cover = card\.querySelector\("\.saiyaara-tile-cover-poster"\)/);
  assert.match(styles, /\.saiyaara-preview-cover:focus-visible/);
});

test("Saiyaara preview starts from first-party poster, never the expired D1 signed URL", () => {
  assert.match(home, /surface\.dataset\.saiyaaraPoster = share \? "\/api\/tiktok\/cached-poster/);
  assert.match(loader, /FALLBACK_POSTER = "\/api\/tiktok\/cached-poster\?id=7669587518156705056"/);
  assert.match(loader, /img\.src = FALLBACK_POSTER/);
  assert.match(loader, /saiyaara-preview-caption/);
  assert.match(loader, /posterRequests\.set\(host, token\)/);
  assert.match(home, /VidBestSaiyaaraTagembed\?\.updatePoster\?\./);
  assert.match(styles, /saiyaara-preview-caption/);
  assert.match(styles, /\.saiyaara-tile-cover-poster\[hidden\]/);
  assert.doesNotMatch(loader, /IntersectionObserver|rootMargin/);
});
