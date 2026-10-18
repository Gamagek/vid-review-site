# Review artwork discovery and image sitemap (18 October 2026)

## Scope and provenance
Vid.Best has existing editorial/poster verification workflows and rights/source-media holds. This change **does not generate new image files**, fetch protected source frames, overwrite covers, update D1 rows, or claim Google index inclusion. It is an additive discovery/display layer for already-published images. Existing artwork and dates remain the source of truth.

## Routes
- `https://vid.best/image-sitemap.xml` – index for image sitemap pages.
- `https://vid.best/sitemaps/images-1.xml` – published canonical review URLs with an `<image:image><image:loc>…</image:loc></image:image>` element. Pages of 500 records support growth.
- `https://vid.best/sitemap.xml` – now links to the image sitemap index alongside the existing video/page/category/editorial sitemaps.
- `https://vid.best/sitemaps/videos-1.xml` – adds the same image URL to each published review entry's image sitemap extension while retaining existing VideoObject tags.
- `https://vid.best/watch/:slug` – adds a source/artwork-aware server-rendered `<figure><img …></figure>` under the audio panel in the spare desktop column, and below the review on smaller screens.

Images are discovered through normal HTML and sitemap crawling; publishing and sitemap submissions **do not** guarantee Google indexing. Google Search Console Indexing API is restricted to eligible job/livestream content, not ordinary reviews. Never falsify structured data to get around that.

## Operational rollout
1. Keep existing production 200-review inventory and protected artwork unchanged.
2. Run CI and the full existing SEO/image tests and Worker deployment dry-run on the PR head.
3. On deploy, verify `/image-sitemap.xml`, `/sitemaps/images-1.xml`, `/sitemap.xml`, and 3 different `/watch/:slug` documents, including one Facebook with a durable cover, one YouTube, and one mobile viewport.
4. Continue the existing `scripts/thumbnail-audit.mjs` and existing hourly-by-batch automation. Prior audit: 181/200 HTTP-available, 11 HTTP errors, eight deliberate placeholders; verification of image bytes does not verify visual relevance or rights.
5. For batches of **up to 10 reviewed records per hour**, identify missing/expired covers, preserve existing successful owner/source originals, verify provenance/rights, create clearly labeled conceptual artwork only when justified, and publish only tested changes. Mark protected/unverifiable source posters for review rather than inventing actual video frames. The current Cloudflare Worker also runs independent bounded 15-minute Facebook/TikTok preview/cache jobs; do not duplicate their fetching.
6. Search Console: submit the root sitemap (which includes the new image sitemap index) via an authorized, supported Sitemap API or UI after deployment; inspect a small representative sample of canonical URLs. Do not repeatedly request indexation for 200 ordinary reviews via the restricted Google Indexing API.
7. Check Google Search Console Indexing and Image Search reports over subsequent days, and independently review crawl/render/content issues and AdSense policy compliance. No AdSense review request is triggered.

## Rollback
Revert the additive commits to return to the previous watch-page UI and sitemap index. No D1 migrations or R2 media writes are made by this patch.

## Additive illustration batch 1 and flat index repair

The next change supplies ten genuinely generated, visibly labelled **AI-generated review illustrations**, separate from the existing source/owner video posters. IDs: 4, 144, 145, 149, 150, 151, 152, 159, 160, 161. The exact prompts, bytes, dimensions and SHA-256 values are in `docs/review-illustration-prompts.json`; runtime associations are in `src/review-illustrations.json`. Built-in imagegen was used once per asset; WebP encoding preserves the generated composition. These are conceptual art grounded in the published theme and previously documented source verification, not fresh footage/audio observations or copies of source posters. No actor likeness, rescue outcome, health benefit or other unsupported source event is generated or asserted.

The art appears in the spare review column below the player/audio controls, beside the start of the review, and below the review on narrow screens. The containing grid keeps it beside the review even when related links are added. Standard server-rendered `<img src>` markup, descriptive alternative text, explicit dimensions and a visible disclosure support accessibility and discovery. An independent WebPage ImageObject describes the illustration. Existing Open Graph/source posters and VideoObject thumbnails remain unchanged. A different owner title, slug or source disables a stale art association without a database write; unpublished pages are excluded.

The root `/sitemap.xml` now lists `/sitemaps/images-N.xml` directly. `/image-sitemap.xml` remains an independently discoverable index advertised in robots.txt; neither index lists another index. Google explicitly disallows nested sitemap indexes: https://support.google.com/webmasters/answer/7451001#nested_sitemap_index . Only normal image location tags are used, without deprecated caption/title/license tags. Reviews with no source thumbnail can still list their separate illustration. Newly published rows join the dynamic sitemap automatically; generation requires the recorded verification queue, not a fabricated image or empty production commit.

The 17:19:45.523 UTC read-only baseline found **214 saved / 210 published** library records: ten more published records than the earlier audit's 200. This independent owner activity is preserved. Baseline non-counter-field SHA-256: `494f438a0dd202253acc3f14cf8a12220ea54d17484407acbb5ab0186bdac9c8`. Every local migration through 0046 was already applied; this release adds no migration or D1/R2 write. Target row digests and original dates are retained in the queue release evidence. No protected player/media/security configuration changes are part of this work.

Latest consumed completed audit: **39134241726**, artifact **12138698113**, ZIP SHA-256 `87f98f10966e2b1a4838648a4875587e0569162c03d7381a3150f7e63a16b22d`, generated 18 October 2026 14:03:11.258 UTC. It checked the then-current 200 library reviews plus ten separate editorial reviews, 231 pages / zero technical failures; posters 181 available / 11 HTTP errors / eight protected placeholders. It made zero inspections/submissions. Google root processing was not pending, last download 09:11:12.537 UTC, zero errors; library processing retained 20 warnings. These are dated processing/availability results, not a refreshed indexed-page count. The prior dated partial inspection remains 200 of 210 then-known reviews: two PASS / 156 Discovered / 42 unknown. Do not extrapolate it to the enlarged library or claim that generated art ensures indexing or AdSense approval.

Release gate: 417 Node regressions pass and Worker dry-run compiles; exact-head CI, merge, Worker deployment, live image byte/hash checks and responsive layout verification remain required before calling the batch published. Continue from `docs/review-image-queue.json` and reconcile fresh owner records at every run. Target up to ten new verified illustrations per batch; do not replace source posters, rewrite reviews for freshness, publish drafts or clear existing source/media holds.
