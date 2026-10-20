import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/seo-edge.js";

const origin = "https://vid.best";
const ownerTitle = "Owner's video title & original identity";
const source = "https://www.youtube.com/watch?v=j8x_YJtsUaQ";
const embed = "https://www.youtube-nocookie.com/embed/j8x_YJtsUaQ?rel=0";
const poster = "/review-covers/owner-poster.webp";
const created = "2026-10-11T13:29:15.091Z";
const updated = "2026-10-12T10:01:02.003Z";
const description = "Owner listing description — unchanged.";
const review = "1. Original heading\n\nOwner review paragraph.\n\n2. Final heading\n\nOwner final paragraph.";

function context({ seoTitle = "Editorial SEO title — choosing the right version", title = ownerTitle,
  slug = "metadata-title-fixture", category = "Music", provider = "youtube", published = 1 } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql", "0002_discovery_requests.sql", "0003_security_rate_limits.sql",
    "0004_maintenance_indexes.sql", "0005_source_video_metadata.sql", "0009_app_settings.sql",
    "0010_video_analysis.sql", "0014_member_notifications.sql", "0016_rights_certified_r2_cache.sql",
    "0017_authorized_auto_cache.sql", "0018_tiktok_oembed_cache.sql", "0019_tiktok_oembed_backfill.sql",
    "0020_member_personalization.sql", "0022_facebook_readable_slugs.sql", "0030_facebook_preview_jobs.sql",
  ]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const sourceUrl = provider === "tiktok"
    ? "https://www.tiktok.com/@fixture/video/7622472784039415061" : source;
  sqlite.prepare(`INSERT INTO videos
    (id,slug,title,source_url,embed_url,media_type,primary_category,subcategory,description,
     review_text,seo_title,seo_description,seo_tags,thumbnail_url,published,created_at,updated_at,
     views,reaction_count,comments_count)
    VALUES (901,?,?,?,?,?,?,'Music Videos',?,?,?,?,?,?, ?,?,?,23,7,2)`)
    .run(slug, title, sourceUrl, provider === "youtube" ? embed : null, provider, category,
      description, review, seoTitle, "Owner SEO description", '["owner","original"]', poster,
      published, created, updated);
  sqlite.prepare("INSERT INTO video_source_metadata (video_id,source_published_at,source_duration) VALUES (901,?,?)")
    .run("2020-01-02T00:00:00Z", "PT3M");
  function statement(sql, params = []) {
    assert.match(sql.trim(), /^SELECT\b/i, "A metadata render must not prepare a data mutation");
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return sqlite.prepare(sql).get(...params) || null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...params) }; },
      async run() { throw Error("Unexpected database write"); },
    };
  }
  return {
    sqlite, slug, title,
    env: { PUBLIC_BASE_URL: origin, DB: { prepare: statement } },
    ctx: { waitUntil() { throw Error("Unexpected background mutation"); } },
  };
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const clean = value => String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ")
  .replace(/\s+/g, " ").trim().slice(0, 70);
const schema = html => JSON.parse(html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1])["@graph"];
const snapshot = c => c.sqlite.prepare("SELECT * FROM videos ORDER BY id").all();
const request = (c, suffix = "", method = "GET") => worker.fetch(new Request(`${origin}/watch/${c.slug}${suffix}`, {
  method, headers: { "User-Agent": "VidBest-SEO-Audit/1.0" },
}), c.env, c.ctx);

function assertMetadata(html, selected) {
  assert.equal([...html.matchAll(/<title\b/g)].length, 1);
  assert.ok(html.includes(`<title>${escape(selected)} | Vid.Best</title>`));
  assert.ok(html.includes(`<meta property="og:title" content="${escape(selected)}">`));
  assert.ok(html.includes(`<meta name="twitter:title" content="${escape(selected)}">`));
  assert.equal(schema(html).find(x => x["@type"] === "WebPage").name, selected);
}

test("saved SEO title supplies server metadata without rewriting owner titles, prose, dates or source", async t => {
  const seoTitle = '✨ Review & choice — <new perspective> "owner"';
  const c = context({ seoTitle }); t.after(() => c.sqlite.close());
  const before = snapshot(c);
  const response = await request(c);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const html = await response.text();
  assertMetadata(html, seoTitle);
  assert.ok(html.includes(`<h1>${escape(ownerTitle)}</h1>`));
  assert.ok(html.includes(escape(description)));
  for (const paragraph of review.split("\n\n")) assert.ok(html.includes(escape(paragraph)));
  const frame = html.match(/<iframe[^>]*src="([^"]+)"[^>]*>/)?.[1].replaceAll("&amp;", "&");
  assert.ok(frame);
  assert.equal(new URL(frame).origin + new URL(frame).pathname, "https://www.youtube-nocookie.com/embed/j8x_YJtsUaQ");
  assert.ok(html.includes(`title="${escape(ownerTitle)}"`));
  assert.ok(html.includes(`<link rel="canonical" href="${origin}/watch/${c.slug}">`));
  assert.ok(html.includes(`<meta property="og:image" content="${origin}${poster}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${origin}${poster}">`));
  const graph = schema(html), page = graph.find(x => x["@type"] === "WebPage"), video = graph.find(x => x["@type"] === "VideoObject");
  assert.equal(video.name, ownerTitle);
  assert.equal(video.embedUrl, frame);
  assert.equal(video.uploadDate, "2020-01-02T00:00:00Z");
  assert.equal(video.duration, "PT3M");
  assert.deepEqual(video.thumbnailUrl, [origin + poster]);
  assert.equal(page.datePublished, created);
  assert.equal(page.dateModified, updated);
  assert.equal(page.isBasedOn, source);
  assert.equal(graph.find(x => x["@type"] === "BreadcrumbList").itemListElement.at(-1).name, ownerTitle);
  assert.doesNotMatch(html, /Last updated|&lt;script&gt;/);
  assert.deepEqual(snapshot(c), before);
});

test("empty and whitespace/control-only SEO titles fall back to the unchanged display title", async t => {
  for (const seoTitle of ["", " \t\r\n ", "\u0000\u0001\u007f\t"]) {
    const c = context({ seoTitle, title: "  ✨ Owner   & identity\nunchanged  " });
    t.after(() => c.sqlite.close());
    const before = snapshot(c), html = await (await request(c)).text();
    assertMetadata(html, clean(c.title));
    assert.ok(html.includes(`<h1>${escape(c.title)}</h1>`));
    assert.deepEqual(snapshot(c), before);
  }
});

test("SEO title normalization keeps the existing 70-character bound and escapes metadata safely", async t => {
  for (const seoTitle of [" \t✨  Review\nchoice \u0001 & context\u007f ", "A".repeat(90), '</title><script>alert("x")</script> & \'owner\'']) {
    const c = context({ seoTitle }); t.after(() => c.sqlite.close());
    const before = snapshot(c), html = await (await request(c)).text();
    assertMetadata(html, clean(seoTitle));
    assert.doesNotMatch(html, /<script>alert\("x"\)<\/script>/);
    assert.deepEqual(snapshot(c), before);
  }
});

test("protected comedy and TikTok player/display identities remain unchanged with separate SEO metadata", async t => {
  for (const settings of [
    { category: "Funny & Comedy" },
    { slug: "summer-inverted-7332342275151760642", provider: "tiktok" },
    { slug: "saiyaara-a-cinematic-romance", provider: "tiktok" },
  ]) {
    const c = context(settings); t.after(() => c.sqlite.close());
    const before = snapshot(c), html = await (await request(c)).text();
    assertMetadata(html, before.find(r => r.id === 901).seo_title);
    assert.ok(html.includes(`<h1>${escape(ownerTitle)}</h1>`));
    for (const paragraph of review.split("\n\n")) assert.ok(html.includes(escape(paragraph)));
    if (settings.slug === "saiyaara-a-cinematic-romance") {
      assert.ok(html.includes("https://widget.tagembed.com/2236794?postId=5592899&amp;caption=1&amp;header=1"));
    } else if (settings.provider === "tiktok") {
      assert.match(html, /class="tiktok-preview-card"/);
      assert.doesNotMatch(html, /widget\.tagembed\.com/);
    } else assert.equal(schema(html).find(x => x["@type"] === "VideoObject").name, ownerTitle);
    assert.deepEqual(snapshot(c), before);
  }
});

test("viewer preparation, HEAD and unpublished routes keep their existing indexing and write boundaries", async t => {
  const c = context(); t.after(() => c.sqlite.close());
  const before = snapshot(c);
  const viewer = await request(c, "?viewer=1");
  assert.equal(viewer.status, 200);
  assert.match(viewer.headers.get("X-Robots-Tag"), /noindex/);
  assertMetadata(await viewer.text(), before.find(r => r.id === 901).seo_title);
  const head = await request(c, "", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.deepEqual(snapshot(c), before);
  const draft = context({ published: 0 }); t.after(() => draft.sqlite.close());
  const draftBefore = snapshot(draft);
  const response = await request(draft);
  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes("Editorial SEO title"));
  assert.deepEqual(snapshot(draft), draftBefore);
});
