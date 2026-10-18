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
