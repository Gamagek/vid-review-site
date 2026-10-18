# Requested TikTok cached oEmbed integration

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
