import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { tikTokZeroRequestPlayer } from "../src/tiktok-zero-request-cache.js";

const code = readFileSync(new URL("../public/tiktok-cache-player.js", import.meta.url), "utf8");
const service = readFileSync(new URL("../public/tiktok-preview-service.js", import.meta.url), "utf8");
const source = "https://www.tiktok.com/@sujicomedyedit_007/video/7603012203595320584";
const origin = "https://vid.best";

function success(extra = {}, metadata = {}) {
  return { status: "success", source: "cache", remaining_today: 18, views_today: 2,
    oembed: { type: "video", provider_name: "TikTok", author_name: "Original creator",
      author_url: "https://www.tiktok.com/@sujicomedyedit_007", title: '<img src=x onerror="attack()">',
      html: '<blockquote data-video-id="7603012203595320584"></blockquote><script src="https://evil.example"></script>', ...metadata }, ...extra };
}

async function player(fetcher, storage = new Map()) {
  const calls = [], scripts = [], messages = [];
  function element(tag) {
    return { tagName: tag.toUpperCase(), dataset: {}, children: [], attrs: {}, events: {},
      setAttribute(key, value) { this.attrs[key] = value; },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      addEventListener(type, fn) { this.events[type] = fn; },
    };
  }
  const host = element("div"), status = element("p"), link = { href: source };
  const document = {
    getElementById(id) { return { "tiktok-embed-host": host, "cache-status": status, "tiktok-source": link }[id]; },
    createElement: element,
    body: { append(node) { assert.equal(node.tagName, "SCRIPT"); scripts.push(node); } },
  };
  const context = { document, window: { parent: { postMessage(data, target) { messages.push({ data, target }); } } },
    location: { origin }, URL, AbortSignal, TextDecoder,
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (...args) => { calls.push(args); return fetcher(...args); },
  };
  vm.runInNewContext(code, context);
  await new Promise(resolve => setImmediate(resolve));
  return { host, status, calls, scripts, messages };
}

test("cached metadata constructs the exact official blockquote and loads embed.js once, without executing API HTML", async () => {
  const h = await player(async () => Response.json(success()));
  assert.equal(h.calls.length, 1);
  const request = new URL(h.calls[0][0], origin);
  assert.equal(request.origin, "https://tiktokmedia.megasale.win"); assert.equal(request.pathname, "/api/watch"); assert.equal(request.searchParams.get("url"), source);
  assert.equal(h.calls[0][1].credentials, "omit"); assert.equal(h.calls[0][1].redirect, "error"); assert.equal(h.calls[0][1].cache, "no-store");
  const quote = h.host.children[0];
  assert.equal(quote.tagName, "BLOCKQUOTE"); assert.equal(quote.attrs.cite, source); assert.equal(quote.attrs["data-video-id"], "7603012203595320584");
  assert.equal(quote.children[0].children[1].textContent, '<img src=x onerror="attack()">');
  assert.equal(h.scripts.length, 1); assert.equal(h.scripts[0].src, "https://www.tiktok.com/embed.js"); assert.equal(h.scripts[0].async, true);
  assert.ok(h.messages.every(x => x.target === origin && x.data.channel === "vidbest-tiktok-oembed"));
  h.scripts[0].events.load(); assert.match(h.status.textContent, /Availability depends on TikTok/);
  assert.doesNotMatch(h.status.textContent, /playing|successfully played/i);
  assert.match(h.status.textContent, /18 video requests left today/);
});

test("daily20 and other429 show useful messages without an embed script, polling, alternate fetch or retries", async () => {
  for (const code of ["daily_video_limit", "upstream_rate_limit", "cache_cooldown", "cache_busy"]) {
    const h = await player(async () => Response.json({ ok: false, code, retry_after: 86400 }, { status: 429, headers: { "Retry-After": "86400" } }));
    assert.equal(h.calls.length, 1); assert.equal(h.scripts.length, 0); assert.equal(h.host.children.length, 0);
    assert.match(h.status.textContent, /20 videos per viewer per day/);
    assert.doesNotMatch(h.status.textContent, /00:00|UTC/);
    assert.equal(h.messages.at(-1).data.state, "error");
  }
});

test("reopening after429 honors a shared session deadline rather than sending another API request", async () => {
  for (const retry of ["120", new Date(Date.now() + 180000).toUTCString(), null]) {
    const storage = new Map();
    const first = await player(async () => new Response("Limited", { status: 429, headers: retry ? { "Retry-After": retry } : {} }), storage);
    assert.equal(first.calls.length, 1);
    assert.ok(Number([...storage.values()][0]) > Date.now() + 50000);
    const reopened = await player(async () => { throw new Error("Must not retry during the deadline"); }, storage);
    assert.equal(reopened.calls.length, 0); assert.equal(reopened.scripts.length, 0); assert.match(reopened.status.textContent, /20 videos per viewer/);
  }
});

test("mismatched IDs/creator, nonJSON errors and network failures stop safely", async () => {
  for (const fetcher of [
    async () => Response.json(success({}, { html: '<blockquote data-video-id="7603012203595320585"></blockquote>' })),
    async () => Response.json(success({}, { author_url: "https://www.tiktok.com/@someone_else" })),
    async () => Response.json(success({ status: "error" })),
    async () => new Response("Access denied", { status: 403 }),
    async () => { throw new Error("network detail"); },
    async () => new Response("Access denied", { headers: { "Content-Type": "text/html" } }),
  ]) {
    const h = await player(fetcher); assert.equal(h.calls.length, 1); assert.equal(h.scripts.length, 0);
    assert.equal(h.messages.at(-1).data.state, "error"); assert.doesNotMatch(h.status.textContent, /network detail|Access denied/);
  }
});

test("embed.js load error gives a source fallback and never reloads the script", async () => {
  const h = await player(async () => Response.json(success()));
  h.scripts[0].events.error(); assert.match(h.status.textContent, /script could not load/);
  assert.equal(h.scripts.length, 1); assert.equal(h.calls.length, 1);
});

test("only the supplied exact creator and ID opt in; all other gateway URL routes remain intact", () => {
  const window = {};
  vm.runInNewContext(service, { window, URL, location: { origin } });
  const api = window.VidBestTikTok;
  const target = new URL(api.cachePlayerUrl(source + "?tracking=1"));
  assert.equal(target.origin, origin); assert.equal(target.pathname, "/api/tiktok/oembed-player"); assert.equal(target.searchParams.get("url"), source);
  for (const value of [source.replace("sujicomedyedit_007", "someone_else"),
    "https://www.tiktok.com/@bozlun.youth/video/7332342275151760642",
    "https://www.tiktok.com/@creator/video/7552567024304540959", "https://evil.example"]) assert.equal(api.cachePlayerUrl(value), null);
  assert.equal(new URL(api.gatewayWatchUrl(source)).origin, "https://tiktok-oembed-gateway.gkasunc.workers.dev");
});

test("invalid/oversized JSON and forged provider names do not reach the official embed loader", async () => {
  for (const fetcher of [
    async () => Response.json(success({}, { provider_name: "Other" })),
    async () => Response.json(success({ huge: "x".repeat(70000) })),
    async () => new Response("broken-json", { headers: { "Content-Type": "application/json" } }),
  ]) {
    const h = await player(fetcher); assert.equal(h.calls.length, 1); assert.equal(h.scripts.length, 0);
    assert.equal(h.messages.at(-1).data.state, "error");
  }
});

test("isolated official player is noindex/self-framed and permits only the required cache origin", async () => {
  const result = tikTokZeroRequestPlayer(new Request(`${origin}/api/tiktok/oembed-player?url=${encodeURIComponent(source)}`));
  assert.equal(result.status, 200); assert.match(result.headers.get("X-Robots-Tag"), /noindex/);
  const csp = result.headers.get("Content-Security-Policy");
  assert.match(csp, /frame-ancestors 'self'/); assert.match(csp, /connect-src[^;]*https:\/\/tiktokmedia\.megasale\.win/);
  const scriptSources = csp.match(/(?:^|; )script-src ([^;]+)/)[1].split(" ");
  assert.deepEqual(scriptSources, ["'self'", "https://www.tiktok.com", "https://sf16-website-login.neutral.ttwstatic.com"], "permit the observed official302script host without a wildcard");
  assert.doesNotMatch(csp, /unsafe-eval|https:\/\/\*/);
  const html = await result.text(); assert.ok(html.includes(source)); assert.match(html, /tiktok-cache-player\.js/);
  assert.doesNotMatch(html, /<iframe|embed\.js|<script(?! src=)/);
  for (const bad of ["http://www.tiktok.com/@creator/video/7603012203595320584", "https://evil.example/@creator/video/7603012203595320584",
    source.replace("www.tiktok.com", "user@www.tiktok.com"), "javascript:alert(1)"]) {
    assert.equal(tikTokZeroRequestPlayer(new Request(`${origin}/api/tiktok/oembed-player?url=${encodeURIComponent(bad)}`)).status, 400);
  }
});

test("the official redirect CDN permission is confined to the isolated player", () => {
  const general = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const seo = readFileSync(new URL("../src/seo-edge.js", import.meta.url), "utf8");
  assert.equal(general.includes("sf16-website-login.neutral.ttwstatic.com"), false);
  assert.equal(seo.includes("sf16-website-login.neutral.ttwstatic.com"), false);
});
