import assert from "node:assert/strict";
import test from "node:test";
import {
  publicTikTokOpenGraphThumbnail,
  fetchPublicTikTokOpenGraphThumbnail,
} from "../src/tiktok-page-thumbnail.js";
import {
  preservedTikTokReference, verifiedTikTokSourceImage,
} from "../src/tiktok-image.js";

const id = "7611111111111111111";
const link = "https://www.tiktok.com/@owner/video/" + id;
const thumb = "https://p16-sign.tiktokcdn.com/cover.jpeg?size=200&amp;format=jpeg";
const html = '<!doctype html><head><meta property="og:url" content="' + link +
  '"><meta property="og:image" content="' + thumb +
  '"><meta property="og:description" content="Actual public post"></head><body>Public video</body>';

test("last-resort HTML metadata requires the exact same TikTok video identity", () => {
  assert.equal(publicTikTokOpenGraphThumbnail(html, link),
    "https://p16-sign.tiktokcdn.com/cover.jpeg?size=200&format=jpeg");
  assert.equal(publicTikTokOpenGraphThumbnail(html, "https://www.tiktok.com/@owner/video/7622222222222222222"), null);
  assert.equal(publicTikTokOpenGraphThumbnail("<html><title>Sign in to TikTok</title></html>", link), null);
  assert.equal(publicTikTokOpenGraphThumbnail(html.replace("tiktokcdn.com", "untrusted.example.com"), link), null);
  assert.equal(publicTikTokOpenGraphThumbnail(html.replace('property="og:url"', 'property="og:other"'), link), null);
  assert.equal(publicTikTokOpenGraphThumbnail(html, "http://www.tiktok.com/@owner/video/" + id), null);
  assert.equal(publicTikTokOpenGraphThumbnail(html, "https://tiktok.com.evil.example/@owner/video/" + id), null);
});

test("public metadata fallback makes at most one bounded, no-redirect HTML request", async () => {
  let requests = 0;
  const fetched = await fetchPublicTikTokOpenGraphThumbnail(link, async (url, options) => {
    requests += 1;
    assert.equal(url, link);
    assert.equal(options.redirect, "manual");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Accept, "text/html");
    assert.equal(options.headers.Cookie, undefined);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  });
  assert.equal(requests, 1);
  assert.equal(fetched, "https://p16-sign.tiktokcdn.com/cover.jpeg?size=200&format=jpeg");

  const blocked = await fetchPublicTikTokOpenGraphThumbnail(link, async () =>
    new Response("Too many requests", {status:429, headers:{"Content-Type":"text/html"}}));
  assert.equal(blocked,null, "a rate limit must never trigger an evasion/retry");

  const redirected = await fetchPublicTikTokOpenGraphThumbnail(link, async () =>
    new Response(null, {status:302, headers:{Location:"https://other.example/"}}));
  assert.equal(redirected,null, "never follow a redirect to an untrusted HTML page");

  const oversized = await fetchPublicTikTokOpenGraphThumbnail(link, async () =>
    new Response("X".repeat(400 * 1024), {headers:{"Content-Type":"text/html"}}));
  assert.equal(oversized,null, "reject oversized documents");
});

test("owner's four references retain existing poster schemes", () => {
  for (const reference of [
    "7603012203595320584", "7332342275151760642",
    "7578945803910270230", "7669587518156705056",
  ]) {
    assert.equal(preservedTikTokReference(reference), true);
    assert.equal(verifiedTikTokSourceImage({
      media_type:"tiktok", source_url:"https://www.tiktok.com/@owner/video/"+reference,
      thumbnail_url:"https://vid.best/media/uploads/tiktok-thumbnails/"+reference+".img",
    }),"");
  }
  assert.equal(preservedTikTokReference(id),false);
  assert.equal(verifiedTikTokSourceImage({
    media_type:"tiktok",source_url:link,
    thumbnail_url:"https://vid.best/media/uploads/tiktok-thumbnails/"+id+".img",
  }),"https://vid.best/media/uploads/tiktok-thumbnails/"+id+".img");
  assert.equal(verifiedTikTokSourceImage({
    media_type:"tiktok",source_url:link,
    thumbnail_url:"https://vid.best/media/uploads/tiktok-thumbnails/7622222222222222222.img",
  }),"","reject mismatched source image IDs");
});
