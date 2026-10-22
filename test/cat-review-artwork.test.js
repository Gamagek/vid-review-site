import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import illustrations from "../src/review-illustrations.json" with { type: "json" };
import { reviewIllustration } from "../src/review-illustrations.js";

test("cat review artwork is a source-guarded first-party image, not represented as footage", () => {
  const item = illustrations.find(row => row.id === 401);
  assert.ok(item);
  assert.equal(item.slug, "cat-hard-hat-mirror-trick-and-fake-iphone-prank");
  assert.equal(item.sourceUrl, "https://www.youtube.com/shorts/l79eveAPMwk");
  assert.equal(item.path, "/review-illustrations/cat-hard-hat-iphone-sponge-concept-v1.svg");
  assert.match(item.caption, /not a video frame/i);
  const bytes = readFileSync(new URL("../public" + item.path, import.meta.url), "utf8");
  assert.match(bytes, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(bytes, /vid\.best/);
  assert.doesNotMatch(bytes, /<script|onload\s*=|<foreignObject/i);
  const row = { id: 401, slug: item.slug, title: item.expectedTitle, source_url: item.sourceUrl, published: 1 };
  assert.equal(reviewIllustration(row)?.path, item.path);
  assert.equal(reviewIllustration({ ...row, published: 0 }), null);
  assert.equal(reviewIllustration({ ...row, title: "changed title" }), null);
  assert.equal(reviewIllustration({ ...row, source_url: "https://www.youtube.com/shorts/different" }), null);
});
