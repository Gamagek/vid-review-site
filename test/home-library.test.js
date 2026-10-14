import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const video = (id) => ({ id, slug: `review-${id}`, title: `Review ${id}`, description: "Original commentary", media_type: "youtube", primary_category: "Music", subcategory: "Songs", created_at: "2026-10-01", reactions: {} });
const list = (ids = [1, 2], total = 25) => ({ videos: ids.map(video), pagination: { total } });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => typeof body === "string" ? body : JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness({ fetcher, legacy = false, search = "" } = {}) {
  function node() {
    const selectors = new Map();
    const item = { children: [], dataset: {}, value: "", textContent: "", hidden: true, disabled: false, listeners: new Map(), attributes: {},
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(name, handler) { this.listeners.set(name, handler); },
      setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; },
      append(...items) { this.children.push(...items); }, appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      reset() {}, scrollIntoView() {},
      querySelector(selector) { if (!selectors.has(selector)) selectors.set(selector, node()); return selectors.get(selector); },
      querySelectorAll(selector) {
        if (selector === ".category-chip") return this.children;
        if (selector === "[data-reaction]") return ["like", "sparkle", "useful"].map(reaction => {
          const button = this.querySelector(reaction); button.dataset.reaction = reaction; return button;
        });
        return [];
      },
    };
    Object.defineProperty(item, "firstChild", { get() { return this.children[0] || null; } });
    Object.defineProperty(item, "innerHTML", { set() { this.children = []; } });
    if (!legacy) item.replaceChildren = function (...items) { this.children = items; };
    return item;
  }
  const nodes = new Map(), calls = [], timers = new Map(), history = [];
  const get = name => { if (!nodes.has(name)) nodes.set(name, node()); return nodes.get(name); };
  get("#sort-select").value = "newest";
  get("#video-card-template").content = { cloneNode: node };
  const scope = createContext({
    document: { readyState: "loading", addEventListener() {}, dispatchEvent() {}, querySelector: get, createElement: node },
    location: { search, pathname: "/", origin: "https://vid.best" }, history: { replaceState(...args) { history.push(args[2]); } },
    fetch: async (url, options) => { calls.push({ url, options }); return fetcher ? fetcher(url, options) : response(url.startsWith("/api/categories") ? { categories: { Music: ["Songs"] } } : list()); },
    URLSearchParams, console, CustomEvent: class {},
    matchMedia: () => ({ matches: true }),
    setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval() {}, clearInterval() {},
  });
  runInContext("Object.hasOwn = undefined;", scope);
  runInContext(source, scope);
  return { scope, get, calls, timers, history, state: runInContext("state", scope) };
}

test("the main library initializes without Object.hasOwn or replaceChildren", async () => {
  const h = harness({ legacy: true }); await h.scope.initialize();
  assert.equal(h.state.videos.length, 2);
  assert.equal(h.get("#video-grid").children.length, 2);
  assert.equal(h.get("#result-summary").textContent, "25 curated videos");
  assert.equal(h.get("#empty-state").hidden, true);
});

test("categories and featured failures cannot suppress available library records", async () => {
  const h = harness({ fetcher: url => response(url.includes("categories") || url.includes("featured=1") ? { error: "Unavailable" } : list(), url.includes("categories") || url.includes("featured=1") ? 503 : 200) });
  await h.scope.initialize();
  assert.equal(h.state.videos.length, 2);
  assert.equal(h.get("#empty-state").hidden, true);
  assert.equal(h.get("#category-select").disabled, true);
  assert.match(h.get("#category-chips").textContent, /still search/);
});

test("a slow category request does not delay library rendering or lose URL filters", async () => {
  const categories = deferred();
  const h = harness({ search: "?category=Music&subcategory=Songs&q=hello", fetcher: url => url.includes("categories") ? categories.promise : response(list()) });
  const pending = h.scope.initialize();
  await new Promise(setImmediate);
  assert.equal(h.state.videos.length, 2);
  const request = h.calls.find(call => call.url.includes("offset=0"));
  const params = new URLSearchParams(request.url.split("?")[1]);
  assert.equal(params.get("category"), "Music"); assert.equal(params.get("subcategory"), "Songs"); assert.equal(params.get("q"), "hello");
  categories.resolve(response({ categories: { Music: ["Songs"] } })); await pending;
  assert.equal(h.get("#category-select").value, "Music");
});

test("successful empty data and a failed request have different headings and actions", async () => {
  const empty = harness({ fetcher: url => response(url.includes("categories") ? { categories: {} } : list([], 0)) });
  await empty.scope.initialize();
  assert.equal(empty.get("#empty-title").textContent, "No videos found");
  assert.equal(empty.get("#retry-library").hidden, true);
  const failed = harness({ fetcher: () => response({ error: "Unavailable" }, 503) });
  await failed.scope.initialize();
  assert.equal(failed.get("#empty-title").textContent, "Video library unavailable");
  assert.equal(failed.get("#retry-library").hidden, false);
  assert.match(failed.get("#result-summary").textContent, /unavailable/i);
});

test("invalid JSON or a missing video array cannot masquerade as an empty library", async () => {
  for (const body of ["<html>Login page</html>", {}, { videos: {}, pagination: { total: 0 } }, { videos: [], pagination: { total: null } }]) {
    const h = harness({ fetcher: url => response(url.includes("categories") ? { categories: {} } : body) });
    await h.scope.initialize();
    assert.equal(h.get("#retry-library").hidden, false);
    assert.equal(h.get("#empty-title").textContent, "Video library unavailable");
  }
});

test("retry recovers the library without reloading categories or sending mutations", async () => {
  let failed = true;
  const h = harness({ fetcher: url => response(url.includes("categories") ? { categories: {} } : failed ? { error: "Unavailable" } : list(), url.includes("categories") || !failed ? 200 : 503) });
  await h.scope.initialize(); const before = h.calls.length; failed = false;
  await h.get("#retry-library").listeners.get("click")();
  assert.equal(h.calls.length, before + 1);
  assert.equal(h.state.videos.length, 2);
  assert.ok(h.calls.every(call => !call.options.method || call.options.method === "GET"));
  assert.equal(h.get("#retry-library").hidden, true);
});

test("a late response from an old filter cannot overwrite newer results", async () => {
  const a = deferred(), b = deferred(); let libraryCalls = 0;
  const h = harness({ fetcher: url => url.includes("offset=") ? (++libraryCalls === 1 ? a.promise : b.promise) : response(url.includes("categories") ? { categories: {} } : list()) });
  const old = h.scope.loadVideos({ reset: true });
  const latest = h.scope.loadVideos({ reset: true });
  b.resolve(response(list([9], 1))); await latest;
  a.resolve(response(list([3], 1))); await old;
  assert.deepEqual(Array.from(h.state.videos, item => item.id), [9]);
});

test("a failed pagination request preserves loaded cards and retries the same offset", async () => {
  let fail = false;
  const h = harness({ fetcher: url => response(url.includes("categories") ? { categories: {} } : fail && url.includes("offset=2") ? { error: "Unavailable" } : list(), fail && url.includes("offset=2") ? 503 : 200) });
  await h.scope.initialize(); fail = true;
  await h.scope.loadVideos({ reset: false });
  assert.equal(h.get("#video-grid").children.length, 2); assert.equal(h.state.offset, 2);
  fail = false; await h.get("#retry-library").listeners.get("click")();
  assert.equal(h.state.videos.length, 4);
  assert.ok(h.calls.at(-1).url.includes("offset=2"));
});

test("network failure has a truthful retry state rather than an empty result", async () => {
  const h = harness({ fetcher: () => { throw new TypeError("Network unavailable"); } });
  await h.scope.initialize();
  assert.equal(h.get("#empty-title").textContent, "Connection problem");
  assert.equal(h.get("#retry-library").hidden, false);
});

test("a read times out even without AbortController and clears the timer", async () => {
  const h = harness({ fetcher: () => new Promise(() => {}) });
  const pending = h.scope.loadVideos({ reset: true });
  assert.equal(h.timers.size, 1);
  Array.from(h.timers.values())[0].fn(); await pending;
  assert.match(h.get("#empty-message").textContent, /timed out/i);
  assert.equal(h.timers.size, 0);
});

test("filter URL synchronization works without URLSearchParams.size", () => {
  const h = harness();
  runInContext("URLSearchParams = class extends URLSearchParams { get size() { return undefined; } };", h.scope);
  h.get("#search-input").value = "music";
  h.scope.syncUrl(); assert.equal(h.history.at(-1), "?q=music");
});

test("the compatibility bootstrap handles a core parse error and missing browser APIs", () => {
  const bootstrap = readFileSync(new URL("../public/library-support.js", import.meta.url), "utf8");
  for (const parseError of [false, true]) {
    const h = harness(), events = new Map(), documentEvents = new Map();
    h.scope.document.getElementById = id => h.get("#" + id);
    h.scope.document.addEventListener = (type, handler) => documentEvents.set(type, handler);
    h.scope.document.readyState = "complete";
    h.scope.window = { addEventListener: (type, handler) => events.set(type, handler), Promise, URLSearchParams, fetch: parseError ? h.scope.fetch : undefined };
    runInContext(bootstrap, h.scope);
    if (parseError) events.get("error")({ filename: "https://vid.best/app.js?v=example" });
    else documentEvents.get("DOMContentLoaded")();
    assert.equal(h.get("#empty-title").textContent, "Browser support required");
    assert.match(h.get("#empty-message").textContent, /video directory/);
    assert.equal(h.get("#empty-state").hidden, false);
  }
});

test("a lost response body is a connection failure and history errors do not remove loaded data", async () => {
  const broken = harness({ fetcher: () => ({ ok: true, status: 200, text: async () => { throw new TypeError("Connection lost"); } }) });
  await broken.scope.initialize(); assert.equal(broken.get("#empty-title").textContent, "Connection problem");
  const h = harness(); h.scope.history.replaceState = () => { throw new Error("Browser storage restriction"); };
  await h.scope.initialize(); assert.equal(h.state.videos.length, 2); assert.equal(h.get("#empty-state").hidden, true);
});
