# Non-Saiyaara TikTok playback: verified prerequisites

## 20 October 2026: current prerequisites and owner image pause

Image creation is paused until the owner explicitly requests resumption. All earlier instructions in this plan to continue artwork are deferred during the pause. Preserve existing100artworks and saved image queue progress; independent non-image SEO/editorial work may continue.

Current main43a3279 was reconciled before PR236. Read-only D1 at2026-10-20T08:51:06.028Z has54TikTok records, no Tagembed/Iframely embed_url records and no matching app-setting keys. The source still supplies the Saiyaara-only2236794/5592899mapping, which must not be reused for another video. Record81reports complete/certified with no videos.r2_key; flags alone still do not verify an actual permitted playable raw asset. No provider/media request, new mapping, player-chain activation or6second detection is claimed. The existing origin/source/ID checks, cooldowns and source/rights/held-media exclusions remain unchanged.

The owner requested the following order on19October2026: fast thumbnail; a per-video Tagembed mini preview/main player; gateway; Iframely; an additional raw-cache option only for an existing permitted playable cache. A6second decision should use real playback/error evidence. Metadata should be deduplicated and reusable, preferably one refresh per video/day. After this phase, continue original review artwork.

## Current evidence

Main `0d90c25a8acc15b88e4614a7776aa862a9a185f3` contains one owner-supplied Tagembed mapping: widget2236794/post5592899 for Saiyaara only. It is referenced in `public/saiyaara-tagembed.js`, `public/swipe-viewer.js`, `src/index.js` and README. Those are three viewing surfaces of the same post, not evidence that this postId can play every TikTok video. No other Tagembed post mapping or Iframely integration/mapping appears in src/public/README/wrangler. Reusing the Saiyaara URL would show the wrong video. No new provider URL, credential or source mapping was invented.

The read-only D1 snapshot at2026-10-18T22:29:12.839Z has thirteen TikTok records. Record81 reports cache_status=complete and redistribution_certified=true, while all other selected TikTok cache states are none. This alone is not proof that an actual playable raw cache file exists or that all videos have redistribution permission; the raw option must first verify the existing allowed asset through the current server authorization path. This task does not create media caches, relax certification or copy video.

## Required next input and implementation

Obtain verified owner-authorized Tagembed embed URLs/post mappings and Iframely embeds/configuration for the other TikTok source IDs. Then add a bounded identity-checked registry and reuse existing gateway signing/security. Keep Saiyaara and Summer/source30/removal holds unchanged. Metadata/config caching may reduce calls but cannot cache provider video bytes, eliminate iframe/video requests or guarantee one vendor view per day.

Permit at most one active frame/preview. Share pending lookups, retain validated public metadata with a bounded TTL, respect429/Retry-After and stop cancellation/reopen races. Do not store signed playback URLs or expiring thumbnails for a day, poll provider quotas, refresh blocked frames repeatedly or bypass access controls.

At6seconds, an allowed documented postMessage/API signal must be checked against exact origin, iframe contentWindow and source/video ID. Only explicit error/unavailable/quota or a supported playback failure can justify automatic movement to the next registered method. An iframe load event is neither playback proof nor quota-exhaustion proof. If no supported signal exists, show an honest playback-unconfirmed state and the next user-selected option; do not replace a potentially playing frame merely because six seconds elapsed.

Test provider ordering, unknown/forged events, delayed success, explicit errors/429, cooldowns, cancellation, repeated opens, missing mappings, one-active-frame, raw permission/readiness and protected exclusions with simulated events before PR/CI/release. Verify any actual player separately; do not claim source playback from a successful HTML load. No new player code or provider/account/security change is part of the image batch while these mappings are unavailable. Continue safe image work independently.

Image phase checkpoint: PR214 is deployed and live-verified as Worker08e6d1d0-c84f-4521-854e-1294eba20b1d (ten new covers, four guarded generic-SVG TikTok artwork-preview fallbacks;40/234 current artwork coverage). Facebook20/20 and ten non-held TikTok reviews have artwork; TikTok8/30/73 remain held. Provider mapping prerequisites above remain pending; no player-chain activation or provider playback test is claimed. Continue safe remaining artwork independently, preserving source posters and all holds.
