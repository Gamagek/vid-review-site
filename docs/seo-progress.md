# Vid.Best indexing and thumbnail work queue

Preserve original publication dates, substantive editorial structure, owner edits and all existing production media/data. Do not edit Funny & Comedy topics, add a Last updated label, publish pending drafts, or enable Portainer automatic deployment.

## Verified evidence, 12 October 2026

- Main baseline: 269819ca9266c6afa09061dfacfe6ede46e69614.
- Review indexing audit run 38249434461: Google OAuth succeeds, Full/Owner property access verified, sitemap submission accepted. 148 public pages checked without technical errors. Of 134 published review URLs inspected, 21 were discovered but not indexed, 113 were unknown to Google, 0 were indexed and 0 had a stored last crawl time. This does not establish that Google evaluated and rejected the reviews for content quality.
- The owner subsequently published more videos: the live database now contains 149 published and 4 unpublished videos. Do not restore an older publication snapshot or overwrite these edits.
- 17 published Facebook records contain a video/share HTML page URL in the thumbnail field. Existing CDN posters also expire. The Facebook public poster route had no robots exception and the sitemap did not reuse the stable poster used by the watch page.
- Cloudflare zone settings read successfully: bot fight mode off, crawler protection disabled, hotlink protection off, security level medium. No security settings changed. This is not a substitute for verified Googlebot request analytics.

## This change

Allow crawler reads of existing public Facebook/Instagram poster routes while retaining the API/admin blocks. Reuse the durable Facebook poster address across sitemap, watch page, category and full directory. Use metadata fallback for pasted Facebook video-page covers or expired provider posters. Preserve uploaded covers, dates and database content. Add a bounded thumbnail audit to the daily/deployment SEO workflow: per-page image availability, host/status/MIME/byte count, with signed source URLs omitted. Source errors are warnings requiring investigation, not evidence of Googlebot blocking or visual relevance.

Local validation: 233 Node tests passed; Worker dry-run compiled; deployment script syntax checked. GitHub CI also runs the four Teamwork Python tests. Indexing remains a Google decision: ordinary review pages are not eligible for the restricted Indexing API. Use sitemap submission and URL Inspection within quotas.

## Next tasks, in order

1. Verify deployed fixes and read the new Actions thumbnail artifact. Inventory every published record; distinguish missing/expired images, wrong URLs, HTTP-denied provider images and unverified network results.
2. Replace only confirmed missing/broken covers with accurate source frames or source posters, stored at durable public URLs. Preserve custom covers and guarded owner edits. Do not invent scenes or performers. An illustrative review cover must not be presented as a frame from the video. Verify each cover against the actual source before publication.
3. Examine real Google Crawl Stats / verified crawler analytics for absent crawling and inspect sitemap processing status; do not grant access based on a spoofable User-Agent or disable Cloudflare security speculatively.
4. Check old-to-current canonical redirects, important category/directory links and crawl depth using actual Search Console evidence. Avoid unnecessary URL changes.
5. Review the two published demonstration pages with the owner before changing their publication/indexability. Keep existing Funny & Comedy reviews unchanged.
6. Recheck Google coverage after Google processes the sitemap; avoid repeatedly inspecting all URLs within the same day. Record material changes and the next task here. Do not manufacture rankings, bulk filler, spam links or unlimited indexing claims.

The connected scheduled SEO task runs every two hours. Existing Portainer repair automation remains paused. Each run should read current main and this queue, complete a verified task, and update this checkpoint. Reconfirm remote state before any mutation.
