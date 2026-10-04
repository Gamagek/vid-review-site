import assert from "node:assert/strict";
import test from "node:test";
import { parseInstagramUrl } from "../public/instagram-utils.js";

test("normalizes Instagram Reel, post and legacy video URLs without sharing parameters", () => {
  for (const [input, canonical] of [
    ["https://www.instagram.com/reel/DcAcA_QnOLk/?stkn=example", "reel/DcAcA_QnOLk"],
    ["https://instagram.com/reels/Ab_12-3/", "reel/Ab_12-3"],
    ["https://m.instagram.com/p/Ab12/embed/", "p/Ab12"],
    ["https://www.instagram.com/tv/Ab12/", "tv/Ab12"],
  ]) {
    const parsed = parseInstagramUrl(input);
    assert.equal(parsed.sourceUrl, `https://www.instagram.com/${canonical}/`);
    assert.equal(parsed.embedUrl, `https://www.instagram.com/${canonical}/embed/`);
  }
});

test("rejects unsupported, credential-bearing and lookalike Instagram URLs", () => {
  for (const input of [
    "https://www.instagram.com/stories/example/123/", "https://www.instagram.com/example/",
    "https://instagram.com.evil.test/reel/abc/", "https://evil.instagram.com/reel/abc/",
    "https://user:pass@instagram.com/reel/abc/", "http://instagram.com/p/abc/",
    "https://instagram.com:8443/p/abc/", "javascript:alert(1)",
    "https://instagram.com/reel/abc/extra", "https://youtube.com/watch?v=abc",
  ]) assert.equal(parseInstagramUrl(input), null, input);
});
