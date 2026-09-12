import assert from "node:assert/strict";
import test from "node:test";
import { isLikelyCrawler, sanitizeWatchHtml } from "../src/edge.js";

test("recognizes common search crawlers without flagging ordinary browsers", () => {
  assert.equal(isLikelyCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isLikelyCrawler("Mozilla/5.0 Chrome/140.0 Mobile Safari/537.36"), false);
});

test("removes VideoObject markup when the page only has the site favicon", () => {
  const html = `<!doctype html><head>
    <meta property="og:image" content="https://example.com/favicon.svg">
    <script type="application/ld+json" nonce="abc">{"@type":"VideoObject","thumbnailUrl":["https://example.com/favicon.svg"]}</script>
  </head><body data-video-id="1"><footer>Vid.Best · Human-curated video discovery</footer></body>`;
  const result = sanitizeWatchHtml(html);
  assert.doesNotMatch(result, /application\/ld\+json/);
  assert.match(result, /Curated video discovery/);
});

test("uses verified source publication metadata for external VideoObject markup", () => {
  const html = `<!doctype html><head>
    <meta property="og:image" content="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg">
    <script type="application/ld+json" nonce="abc">{"@context":"https://schema.org","@type":"VideoObject","name":"Test","thumbnailUrl":["https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"],"uploadDate":"2026-09-01T00:00:00.000Z","embedUrl":"https://www.youtube-nocookie.com/embed/abcdefghijk"}</script>
  </head><body data-video-id="1"></body>`;
  const result = sanitizeWatchHtml(html, {
    source_published_at: "2024-05-06T07:08:09Z",
    source_duration: "PT4M12S",
  });
  assert.match(result, /2024-05-06T07:08:09Z/);
  assert.match(result, /PT4M12S/);
  assert.doesNotMatch(result, /2026-09-01T00:00:00\.000Z/);
});

test("omits external VideoObject markup when original publication date is unverified", () => {
  const html = `<!doctype html><head>
    <meta property="og:image" content="https://example.com/video.jpg">
    <script type="application/ld+json" nonce="abc">{"@type":"VideoObject","thumbnailUrl":["https://example.com/video.jpg"],"uploadDate":"2026-09-01T00:00:00Z","embedUrl":"https://www.tiktok.com/player/v1/123"}</script>
  </head><body data-video-id="1"></body>`;
  assert.doesNotMatch(sanitizeWatchHtml(html), /application\/ld\+json/);
});

test("keeps crawlable WebPage and breadcrumb schema when an external VideoObject is unverified", () => {
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": "https://example.com/watch/test", mainEntity: { "@id": "https://example.com/watch/test#video" } },
      { "@type": "VideoObject", "@id": "https://example.com/watch/test#video", thumbnailUrl: ["https://example.com/video.jpg"], embedUrl: "https://player.vimeo.com/video/123" },
      { "@type": "BreadcrumbList", itemListElement: [] },
    ],
  };
  const html = `<!doctype html><head>
    <meta property="og:image" content="https://example.com/video.jpg">
    <script type="application/ld+json" nonce="abc">${JSON.stringify(schema)}</script>
  </head><body data-video-id="1"></body>`;
  const result = sanitizeWatchHtml(html);
  assert.match(result, /application\/ld\+json/);
  assert.match(result, /WebPage/);
  assert.match(result, /BreadcrumbList/);
  assert.doesNotMatch(result, /VideoObject/);
  assert.doesNotMatch(result, /mainEntity/);
});
