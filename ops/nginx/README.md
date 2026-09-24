# Vid.Best NGINX TikTok facade

This NGINX snippet is intentionally limited to TikTok's fixed oEmbed endpoint. It does not download, record, proxy, or cache TikTok video streams.

## What the website now does

- TikTok cards on the homepage do not create a TikTok player while scrolling.
- A TikTok watch page initially shows a lightweight facade.
- The official TikTok Embed Player is created only after the user activates the facade.
- Existing direct/R2/HLS media continues to use its original playback path.
- The removed 360p MP4 cache/transcoder is no longer part of the Worker.

## NGINX setup

1. Install NGINX on the Oracle VPS.
2. Put the `proxy_cache_path` line in the main `http {}` section.
3. Include the server block from `tiktok-facade.conf`.
4. Keep NGINX bound to `127.0.0.1:8788`.
5. Expose it through your Cloudflare Tunnel rather than opening port 8788 directly.

The public Tunnel hostname can route to:

    http://127.0.0.1:8788

The cache key includes the full query string, so each TikTok oEmbed URL is cached independently.

## Optional Worker integration

Set the Worker variable:

    TIKTOK_FACADE_API_URL=https://YOUR-TUNNEL-HOST/api/tiktok-oembed

When configured, Vid.Best's TikTok metadata/preflight request path can use the NGINX facade. The official player itself still loads directly from TikTok after the user activates playback.

## Important limitation

A lazy facade reduces unnecessary player loads, but it does not make the viewer's browser invisible to TikTok. The official player still contacts TikTok after activation, and content/account/network restrictions can still apply.
