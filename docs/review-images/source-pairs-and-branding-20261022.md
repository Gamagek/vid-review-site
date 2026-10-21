# Source previews, anime artwork and image discovery

Owner instruction recorded 22 October 2026. Continue existing PR255 and its same ten reserved pages; no new image-production batch or automation.

## Prepared implementation

- Image1 retains the existing publisher/source preview. Ten original JPEGs were fetched once by the read-only CI job and copied without resizing, cropping, re-encoding or added branding. Their source URLs, bytes, dimensions, SHA-256 hashes and HTTP200 evidence are in [batch11-source-copies-20261022.json](batch11-source-copies-20261022.json). These are publisher previews, not newly extracted video frames.
- Each copy uses a stable `/review-source-images/ID-SHA256PREFIX.jpg` URL. It is selected only when the video ID/title/slug/source guards and the current original thumbnail URL still match. A later owner poster edit immediately takes priority. Original D1 fields and VideoObject thumbnails remain unchanged.
- Image2 remains the already generated, separately captioned 1600×900 anime/conceptual artwork. The two real server-rendered `img` elements appear source first in the desktop right review column and stack responsively on mobile. Existing artwork bytes/hashes are preserved.
- The ten prepared artworks display a small bottom-right `vid.best` watermark through HTML/CSS; the original source preview receives no watermark. This display overlay does **not** add watermark pixels to the ten already prepared WebP files. Every future newly generated asset must include the exact small `vid.best` watermark in the image itself, and its real prompt/provenance must record that requirement. Never add visible AI-generated lettering.
- Future scene-based anime artwork should use a genuinely inspected source/captured image and record which scene was inspected, ideally with its timestamp. Preserve the recognizable composition where permitted, without copying protected posters or unauthorized recognizable likenesses. If scene evidence is unavailable, describe a verified key idea honestly as conceptual artwork; do not claim a best-frame recreation or invent observed footage/audio.

## Crawler discovery

The same first-party source-copy URL appears in the actual watch-page `img`, matching canonical entry in the source image sitemap, legacy combined image sitemap and video sitemap image extension. The separate editorial sitemap continues to identify only artwork. Original external source URLs remain in VideoObject/video-thumbnail evidence. The flat root index, existing image index aliases, robots discovery and source/editorial separation are retained. No extra URL-per-variant or query-string image aliases are introduced.

The XML cache revision includes source-copy paths and hashes, so a release cannot inherit a previously fresh XML snapshot without the new image URLs. Static images do not perform D1 reads or provider video requests. Existing Static Assets response/ETag behavior is retained. Both images have dimensions, lazy loading, asynchronous decoding, descriptive alt text and distinct source-versus-conceptual captions.

Authoritative references checked 22 October 2026:

- [Google image SEO](https://developers.google.com/search/docs/appearance/google-images): real HTML image elements, landing-page context, consistent image URLs, accessible images and useful alt text.
- [Google image sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps): image URLs associated with their correct canonical landing pages; first-party copies avoid relying on verification of a publisher's external image host.
- [Google crawl-budget guidance](https://developers.google.com/crawling/docs/crawl-budget): reduce duplicate inventory, keep sitemaps accurate and pages available, and use efficient HTTP caching. Sitemap inclusion is not an indexing guarantee.

## Release state and validation

The capture preparation CI passed at commit646906973b7dc03dbfced250c929adae3b5f34cd, [run39688141220](https://github.com/Gamagek/vid-review-site/actions/runs/39688141220). The one-time capture step is removed before the final release head; ordinary CI performs no new provider-thumbnail downloads. The reusable capture script remains explicitly invoked tooling, restricted to at most ten reserved, exact-source-matched publisher images.

This update generated **0** new illustrations and prepared **10** unchanged source-image copies. Batch11 still contains its prior ten unique generated artworks. No main merge, Worker deployment or live publication is claimed here. D1 daily read quota remains a transient release hold until the stated midnightUTC reset at2026-10-22T00:00:00Z; no D1 query was retried before then. Fresh current published identities, holds and preservation checks, complete exact-head CI/dry-run and the extended live verifier are required before release. The verifier checks WebP and JPEG HTTP200/MIME/bytes/hashes, both watch images and exact matching source/editorial/combined/video sitemap associations.

Keep the six-video draft hold in PR254 and all Saiyaara/Summer/source30/removal/raw/owner holds intact. No Google Indexing API calls, indexing claims, AdSense submission or paid-plan changes. New published/live-verified counts remain0 pending those gates. Last readable inventory remains the dated 21October17:41UTC snapshot:501saved/501published, not a new current count.

Rollback: revert the final source-pair/branding commit on the same branch before release, or use the normal tested revert process after release. No D1 rollback is needed because this change performs no D1 writes.
