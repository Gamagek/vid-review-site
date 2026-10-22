# Juicer → R2 TikTok metadata cache (staged)

This integration archives **public TikTok post metadata only**. It does not download video files, mirror any Juicer-hosted player or authorize unrelated content publication. Existing Saiyaara, Proposal, Summer, Top-5 and other TikTok player behaviour is unchanged.

## Current authorized Juicer feed
- Juicer feed **460118** (My Feed; Trial plan with up to five sources).
- Connected Juicer sources may be changed by the account owner; this integration neither creates nor deletes them.
- Only public TikTok video-post URLs matching `https://www.tiktok.com/@handle/video/<numeric ID>` are accepted. A photo post or a malformed link is skipped.
- The source list is intentionally **not** embedded in the cache key: posts remain under their canonical numeric ID after a source is removed.

## Set up
1. Deploy this PR only after checking the exact-head tests and reviewing the changes. It adds the existing R2 binding `BUCKET` and a daily scheduled trigger `30 0 * * *` (06:00 Asia/Colombo). The trigger is a no-op if the secret below does not exist.
2. In Cloudflare Worker **vid-review-site**, create a Worker secret named `JUICER_API_KEY` using the Juicer Integration/Feed API key from your authenticated Juicer settings. Do **not** paste the key into GitHub, chat, a URL or a video record. The Worker var `JUICER_FEED_ID=460118` is public, not a secret.
3. Only after the provider has synced the newly added public source and the source's posts are visible in Juicer, let the scheduled Worker ingest them. For an immediate manual sync, use `POST /api/admin/juicer-cache/sync` with the **existing Vid.Best administrator authentication**. An optional JSON body `{"resume":true}` continues a previously incomplete large feed.
4. Check `GET /api/admin/juicer-cache/status` (admin only), then `GET /api/tiktok/juicer-cache/<video-id>`. Both checks must succeed and return the **exact ID** before a source is removed.

## What stays cached?
- Separate R2 object: `metadata/juicer/tiktok/v1/posts/<video-id>.json` (creator, caption, source URL, original post date, official TikTok iframe URL and markup).
- R2 sync state: `metadata/juicer/tiktok/v1/sync-state.json` (pagination position, last run, counts, next permitted refresh).
- No actual TikTok video or stream URL, no replay of Juicer feed HTML, no original image uploads or player extraction.
- Unchanged posts avoid duplicate R2 writes. Changing or deleting a Juicer source does **not** delete any saved R2 object. This preserves *our metadata*, **not** the original source provider's playable content or any provider entitlement.

## Quota / reliability
- Max 3 paginated feed requests × 100 posts per daily run; large feeds can resume on the next daily trigger or an authorized admin trigger with `{"resume":true}`.
- R2 objects are read to deduplicate and store only changes. A failed fetch does not silently delete previously saved posts.
- This reads the **Juicer Feed API**, not the separate credit-charged Juicer Data API. Availability still depends on the user's current Juicer plan and a valid API key; neither is unlimited.
- The runtime has **no dependency on D1** for this metadata cache. It does not alter Vid.Best videos, slugs, published status, views, reactions, sitemap URLs or existing player-specific exceptions.
- Metadata can remain stored after a source is removed; TikTok can still remove/private a post or restrict embedding, and Juicer feed embeds may stop working. Always maintain a normal link back to the original TikTok post.

## Connection status at staging time
- GitHub PR staged; not deployed automatically.
- Cloudflare script had no `JUICER_API_KEY` secret when inspected on 23 October 2026.
- Juicer feed username sources `officialmovietr82` and `khaby.lame` were marked unsyncable (`no_social_account`). The `funny joke` mentions source was syncable. To ingest a creator by username, connect the appropriate TikTok account via Juicer's supported authorization flow before relying on it.
- Do not remove a source merely because it was added or synchronized by Juicer. First confirm its **exact** video IDs are in Vid.Best's R2 snapshot.
