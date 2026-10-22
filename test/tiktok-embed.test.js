import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const code = readFileSync(new URL("../public/tiktok-preview-service.js", import.meta.url), "utf8");
const share = "https://www.tiktok.com/@creator/video/6718335390845095173";

function payload(extra = {}) {
  return {
    ok: true,
    mode: "metadata-card",
    video_id: "6718335390845095173",
    source_url: share,
    open_url: share,
    title: "Cached title",
    author_name: "creator",
    description: "Cached description",
    thumbnail_url: "https://p16-common-sign.tiktokcdn-us.com/example.jpg",
    ...extra,
  };
}

function harness(fetcher = async () => Response.json(payload())) {
  const saved = new Map();
  const window = {};
  const context = {
    window,
    URL,
    AbortSignal,
    Response,
    location: { origin: "https://vid.best" },
    fetch: fetcher,
    sessionStorage: {
      getItem: (key) => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    document: {},
  };
  runInNewContext(code, context);
  return { api: window.VidBestTikTok, saved };
}

test("metadata requests coalesce and pass the canonical TikTok URL once", async () => {
  let calls = 0;
  let finish;
  const h = harness(async (target) => {
    calls += 1;
    const url = new URL(target, "https://vid.best");
    assert.equal(url.pathname, "/api/tiktok/embed");
    assert.equal(url.searchParams.get("url"), share);
    await new Promise((resolve) => { finish = resolve; });
    return Response.json(payload());
  });

  const jobs = Array.from({ length: 20 }, () => h.api.getMetadata(share + "?tracking=1"));
  assert.equal(calls, 1);
  finish();
  await Promise.all(jobs);
  await h.api.getMetadata(share);
  assert.equal(calls, 1);
});

test("429 response stores a retry deadline and avoids repeated requests", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls += 1;
    return Response.json({ ok: false, error: "Rate limited" }, {
      status: 429,
      headers: { "Retry-After": "120" },
    });
  });

  await assert.rejects(h.api.getMetadata(share));
  await assert.rejects(h.api.getMetadata(share));
  assert.equal(calls, 1);
  assert.ok([...h.saved.values()].some((value) => JSON.parse(value).until > Date.now() + 100000));
});

test("rejects mismatched metadata and unsafe TikTok URLs", async () => {
  const h = harness(async () => Response.json(payload({
    video_id: "7552567024304540959",
  })));
  await assert.rejects(h.api.getMetadata(share), /different/);

  for (const value of [
    share.replace("https:", "http:"),
    share.replace("www.tiktok.com", "user@www.tiktok.com"),
    "https://example.com/@creator/video/6718335390845095173",
  ]) {
    assert.equal(h.api.parse(value), null);
  }
});

test("TikTok browser service uses official player first, with an opt-in gateway fallback", () => {
  const h = harness();
  const link = h.api.gatewayWatchUrl(share + "?utm_source=demo");
  assert.equal(new URL(link).origin, "https://tiktok-oembed-gateway.gkasunc.workers.dev");
  assert.equal(new URL(link).pathname, "/watch");
  assert.equal(new URL(link).searchParams.get("url"), share);
  assert.equal(h.api.gatewayWatchUrl("https://evil.test/" + share), null);
  assert.match(code, /gatewayWatchUrl/);
  assert.match(code, /createElement\(["']iframe["']\)/);
  assert.match(code, /\/player\/v1\//);
  assert.doesNotMatch(code, /https:\/\/www\.tiktok\.com\/embed\.js/);
  assert.match(code, /requestAnimationFrame/);
  assert.match(code, /cleanupEmbed/);
  assert.match(code, /observeOfficialPlayer/);
  assert.match(code, /data-tiktok-dialog-alternate/);
  assert.match(code, /author_name/);
});


test("a slow gateway stays interactive without the false 15-minute lock, and cleanup removes the observer", async () => {
  const rafs = [];
  const timers = new Map();
  let nextTimer = 0;
  let createdFrames = 0;
  let dialog = null;
  const storage = new Map();
  const docListeners = new Map();
  const winListeners = new Map();

  function element(tag) {
    const listeners = new Map();
    return {
      tagName: tag.toUpperCase(), dataset: {}, style: {}, children: [], textContent: "", contentWindow: {},
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, cb) { listeners.set(name, cb); },
      remove() { this.removed = true; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      trigger(name, event = {}) { listeners.get(name)?.(event); },
    };
  }

  const host = element("div");
  const status = element("p");
  const selectors = new Map([
    ["[data-tiktok-embed-host]", host],
    ["[data-tiktok-dialog-status]", status],
    ["[data-tiktok-dialog-title]", element("strong")],
    ["[data-tiktok-dialog-author]", element("span")],
    ["[data-tiktok-dialog-description]", element("p")],
    ["[data-tiktok-dialog-alternate]", element("button")],
    [".tiktok-preview-dialog-close", element("button")],
    ["[data-tiktok-dialog-cancel]", element("button")],
  ]);
  const document = {
    hidden: false,
    body: { append(node) { if (node.tagName === "DIALOG") dialog = node; } },
    querySelector(selector) { return selector === "#vidbest-tiktok-preview-dialog" ? dialog : null; },
    addEventListener(type, fn) { docListeners.set(type, fn); },
    createElement(tag) {
      const el = element(tag);
      if (tag === "iframe") createdFrames++;
      if (tag === "dialog") {
        el.open = false;
        el.querySelector = (selector) => selectors.get(selector) || null;
        el.showModal = () => { el.open = true; };
        el.close = () => { el.open = false; el.trigger("close"); };
      }
      return el;
    },
  };
  const window = {
    addEventListener(type, fn) { winListeners.set(type, fn); },
    removeEventListener(type, fn) { if (winListeners.get(type) === fn) winListeners.delete(type); },
  };
  const context = {
    window, document, URL, AbortSignal, Response, Date,
    location: { origin: "https://vid.best" },
    requestAnimationFrame(fn) { rafs.push(fn); },
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    sessionStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    fetch: async () => Response.json(payload()),
  };
  runInNewContext(code, context);
  const api = window.VidBestTikTok;
  assert.equal(createdFrames, 0, "never create iframe at page startup");
  await api.showPreview(share, { title: "First video" });
  assert.equal(dialog.open, true);
  assert.equal(createdFrames, 0, "no player before dialog opens and is painted");
  rafs.shift()();
  assert.equal(createdFrames, 1);
  assert.match(host.children[0].src, /^https:\/\/www\.tiktok\.com\/player\/v1\/6718335390845095173\?/);
  assert.equal(timers.size, 1, "only one readiness timer");
  const timeout = [...timers.values()][0].fn;
  timers.clear();
  timeout();
  assert.equal(host.children[0].tagName, "IFRAME", "slow loading must not destroy the player");
  assert.match(status.textContent, /has not confirmed readiness/i);
  assert.equal(timers.size, 0);
  const frame = host.children[0];
  const event = { source: frame.contentWindow, origin: "https://www.tiktok.com", data: { "x-tiktok-player": true, type: "onPlayerReady" } };
  winListeners.get("message")({ ...event, origin: "https://evil.test" });
  assert.match(status.textContent, /has not confirmed readiness/i);
  winListeners.get("message")({ ...event, source: {} });
  assert.match(status.textContent, /has not confirmed readiness/i);
  winListeners.get("message")(event);
  assert.equal(status.textContent, "Ready to play on TikTok's player.");
  assert.equal(host.children[0], frame, "the official embed stays mounted after readiness");
  assert.equal(selectors.get("[data-tiktok-dialog-alternate]").hidden, false);
  dialog.close();
  assert.equal(winListeners.has("message"), false);
  assert.equal(host.children.length, 0, "closing the popup removes player and placeholder");
  await api.showPreview(share, { title: "First video" });
  rafs.shift()();
  assert.equal(createdFrames, 2, "manual reopen is not blocked by an invented cooldown");
  dialog.close();
});

test("repeated Play calls on the same open cached player keep one iframe and one listener", async () => {
  const source = "https://www.tiktok.com/@sujicomedyedit_007/video/7603012203595320584";
  const rafs = [], listeners = new Map(), selectors = new Map(), timers = new Map();
  let dialog = null, frames = 0, nextTimer = 0, fetches = 0;
  function element(tag) {
    const events = new Map();
    return { tagName: tag.toUpperCase(), children: [], contentWindow: {},
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, fn) { events.set(name, fn); },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      trigger(name) { events.get(name)?.(); },
    };
  }
  for (const key of ["[data-tiktok-embed-host]", "[data-tiktok-dialog-status]", "[data-tiktok-dialog-title]", "[data-tiktok-dialog-author]", "[data-tiktok-dialog-description]", ".tiktok-preview-dialog-close", "[data-tiktok-dialog-cancel]"]) selectors.set(key, element("div"));
  const document = { hidden: false,
    querySelector() { return dialog; }, addEventListener() {},
    body: { append(node) { dialog = node; } },
    createElement(tag) {
      const el = element(tag);
      if (tag === "iframe") frames++;
      if (tag === "dialog") {
        el.open = false; el.querySelector = key => selectors.get(key);
        el.showModal = () => { el.open = true; };
        el.close = () => { el.open = false; el.trigger("close"); };
      }
      return el;
    },
  };
  const window = { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const context = { document, window, URL, location: { origin: "https://vid.best" },
    requestAnimationFrame(fn) { rafs.push(fn); },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    fetch() { fetches++; throw new Error("The old gateway must not be refreshed"); },
  };
  runInNewContext(code, context);
  const api = window.VidBestTikTok;
  await Promise.all(Array.from({ length: 10 }, () => api.showPreview(source)));
  assert.equal(rafs.length, 1); rafs.shift()();
  const host = selectors.get("[data-tiktok-embed-host]"), frame = host.children[0];
  assert.equal(frames, 1); assert.equal(new URL(frame.src).pathname, "/api/tiktok/oembed-player");
  await api.showPreview(source);
  assert.equal(rafs.length, 0); assert.equal(frames, 1); assert.equal(host.children[0], frame);
  assert.equal(listeners.has("message"), true); assert.equal(timers.size, 1); assert.equal(fetches, 0);
  runInNewContext(code, context);
  assert.equal(window.VidBestTikTok, api, "duplicate service execution cannot reset the active player");
  dialog.close(); assert.equal(host.children.length, 0); assert.equal(listeners.has("message"), false);
  await api.showPreview(source); rafs.shift()();
  assert.equal(frames, 2, "closing still destroys playback; deliberate reopen creates a clean official player");
  assert.equal(fetches, 0); dialog.close();
});
