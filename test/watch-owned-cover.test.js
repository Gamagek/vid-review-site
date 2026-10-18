import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import worker from "../src/seo-edge.js";

const origin = "https://vid.best";
const source = "https://www.tiktok.com/@creator/video/7622472784039415061";
const cover = `${origin}/review-covers/meri-aashiqui-illustrated-v1.webp`;
const providerPoster = "https://p16-common-sign.tiktokcdn-eu.com/fixture-preview.jpg";
const fallback = "/api/tiktok/cached-poster?id=7622472784039415061";
const illustrationLabel = "Illustrated cover · not a video frame";
const watchSource = readFileSync(new URL("../public/watch.js", import.meta.url), "utf8");

function serverContext({ thumbnail = cover, slug = "watch-cover-test", category = "Entertainment, Movies & Games", cached = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql", "0002_discovery_requests.sql", "0003_security_rate_limits.sql",
    "0004_maintenance_indexes.sql", "0005_source_video_metadata.sql", "0009_app_settings.sql",
    "0010_video_analysis.sql", "0014_member_notifications.sql", "0016_rights_certified_r2_cache.sql",
    "0017_authorized_auto_cache.sql", "0018_tiktok_oembed_cache.sql", "0019_tiktok_oembed_backfill.sql",
    "0020_member_personalization.sql", "0022_facebook_readable_slugs.sql", "0030_facebook_preview_jobs.sql",
  ]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  sqlite.prepare(`INSERT INTO videos
    (slug,title,source_url,media_type,primary_category,subcategory,description,review_text,thumbnail_url,published,created_at,updated_at)
    VALUES (?,?,?,'tiktok',?,'Movie Trailers','Owner description','Owner review — final paragraph.',?,1,?,?)`)
    .run(slug, "Owner review title", source, category, thumbnail, "2026-09-22T10:53:05.021Z", "2026-09-22T20:10:20.017Z");
  if (cached) sqlite.prepare(`INSERT INTO tiktok_oembed_cache
    (video_id,share_url,title,author_name,description,thumbnail_url,fetched_at)
    VALUES ('7622472784039415061',?,'Cached source title','creator','Cached source description',?,?)`)
    .run(source, providerPoster, new Date().toISOString());
  function statement(sql, params = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return sqlite.prepare(sql).get(...params) || null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...params) }; },
      async run() { throw new Error("Unexpected database write during a read-only watch render"); },
    };
  }
  return {
    sqlite, slug,
    env: { PUBLIC_BASE_URL: origin, DB: { prepare: statement } },
    ctx: { waitUntil() { throw new Error("Unexpected background mutation"); } },
  };
}

async function render(context, query = "", init = {}) {
  return worker.fetch(new Request(`${origin}/watch/${context.slug}${query}`, {
    headers: { "User-Agent": "VidBest-SEO-Audit/1.0" }, ...init,
  }), context.env, context.ctx);
}

function imageTag(html) {
  return html.match(/<img class="tiktok-preview-card-image"[^>]*>/)?.[0] || "";
}

test("watch first paint uses the selected illustration without changing owner text, dates or metadata", async (t) => {
  const c = serverContext(); t.after(() => c.sqlite.close());
  const before = c.sqlite.prepare("SELECT * FROM videos ORDER BY id").all();
  const metadata = c.sqlite.prepare("SELECT * FROM tiktok_oembed_cache").all();
  const response = await render(c);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(imageTag(html).includes(`src="${cover}"`));
  assert.ok(imageTag(html).includes(`data-tiktok-owned-cover="${cover}"`));
  assert.match(imageTag(html), /style="object-fit:contain"/);
  assert.match(imageTag(html), /loading="eager"/);
  assert.ok(html.includes(illustrationLabel));
  assert.ok(html.includes('<link rel="canonical" href="https://vid.best/watch/watch-cover-test">'));
  assert.ok(html.includes(`<meta property="og:image" content="${cover}">`));
  assert.match(html, /<h1>Owner review title<\/h1>/);
  assert.ok(html.includes("Owner review — final paragraph."));
  assert.doesNotMatch(html, /Last updated|<iframe|<video|"@type":"VideoObject"/);
  assert.match(html, /\/watch\.js\?v=20261018-oembed-cache/);
  assert.deepEqual(c.sqlite.prepare("SELECT * FROM videos ORDER BY id").all(), before);
  assert.deepEqual(c.sqlite.prepare("SELECT * FROM tiktok_oembed_cache").all(), metadata);
  const head = await render(c, "", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("selected cover also works without cached metadata and in the existing noindex preparation document", async (t) => {
  const c = serverContext({ cached: false }); t.after(() => c.sqlite.close());
  const response = await render(c, "?viewer=1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  assert.ok(imageTag(await response.text()).includes(`src="${cover}"`));
});

test("an approved real local source poster is preserved and never called an illustration", async (t) => {
  const poster = "/review-covers/owner-source-poster-v1.jpg";
  const c = serverContext({ thumbnail: poster }); t.after(() => c.sqlite.close());
  const html = await (await render(c)).text();
  assert.ok(imageTag(html).includes(`src="${origin}${poster}"`));
  assert.doesNotMatch(html, /Illustrated cover/);
  assert.match(html, /class="tiktok-preview-card-kicker">TikTok preview/);
});

test("unapproved cover addresses do not change the provider-first path", async () => {
  for (const thumbnail of [null, "", "https://elsewhere.example/review-covers/cover.webp",
    "https://user:password@vid.best/review-covers/cover.webp", `${cover}?private=fixture`, `${cover}#fragment`,
    "/review-covers/cover.svg", "/media/uploads/cover.webp", "/review-covers/nested/cover.webp",
    "/review-covers/%63over.webp", "javascript:alert(1)"]) {
    const c = serverContext({ thumbnail });
    try {
      const html = await (await render(c)).text();
      assert.ok(imageTag(html).includes(`src="${providerPoster}"`), String(thumbnail));
      assert.doesNotMatch(imageTag(html), /data-tiktok-owned-cover|object-fit:contain/);
      assert.doesNotMatch(html, /Illustrated cover · not a video frame/);
    } finally { c.sqlite.close(); }
  }
});

test("comedy, Summer and Saiyaara keep their existing presentation and player routes", async () => {
  for (const settings of [
    { category: "Funny & Comedy" },
    { slug: "summer-inverted-7332342275151760642" },
    { slug: "saiyaara-a-cinematic-romance" },
  ]) {
    const c = serverContext(settings);
    try {
      const html = await (await render(c)).text();
      assert.doesNotMatch(html, /data-tiktok-owned-cover|Illustrated cover · not a video frame/);
      if (settings.slug === "saiyaara-a-cinematic-romance") {
        assert.match(html, /https:\/\/widget\.tagembed\.com\/2236794\?postId=5592899&amp;caption=1&amp;header=1/);
        assert.doesNotMatch(html, /class="tiktok-preview-card"/);
      } else assert.ok(imageTag(html).includes(`src="${providerPoster}"`));
      const prepared = await (await render(c, "?viewer=1")).text();
      assert.ok(imageTag(prepared).includes(`src="${providerPoster}"`));
      assert.doesNotMatch(prepared, /data-tiktok-owned-cover|<iframe|<video/);
    } finally { c.sqlite.close(); }
  }
});

function browserHarness({ owned = cover, apiAvailable = true, failedBeforeInit = false, zeroRequest = false } = {}) {
  const events = {}, calls = [], opened = [], created = [];
  let resolve, reject;
  const metadata = new Promise((yes, no) => { resolve = yes; reject = no; });
  const imageEvents = {};
  const image = {
    dataset: { tiktokFallback: fallback, ...(owned ? { tiktokOwnedCover: owned } : {}) },
    style: { objectFit: owned ? "contain" : "" }, complete: failedBeforeInit, naturalWidth: 0,
    addEventListener(type, fn) { imageEvents[type] = fn; },
    removeAttribute(name) { if (name === "data-tiktok-owned-cover") delete this.dataset.tiktokOwnedCover; },
  };
  let src = new URL(owned || providerPoster, origin).href;
  Object.defineProperty(image, "src", { get: () => src, set(value) { src = new URL(value, origin).href; calls.push(src); } });
  const title = { textContent: "Original source title" }, author = { textContent: "creator" }, description = { textContent: "Cached description" };
  const kicker = { textContent: owned === cover ? illustrationLabel : "TikTok preview" };
  const buttons = [{}, {}];
  for (const button of buttons) button.addEventListener = (_type, fn) => { button.click = fn; };
  const card = {
    isConnected: true, dataset: { tiktokSource: source, ...(zeroRequest ? { tiktokZeroRequest: "1" } : {}) },
    querySelector(selector) { return ({ ".tiktok-preview-card-image": image, "[data-tiktok-card-title]": title,
      "[data-tiktok-card-author]": author, "[data-tiktok-card-description]": description, ".tiktok-preview-card-kicker": kicker })[selector] || null; },
    querySelectorAll(selector) { assert.equal(selector, "[data-tiktok-show-preview]"); return buttons; },
  };
  const serviceCalls = [];
  const api = {
    parse(value) { assert.equal(value, source); return { url: source }; },
    getMetadata(value) { serviceCalls.push(value); return metadata; },
    showPreview(url, seed) { opened.push({ url, seed }); },
  };
  const document = {
    body: { dataset: { viewerEmbed: "1" } }, head: { append() {} },
    querySelector(selector) { return selector === ".tiktok-preview-card" ? card : null; },
    addEventListener(type, fn) { events[type] = fn; },
    getElementById() { return null; },
    createElement(type) { created.push(type); return { textContent: "" }; },
  };
  vm.runInNewContext(watchSource, { document, window: { VidBestTikTok: apiAvailable ? api : undefined },
    location: { origin }, URL, console, fetch() { throw new Error("Unexpected network request"); } });
  events.DOMContentLoaded();
  return { image, card, calls, opened, created, title, kicker, buttons, serviceCalls,
    resolve, reject, error: () => imageEvents.error(), initialize: events.DOMContentLoaded };
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

test("opt-in zero-request watch cards make no old-gateway refresh before or after a deliberate Play click", () => {
  const h = browserHarness({ zeroRequest: true });
  assert.equal(h.serviceCalls.length, 0); assert.equal(h.opened.length, 0);
  h.buttons[0].click({ preventDefault() {} });
  assert.equal(h.opened.length, 1); assert.equal(h.serviceCalls.length, 0);
  assert.equal(h.image.src, cover); assert.equal(h.kicker.textContent, illustrationLabel);
});

test("full watch script keeps the local image and label after refresh; Play remains user-initiated", async () => {
  const h = browserHarness();
  assert.equal(h.image.src, cover);
  assert.equal(h.opened.length, 0);
  h.resolve({ title: "Refreshed source title", thumbnail_url: providerPoster }); await settle();
  assert.equal(h.title.textContent, "Refreshed source title");
  assert.equal(h.image.src, cover);
  assert.equal(h.kicker.textContent, illustrationLabel);
  assert.deepEqual(h.calls, []);
  assert.equal(h.created.some(type => ["video", "iframe", "script"].includes(type)), false);
  h.initialize(); assert.equal(h.serviceCalls.length, 1);
  h.buttons[0].click({ preventDefault() {} });
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].url, source);
  assert.equal(h.opened[0].seed.thumbnail, cover);
});

test("failed local cover releases its label/contain style and uses a finite existing fallback", async () => {
  for (const failedBeforeInit of [false, true]) {
    const h = browserHarness({ failedBeforeInit });
    if (!failedBeforeInit) h.error();
    assert.equal(h.image.src, origin + fallback);
    assert.equal(h.kicker.textContent, "TikTok preview");
    assert.equal(h.image.style.objectFit, "");
    assert.equal(h.image.dataset.tiktokOwnedCover, undefined);
    h.resolve({ thumbnail_url: providerPoster }); await settle();
    assert.equal(h.image.src, providerPoster);
    h.error(); assert.equal(h.image.src, origin + fallback);
    const count = h.calls.length; h.error(); assert.equal(h.calls.length, count);
    assert.equal(h.calls.includes(cover), false);
  }
});

test("refresh failure, detached cards and missing preview service do not remove the server cover", async () => {
  const h = browserHarness(); h.reject(new Error("temporary metadata failure")); await settle();
  assert.equal(h.image.src, cover); assert.equal(h.kicker.textContent, illustrationLabel);
  const detached = browserHarness(); detached.card.isConnected = false;
  detached.resolve({ title: "Late title", thumbnail_url: providerPoster }); await settle();
  assert.equal(detached.image.src, cover); assert.equal(detached.title.textContent, "Original source title");
  const unavailable = browserHarness({ apiAvailable: false });
  assert.equal(unavailable.image.src, cover); assert.equal(unavailable.serviceCalls.length, 0);
});

test("cards without an approved owned-cover marker retain provider refresh behavior", async () => {
  for (const owned of [null, "https://external.example/review-covers/fixture.webp", `${cover}?not-approved=1`, "/media/uploads/fixture.webp"]) {
    const h = browserHarness({ owned });
    h.resolve({ thumbnail_url: providerPoster }); await settle();
    assert.equal(h.image.src, providerPoster);
  }
});
