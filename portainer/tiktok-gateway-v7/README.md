# Vid.Best TikTok Gateway v7 (Portainer)

This folder is the Portainer/Git deployment form of the signed v7 player gateway.

Why this exists:
- Portainer installations can reject Compose files that use inline `configs: ... content:` and surface only a generic HTTP 500.
- This version keeps `server.cjs` as a normal repository file and builds a tiny Node image, so Portainer does not need inline Compose configs.

## Portainer deployment

Use **Stacks → Add stack → Git repository**.

Repository:
`https://github.com/Gamagek/vid-review-site`

Compose path:
`portainer/tiktok-gateway-v7/docker-compose.yml`

Set these Stack environment variables:
- `ALLOWED_SITE=https://vid.best`
- `SIGN_SECRET=<the exact same 32+ character value used by the Cloudflare Worker>`
- `TUNNEL_TOKEN=<your existing Cloudflare Tunnel token>`

Then deploy.

## Tunnel origin

The Cloudflare Tunnel public hostname `video.megasale.win` must point to:

`http://app:8080`

## Checks

Container health:

`http://127.0.0.1:8080/health`

Expected text includes:
`OK v7 secret:set secretlen:32 site:set retry:on`

The health endpoint never prints the secret itself.

A direct request to the public gateway without a valid signature should return `Forbidden`. That is expected.

Vid.Best should access the gateway only through the same-origin signed route:
`/watch?user=USERNAME&id=VIDEO_ID`

The gateway uses TikTok's official player/embed endpoints and provides retry/fallback UI; it does not proxy or re-host TikTok video bytes.


## Conservative playback mode

The v7 stack now defaults to a lower-request playback policy:
- one `player/v1` attempt
- one `embed/v2` fallback
- no duplicate `player/v1` retry
- longer retry spacing with jitter
- a 30 signed-page-requests/minute per-client gateway limit
- the Watch on TikTok fallback is revealed after 5 seconds

These settings reduce bursty retries and protect the gateway from accidental repeated requests. They do not bypass TikTok or Akamai restrictions.

The Docker container DNS is intentionally not overridden. TikTok playback happens inside the visitor's browser, so changing DNS inside this container would not make the browser use Google Public DNS.

Optional stack variables are already set to conservative defaults in `docker-compose.yml`:
`PLAYER_ATTEMPTS=2`
`PLAYER_WAIT_MS=15000`
`RETRY_BASE_MS=4500`
`RETRY_JITTER_MS=1200`
`FALLBACK_REVEAL_MS=5000`
`REQUESTS_PER_MINUTE=30`
