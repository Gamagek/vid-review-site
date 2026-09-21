test("renders the supplied official Saiyaara TikTok embed without fallback UI", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, embed_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    "tiktok-player-test",
    "Admin data title that must not alter official embed",
    "https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056?_r=1&_t=ZS-99uc1Q5QfSR",
    "https://www.tiktok.com/player/v1/7669587518156705056?controls=1",
    "tiktok",
    "Social Media & Trending",
    "TikTok Trending",
    "Official TikTok embed playback test",
  );

  const page = await send(context, "/watch/tiktok-player-test");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /class="tiktok-embed"/);
  assert.match(html, /data-video-id-list="7669587518156705056"/);
  assert.doesNotMatch(html, /<blockquote[^>]*cite="https:\/\/www\.tiktok\.com\/@saiyaara\.4ever\/video\/7669587518156705056"/);
  assert.match(html, /cite="https:\/\/www\.tiktok\.com"/);
  assert.doesNotMatch(html, /player\/v1\/7669587518156705056/);
  assert.match(html, /data-embed-from="embed_page"/);
  assert.match(html, /data-embed-type="curated"/);
  assert.match(html, /data-video-id-list="7669587518156705056"/);
  assert.match(html, /href="https:\/\/www\.tiktok\.com\?refer=embed_page"/);
  assert.match(html, /<a target="_blank" href="https:\/\/www\.tiktok\.com\?refer=embed_page">TikTok<\/a>/);
  assert.doesNotMatch(html, /audio-originale-7669587549221178144/);
  assert.match(html, /data-video-provider="tiktok"/);

  const watchSource = readFileSync(new URL("../public/watch.js", import.meta.url), "utf8");
  assert.doesNotMatch(watchSource, /Play TikTok in popup/);
  assert.doesNotMatch(watchSource, /x-tiktok-player/);
  assert.doesNotMatch(watchSource, /initializeTikTokReliability/);
  assert.doesNotMatch(watchSource, /initializeTikTokPopupFallback/);
});

test("repairs a legacy TikTok record with only its source URL and uses the Saiyaara title", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, 'raw', 'Social Media & Trending', 'TikTok Trending', ?, 1)`,
  ).run(
    "saiyaara-tiktok",
    "Saiyaara movie TikTok",
    "https://www.tiktok.com/@example/video/6718335390845095173",
    "Legacy TikTok source without an embed URL",
  );

  const page = await send(context, "/watch/saiyaara-tiktok");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("<title>Saiyaara; A Cinematic Romance | Vid.Best</title>"));
  assert.ok(html.includes("<h1>Saiyaara; A Cinematic Romance</h1>"));
  assert.ok(html.includes('<iframe id="watch-media-frame" class="tiktok-official-player"'));
  assert.ok(html.includes('https://www.tiktok.com/player/v1/6718335390845095173?'));
  assert.ok(html.includes('controls=1'));
  assert.ok(html.includes('closed_caption=1'));
  assert.ok(html.includes('data-video-provider="tiktok"'));
});

test("discovers direct TikTok URLs without server-side TikTok requests", async () => {
  const context = createTestContext();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected upstream request");
  };
  try {
    const response = await send(
      context,
      "/api/admin/discover?q=" + encodeURIComponent("https://www.tiktok.com/@example/video/6718335390845095173"),
      { method: "GET", headers: { Authorization: `Bearer ${secret}` } },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.results[0].provider, "tiktok");
    assert.equal(payload.results[0].video_id, "6718335390845095173");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redirects the legacy Saiyaara slug to the permanent SEO slug", async () => {
  const context = createTestContext();
  const response = await send(context, "/watch/fyppppppppppppppppppppppp-fyp-ahaanpanday-aneetpadda-saiyaara");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://example.com/watch/saiyaara-a-cinematic-romance");
});
test("renders the official TikTok Embed Player iframe with responsive options", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, embed_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    "tiktok-player-test",
    "Admin data title",
    "https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056?_r=1&_t=ZS-99uc1Q5QfSR",
    "https://www.tiktok.com/player/v1/7669587518156705056?controls=0",
    "tiktok",
    "Social Media & Trending",
    "TikTok Trending",
    "Official TikTok player test",
  );

  const page = await send(context, "/watch/tiktok-player-test");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<iframe[^>]+class="tiktok-official-player"/);
  assert.match(html, /https:\\/\\/www\\.tiktok\\.com\\/player\\/v1\\/7669587518156705056\\?/);
  assert.match(html, /controls=1/);
  assert.match(html, /progress_bar=1/);
  assert.match(html, /volume_control=1/);
  assert.match(html, /fullscreen_button=1/);
  assert.match(html, /timestamp=1/);
  assert.match(html, /music_info=1/);
  assert.match(html, /description=1/);
  assert.match(html, /closed_caption=1/);
  assert.match(html, /autoplay=0/);
  assert.match(html, /muted=0/);
  assert.doesNotMatch(html, /class="tiktok-embed"/);
  assert.doesNotMatch(html, /tiktok\.com\\/embed\.js/);
  assert.match(html, /allow="autoplay; fullscreen; picture-in-picture"/);
  assert.match(html, /data-video-provider="tiktok"/);

  const watchSource = readFileSync(new URL("../public/watch.js", import.meta.url), "utf8");
  assert.match(watchSource, /"x-tiktok-player": true/);
  assert.match(watchSource, /onPlayerError/);
  assert.match(watchSource, /SERVER_ERROR/);
});
 
test("repairs a legacy TikTok record with only its source URL and uses the Saiyaara title", async () => {
  const context = createTestContext();
  context.sqlite.prepare(
    `INSERT INTO videos (
       slug, title, source_url, media_type, primary_category, subcategory, description, published
     ) VALUES (?, ?, ?, 'raw', 'Social Media & Trending', 'TikTok Trending', ?, 1)`,
  ).run(
    "saiyaara-tiktok",
    "Saiyaara movie TikTok",
    "https://www.tiktok.com/@example/video/6718335390845095173",
    "Legacy TikTok source without an embed URL",
  );

  const page = await send(context, "/watch/saiyaara-tiktok");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("<title>Saiyaara; A Cinematic Romance | Vid.Best</title>"));
  assert.ok(html.includes("<h1>Saiyaara; A Cinematic Romance</h1>"));
  assert.ok(html.includes('<blockquote class="tiktok-embed"'));
  assert.ok(html.includes('data-video-id-list="6718335390845095173"'));
  assert.ok(html.includes('data-embed-type="curated"'));
  assert.ok(html.includes('data-video-id-list="6718335390845095173"'));
  assert.ok(html.includes('cite="https://www.tiktok.com"'));
  assert.ok(html.includes('https://www.tiktok.com/embed.js'));
  assert.doesNotMatch(html, /Play TikTok in popup/);
  assert.ok(html.includes('data-video-provider="tiktok"'));
});




test("discovers direct TikTok URLs without server-side TikTok requests", async () => {
  const context = createTestContext();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected upstream request");
  };
  try {
    const response = await send(
      context,
      "/api/admin/discover?q=" + encodeURIComponent("https://www.tiktok.com/@example/video/6718335390845095173"),
      { method: "GET", headers: { Authorization: `Bearer ${secret}` } },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.results[0].provider, "tiktok");
    assert.equal(payload.results[0].video_id, "6718335390845095173");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redirects the legacy Saiyaara slug to the permanent SEO slug", async () => {
  const context = createTestContext();
  const response = await send(context, "/watch/fyppppppppppppppppppppppp-fyp-ahaanpanday-aneetpadda-saiyaara");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://example.com/watch/saiyaara-a-cinematic-romance");
});
