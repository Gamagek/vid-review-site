import assert from "node:assert/strict";
import test from "node:test";
import { reviewIllustration, reviewSourcePreview } from "../src/review-illustrations.js";

const reviewedMovies = [
  {
    id: 512,
    slug: "phir-hera-pheri-2006-film-review",
    title: "Phir Hera Pheri (2006) — Raju's Double-Money Trap and Babu Bhaiya's Chaos",
    source_url: "https://www.youtube.com/watch?v=Us6pVG4NK8Q",
    thumbnail_url: "https://vid.best/media/uploads/review-source-images/512-7b35c9b8d370c392.jpg",
  },
  {
    id: 513,
    slug: "hera-pheri-1976-film-review",
    title: "Hera Pheri (1976) — Vijay and Ajay's Friendship on Trial",
    source_url: "https://www.youtube.com/watch?v=TBSjGjhFvnI",
    thumbnail_url: "https://vid.best/media/uploads/review-source-images/513-09350c9e0817e7ae.jpg",
  },
];

test("separate first-party film source previews and conceptual illustration entries", () => {
  for (const movie of reviewedMovies) {
    const video = { ...movie, published: 1, media_type: "youtube" };
    const artwork = reviewIllustration(video);
    assert.ok(artwork, `Expected independent artwork for ID ${movie.id}`);
    assert.match(artwork.path, /^\/media\/uploads\/review-illustrations\/[a-z0-9-]+\.jpg$/);
    assert.equal(artwork.width, 1024);
    assert.equal(artwork.height, 1024);
    assert.equal(artwork.displayWatermark, "vid.best");
    assert.equal(artwork.sha256.length, 64);
    assert.notEqual(artwork.sourceImage.path, artwork.path);
    assert.equal(artwork.sourceImage.url, movie.thumbnail_url);
    const preview = reviewSourcePreview(video, movie.thumbnail_url, "https://vid.best");
    assert.equal(preview?.url, movie.thumbnail_url);
    assert.equal(preview?.width, 640);
    assert.equal(preview?.height, 480);
  }
});

test("unpublished or changed source films never receive a mismatched artwork", () => {
  for (const movie of reviewedMovies) {
    assert.equal(reviewIllustration({ ...movie, published: 0 }), null);
    assert.equal(reviewIllustration({ ...movie, published: 1, title: "An unrelated review" }), null);
    assert.equal(reviewIllustration({ ...movie, published: 1, source_url: "https://www.youtube.com/watch?v=DIFFERENT" }), null);
  }
});
