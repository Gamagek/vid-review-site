import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { backfillYoutubeMetadata } from "../src/youtube-metadata-backfill.js";

function setup(key = "") {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of ["0001_initial.sql", "0005_source_video_metadata.sql"]) {
    sqlite.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  class Statement {
    constructor(sql, parameters = []) { this.sql = sql; this.parameters = parameters; }
    bind(...params) { return new Statement(this.sql, params); }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.parameters) }; }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.parameters);
      return { meta: { changes: result.changes } };
    }
  }
  const env = { DB: { prepare: sql => new Statement(sql) }, YOUTUBE_API_KEY: key };
  const insert = (slug, source, published = 1) => sqlite.prepare(
    "INSERT INTO videos (slug,title,source_url,media_type,primary_category,subcategory,published) " +
    "VALUES (?, ?, ?, 'youtube', 'Music', 'Music Videos', ?)"
  ).run(slug, slug, source, published);
  return { env, sqlite, insert };
}

test("missing YouTube API key makes no provider requests or unverified publication dates", async () => {
  const x = setup();
  x.insert("short-demo", "https://youtu.be/M7lc1UVf-VE");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No network access without a key"); };
  try {
    const result = await backfillYoutubeMetadata(x.env);
    assert.equal(result.status, "not_configured");
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) total FROM video_source_metadata").get().total, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("one verified API batch fills only missing YouTube source metadata and never overwrites existing dates", async () => {
  const x = setup("test-secret");
  x.insert("first", "https://www.youtube.com/watch?v=M7lc1UVf-VE");
  x.insert("second", "https://youtu.be/abcdefghijk");
  x.insert("unpublished", "https://youtu.be/ABCDEFGHIJK", 0);
  x.sqlite.prepare(
    "INSERT INTO video_source_metadata (video_id,source_published_at,source_duration) VALUES (2,'2020-01-01T00:00:00.000Z','PT8M')"
  ).run();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const u = new URL(url);
    assert.equal(u.hostname, "www.googleapis.com");
    assert.equal(u.pathname, "/youtube/v3/videos");
    assert.equal(u.searchParams.get("part"), "snippet,contentDetails");
    assert.deepEqual(u.searchParams.get("id").split(","), ["M7lc1UVf-VE"]);
    return Response.json({ items: [
      { id: "M7lc1UVf-VE", snippet: { publishedAt: "2013-10-15T08:09:10Z" }, contentDetails: { duration: "PT1M2S" } },
      { id: "ABCDEFGHIJK", snippet: { publishedAt: "2018-01-01T00:00:00Z" }, contentDetails: { duration: "PT2M" } },
    ] });
  };
  try {
    const result = await backfillYoutubeMetadata(x.env);
    assert.equal(result.updated, 1);
    assert.equal(calls, 1);
    const row = x.sqlite.prepare("SELECT source_published_at,source_duration FROM video_source_metadata WHERE video_id=1").get();
    assert.equal(row.source_published_at, "2013-10-15T08:09:10.000Z");
    assert.equal(row.source_duration, "PT1M2S");
    assert.equal(x.sqlite.prepare("SELECT source_published_at FROM video_source_metadata WHERE video_id=2").get().source_published_at, "2020-01-01T00:00:00.000Z");
    assert.equal((await backfillYoutubeMetadata(x.env)).updated, 0);
    assert.equal(calls, 1, "no additional API traffic once all candidates are verified");
  } finally { globalThis.fetch = originalFetch; }
});

test("editing a source while an API request is in flight cannot attach the old video's date", async () => {
  const x = setup("test-secret");
  x.insert("editable", "https://youtu.be/M7lc1UVf-VE");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    x.sqlite.prepare("UPDATE videos SET source_url='https://youtu.be/abcdefghijk' WHERE id=1").run();
    return Response.json({ items: [
      { id: "M7lc1UVf-VE", snippet: { publishedAt: "2014-03-04T05:06:07Z" }, contentDetails: { duration: "PT2M" } },
    ] });
  };
  try {
    const result = await backfillYoutubeMetadata(x.env);
    assert.equal(result.updated, 0);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) total FROM video_source_metadata").get().total, 0);
  } finally { globalThis.fetch = originalFetch; }
});
