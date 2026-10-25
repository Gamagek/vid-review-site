import assert from "node:assert/strict";
import test from "node:test";
import {
  cacheTikTokThumbnail,
  validThumbnailSource,
  thumbnailKey,
} from "../src/tiktok-thumbnail-cache.js";
import { PRESERVED_TIKTOK_THUMBNAIL_IDS } from "../src/tiktok-image.js";

// All source checks run before any network/storage write.
test("never fetch or store reference videos or a cross-video TikTok thumbnail", async t => {
  let network = 0, storage = 0;
  t.mock.method(globalThis, "fetch", async () => { network++; throw Error("unexpected network"); });
  const env = { BUCKET: { head: async () => { storage++; throw Error("unexpected R2"); } } };
  assert.equal(PRESERVED_TIKTOK_THUMBNAIL_IDS.length, 4);
  for (const id of PRESERVED_TIKTOK_THUMBNAIL_IDS) {
    await assert.rejects(cacheTikTokThumbnail(env, {
      video_id: id,
      source_url: "https://www.tiktok.com/@creator/video/" + id,
      thumbnail_url: "https://p19-sign.tiktokcdn-us.com/photo.jpg",
    }), /excluded/);
  }
  await assert.rejects(cacheTikTokThumbnail(env, {
    video_id: "7611111111111111111",
    source_url: "https://www.tiktok.com/@creator/video/7622222222222222222",
    thumbnail_url: "https://p19-sign.tiktokcdn-us.com/photo.jpg",
  }), /excluded/);
  assert.equal(network, 0);
  assert.equal(storage, 0);
});

test("original image bytes are stored unchanged, with safe MIME, bounded size and canonical source ID", async t => {
  const id = "7611111111111111111";
  const source = "https://www.tiktok.com/@creator/video/" + id;
  const url = "https://p19-sign.tiktokcdn-us.com/original-image.jpg";
  const originalBytes = Uint8Array.of(0xff,0xd8,0xff,0xe0,0x00,0xff,0xd9);
  let calls = 0, saved, savedOptions, savedKey;
  const writes = [];
  t.mock.method(globalThis, "fetch", async (requested, options) => {
    calls++;
    assert.equal(requested, url);
    assert.equal(options.redirect, "manual");
    return new Response(originalBytes, {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(originalBytes.length) },
    });
  });
  const env = {
    BUCKET: {
      head: async key => { assert.equal(key, thumbnailKey(id)); return null; },
      put: async (key, bytes, options) => {
        savedKey = key;
        saved = new Uint8Array(bytes);
        savedOptions = options;
      },
    },
    DB: { prepare(sql) { return { bind(...args) { return {
      async run() { writes.push({ sql, args }); return { success:true, meta:{changes:1} }; },
    }; } }; } },
  };
  const result = await cacheTikTokThumbnail(env, { id: 412, video_id:id, source_url:source, thumbnail_url:url });
  assert.equal(result.status, "complete");
  assert.equal(result.thumbnail_url, "https://vid.best/media/" + thumbnailKey(id));
  assert.equal(savedKey, thumbnailKey(id));
  assert.deepEqual(saved, originalBytes, "Never regenerate, redraw, watermark, crop, or re-encode");
  assert.equal(savedOptions.httpMetadata.contentType, "image/jpeg");
  assert.equal(savedOptions.customMetadata.video_id, id);
  assert.equal(calls, 1);
  assert.equal(writes.length, 2);
  assert.equal(validThumbnailSource("https://not-tiktok.example.com/photo.jpg"), null);
  assert.equal(validThumbnailSource("http://p19-sign.tiktokcdn-us.com/photo.jpg"), null);
});
