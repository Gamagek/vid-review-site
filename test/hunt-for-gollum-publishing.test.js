import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { reviewIllustration, reviewSourcePreview } from "../src/review-illustrations.js";

const payload = JSON.parse(readFileSync(new URL("../content/editorial-quality/2026-10-23-hunt-for-gollum.json", import.meta.url), "utf8"));
const row = { id: 522, slug: payload.slug, title: payload.title, source_url: payload.source_url, thumbnail_url: payload.thumbnail_url, published: 1, media_type: "youtube" };

test("single-film editorial payload keeps authentic identity, full review and canonical source", () => {
  assert.equal(payload.youtube_id, "9H09xnhlCQU");
  assert.equal(payload.embed_url, "https://www.youtube-nocookie.com/embed/9H09xnhlCQU?rel=0");
  assert.equal(payload.primary_category, "Entertainment, Movies & Games");
  assert.equal(payload.subcategory, "Film Reviews");
  assert.ok(payload.review_text.length > 4000);
  assert.ok(payload.review_text.includes("Adrian Webster plays Aragorn"));
  assert.ok(payload.review_text.includes("Arithir is a separate supporting Ranger"));
  assert.ok(payload.review_text.includes("Adam Langston and Andrew Skrabutenas"));
  assert.ok(!payload.review_text.includes("official Warner Bros. feature"));
  assert.ok(payload.seo_description.length <= 180);
  assert.equal(payload.source_duration, "PT39M7S");
  assert.equal(payload.original_film_release_date, "2009-05-03");
});

test("two separate illustrated review assets have source guards and genuine visible watermarks", () => {
  const art = reviewIllustration(row);
  assert.ok(art);
  assert.equal(art.displayWatermark, "vid.best");
  assert.ok(art.companionImage);
  assert.notEqual(art.path, art.companionImage.path);
  for (const entry of [art, art.companionImage]) {
    const file = new URL("../public" + entry.path, import.meta.url);
    assert.ok(existsSync(file), "asset exists: " + entry.path);
    const svg = readFileSync(file, "utf8");
    assert.match(svg, /viewBox="0 0 1280 720"/);
    assert.match(svg, /vid\.best/);
    assert.match(svg, /Not a captured frame|Not a film still|Not a captured frame from a film|Not a film frame|Not a film still|not a captured frame|Not a film still|Not a film frame|Not a film still|not film footage|Not a captured frame|Not a film still/i);
  }
  assert.equal(reviewSourcePreview(row, row.thumbnail_url, "https://vid.best"), null, "do not mislabel conceptual images as original film capture");
  assert.equal(reviewIllustration({ ...row, published: 0 }), null);
  assert.equal(reviewIllustration({ ...row, title: "Unrelated title" }), null);
  assert.equal(reviewIllustration({ ...row, source_url: "https://www.youtube.com/watch?v=DIFFERENT" }), null);
});
