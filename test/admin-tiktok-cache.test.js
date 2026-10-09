import test from "node:test";
import assert from "node:assert/strict";
import { maybeQueueAdminTikTokCache, retryAdminTikTokCache } from "../src/admin-tiktok-cache.js";

const valid = {
  id: 81, redistribution_certified: 1, media_type: "tiktok",
  source_url: "https://www.tiktok.com/@toop5_/video/7578945803910270230",
  r2_key: null,
};

test("Never auto-queue uncertified or protected videos", () => {
  let calls = 0;
  const ctx = { waitUntil() { calls++; } };
  const env = { VIDBEST_AUTO_CACHE_TIKTOK: "0" };
  maybeQueueAdminTikTokCache(env, ctx, valid);
  maybeQueueAdminTikTokCache(env, ctx, { ...valid, redistribution_certified: 0 });
  maybeQueueAdminTikTokCache(env, ctx, { ...valid,
    source_url: "https://www.tiktok.com/@looooooooch/video/7332342275151760642"
  });
  maybeQueueAdminTikTokCache(env, ctx, { ...valid,
    source_url: "https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056"
  });
  assert.equal(calls, 0);
});

test("manual request verifies saved D1 rights", async () => {
  const env = { DB: { prepare() { return { bind() {
    return { first: async () => ({ ...valid, redistribution_certified: 0 }) };
  } }; } } };
  const response = await retryAdminTikTokCache(env, 81);
  assert.equal(response.status, 400);
});
