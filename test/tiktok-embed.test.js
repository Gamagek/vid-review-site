import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const code = readFileSync(new URL("../public/tiktok-preview-service.js", import.meta.url), "utf8");
const share = "https://www.tiktok.com/@creator/video/6718335390845095173";

function payload(extra = {}) {
  return {
    ok: true,
    mode: "metadata-card",
    video_id: "6718335390845095173",
    source_url: share,
    open_url: share,
    title: "Cached title",
    author_name: "creator",
    description: "Cached description",
    thumbnail_url: "https://p16-common-sign.tiktokcdn-us.com/example.jpg",
    ...extra,
  };
}

function harness(fetcher = async () => Response.json(payload())) {
  const saved = new Map();
  const window = {};
  const context = {
    window,
    URL,
    AbortSignal,
    Response,
    location: { origin: "https://vid.best" },
    fetch: fetcher,
    sessionStorage: {
      getItem: (key) => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    document: {},
  };
  runInNewContext(code, context);
  return { api: window.VidBestTikTok, saved };
}

test("metadata requests coalesce and pass the canonical TikTok URL once", async () => {
  let calls = 0;
  let finish;
  const h = harness(async (target) => {
    calls += 1;
    const url = new URL(target, "https://vid.best");
    assert.equal(url.pathname, "/api/tiktok/embed");
    assert.equal(url.searchParams.get("url"), share);
    await new Promise((resolve) => { finish = resolve; });
    return Response.json(payload());
  });

  const jobs = Array.from({ length: 20 }, () => h.api.getMetadata(share + "?tracking=1"));
  assert.equal(calls, 1);
  finish();
  await Promise.all(jobs);
  await h.api.getMetadata(share);
  assert.equal(calls, 1);
});

test("429 response stores a retry deadline and avoids repeated requests", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls += 1;
    return Response.json({ ok: false, error: "Rate limited" }, {
      status: 429,
      headers: { "Retry-After": "120" },
    });
  });

  await assert.rejects(h.api.getMetadata(share));
  await assert.rejects(h.api.getMetadata(share));
  assert.equal(calls, 1);
  assert.ok([...h.saved.values()].some((value) => JSON.parse(value).until > Date.now() + 100000));
});

test("rejects mismatched metadata and unsafe TikTok URLs", async () => {
  const h = harness(async () => Response.json(payload({
    video_id: "7552567024304540959",
  })));
  await assert.rejects(h.api.getMetadata(share), /different/);

  for (const value of [
    share.replace("https:", "http:"),
    share.replace("www.tiktok.com", "user@www.tiktok.com"),
    "https://example.com/@creator/video/6718335390845095173",
  ]) {
    assert.equal(h.api.parse(value), null);
  }
});

test("TikTok browser service mounts Player v1 rather than embed.js", () => {
  assert.match(code, /https:\/\/www\.tiktok\.com/);
  assert.match(code, /\/player\/v1\//);
  assert.doesNotMatch(code, /www\.tiktok\.com\/embed\.js/);
  assert.match(code, /createElement\(["']iframe["']\)/);
  assert.match(code, /onPlayerReady/);
  assert.match(code, /onPlayerError/);
  assert.match(code, /event\.source !== iframe\.contentWindow/);
  assert.match(code, /event\.origin !== PLAYER_ORIGIN/);
  assert.match(code, /requestAnimationFrame/);
  assert.match(code, /cleanupEmbed/);
  assert.match(code, /autoplay", "0"/);
  assert.match(code, /author_name/);
});
