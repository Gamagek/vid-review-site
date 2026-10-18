# Requested TikTok cached oEmbed integration

## Replay follow-up released

PR 200 / `db44e82e6c4f9e16be38f343980b23ab204fbc8e` deploys metadata reuse and duplicate-Play guards as Worker `aa55179e-5f71-411d-9c84-9576470d6f7e`. 412 Node / four Python tests pass; owner fields are unchanged. Production-JS/synthetic-DOM replay verification makes one actual API200 request across three document lifecycles, without loading TikTok's script/player/video. This is not playback or provider-429 resolution. The authoritative final follow-up release, artifact and limits are in `docs/tiktok-replay-cache-20261018.md`; older sections below are dated history.

## Replay request reduction follow-up

The owner's later second/third-open reports identify redundant metadata lookups across isolated popup documents. The replay fix now shares pending lookups and reuses validated public metadata for 30 minutes, without storing video bytes or ignoring a known API 429. This supersedes the per-open metadata lookup described in the original release history below. Official TikTok iframe/video requests remain separate and can still be restricted. Exact scope, 412 local tests, data/migration preflight and release requirements: `docs/tiktok-replay-cache-20261018.md`.

## Final release verification — 18 October 2026

The owner-requested player integration is merged and deployed. PR [197](https://github.com/Gamagek/vid-review-site/pull/197) merged as `f11dedb293240790f795e6dee3796b1c2d6049c7`; the observed official-script redirect correction, PR [198](https://github.com/Gamagek/vid-review-site/pull/198), merged as `9f9c732833fe06667963ba29b87a260fb6d12d00`. The latter changes only the isolated player's script CSP, plus its regression test and evidence checkpoints. General site CSP and unrelated players remain unchanged.

- Exact-head CI [39122208565](https://github.com/Gamagek/vid-review-site/actions/runs/39122208565), reviewed head `874b278841ce1cdf8b9c711fea1289cf5bda2aff`, passes 404 Node tests, four Python tests, editorial validation and Worker dry-run. Main CI 39122285632 also succeeds.
- Deploy [39122285668](https://github.com/Gamagek/vid-review-site/actions/runs/39122285668), job 117660143841, succeeds with **no migrations**. Worker `ad44f609-896e-4e00-bee5-be57a124404d` serves 100%; deployment `dc48aac5-0874-44df-9f09-fb23cbe5bdcd` was created at 11:12:45.456358 UTC. Direct Cloudflare verification at 11:13:21.574 UTC confirms it.
- Portainer 39122285645 validation job 117660144118 succeeds. Optional 117660232960, preflight 117660233006, deploy 117660233031 and incident 117660233274 are all skipped. Its automatic flag, backend, containers, persistent data and security policies were not changed.
- Credential-free live checks at 11:14:51.025 UTC: eight reads, API/watch/isolated player/sitemap all 200; all four deployed JS/CSS assets match repository bytes; all five owner paragraphs remain server-visible; exact source ID, canonical and original schema dates match; no player is loaded before a click. These checks make no provider API call and no verification write.
- Read-only D1 verification at 11:13:21.574 UTC still gives 204 saved / 200 published records. SHA-256 across **every video field except the naturally changing views/reaction/comment counters** remains `0cfd948043b91847fe4ff442ceba1921235ae2910de38fc6a927b682e65e1736`. Record 18's listing/review/SEO-description hash remains `b3f5eeea29b02562dddbae401bb3f688cc40e807bcadc640aa95f04ff28377a5`. No owner/content/date/media field was changed; no counter was reset.

Live Chrome now loads the official script once and creates the exact official iframe `https://www.tiktok.com/embed/v2/7603012203595320584`. The API metadata cache had already been verified by one `cache_0_request` response. **Playback itself remains unverified:** the nested TikTok iframe displays `overload-protect triggered` in this browser. This is an observed provider restriction, not a diagnosis of its underlying cause or a successful Akamai fix. The player was closed; no further provider retries, alternate route, copying or access workaround was attempted. The two deliberate browser opens were the initial script-CSP failure and the final post-fix check. The final API display reported 16 requests remaining; production 429 was not forced. Tests cover the actual 429 branch and Retry-After/session pause.

The latest completed post-release audit [39122325651](https://github.com/Gamagek/vid-review-site/actions/runs/39122325651), job 117660263425, succeeds. Artifact 12134882237, created 11:15:17 UTC, has matching ZIP SHA-256 `852bdd4bf7af1d58b824abd4e68623b12beec79cb7c8f6108ee96f4e5a63ba27`; report generated 11:13:11.323 UTC. It checks 231 pages with zero technical failures and two existing editorial warnings. Its 200 published thumbnail checks remain 181 available / 11 HTTP errors / eight protected placeholders, with 189 matching signatures and full-byte hashes. No new image or source-poster repair is claimed.

This audit has **zero URL Inspections and zero sitemap submissions**. Maps remain processed/not pending: root last downloaded 18 October 09:11:12.537 UTC, library 09:11:14.226, editorials 09:11:13.890; zero errors, 20 existing library warnings. The separately dated 09:09:16.202 UTC Inspection sample remains 200 of 210 reviews: two PASS / 156 Discovered / 42 unknown. Both PASS pages are protected comedy and unedited. Neither record 18 nor the next editorial candidate is newly claimed indexed.

This final four-file checkpoint is documentation only. Use both `[read-only-preflight]` and `[seo-only]` in its merge commit, require exact-head CI, and record final CI/skipped-release evidence on its PR rather than creating another checkpoint commit. Next substantive editorial task: published Music record 135 / Titli, with fresh owner preimages, primary-source limits and all six headings/substantial prose/SEO title/media/dates preserved. The provider playback limitation stays recorded; do not retry it merely because this documentation merges.

## PR197release and bounded script-CSP correction

PR197 reviewed0cb1c59/merge`f11dedb293240790f795e6dee3796b1c2d6049c7`; exact-headCI39121602793/job117658155700 passes403Node/fourPython/editorialvalidation/Workerdry-run. Deploy39121686207/job117658399640 succeeds, no migrations; Worker`a5be7a86-08d7-4e4c-997e-7c765c894b7f`100%, deployment786f06d9 at18October11:03:52UTC. Portainer39121686206 validate117658399797 passes; incident117658477293/optional117658477423/preflight117658477479/deploy117658477820 all skip.

Actual live Chrome first paint:opt-in1/newclient version,0iframes/0officialscripts. Deliberate Play creates the correct same-origin player, fetches/validates cache metadata and attempts official embed.js once, but initially shows script-load fallback. A single official HEAD at11:05:52UTC establishes302from `https://www.tiktok.com/embed.js` to `https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok/falcon/embed/embed_v1.0.13.js`; the isolated CSP had omitted that exact legitimate script host. The follow-up permits only that observed host in this document's script-src. General watch/home CSP, API, quota and media/security routes remain unchanged. This is a CSP correction, not an Akamai workaround or playback guarantee. Add isolated-only/exact-origin regression and require fresh exact-headCI/live verification.

Follow-up local404Node tests pass. D1read18October11:08:44UTC still204saved/200published, same all-non-counter-field hash `0cfd948043b91847fe4ff442ceba1921235ae2910de38fc6a927b682e65e1736`,0verificationwrites. Consumed completed post-release39121730275/artifact12134975351, ZIP SHA256 `b6801943f3f7c325c336eb88366fca4d459b5190dcdd74a62b76e77de7aad685`:231pages/0technicalfailures,200posters181available/11errors/eight protected placeholders,0Inspections/submissions. Google maps are processed/notpending, last downloaded18October09:11:12.537UTC(root),09:11:14.226(library),09:11:13.890(editorials);0errors, library20aggregatewarnings persist. ZeroInspections does not change the separately dated2PASS/156Discovered/42unknown sample.

Owner-authorized player-only change for published record18, `/watch/a-beautifully-creative-proposal-meme`, exact source `https://www.tiktok.com/@sujicomedyedit_007/video/7603012203595320584`. No review/listing/title/heading/poster/source/date/account/counter/comment/draft/R2 change or general rollout.

## Actual service contract:18October2026

- Owner supplied `/api/watch?url=...` and `/api/stats`.
- Stats at10:50:18UTC:200JSON, `cached_videos:1`, `daily_limit_per_viewer:20`. After the bounded test:2cached videos, same limit20.
- Exact requested source at10:50:40UTC:200JSON, `status:success`, `source:fetched_and_cached`, `views_today:1`, `remaining_today:19`.
- One repeat to verify cache:200JSON, `source:cache_0_request`, `views_today:2`, `remaining_today:18`; same exact sourceID. No production quota exhaustion or retry loop.
- Nested `oembed`: `type:video`, `provider_name:TikTok`, creator `ꜱᴜᴊɪ ᴄᴏᴍᴇᴅʏ ᴇᴅɪᴛ`, matching author URL `/@sujicomedyedit_007`, HTML data-video-id7603012203595320584 and official embed.js. First JSON2419bytes/SHA256 `bb66936b1e0d1d02429fb934b0b86ad755a777d5c019989e3186515e0feffc48`. Raw HTML/signed CDN URLs are not committed.
- `Access-Control-Allow-Origin:*` permits the public browser call. The20/day allowance is **per viewer**, not a global new-video budget. Its reset timezone is unverified.

## Behavior and limits

Existing Play opens an isolated same-origin `/api/tiktok/oembed-player?url=...` document. It requests `https://tiktokmedia.megasale.win/api/watch` once directly from the browser, with the full canonical source in URLSearchParams, no credentials/redirects/browser response caching. This preserves the API's viewer identity and authoritative counter. No server-side proxy, client quota replacement or local-metadata bypass of429. No per-click stats polling. The backend owns persistent oEmbed caching and its viewer allowance; no backend/container/config change was made.

First paint loads no new API/player/script. Only the exact supplied creator/ID opts in; its watch/popup skips the old gateway metadata refresh. Other gateway paths, Saiyaara/Tagembed, Summer and video.megasale.win are unchanged. Existing server-rendered cached card content and selected posters remain intact.

Success requires the observed wrapper/schema, video type/TikTok provider, exact data-video-id and author URL. Read JSON with a64KiB stream cap. Ignore API HTML/scripts/media URLs; construct safe text/attribution DOM and the official blockquote, then add `https://www.tiktok.com/embed.js` once. Closing destroys the iframe; each deliberate reopen has an independent script lifecycle, without undocumented rendering calls. Parent messages validate origin/window/channel/sourceID/state. Script/frame loading is not reported as playback.

HTTP429 shows20-per-viewer/day guidance and loads no embed. A shared session deadline honors visible Retry-After seconds/HTTP dates; absent/inaccessible headers cause a60-second local pause before manual reopen. This is not a guessed daily reset or automatic retry. Provider/network/schema/script failures stop with a source-link fallback. No polling, alternate host, proxy rotation, media copy, restriction bypass or playback guarantee.

The isolated document is noindex/nofollow/no-store, frameable only by the same origin. Its narrow CSP permits the owner's API fetch, official TikTok script/player and local assets; the site's general CSP/security is unchanged. No new binding, variable, migration or quota table.

## Verification/release checkpoint

Local final validation:403Node tests, Python source compilation,14editorial-page validation and Worker dry-run pass. New tests cover actual nested contract/URL/creator/ID validation, text-only DOM, one script,429/no-retry/session deadlines, malformed/oversized JSON, no old pre-click refresh, isolated CSP and unchanged owner data/other players. Actual backend429 was not forced by spending20requests.

Read-only D1 baseline18October10:41:44UTC:204saved/200published, all non-counter video fields SHA256 `0cfd948043b91847fe4ff442ceba1921235ae2910de38fc6a927b682e65e1736`,0writes. Record18's existing metadata date10October20:54:40.290UTC is historical, not new viewing proof. Through0046applied; historical applied-only0013_media_cache_jobs.sql preserved. No migration is added. Release requires exact-headCI/merge/existingWorker; `[seo-only]` keeps privileged Portainer jobs skipped. Final workflow/Worker/live/browser/preservation evidence is recorded on the PR/checkpoint.

Consumed actual completed39114196048/artifact12132281873, matching ZIP SHA256 `7d946c01e915d5b3d1f6480f6f95241e5fb0c377ad83984f61f9d1c8d2f5eea6`:231pages/0technicalfailures,200posters181available/11errors/eight protected placeholders. Dated200/210reviewInspection2PASS/156Discovered/42unknown is partial coverage, not whole-site indexing. BothPASS are protected comedy and unedited. This task initiated no extra Google Inspection/submission or thumbnail-provider audit.

Next: consume release/live evidence and report provider/regional limitations honestly. Resume queued Titli135 context work separately with fresh owner preimages and six headings/substantial text/SEO/media/dates preserved. Owner authorization for this one player does not authorize review/comedy/draft/media rewrites.
