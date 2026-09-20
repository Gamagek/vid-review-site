import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import seoWorker from "../src/seo-edge.js";

const migrations = [
  "0001_initial.sql",
  "0002_discovery_requests.sql",
  "0003_security_rate_limits.sql",
  "0004_maintenance_indexes.sql",
  "0005_source_video_metadata.sql",
  "0006_test_player_and_comment_images.sql",
  "0007_universal_video_experience.sql",
  "0008_verified_demo_metadata.sql",
  "0009_app_settings.sql",
  "0010_video_analysis.sql",
  "0011_spirituality_buddhism.sql",
];

class TestD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new TestD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) || null;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }
}

class TestD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new TestD1Statement(this.database, sql);
  }
}

function createContext() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }

  return {
    sqlite,
    env: {
      APP_NAME: "Vid.Best",
      PUBLIC_BASE_URL: "https://vid.best",
      DB: new TestD1Database(sqlite),
      ASSETS: {
        async fetch() {
          return new Response(`<!doctype html><html><head><title>Vid.Best — Video Review & Discovery</title><meta name="description" content="Discover thoughtful video reviews, tutorials, culture, technology, education and trending stories on Vid.Best."><meta property="og:title" content="Vid.Best — Video Review & Discovery"></head><body><main><h1>Find videos worth <em>your time.</em></h1></main><footer>Footer</footer></body></html>`, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        },
      },
    },
    ctx: { waitUntil() {} },
  };
}

function request(context, url, init = {}) {
  return seoWorker.fetch(new Request(url, init), context.env, context.ctx);
}

test("redirects the legacy home subdomain to the canonical origin", async () => {
  const context = createContext();
  const response = await request(context, "https://home.vid.best/watch/example");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), "https://vid.best/watch/example");
});

test("redirects www to the canonical origin", async () => {
  const context = createContext();
  const response = await request(context, "https://www.vid.best/");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), "https://vid.best/");
});

test("homepage query/filter URLs are noindex while the root remains crawlable", async () => {
  const context = createContext();
  const response = await request(context, "https://vid.best/?q=technology&sort=trending");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex,follow/);
  const html = await response.text();
  assert.match(html, /Vid\.Best — Video Reviews, Tutorials & Discoveries/);
  assert.match(html, /Video reviews, tutorials &amp; discoveries worth <em>your time\.<\/em>/);
  assert.match(html, /href="https:\/\/vid\.best\/category\/technology"/);
});

test("category hubs are server-rendered, linked with real anchors, and structured", async () => {
  const context = createContext();
  for (let i = 1; i <= 3; i += 1) {
    context.sqlite.prepare(
      `INSERT INTO videos (
        slug, title, source_url, media_type, primary_category, subcategory,
        description, review_text, published, updated_at
      ) VALUES (?, ?, ?, 'raw', 'Technology', 'Web Development', ?, ?, 1, ?)`,
    ).run(
      `technology-${i}`,
      `Technology review ${i}`,
      `https://example.com/${i}.mp4`,
      `Useful technology description ${i}`,
      `Original review notes ${i}`,
      `2026-09-${10 + i}T00:00:00.000Z`,
    );
  }

  const response = await request(context, "https://vid.best/category/technology");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("X-Robots-Tag"), /index,follow/);
  const html = await response.text();
  assert.match(html, /<h1>Technology video reviews<\/h1>/);
  assert.match(html, /href="https:\/\/vid\.best\/watch\/technology-1"/);
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(html, /"@type":"ItemList"/);
});

test("only substantive category hubs enter the category sitemap", async () => {
  const context = createContext();
  for (let i = 1; i <= 3; i += 1) {
    context.sqlite.prepare(
      `INSERT INTO videos (
        slug, title, source_url, media_type, primary_category, subcategory, published
      ) VALUES (?, ?, ?, 'raw', ?, ?, 1)`,
    ).run(
      `tech-${i}`,
      `Tech ${i}`,
      `https://example.com/tech-${i}.mp4`,
      "Technology",
      "Web Development",
    );
  }
  context.sqlite.prepare(
    `INSERT INTO videos (
      slug, title, source_url, media_type, primary_category, subcategory, published
    ) VALUES ('music-1', 'Music 1', 'https://example.com/music.mp4', 'raw', 'Music', 'Music Videos', 1)`,
  ).run();

  const response = await request(context, "https://vid.best/sitemap.xml");
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.match(xml, /https:\/\/vid\.best\/sitemaps\/videos-1\.xml/);
  assert.match(xml, /https:\/\/vid\.best\/sitemaps\/categories\.xml/);

  const categories = await request(context, "https://vid.best/sitemaps/categories.xml");
  const categoryXml = await categories.text();
  assert.match(categoryXml, /https:\/\/vid\.best\/category\/technology/);
  assert.doesNotMatch(categoryXml, /https:\/\/vid\.best\/category\/music/);
});


test("video pages expose a crawlable category breadcrumb", async () => {
  const context = createContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
      slug, title, source_url, media_type, primary_category, subcategory, description, published
    ) VALUES ('breadcrumb-video', 'Breadcrumb video', 'https://example.com/breadcrumb.mp4', 'raw', 'Technology', 'Web Development', 'A crawlable breadcrumb test video', 1)`,
  ).run();

  const response = await request(context, "https://vid.best/watch/breadcrumb-video");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /class="vidbest-seo-breadcrumb"/);
  assert.match(html, /href="https:\/\/vid\.best\/category\/technology"/);
  assert.match(html, /"item":"https:\/\/vid\.best\/category\/technology"/);
});
