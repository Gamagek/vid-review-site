# TikTok cache gateway v56

`vidbest-v56.yaml` is based on the owner's supplied v55 stack. Replace the existing
`video-site` stack's editor contents; do not deploy a second copy of its tunnel.
Preserve existing environment variables and named volumes.

The only runtime change is watermarked RapidAPI response normalization. The tester
previously reported `download_link.watermark` as available, while its private
resolver returned only `data.wmplay`. v56 accepts either form, including the
watermarked HD variant, **only when the returned video ID matches**. It does not
substitute unwatermarked URLs or change provider credentials, endpoints, quotas,
rights checks, protected Summer/Saiyaara IDs, or the existing CDN allowlist.

Required existing variables include `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `SIGN_SECRET`,
`TUNNEL_TOKEN`, `RAPIDAPI_KEY`, `TESTER_TOKEN`, and `CACHE_HOOK_SECRET`.
The cache hook secret must match the `vid-review-site` Worker secret (32+ characters).
It is separate from `SIGN_SECRET`, which signs playback. Keep all values private.
The tunnel destination remains `http://app:8080`.

The API tester reports structured provider metadata; success there does not prove
the watermarked CDN download, MP4 validation, or R2 upload succeeded. Its tests and
cache resolutions share the existing `TESTER_MAX_MONTHLY` budget (default 20).

After updating, `/health` should report `56-R2-ADMIN-APPROVED-RAPIDAPI-CACHE`.
Use the site's saved rights-confirmed TikTok record and its cache status to verify
the whole path. An HTTP 202 acknowledgment means queued; only an actual valid R2
object produces `complete` in the admin panel. Check the app logs for
`rapidapi-cache-failed`, `cache-ready`, or R2 errors if it stays queued.

Cloudflare's unsupported `redirect: "error"` error is fixed in the **site Worker**,
not by this YAML. Node.js supports that mode. Adding NGINX, Tor or proxy rotation
does not repair a Worker exception, missing video response field, or failed R2
upload. Keep provider cooldowns and monthly budgets in place.
