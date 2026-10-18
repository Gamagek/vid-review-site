import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const names = [
  "expressive-soft-drink", "pol-karu-fashion", "limited-stock", "cake-or-cat",
  "fashion-means-fashion", "late-home-pets", "maths-dance", "unstoppable-cat-music",
];

test("eight original Facebook review illustrations are distinct, labeled and self-contained", () => {
  const assets = new Set();
  for (const name of names) {
    const svg = readFileSync(new URL("../public/review-covers/facebook-" + name + "-concept-v1.svg", import.meta.url), "utf8");
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /width="1200" height="675"/);
    assert.match(svg, /CONCEPT ART/);
    assert.match(svg, /NOT VIDEO FOOTAGE/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|<image\b|<!DOCTYPE|<!ENTITY/i);
    assert.doesNotMatch(svg, /(?:href|src)\s*=\s*["']https?:/i);
    assert.match(svg, /<title[\s>]/);
    assert.match(svg, /<\/svg>\s*$/);
    assets.add(svg);
  }
  assert.equal(assets.size, 8);
});
