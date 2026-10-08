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

test("TikTok browser service uses the signed Cloudflare/Portainer watch route", () => {
  const h = harness();
  const link = h.api.gatewayWatchUrl(share + "?utm_source=demo");
  assert.equal(new URL(link).origin, "https://tiktok-oembed-gateway.gkasunc.workers.dev");
  assert.equal(new URL(link).pathname, "/watch");
  assert.equal(new URL(link).searchParams.get("url"), share);
  assert.equal(h.api.gatewayWatchUrl("https://evil.test/" + share), null);
  assert.match(code, /gatewayWatchUrl/);
  assert.match(code, /createElement\(["']iframe["']\)/);
  assert.doesNotMatch(code, /\/player\/v1\//);
  assert.doesNotMatch(code, /https:\/\/www\.tiktok\.com\/embed\.js/);
  assert.match(code, /requestAnimationFrame/);
  assert.match(code, /cleanupEmbed/);
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
  assert.match(host.children[0].src, /^https:\/\/tiktok-oembed-gateway\.gkasunc\.workers\.dev\/watch\?/);
  assert.equal(timers.size, 1, "only one readiness timer");
  const timeout = [...timers.values()][0].fn;
  timers.clear();
  timeout();
  assert.equal(host.children[0].tagName, "IFRAME", "slow loading must not destroy the player");
  assert.match(status.textContent, /longer to load/i);
  assert.equal(timers.size, 0);
  const frame = host.children[0];
  const event = { source: frame.contentWindow, origin: "https://tiktok-oembed-gateway.gkasunc.workers.dev", data: { channel: "vidbest-gateway", video_id: "6718335390845095173", state: "error", message: "Source could not be prepared." } };
  winListeners.get("message")({ ...event, origin: "https://evil.test" });
  assert.match(status.textContent, /longer to load/i);
  winListeners.get("message")({ ...event, source: {} });
  assert.match(status.textContent, /longer to load/i);
  winListeners.get("message")(event);
  assert.equal(status.textContent, "Source could not be prepared.");
  assert.equal(host.children[0], frame, "gateway keeps its own retry controls");
  dialog.close();
  assert.equal(winListeners.has("message"), false);
  assert.equal(host.children.length, 0, "closing the popup removes player and placeholder");
  await api.showPreview(share, { title: "First video" });
  rafs.shift()();
  assert.equal(createdFrames, 2, "manual reopen is not blocked by an invented cooldown");
  dialog.close();
});
