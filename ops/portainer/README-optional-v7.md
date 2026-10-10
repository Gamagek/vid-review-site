# Optional historical v7 TikTok player (PR #53 + #70 + #71 + #72)

This is an **additive, opt-in diagnostic player**, not a fix for TikTok's 429, access-denied, or regional restrictions. Historical v7 ultimately uses the **official TikTok player/v1 then embed/v2 iframe** (one attempt each). It does not provide MP4 bytes, bypass restrictions, or download/copy TikTok media.

## What was recovered

- Original signed Worker route from PR #53 and restored integration from PR #70.
- Original small, independently running Node.js v7 player from merge commit `f1884e46313bd9983c85ca7ea276eda5d7d13133`, including conservative bounded retries from PR #72.
- Current production-compatible stack from `ops/portainer/vidbest-v56.yaml`, preserving the current R2-first `/watch`, `/stream`, `/status`, cache authorization webhook, monthly provider budget, existing `rapidapi-tester`, and **one** `cloudflared` service.

## Safe Portainer update

1. **Back up** the existing `video-site` Stack Editor YAML and its current environment variables/volumes first. Do not delete the stack.
2. After the linked GitHub PR has been merged, copy `ops/portainer/vidbest-v56-with-optional-v7.yaml` into the **existing** `video-site` Stack Editor and update the same stack; do not create a second tunnel.
3. Keep all existing env vars, including `SIGN_SECRET`, `TUNNEL_TOKEN`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `RAPIDAPI_KEY`, `TESTER_TOKEN`, `CACHE_HOOK_SECRET`. `SIGN_SECRET` must be identical in the Worker, v56 gateway app and optional v7 service. No new secret or DNS override is needed.
4. The existing Tunnel public hostname remains `video.megasale.win -> http://app:8080`. New `legacy-v7` is internal-only. The v56 app proxies only the signed `/legacy/watch` path to that internal container.
5. Check the unchanged `https://video.megasale.win/health` endpoint. Then test `https://vid.best/watch-legacy?user=umbralarchive&id=7552567024304540959`; it is only enabled after merging/deploying the Worker route and updating the Stack. Do not interpret an iframe `load` event as proof of playable video.

## Preserve current behavior

- Normal `/watch/:slug` remains the current R2-first player. No automatic switch to the historical player has been enabled.
- Saiyaara and Summer records, including protected cache exclusions, are not modified.
- No additional public tunnel and no new TikTok scraping/caching paths are introduced.
- In the event of a problem, roll back to the original `vidbest-v56.yaml` in the same stack and revert the optional site Worker route. Do not remove your existing R2 bucket or persistent volumes.

**Limitations:** TikTok may still display `429`, `overload-protect`, or `Video unavailable` inside the browser iframe. Only a successful user playback test establishes useful behavior.
