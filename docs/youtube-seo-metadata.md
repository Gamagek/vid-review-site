# Verified YouTube publication dates for Vid.Best SEO

Google VideoObject.uploadDate is the **original video's upload date**, not the date a curator saved a link. The Worker already omits unverified third-party VideoObject markup for Googlebot.

## Required setup (one-time)

1. In Google Cloud Console, enable **YouTube Data API v3** for the intended project.
2. Create an **API key** restricted to **YouTube Data API v3**. A Google Search Console service-account JSON file is **not** a YouTube Data API key.
3. Store the key as a Cloudflare Worker **encrypted secret** named `YOUTUBE_API_KEY` for `vid-review-site` (Cloudflare dashboard → Workers & Pages → vid-review-site → Settings → Variables and Secrets). Do not paste it in a chat, GitHub issue, source file or documentation.

## Backfill behavior

The existing 15-minute cron performs **at most one** Google YouTube `videos.list` request per run, combining up to 20 missing video IDs. It only updates source dates that Google returned for the same ID. It skips unpublished records and any record whose source URL changed mid-request, and it never replaces an existing verified date. Where available, the same response supplies the video's duration.

With no configured `YOUTUBE_API_KEY`, the task is inactive and makes **zero** YouTube requests. If Google's API is unavailable or quota-limited, existing metadata and pages remain unchanged.

External Facebook, TikTok and other providers require their own verified original upload dates or manually reviewed metadata; this YouTube backfill does not fabricate those values.

After adding the key, check the Cloudflare cron log and the `video_source_metadata` D1 table. Validate published watch URLs in [Google Rich Results Test](https://search.google.com/test/rich-results) and sitemap coverage in Search Console. Rich results and Google AI citations are never guaranteed.
