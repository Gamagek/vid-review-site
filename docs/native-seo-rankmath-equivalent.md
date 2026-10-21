# Vid.Best native SEO (Rank Math-style features without WordPress)

Vid.Best runs **Cloudflare Workers + Static Assets + D1 + R2**, not WordPress. The Rank Math plugin cannot be installed or activated on this stack. Installing WordPress just to run the plugin risks conflicting sitemap, schema and canonical implementations.

## Features already provided by Vid.Best

- Canonical `/watch/:slug` pages with server-rendered metadata.
- `VideoObject`, `WebPage`, `WebSite`, `Organization` and `BreadcrumbList` JSON-LD.
- Sitemap index `/sitemap.xml`, video `/sitemaps/videos-1.xml`, image sitemaps and category sitemap.
- Permanent redirects for prior watch-page slugs via D1 `video_slug_redirects`.
- `/videos` directory with ordinary crawlable page links.
- `/robots.txt` sitemap discovery and restrictions on admin/private API routes.

## This pull request

1. Links the structured-data category breadcrumb to the **indexable** `/category/{slug}` landing page instead of the filtered homepage query `/?category=...`, where appropriate.
2. Adds an **Article** node to the JSON-LD graph when a published Vid.Best video page contains a substantive original review (500+ characters). `VideoObject` still refers to the external video; `Article` explicitly describes Vid.Best's own analysis. The source page can be linked through `isBasedOn`.
3. Carries forward **the stored original Vid.Best article publication date** as `Article.datePublished`. No new dates or inaccurate source-video `uploadDate` values are created.
4. Refuses to emit malformed category-sitemap `lastmod` values for legacy SQLite timestamps. Valid existing W3C dates pass through unchanged.
5. Includes regression tests. The ten oldest published video records (IDs 1–10) and every `raw` media record (including ID 88) are explicitly excluded from the new review Article node / breadcrumb path change. No D1 content is edited by this PR.

## Important limitations and crawl priorities

- **This is not a promise of extra crawl budget or Google indexing.** For this site's approximate size (501 video entries), prioritize reliable page response times, real original commentary, internal discovery links and Google Search Console diagnostics.
- **Do not fabricate original video publication dates.** The current database has original source dates for only 55 videos. Google requires a genuine video `uploadDate` for video rich-result eligibility. A review's `created_at` is the Vid.Best article publication date, not the video's upload date.
- Google ignores `changefreq` and `priority` sitemap hints. Do not add false freshness or automated re-submission floods. Date values in `lastmod` need to reflect significant verified changes.
- Keep existing 301 redirects for legacy `youtube-short-...` URLs. Avoid bulk renames or deleting older URL mappings.
- Validate rich results with Google's [Rich Results Test](https://search.google.com/test/rich-results), URLs with [Search Console URL Inspection](https://search.google.com/search-console), and the XML with the [Sitemaps report](https://search.google.com/search-console/sitemaps).
- Check [Video SEO best practices](https://developers.google.com/search/docs/appearance/video) and [Video structured data requirements](https://developers.google.com/search/docs/appearance/structured-data/video). Videos need a usable watch experience and reliable thumbnail, source date and player information.

## Merge checklist

- Run `npm test` and `npm run check` from the repository CI environment.
- Inspect an ID > 10 YouTube review and its `VideoObject`, `Article` and `BreadcrumbList` nodes using the Rich Results Test.
- Confirm an original protected page (e.g. IDs 3 and 8) and a raw-media page (ID 88) keep their existing schema and breadcrumb.
- Confirm that `/sitemap.xml`, `/sitemaps/categories.xml` and `/sitemaps/videos-1.xml` return HTTP 200 and valid XML.
- Confirm that the original canonical, redirects and page title remain unchanged, then deploy via the existing GitHub/Cloudflare workflow only after the tests pass.
