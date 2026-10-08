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
  assert.match(loader, /rootMargin: "300px 0px"/);
  assert.match(loader, /tagembedTracked/);
  assert.match(styles, /saiyaara-tagembed-frame/);
  assert.doesNotMatch(styles, /saiyaara-tagembed-overlay/);
});

test("homepage preserves a single Saiyaara mini tile on metadata refresh", () => {
  assert.ok(home.includes('card.dataset.videoSlug === "saiyaara-a-cinematic-romance"'));
  assert.match(home, /VidBestSaiyaaraTagembed\.mount\(surface, "tile"\)/);
  assert.match(home, /card\.classList\.contains\("saiyaara-tagembed-tile"\)/);
});

test("Saiyaara mini tile creates iframe only when it approaches viewport", () => {
  let createCount = 0;
  let intersectionCallback = null;
  const children = [];
  const iframe = {
    isConnected: false, className: "", dataset: {}, style: {},
    setAttribute(key, value) { this[key] = value; },
    getAttribute(key) { return this[key] || null; },
    addEventListener() {},
  };
  const host = {
    isConnected: true,
    dataset: { saiyaaraPoster: "" },
    classList: { add() {} },
    append(node) { children.push(node); node.isConnected = true; },
    prepend(node) { children.unshift(node); node.isConnected = true; },
    querySelector(selector) {
      return selector === "iframe.saiyaara-tagembed-frame"
        ? children.find((node) => node.className === "saiyaara-tagembed-frame") || null
        : selector === "[data-saiyaara-tagembed-status]"
          ? children.find((node) => node.dataset?.saiyaaraTagembedStatus) || null
          : null;
    },
  };
  const document = {
    readyState: "complete",
    body: { dataset: { viewerEmbed: "0" } },
    querySelectorAll() { return []; },
    createElement(type) {
      if (type === "iframe") { createCount++; return iframe; }
      return {
        dataset: {}, className: "", textContent: "", hidden: false,
        setAttribute() {},
      };
    },
  };
  const context = {
    window: {
      addEventListener() {},
      setTimeout() { return 10; },
      clearTimeout() {},
    },
    document,
    IntersectionObserver: function MockIntersectionObserver(callback) {
      intersectionCallback = callback;
      this.observe = () => {};
      this.disconnect = () => {};
    },
  };
  context.window.IntersectionObserver = context.IntersectionObserver;
  runInNewContext(loader, context);
  const api = context.window.VidBestSaiyaaraTagembed;
  assert.equal(api.mount(host, "tile"), undefined);
  assert.equal(createCount, 0, "no iframe should preload before intersection");
  assert.equal(host.querySelector("iframe.saiyaara-tagembed-frame"), null);
  intersectionCallback([{ isIntersecting: true }]);
  assert.equal(createCount, 1);
  assert.equal(iframe.src, api.iframeUrl);
  api.mount(host, "tile");
  assert.equal(createCount, 1, "repeated tile setup should not add another iframe");
});


test("all three Saiyaara viewing surfaces use contained, touch-accessible embeds", () => {
  const viewer = readFileSync(new URL("../public/swipe-viewer.js", import.meta.url), "utf8");
  const viewerCss = readFileSync(new URL("../public/swipe-viewer.css", import.meta.url), "utf8");
  assert.match(viewer, /SAIYAARA_SLUG = "saiyaara-a-cinematic-romance"/);
  assert.match(viewer, /SAIYAARA_TAGEMBED_URL/);
  assert.match(viewer, /if \(!desired\(card\)\) return/);
  assert.match(viewer, /card\.el\.classList\.add\("is-interactive", "is-saiyaara-widget"\)/);
  assert.match(viewer, /iframe\.src = SAIYAARA_TAGEMBED_URL/);
  assert.match(viewer, /card\.el\.classList\.remove\("is-playing", "is-interactive", "is-saiyaara-widget"\)/);
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
