# Optional historical v5 metadata gateway / Nginx facade

The live Portainer stack is `video-site` (stack 27, endpoint 3) and currently
runs `APP_VERSION=55-R2-ADMIN-APPROVED-RAPIDAPI-CACHE`. Do NOT replace that
live file with repository v56: existing content differs.

This change supplies a **live Compose overlay**, generated at deployment time
from the currently running stack YAML, and only adds:

- legacy-v5-postgres: isolated metadata persistence on named volume
- legacy-v5-redis: 24h hot metadata cache, named volume
- legacy-v5: signed, server-side TikTok oEmbed metadata / click-to-load preview
- legacy-v5-nginx: internal reverse-proxy facade for signed /watch and /metadata

The existing app (R2, signed /stream and /status, cache webhook), rapidapi-tester,
cloudflared and their volumes/environment remain structurally identical.
Neither an external host port nor a second Cloudflare tunnel is added.

On the single authorized one-time merge commit tagged `[deploy-v5-addons]`,
the existing Portainer workflow validates tests, runs a read-only baseline check,
encrypts the full live YAML/Env backup and uploads it as a private artifact,
pulls only the required addon images, updates the *existing* stack and checks
the original tunnel identity and all service health. It attempts rollback to
the previous YAML/Env on failure. A failed update can leave addon containers
as orphans because the rollback deliberately uses Prune=false.

The database password is generated with cryptographic randomness and stored
as a new Portainer stack environment variable, without logging it. Existing
Portainer variables are retained. It persists for subsequent addon updates.

No Cloudflare published hostname is created by this PR. After backend containers
are healthy, publish a **separate** legacy hostname on the existing tunnel
pointing at http://legacy-v5-nginx:8080. Never alter video.megasale.win routing.

This legacy implementation is metadata-only: no media downloading, R2 changes,
proxy bypass, TikTok rate-limit circumvention or hidden third-party scripts.
Only successful normalized metadata is cached for 24h; failed oEmbed fetches
are not inserted into Redis/Postgres. TikTok playback is still provider-controlled
and may fail or be blocked on the client's browser. This is NOT a guarantee
that TikTok playback will work in all regions.

The one-time job never runs for normal pushes, unless the explicit merge commit
title contains [deploy-v5-addons]; original PORTAINER_AUTO_DEPLOY_ENABLED must
remain disabled while this special job runs.
