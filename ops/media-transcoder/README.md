# Vid.Best authorized 360p media cache

This service is intentionally limited to media that Vid.Best is authorized to copy and serve. It refuses TikTok and other social-video hosts. The Worker remains the authority for which jobs are queued.

## Flow

1. An administrator explicitly confirms media rights.
2. A published R2 or direct-media record queues a 360p cache job.
3. This service uses FFmpeg to make a small MP4, up to 640 pixels on the long side.
4. The service calls the Worker callback.
5. The Worker fetches the generated MP4 and stores it in R2.
6. Eligible public watch pages can use the R2 cache.

TikTok links are never sent to this service. They continue using the official TikTok player and the existing metadata/thumbnail cache.

## Worker configuration

Set these values on the Worker:

MEDIA_TRANSCODER_URL
MEDIA_TRANSCODER_SECRET
MEDIA_CACHE_CALLBACK_SECRET
MEDIA_TRANSCODER_RESULT_HOSTS

MEDIA_TRANSCODER_RESULT_HOSTS should contain the hostname serving the generated MP4 files.

The service SERVICE_SECRET must match MEDIA_TRANSCODER_SECRET.

## VPS setup

On the Oracle VPS:

    cd ops/media-transcoder
    cp docker-compose.yml docker-compose.local.yml

Edit docker-compose.local.yml and replace:
- CHANGE_ME_TO_A_LONG_RANDOM_SECRET
- https://transcoder.example.com

Then run:

    docker compose -f docker-compose.local.yml up -d --build

The service listens on port 8789.

Expose the hostname through Cloudflare Tunnel rather than opening 8789 directly to the public internet. The tunnel can forward HTTPS traffic to http://127.0.0.1:8789.

The service is deliberately limited to one active transcode at a time for a small VPS. A failed transcode never replaces the original media.
