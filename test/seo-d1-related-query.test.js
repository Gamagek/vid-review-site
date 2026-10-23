import test from "node:test";
import assert from "node:assert/strict";
import { needsSupplementalRelatedReviews } from "../src/seo-edge.js";

test("existing editorial related links skip duplicate D1 enrichment", () => {
  const html = '<article><nav class="related-reviews" aria-label="Related video reviews"><ul><li>Review</li></ul></nav></article>';
  assert.equal(needsSupplementalRelatedReviews(html), false);
});

test("existing legacy supplemental links are not duplicated", () => {
  assert.equal(needsSupplementalRelatedReviews('<section id="vidbest-related-reviews">Reviews</section>'), false);
});

test("SEO enrichment still adds related links to older pages without them", () => {
  assert.equal(needsSupplementalRelatedReviews('<main><article><h1>Review</h1></article></main>'), true);
});

test("related-reviews marker matches normal multi-class navigation", () => {
  assert.equal(needsSupplementalRelatedReviews('<nav class="panel related-reviews compact">Reviews</nav>'), false);
});

test("unrelated navigation does not suppress editorial discovery", () => {
  assert.equal(needsSupplementalRelatedReviews('<nav class="main-navigation">Home</nav>'), true);
});
