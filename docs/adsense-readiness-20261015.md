# Vid.Best production and AdSense readiness audit — 15 October 2026

This is the read-only production baseline and proposed repair report. It records verified engineering findings and editorial screening concerns. AdSense approval and Google indexing remain external decisions. The supplied AdSense screenshot specifically reports **“Site down or unavailable”**; the cause of that historical reviewer access failure has not been established by this session.

## Production baseline

- Repository main: `b78d647462527a5001c928ccda0176c82cf69fd1` (documentation-only, deployment intentionally skipped).
- Active deployed source commit: `2b9523c3638207838899aee6d0e81ad85db86683`; Deploy run [38632545370](https://github.com/Gamagek/vid-review-site/actions/runs/38632545370) succeeded with no migrations to apply.
- Cloudflare active version: `26f2bda7-260d-474d-bfb4-b192329891ed`, 100% traffic; deployment at 2026-10-14 20:30:15 UTC.
- Actual entry point: `src/seo-edge.js` → `src/edge.js` → `src/index.js`, with Cloudflare Static Assets, D1 `video-reviews-db`, R2 `vid-assets` and `lab-review-media`. Static JavaScript frontend.
- D1 read-only inspection: 174 records, 170 published and four unpublished; zero rows written by audit queries. All 170 unique published IDs were also fetched through four public API pages. IDs 186–182 remain present.
- Existing CI: pinned checkout/setup-node v6 SHAs, Node 22, Ubuntu 24.04. Production deployment preserves its serialized workflow. Portainer deployment stays paused.

## Confirmed defects and proposed fixes

1. **Legacy browser initialization:** the deployed initializer calls `Object.hasOwn` before requesting the video library. Executing the exact baseline code in a VM without that API produces `Object.hasOwn is not a function`, calls only `/api/categories?version=14`, and displays “The video library is temporarily unavailable.” This reproduces a concrete defect consistent with the reported Samsung behavior. The physical Samsung version and its actual console error remain unverified.
2. **Coupled requests:** categories were an initialization prerequisite; a rejected featured request could enter the common catch and erase an already loaded library. Categories, featured videos and the main library now have separate failure handling. Slow categories do not delay the library or lose initial URL filters.
3. **Misleading empty state:** a malformed HTTP 200 response became `{}` and then an empty video array. New validation distinguishes malformed responses, HTTP failures, network/timeout failures, browser support issues and a real empty result. A retry button restores the failed library request; failed pagination preserves existing cards and its offset.
4. **Older APIs and syntax:** core code replaces `Object.hasOwn`, provides an element-clearing fallback, removes optional chaining from the core loader, avoids `URLSearchParams.size`, and tolerates restricted History/Intl behavior. A small ES5 bootstrap can explain a core script load/parse failure. The existing server-rendered `/videos` directory is linked beside the library and remains usable without JavaScript. Other provider scripts retain their existing behavior and may need separate old-browser testing.
5. **Races and stalled reads:** request generations reject stale filter results; duplicate pagination while loading is suppressed. Read requests have a 15-second timeout, with optional AbortController and a timer fallback. POST actions are not automatically retried.
6. **HTTP canonicalization:** live `http://vid.best/` returned HTTP 200 without a redirect. The Worker now redirects public GET/HEAD requests to the existing HTTPS origin while preserving path/query. Canonical redirects also keep double-slash paths on Vid.Best instead of interpreting them as external hosts. Existing HTTPS content, metadata and URLs remain intact.

Changed files: `public/app.js`, `public/library-support.js`, `public/index.html`, `src/seo-edge.js`, `test/home-library.test.js`, `test/seo.test.js`, and this report. No migration, published record, review, account, date, view/reaction count, media object, policy page, player implementation or Cloudflare security rule is changed by this repair.

## Verified availability and SEO evidence

This session checked 30 public GET URLs/API variants: 29 HTTP 200 responses and the expected HTTP 401 for unauthenticated `/api/account/saved`. Working checks include the homepage, health, 14 categories, pagination, featured/trending/popular/reaction sorting, Music filtering, search, details, recommendations, comments, anonymous account state, directory pages, sitemap files and all five trust pages. Live reaction/view mutations and sign-in emails were not sent; their behavior is covered by isolated tests.

The completed production artifact [11926791922](https://github.com/Gamagek/vid-review-site/actions/runs/38632640440/artifacts/11926791922) was downloaded and read. It checked **201 public pages**, including 170 library reviews and ten separate editorial reviews, with zero technical failures, no unlinked review URLs and two demo/editorial warnings. Its canonical, robots, structured-data, server-delivered review and GET/HEAD checks supplement this session’s direct public checks. This artifact predates the proposed repair.

Current robots permits public pages and declares the sitemap, while protecting admin/API paths with specific poster/preflight exceptions. The root sitemap references pages, videos, categories and the separate editorial sitemap. Existing server-delivered review content and source-verified VideoObject handling are preserved; absent verified source upload metadata does not justify invented schema dates. Existing category indexability thresholds are project choices, not Google AdSense eligibility requirements.

Cloudflare adaptive analytics for 2026-10-13 21:15 through 2026-10-14 21:15 UTC, using Googlebot user agents **and** verified Search Engine Crawler classification, reports HTTP 200 groups for robots (7), root sitemap (6), review sitemap (5), and the editorial sitemap (1). Two ads.txt 404 requests occurred at 2026-10-14 01:14 UTC, before ads.txt was added in commit `3ed4a92` at 05:57 UTC. Current ads.txt is HTTP 200 plain text with the exact authorized publisher entry, and was not edited. No Mediapartners-Google group appeared in the sampled window. Sampled absence cannot establish a universal block or reproduce the AdSense review failure.

`home.vid.best` returns 301 to the HTTPS root. `www.vid.best` has no DNS record/custom Worker domain; this environment returned a proxy 502 for it. The www redirect exists in code but that does not establish a working public alias. No speculative DNS/security changes were made. The supplied primary URL is `https://vid.best`.

## Readiness evaluation

| Category | Result | Severity | Evidence / affected locations | Correction and verification | Remaining risk |
|---|---|---|---|---|---|
| Website accessibility | Warning | High | Primary HTTPS site/API responses work; screenshot records a historical AdSense availability rejection | Compatibility and HTTP redirects repaired on branch; 30 live checks and 201-page artifact | AdSense reviewer request not captured; www alias absent |
| Browser compatibility | Warning | High | `public/app.js` fails without Object.hasOwn; DOM replacement APIs also vary | 13 loader/compatibility regression tests; Chrome baseline observed; fallback directory retained | Physical Samsung, Firefox and Edge unverified; older provider scripts unchanged |
| Original editorial content | Warning | High | 170 records screened; 116 have one or more manual-review flags | Per-page queue below; no bulk rewriting | Footage accuracy, attribution and claims need source review |
| Copyright / embedding compliance | Unverified | High | YouTube/Facebook/TikTok/Instagram, Tagembed and existing rights-gated media routes | Player architecture inspected; existing embeds preserved; cached row 81 has owner certification | Certification is not independent proof of license; confirm each hosted item/provider terms |
| Privacy / legal pages | Warning | Medium | About, Contact, Privacy, Terms, Editorial all HTTP 200 and footer-linked | Contact has three MX records and enabled forwarding for info@vid.best; no test email sent | Privacy needs precise saved-data/retention/processor disclosures; CMP requirements depend on deployed ads and audience |
| Navigation / UX | Warning | Medium | Carousel, discovery, filters, account controls and ordinary footer links observed in Chrome | Main library remains independent; retry and directory link added | Keyboard/touch/contrast audit not comprehensive |
| Mobile compatibility | Unverified | Medium | Responsive CSS and mobile-facing controls exist | Mobile initialization scenarios tested in VM | No physical device, viewport emulation or full mobile video QA in this session |
| Crawlability | Pass | Low | 201-page artifact, XML discovery, self-canonicals, HTML review/internal links; verified crawler 200s | Existing SEO behavior tested and preserved; HTTPS read redirects added | Successful discovery does not establish review crawling/indexing |
| Search indexing | Unverified | High | Existing credential-free GitHub diagnostic reports read; latest diagnostic has zero URL Inspections | No fresh Google account access or manual submissions initiated | Historical indexed/discovered counts cannot be presented as current status |
| Ads.txt | Pass | Low | `/ads.txt`: HTTP 200 text/plain, 59 bytes; exact publisher line | Existing file left unchanged; earlier crawler 404 predates its addition | Google must revisit it; ads.txt alone does not resolve approval |
| Video playback | Warning | Medium | 135 YouTube, 20 Facebook, 13 TikTok, one Instagram, one internal media record; R2 lab HEAD 200 video/mp4, 13,179,323 bytes | Existing player tests pass; no download/rehost/bypass added | Provider availability and end-to-end playback for every record unverified; 13 poster HTTP failures |
| Technical stability | Warning | Medium | Baseline 285 Node tests; new loader and redirect regressions; correct bindings | Run full tests, Worker dry-run, PR CI and post-deploy verification before claiming production repair | Worker-specific persisted logging currently unset; no Core Web Vitals measurement |

## Editorial screening and human review

This is lexical triage using the current published description/review fields, plus exact normalized-text duplicate comparison. It does not verify source footage, establish AI authorship or classify any flagged page as a proven Google policy violation. Flags overlap. No exact full-review duplicates were found; repeated promotional phrasing still appears in 58 records. Seven titles contain at least four pictographic emoji; these merit readability review, without treating emoji as a policy violation.

- **Lab Review 1 (ID 2):** 262 review characters, intentionally published for player/interaction testing; it is also featured. It is not established as an accidental publication. Before hiding it, review featured/recommendation/bookmark/QA dependencies and prepare an owner-approved reversible discovery/noindex change preserving its URL, record, reactions and comments.
- **YouTube Embedded Player Experience Demo (ID 3):** another published demo; keep unchanged pending the same review.
- **Romantic AI Art (ID 88):** description remains empty. Its review contains both a statement that no particular song is attributed and a claim naming background audio/large engagement. Those claims require verification. A conservative draft for review is: “Editorial commentary on the linked Instagram post and its romantic digital imagery. Creator, audio and engagement details should be checked against the original source.” It was not saved to the record.
- **Flying relaxation review (ID 186):** specific brainwave entrainment and very large audience claims merit reliable sources or qualified wording; no medical benefit or audience count has been verified here.
- **Hosted TikTok item (ID 81):** redistribution certification is set; ask for/retain rights evidence through the owner’s approved process rather than assuming a public post grants rehosting rights.

| Screening flag | Published records |
|---|---:|
| Brief test review | 1 |
| Test/demo page | 2 |
| Verify health/psychology claims | 49 |
| Verify statistics/algorithm claims | 59 |
| Repeated promotional phrasing | 58 |
| Verify hosting rights | 1 |
| Missing description | 1 |

## Policy distinction and official sources

Mandatory Google requirements include accurate representations, respecting intellectual property, avoiding invalid ad traffic/accidental clicks, required privacy disclosures, and publisher value when embedding others’ content. Adding original commentary is material to the replicated-content policy. These requirements do not create an approval probability or a fixed word/indexed-page quota.

Publisher Restrictions limit eligible ad demand for particular content; they are distinct from prohibited policy violations. Violent/graphic movie clips, dangerous pranks, sexualized imagery or profanity require actual source review before choosing monetization settings. Titles alone are insufficient to declare violations.

For personalized Google ads to EEA, UK and Switzerland visitors, the cited Google consent guidance requires an applicable certified CMP integrated with the IAB TCF. No misleading consent banner was added. No active Google ad-serving/CMP/Google Analytics snippet was found in the inspected first-party frontend; third-party embeds and Cloudflare services can still process technical data. Confirm actual account/ad configuration before enabling ads. Privacy currently omits explicit saved-video data, local notification preference storage, the Brevo email processor and a concrete retention/deletion policy; the source code uses 20-minute login tokens and 30-day member sessions.

Official sources consulted:

- [Fix AdSense crawler issues](https://support.google.com/adsense/answer/2381908?hl=en)
- [Google Publisher Policies](https://support.google.com/adsense/answer/10502938?hl=en)
- [Google Publisher Restrictions](https://support.google.com/adsense/answer/10437795?hl=en)
- [AdSense Program policies](https://support.google.com/adsense/answer/48182?hl=en)
- [AdSense content and user experience](https://support.google.com/adsense/answer/10015918?hl=en)
- [Google consent management requirements](https://support.google.com/adsense/answer/13554116?hl=en)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

## Validation and deployment procedure

Baseline: 285/285 Node tests passed. Final local validation: 300/300 Node tests passed (15 additions), Worker bundle/dry-run passed, diff whitespace validation passed and no private-key/GitHub/AWS credential patterns were found in the seven changed files. Remote applied migration names cover all 37 repository migrations, with one additional historical applied migration and zero pending migrations. Python service tests will also run in PR CI. The compatibility defects were reproduced against the original app. New regression scenarios cover missing Object.hasOwn/replaceChildren, independent/slow requests, URL filters, malformed JSON/data, true empty versus failed requests, retry, stale results, pagination preservation, network/body failures, timeout without AbortController, restricted History, bootstrap parse failure and HTTPS/safe-host redirects. Worker compilation/dry-run uses the existing bindings and no remote mutations.

The repair must pass the full test suite, bundle check and GitHub CI before merge. Confirm current main and pending remote migration state, retain the baseline Worker version for rollback, then use the existing deployment pipeline. After deployment verify the active version, exact new assets, API counts, HTTPS redirect, Chrome interaction and completed public diagnostic results. Browser testing in a VM is simulation; the available cloud browser is Chrome. Firefox, Edge, physical Samsung, full video viewing, CMP legal compliance and real Core Web Vitals are not established by unit tests.

The existing hourly “Vid.Best AdSense Readiness” automation was updated rather than duplicated. It reads this report/current main/deployment artifacts, checks bounded public URLs and changed records, preserves security/data, avoids duplicate PRs and provider bypasses, and notifies only for meaningful changes. Existing separate SEO scheduling and paused Portainer automation were preserved. A running interactive session is not the recurring monitor.

Next safe actions: verify this PR’s production result; complete physical Samsung/browser QA; investigate www routing as a separate reversible configuration repair; obtain authoritative editorial/copyright/privacy decisions for the flagged queue. No AdSense review was requested and no published records were hidden.

## Per-page editorial queue

“Screening clear” means no listed lexical trigger was found; it does not verify accuracy, rights or AdSense eligibility. Length is descriptive, not an approval requirement.

| ID | Current published page | Review words | Manual-review flags |
|---:|---|---:|---|
| 2 | [Lab Review 1 — Player Feature Test](https://vid.best/watch/lab-review-1-player-test) | 38 | Brief test review; Test/demo page |
| 3 | [YouTube Embedded Player Experience Demo](https://vid.best/watch/youtube-embed-experience-demo) | 193 | Test/demo page |
| 4 | [Sadahatama Oba Mage Theme Song (සදහටම ඔබ මගේ තේමා ගීතය)](https://vid.best/watch/sadahatama-oba-mage-theme-song) | 2030 | Screening clear |
| 5 | [Itipiso bhagava: The Power of Supreme Compassion ඉතිපිසෝ භගවා](https://vid.best/watch/itipiso-bhagava-the-power-of-supreme-compassion) | 2052 | Verify health/psychology claims |
| 6 | [A for Apple ABC Alphabet Song](https://vid.best/watch/a-for-apple-abc-alphabet-song) | 2198 | Screening clear |
| 7 | [Best Comedy Compilation: Ultimate Try Not To Laugh Viral Pranks](https://vid.best/watch/best-comedy-compilation-ultimate-try-not-to-laugh-viral-pranks) | 347 | Verify health/psychology claims |
| 8 | [Saiyaara; A Cinematic Romance](https://vid.best/watch/saiyaara-a-cinematic-romance) | 461 | Screening clear |
| 9 | [The Ultimate Bollywood Anthem](https://vid.best/watch/the-ultimate-bollywood-anthem) | 2292 | Verify health/psychology claims |
| 10 | [Sadahatama Oba Mage Teledrama: The Cinematic Romance of Ranveer & Ishaani](https://vid.best/watch/sadahatama-oba-mage-teledrama) | 609 | Screening clear |
| 11 | [The Ultimate Internet Comedy](https://vid.best/watch/the-ultimate-internet-comedy) | 355 | Screening clear |
| 12 | [Meri Aashiqui Tum Se Hi: A story that tells the deepest beauty of love, The Ultimate Epic Romance & Dramatic Storytelling](https://vid.best/watch/tiktok-discovery) | 484 | Screening clear |
| 16 | [Ranking Legendary Laughing Memes](https://vid.best/watch/ranking-legendary-laughing-memes) | 319 | Verify statistics/algorithm claims |
| 17 | [Mr. Bean The Ultimate Cinema Comedy](https://vid.best/watch/mr-bean-the-ultimate-cinema-comedy) | 300 | Screening clear |
| 18 | [A Beautifully Creative "Proposal" Meme](https://vid.best/watch/a-beautifully-creative-proposal-meme) | 363 | Screening clear |
| 19 | [The Funniest Memes: A Funny Proposal, Friendly Pranks & Brutal Pranks](https://vid.best/watch/the-funniest-memes-a-funny-proposal-friendly-pranks) | 342 | Screening clear |
| 20 | [The Ultimate Viral Laughs Compilation](https://vid.best/watch/the-ultimate-viral-laughs-compilation) | 305 | Screening clear |
| 21 | [Super Funny Videos Compilation, Memes](https://vid.best/watch/super-funny-videos-compilation-memes) | 301 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 22 | [ARMCHAIR Bean  /  Funny Clips  /  Mr Bean Official](https://vid.best/watch/armchair-bean-funny-clips-mr-bean-official) | 320 | Screening clear |
| 23 | [Christmas Day!  /  Mr. Bean Official](https://vid.best/watch/christmas-day-mr-bean-official) | 316 | Verify statistics/algorithm claims |
| 24 | [The Ultimate Vocal Magic: Shreya Ghoshal's Live "Teri Ore" Performance!](https://vid.best/watch/the-ultimate-vocal-magic-shreya-ghoshal-s-live-teri-ore-performance) | 2027 | Repeated promotional phrasing |
| 25 | [The Ultimate EDM Anthem: Alan Walker's "Faded" Live Performance! Alan Walker Feat. Tove Stryke](https://vid.best/watch/the-ultimate-edm-anthem-alan-walker-s-faded-live-performance-alan-walker-feat-tove-stryke) | 2110 | Screening clear |
| 26 | [The Funniest Animal Memes: The Boss Chicken & The Scared Dog!](https://vid.best/watch/the-funniest-animal-memes-the-boss-chicken-the-scared-dog) | 279 | Screening clear |
| 27 | [The Ultimate Michael Jackson Playlist: Greatest Hits of the King of Pop!](https://vid.best/watch/the-ultimate-michael-jackson-playlist-greatest-hits-of-the-king-of-pop) | 2213 | Screening clear |
| 28 | [The Ultimate Comedy Viewing Party](https://vid.best/watch/the-ultimate-comedy-viewing-party) | 316 | Screening clear |
| 29 | [The Funniest Football Match Ever: Broomstick Dribbles & Epic Fails!](https://vid.best/watch/the-funniest-football-match-ever-broomstick-dribbles-epic-fails) | 241 | Screening clear |
| 30 | [The Majestic Giant Dog: Is It a Lion or a Puppy](https://vid.best/watch/the-majestic-giant-dog-is-it-a-lion-or-a-puppy) | 273 | Verify statistics/algorithm claims |
| 31 | [The Most Epic Avengers Scene Ever: "I'm Always Angry" & Hulk Smash!](https://vid.best/watch/the-most-epic-avengers-scene-ever-i-m-always-angry-hulk-smash) | 2119 | Verify health/psychology claims |
| 32 | [The Extreme Skateboarding Corgi: Is This Viral Stunt Real or Fake](https://vid.best/watch/the-extreme-skateboarding-corgi-is-this-viral-stunt-real-or-fake) | 201 | Verify statistics/algorithm claims |
| 33 | [Try Not To Laugh (Hard Mode): The Funniest Dinosaur Dub Ever!](https://vid.best/watch/try-not-to-laugh-hard-mode-the-funniest-dinosaur-dub-ever) | 276 | Verify statistics/algorithm claims |
| 34 | [The Most Epic Battle Speech Ever: Aragorn's Final Stand (Lord of the Rings)!](https://vid.best/watch/the-most-epic-battle-speech-ever-aragorn-s-final-stand-lord-of-the-rings) | 2133 | Screening clear |
| 35 | [The Most Epic Fantasy Battle Ever: Hobbit 4K Action Cut!](https://vid.best/watch/the-most-epic-fantasy-battle-ever-hobbit-4k-action-cut) | 2131 | Screening clear |
| 36 | [Lady Gaga & Bruno Mars: "Die With A Smile" Official Music Video](https://vid.best/watch/lady-gaga-bruno-mars-die-with-a-smile-official-music-video) | 2088 | Screening clear |
| 37 | [Building a Secret Dugout Between Two Oak Trees. Bushcraft, Survival Shelter](https://vid.best/watch/building-a-secret-dugout-between-two-oak-trees-bushcraft-survival-shelter) | 2168 | Verify health/psychology claims |
| 38 | [How to make working model of a wind turbine from cardboard  /  school project](https://vid.best/watch/how-to-make-working-model-of-a-wind-turbine-from-cardboard-school-project) | 2153 | Screening clear |
| 39 | [15 ENERGY EFFICIENT INVENTIONS FOR YOUR HOME](https://vid.best/watch/15-energy-efficient-inventions-for-your-home) | 2190 | Screening clear |
| 40 | [How to Make a Water Wheel With Generator - Water Wheel Free Energy](https://vid.best/watch/how-to-make-a-water-wheel-with-generator-water-wheel-free-energy) | 2085 | Screening clear |
| 41 | [10 Home decorating ideas handmade with Seashell  /  Seashell craft ideas](https://vid.best/watch/10-home-decorating-ideas-handmade-with-seashell-seashell-craft-ideas) | 2118 | Screening clear |
| 42 | [creating a *SEASHELL GYARU* sculpture](https://vid.best/watch/creating-a-seashell-gyaru-sculpture) | 2090 | Screening clear |
| 43 | [Daily Calm  /  10 Minute Mindfulness Meditation  /  Be Present](https://vid.best/watch/daily-calm-10-minute-mindfulness-meditation-be-present) | 2211 | Verify health/psychology claims |
| 44 | [🪷 Master Ānāpānasati Meditation: The Ultimate Step-by-Step Guide](https://vid.best/watch/facebook-discovery) | 454 | Screening clear |
| 45 | [Relaxing Sounds & Beautiful Nature Views 🌳  /  Facebook Discovery](https://vid.best/watch/facebook-discovery-5c11fe) | 502 | Verify health/psychology claims |
| 46 | [SAIYAARA SONG DJ BASS BOOSTED #shorts Ahaan Aneet Arijit Singh Mithoon #saiyaara​​​ #ahaanpanday 🥰](https://vid.best/watch/saiyaara-song-dj-bass-boosted-shorts-ahaan-aneet-arijit-singh-mithoon-saiyaara-ahaanpanday) | 453 | Screening clear |
| 47 | [Feel This song.. Ashiqui 🥀🥰](https://vid.best/watch/feel-this-song) | 446 | Verify statistics/algorithm claims |
| 48 | [What’s the Difference between Meditation and Mindfulness? 🧘‍♀️](https://vid.best/watch/what-s-the-difference-between-meditation-and-mindfulness) | 450 | Screening clear |
| 49 | [Try Not To Laugh 🤣 Top 100 Funniest Videos Ever 🎬🔥 Memes, Epic Fails & Pranks Compilation](https://vid.best/watch/try-not-to-laugh-top-100-funniest-videos-ever-memes-epic-fails-pranks-compilation-part-54) | 340 | Verify statistics/algorithm claims |
| 51 | [🍎 Apple Duo mystery #AppleDuo #Viral #Trending #ShortsFeed #MustWatch #FYP #YouTubeShorts #TechTrend](https://vid.best/watch/apple-duo-mystery-appleduo-viral-trending-shortsfeed-mustwatch-fyp-youtubeshorts-techtrend) | 449 | Screening clear |
| 52 | [China’s Street Tech Looks Like 2050 🚀](https://vid.best/watch/china-s-street-tech-looks-like-2050) | 462 | Verify health/psychology claims |
| 53 | [$1 vs $1,000,000,000 Futuristic Tech!](https://vid.best/watch/1-vs-1-000-000-000-futuristic-tech) | 2220 | Screening clear |
| 54 | [The Ultimate Medieval Promposal: Monty Python King Arthur Style! 👑⚔️](https://vid.best/watch/the-ultimate-medieval-promposal-monty-python-king-arthur-style) | 315 | Repeated promotional phrasing; Verify statistics/algorithm claims |
| 55 | [The Northern Lights 🌌 (Aurora Borealis Relaxing View)](https://vid.best/watch/the-northern-lights-aurora-borealis-relaxing-view) | 399 | Screening clear |
| 56 | [Try Not to Laugh Challenge IMPOSSIBLE -Milk eat (You WILL Laugh!)#animation #comedy #memes #cartoon](https://vid.best/watch/try-not-to-laugh-challenge-impossible-milk-eat-you-will-laugh-animation-comedy-memes-cartoon) | 359 | Repeated promotional phrasing |
| 57 | [Sri Lankan Very Famous Delicious Food Kiribath with Katta Sambol කිරිබත් Milk Rice සම්බෝල Coconut](https://vid.best/watch/sri-lankan-very-famous-delicious-food-kiribath-with-katta-sambol-milk-rice-coconut) | 515 | Screening clear |
| 58 | [The Ultimate Movie Theater Funny Fake Proposal Prank! 😂🍿](https://vid.best/watch/the-ultimate-movie-theater-funny-fake-proposal-prank) | 318 | Screening clear |
| 59 | [A BEAUTIFUL PLACES FOREST SINHARAJA Sinharaja - Sri Lanka ලස්සනම තැනක් සිංහරාජ වනාන්තරය ශ්‍රී ලංකාව](https://vid.best/watch/a-beautiful-places-forest-sinharaja-sinharaja-sri-lanka) | 477 | Screening clear |
| 60 | [Water Challange 😁 Funny Cute Faces Instagram DM: Try not to Laugh! 😂](https://vid.best/watch/water-challange-funny-cute-faces-instagram-dm-try-not-to-laugh) | 320 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 61 | [Try Not To Laugh! 😂 Celebrity Reacts to Epic Fails & Pranks 😄](https://vid.best/watch/try-not-to-laugh-celebrity-reacts-to-epic-fails-pranks) | 337 | Verify statistics/algorithm claims |
| 62 | [TRY NOT TO LAUGH 😆 Best Funny Videos Compilation 😂😁😆 Memes](https://vid.best/watch/try-not-to-laugh-best-funny-videos-compilation-memes) | 308 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 63 | [Try Not to Laugh Challenge (IMPOSSIBLE) Laugh and You Lose! 😊](https://vid.best/watch/try-not-to-laugh-challenge-impossible-laugh-and-you-lose-part-16) | 285 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 64 | [💮 Categories of wisdom  /  ප්‍රඥා ප්‍රභේද 🌼 Learn, Reflection, Knowledge, Meditation, Wisdom](https://vid.best/watch/categories-of-wisdom-bhavana-learning-reflection-meditation) | 454 | Screening clear |
| 65 | [Knight Rider Theme 2020 ​🚘 (Cover/Remake by Enzo Margaglio)](https://vid.best/watch/knight-rider-theme-2020-cover-remake-by-enzo-margaglio) | 2147 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 66 | [Hidden Tree Stump Shelter — 6 Minute Build (Fast Version)](https://vid.best/watch/hidden-tree-stump-shelter-6-minute-build-fast-version) | 2134 | Verify health/psychology claims |
| 67 | [J.Geco - Chicken Song 😃🐔 The Ultimate Techno Dance Anthem](https://vid.best/watch/j-geco-chicken-song-the-ultimate-techno-dance-anthem) | 330 | Verify statistics/algorithm claims |
| 68 | [Those one ☝️ Places on Earth That Don't Feel Real! 😌 Surreal Travel Destinations](https://vid.best/watch/those-one-places-on-earth-that-don-t-feel-real-surreal-travel-destinations) | 481 | Verify statistics/algorithm claims |
| 69 | [Shakti & Sarah 😍 Love in the lap of himalaya /  Meriaashiquitumsehi; Soul-Stirring Teledrama Romance! 🎻 The Power of Emotional Soundtracks](https://vid.best/watch/shakti-sarah-meriaashiquitumsehi-ishveer-shaktiarora-radhikamadan-aashiqui-meriaashiqui) | 503 | Screening clear |
| 70 | [Wakawaka song New Trend 😍: You are The Good Learner #shorts #trending #teen #newsong #song Shakira](https://vid.best/watch/wakawaka-song-new-trend-you-are-the-good-learner-shorts-trending-teen-newsong-song-shakira) | 484 | Verify health/psychology claims |
| 71 | [Must Watch New Funny Video 2022 Top New Comedy Video 2022 Try To Not Laugh Episode 169 By #Funny Day](https://vid.best/watch/must-watch-new-funny-video-2022-top-new-comedy-video-2022-try-to-not-laugh-episode-169-by-funny-day) | 340 | Verify statistics/algorithm claims |
| 73 | [The Ultimate TikTok Transition! ✨ Drives Success & Growth  /  Summer😊#Inverted](https://vid.best/watch/summer-inverted-7332342275151760642) | 469 | Verify statistics/algorithm claims |
| 74 | [Ultimate Funny Fails Reaction! Funny Sounds 😂 Try Not to Laugh Challenge](https://vid.best/watch/ultimate-funny-fails-reaction-funny-sounds-try-not-to-laugh-challenge) | 336 | Verify statistics/algorithm claims |
| 76 | [Tom Holland & Zendaya Try Not to Laugh! 😂 Epic Jump Scare Fails](https://vid.best/watch/tom-holland-zendaya-try-not-to-laugh-epic-jump-scare-fails) | 360 | Screening clear |
| 77 | [Funny Fails Reaction! 😊 Inappropriate joke](https://vid.best/watch/trend) | 385 | Repeated promotional phrasing; Verify statistics/algorithm claims |
| 78 | [Tom Holland & Zendaya React! 😂 Fine Comedy & Heartwarming Moments](https://vid.best/watch/trend-426414) | 301 | Repeated promotional phrasing; Verify statistics/algorithm claims |
| 79 | [Hilarious AI Face Filter Prank! 😂 Best Escalator Reactions](https://vid.best/watch/spmm5182) | 347 | Verify statistics/algorithm claims |
| 80 | [Batman Never Asked For A Thank You ❤️  /  The Dark Knight Edit 🦇 The True Meaning of Heroism](https://vid.best/watch/batman-never-asked-for-a-thank-you-edit-shorts-batman) | 428 | Screening clear |
| 81 | [Top 5 Most Viewed TikToks Ever! 🌟🤯 Billions of Views Explained](https://vid.best/watch/top-5-most-viewed-tiktoks-ever-billions-of-views-explained) | 476 | Verify statistics/algorithm claims; Verify hosting rights |
| 82 | [Super Fail Reaction! 😂 Unstoppable Laughter & Epic Pranks](https://vid.best/watch/super-fail-reaction-unstoppable-laughter-epic-pranks) | 352 | Screening clear |
| 83 | [Hilarious Proposal Fail! 😂 When Romance Meets Pure Chaos  /  Farting Girl Ruins Proposal 💍](https://vid.best/watch/hilarious-proposal-fail-when-romance-meets-pure-chaos-farting-girl-ruins-proposal) | 332 | Screening clear |
| 84 | [The chicken is trying to impress me.🤣 Ben etkilendim 👏 Funny CGI Chicken Dance!](https://vid.best/watch/the-chicken-is-trying-to-impress-me-ben-etkilendim-funny-animals-cartoon) | 319 | Verify statistics/algorithm claims |
| 85 | [The Psychology of Viral Edits! 😅 Why Fast Paced Videos Work](https://vid.best/watch/the-psychology-of-viral-edits-why-fast-paced-videos-work) | 351 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 86 | [Luis Fonsi - Despacito ft. Daddy Yankee](https://vid.best/watch/luis-fonsi-despacito-ft-daddy-yankee) | 2052 | Screening clear |
| 87 | [Shakira - Waka Waka ⚽ The Ultimate Anthem of Resilience & Unity](https://vid.best/watch/shakira-waka-waka-the-ultimate-anthem-of-resilience-unity) | 2044 | Verify statistics/algorithm claims |
| 88 | [Romantic AI Art 💖 The Beauty of Digital Love & Sweet Moments](https://vid.best/watch/romantic-ai-art-the-beauty-of-digital-love-sweet-moments) | 407 | Missing description; Verify statistics/algorithm claims |
| 89 | [🧙✨ Harry Potter Hip-Hop Edit! ⚡ The Ultimate Magic Rap Remix](https://vid.best/watch/harry-potter-hip-hop-edit-the-ultimate-magic-rap-remix) | 2010 | Screening clear |
| 90 | [Top 5 Sleep Fails! 😂 The Funniest Dreams Caught on Camera  /  Try Not to Laugh!](https://vid.best/watch/top-5-sleep-fails-the-funniest-dreams-caught-on-camera) | 312 | Verify statistics/algorithm claims |
| 91 | [Celebrity Fail Reactions! 😂 Pure Laughter & The Ethics of Humor](https://vid.best/watch/celebrity-fail-reactions-pure-laughter-the-ethics-of-humor) | 305 | Verify statistics/algorithm claims |
| 92 | [#edits](https://vid.best/watch/edits) | 325 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 93 | [Celebrity Reaction Edit! 😂 The Comedy of Unexpected Fails](https://vid.best/watch/celebrity-reaction-edit-the-comedy-of-unexpected-fails) | 338 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 94 | [Celebrity Reaction Fails! 😂 Pure Laughter & The Boundaries of Pranks](https://vid.best/watch/celebrity-reaction-fails-pure-laughter-the-boundaries-of-pranks) | 351 | Verify health/psychology claims |
| 95 | [Celebrity Reaction Fails! 😂 The Comedy of Unexpected Pranks](https://vid.best/watch/celebrity-reaction-fails-the-comedy-of-unexpected-pranks) | 330 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 96 | [Celebrity Reactions! 😆 Rebounding Balls, Blazzier Challenges & Funny Fails](https://vid.best/watch/celebrity-reactions-rebounding-balls-blazzier-challenges-funny-fails) | 280 | Verify health/psychology claims |
| 97 | [Celebrity Reactions! 😆 The Imaginary Chair Fall, Funny Ladders & Slapstick](https://vid.best/watch/celebrity-reactions-the-imaginary-chair-fall-funny-ladders-slapstick) | 254 | Verify health/psychology claims |
| 98 | [💗 Why This Kolaveri Di Official Video  /  Dhanush  /  Anirudh Ravichander  /  Shruti Haasan](https://vid.best/watch/3-why-this-kolaveri-di-official-video-dhanush-anirudh-ravichander-shruti-haasan) | 2056 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 99 | [🕺💃 Maari 2 - Rowdy Baby (Video Song)  /  Dhanush, Sai Pallavi  /  Yuvan Shankar Raja  /  Balaji Mohan](https://vid.best/watch/maari-2-rowdy-baby-video-song-dhanush-sai-pallavi-yuvan-shankar-raja-balaji-mohan) | 2029 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 100 | [Justin Bieber - Baby ft. Ludacris / 😃 Why Justin Bieber's 'Baby' Became a Legendary Viral Hit Why Justin Bieber's 'Baby' Became a Legendary Viral Hit](https://vid.best/watch/justin-bieber-baby-ft-ludacris) | 2030 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 101 | [🤩 Shakira, Burna Boy - Dai Dai (Official Video) The Ultimate Football Anthem](https://vid.best/watch/shakira-burna-boy-dai-dai-official-video) | 2043 | Screening clear |
| 102 | [🥺 Arash & Helena's 'One Day' - The Ultimate Emotional Journey](https://vid.best/watch/arash-feat-helena-one-day-official-video) | 2080 | Verify statistics/algorithm claims |
| 103 | [🤩🌟😆 PSY - GANGNAM STYLE(강남스타일) M/V  /  Why PSY's 'Gangnam Style' Became the Ultimate Viral Hit](https://vid.best/watch/psy-gangnam-style-m-v) | 2092 | Verify statistics/algorithm claims |
| 104 | [😌 Place On Earth That Don't Feel Real - Travel & Illusion](https://vid.best/watch/place-on-earth-that-don-t-feel-real-travel-explore-expectations-adventure-shorts) | 423 | Repeated promotional phrasing; Verify health/psychology claims |
| 105 | [🌌 Places In Real Life 😆 Travel Social Media vs. Reality - The Truth About Viral Places](https://vid.best/watch/places-in-real-life-travel-explore-adventure-destinations) | 379 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 106 | [🥓🍞🍳🥣 4 Delicious Breakfast Recipes  /  Gordon Ramsay](https://vid.best/watch/4-delicious-breakfast-recipes-gordon-ramsay) | 2065 | Repeated promotional phrasing |
| 107 | [😃💼 Three 3 Best Business can start with $3 dollar in 2025 😏](https://vid.best/watch/three-3-best-business-can-start-with-3-dollar-in-2025-subscribe) | 368 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 108 | [Dilscoop Shot 🥶  /  /  The Psychology and Brilliance of Tillakaratne Dilshan's Dilscoop](https://vid.best/watch/dilscoop-shot-shorts-cricket) | 462 | Verify health/psychology claims |
| 109 | [Tui Tui Comedy Video😂Tui tui Best Funny Video 2022😂Special New Video😂DONT MISS THIS EPISODE](https://vid.best/watch/tui-tui-comedy-video-tui-tui-best-funny-video-2022-special-new-video-dont-miss-this-episode) | 283 | Verify health/psychology claims |
| 110 | [⚾ Lasith Malinga’s Unstoppable 4 Wickets in 4 Balls! 💀🔥](https://vid.best/watch/lasith-malinga-s-unstoppable-4-wickets-in-4-balls) | 452 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 111 | [🏏 How Ali Khan Bowled a 5-Run Wide... Without the Bat Touching the Ball?](https://vid.best/watch/how-ali-khan-bowled-a-5-run-wide-without-the-bat-touching-the-ball) | 485 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 112 | [5.5 million views Indian idol funny video  /  Hilarious Viral Meme! 😂 The Fake Indian Idol Dance Edit Explained](https://vid.best/watch/5-5-million-views-indian-idol-funny-video) | 297 | Verify statistics/algorithm claims |
| 113 | [NEW BEST FUNNY VIDEOS Jacksinfo Try Not Laugh Challenge Compilation Part 15 😅](https://vid.best/watch/new-best-funny-videos-jacksinfo-try-not-laugh-challenge-compilation-part-15) | 324 | Screening clear |
| 114 | [😂 Try Not To Laugh - Epic Fails & Celebrity Reactions](https://vid.best/watch/trend-0cb298) | 301 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 115 | [​❤️ Why 'Tujh Mein Rab Dikhta Hai' Remains an Iconic Bollywood Anthem](https://vid.best/watch/tujh-mein-rab-dikhta-hai-song-rab-ne-bana-di-jodi-shah-rukh-khan-anushka-sharma-roop-kumar) | 2051 | Repeated promotional phrasing; Verify health/psychology claims |
| 116 | [😎 𝐊𝐚𝐥𝐚 𝐂𝐡𝐚𝐬𝐡𝐦𝐚  /  Baar Baar Dekho  /  Sidharth M & Katrina Kaif  /  Badshah, Neha Kakkar, Prem & Hardeep 😃](https://vid.best/watch/kala-chashma-baar-baar-dekho-sidharth-m-katrina-kaif-badshah-neha-kakkar-prem-hardeep) | 2011 | Screening clear |
| 117 | [🧡 Full Song: KHAIRIYAT (BONUS TRACK)  /  CHHICHHORE  /  Sushant, Shraddha  /  Pritam, Amitabh B / Arijit Singh](https://vid.best/watch/full-song-khairiyat-bonus-track-chhichhore-sushant-shraddha-pritam-amitabh-b-arijit-singh) | 2015 | Repeated promotional phrasing |
| 118 | [Saree Ke Fall Sa /  Full (Video) 😃 - R...Rajkumar / Pritam / Shahid & Sonakshi / Antara & Nakash ⭐](https://vid.best/watch/saree-ke-fall-sa-full-video-r-rajkumar-pritam-shahid-sonakshi-antara-nakash) | 2017 | Repeated promotional phrasing |
| 119 | [😃 OFFICIAL: Best Travelling Songs of Bollywood  /  Road Trip Songs  /  T-SERIES 😊](https://vid.best/watch/official-best-travelling-songs-of-bollywood-road-trip-songs-t-series) | 2093 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 120 | [🏍️ African Action Bike Riding 2026 🤣🤣 Why This Chaotic Motorcycle Meme is Pure Slapstick Brilliance](https://vid.best/watch/african-action-bike-riding-2026-shorts-african-bike-funny-bikestunt) | 323 | Verify statistics/algorithm claims |
| 121 | [😌🏆😁 Try Not To Laugh Super Hard!  /  The Funniest Moments & Fails  /  You Laugh You Lose Challenge 🎮](https://vid.best/watch/try-not-to-laugh-super-hard-the-funniest-moments-fails-you-laugh-you-lose-challenge-part-3) | 314 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 122 | [Try Not To Laugh 🤣 Top 100 Funniest Videos Ever  /  Memes Epic Fails & Pranks Compilation](https://vid.best/watch/try-not-to-laugh-top-100-funniest-videos-ever-memes-epic-fails-pranks-compilation-2026-part-13) | 322 | Verify health/psychology claims; Verify statistics/algorithm claims |
| 123 | [⚡“Golden” Official Lyric Video  /  KPop Demon Hunters  /  Sony Animation ✨ The Animated Brilliance of K-Pop Demon Hunters' "Golden"](https://vid.best/watch/golden-official-lyric-video-kpop-demon-hunters-sony-animation) | 2043 | Repeated promotional phrasing |
| 124 | [🌟 Ed Sheeran - Shape of You (Official Music Video) 🥊 Why Ed Sheeran's 'Shape of You' Was a Visual Masterpiece](https://vid.best/watch/ed-sheeran-shape-of-you-official-music-video-why-ed-sheeran-s-shape-of-you-was-a-visual-masterpiece) | 2015 | Repeated promotional phrasing |
| 125 | [Viral Comedy Breakdown! 😂 The Hilarious Dishwashing Dog Meme Explained](https://vid.best/watch/viral-comedy-breakdown-the-hilarious-dishwashing-dog-meme-explained) | 386 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 126 | [This Man Has World's Most Stunning Peacocks!😥❤️](https://vid.best/watch/this-man-has-world-s-most-stunning-peacocks) | 437 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 127 | [🦩 Top 10 Stunning Red Animals 🌏Wildlife Shorts Breakdown! ✨ The Visual Power of 'Top 10 Red Animals](https://vid.best/watch/top-10-stunning-red-animals-wildlife-shorts-breakdown-the-visual-power-of-top-10-red-animals) | 465 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 128 | [🐒 Freakiest Animals Across the Globe  /  MEGA EPISODE  /  Nat Geo Animals 🦇 Freaks of the Jungle & Sky 🌳](https://vid.best/watch/freakiest-animals-across-the-globe-mega-episode-nat-geo-animals-freaks-of-the-jungle-sky) | 2156 | Repeated promotional phrasing |
| 129 | [🎨 How Zach King Gets Away With Doing Graffiti  /  Magic Trick Breakdown! ✨ How Zach King Fakes Graffiti 🪜](https://vid.best/watch/how-zach-king-gets-away-with-doing-graffiti-magic-trick-breakdown-how-zach-king-fakes-graffiti) | 534 | Repeated promotional phrasing; Verify statistics/algorithm claims |
| 130 | [Katy Perry - Roar  /  🐅✨How Katy Perry Conquered the Jungle in 'Roar'](https://vid.best/watch/katy-perry-roar-how-katy-perry-conquered-the-jungle-in-roar) | 2081 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 131 | [🌟 Wiz Khalifa - See You Again ft. Charlie Puth Official Video Furious 7 Soundtrack](https://vid.best/watch/wiz-khalifa-see-you-again-ft-charlie-puth-official-video-furious-7-soundtrack) | 2220 | Repeated promotional phrasing; Verify statistics/algorithm claims |
| 132 | [👑✨ Guli Mata - Saad Lamjarred  /  Shreya Ghoshal  /  Jennifer Winget  /  Anshul Garg](https://vid.best/watch/guli-mata-saad-lamjarred-shreya-ghoshal-jennifer-winget-anshul-garg) | 2128 | Repeated promotional phrasing |
| 133 | [TRY NOT TO LAUGH 🤣 Best Funny Videos Compilation 😂😁😆 Memes](https://vid.best/watch/try-not-to-laugh-best-funny-videos-compilation-memes-part-6) | 311 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 134 | [🎸✨ ROSÉ & Bruno Mars - APT. (Official Music Video)](https://vid.best/watch/rose-bruno-mars-apt-official-music-video) | 2060 | Repeated promotional phrasing; Verify statistics/algorithm claims |
| 135 | [🥰😍🤩 Titli Chennai Express Full Video Song  /  Shahrukh Khan, Deepika Padukone ❤ Music Video Analysis! 🦋 Why 'Titli' is a Bollywood Masterpiece 💛](https://vid.best/watch/titli-chennai-express-full-video-song-shahrukh-khan-deepika-padukone-music-video-analysis-why-titli-) | 2184 | Repeated promotional phrasing |
| 136 | [🌟 Dumbledore vs. Voldemort  /  Full Scene  /  Harry Potter and the Order of the Phoenix  /  Scene Analysis! ⚡✨ Why Dumbledore vs. Voldemort is Cinema's Greatest Duel](https://vid.best/watch/dumbledore-vs-voldemort-full-scene-harry-potter-and-the-order-of-the-phoenix-scene-analysis-why-dumb) | 2283 | Repeated promotional phrasing; Verify health/psychology claims |
| 137 | [⭐ The Balrog of Morgoth  /  The Lord of the Rings: The Fellowship of the Ring  /  Scene Analysis! 🌋✨ Why the Balrog is Cinema's Most Terrifying Monster](https://vid.best/watch/the-balrog-of-morgoth-the-lord-of-the-rings-the-fellowship-of-the-ring-scene-analysis-why-the-balrog) | 2184 | Repeated promotional phrasing |
| 138 | [🌟😃 Dandanakka – A Spirited Tribute to T. Rajendar  /  Romeo Juliet](https://vid.best/watch/dandanakka-romeo-juliet-jayam-ravi) | 2042 | Screening clear |
| 139 | [😂😁🥤 🥫 🧊 This Man! An Expressive Soft-Drink Reaction!](https://vid.best/watch/this-man-expressive-soft-drink-reaction) | 302 | Screening clear |
| 142 | [😂👖🕶 Pol Karu's Playful Fashion Show!](https://vid.best/watch/pol-karu-playful-fashion-show) | 288 | Screening clear |
| 143 | [👖😃 Order Now, Limited Stock!](https://vid.best/watch/order-now-limited-stock-potta-kusuma) | 278 | Screening clear |
| 144 | [🏡 A Garden Like a Painting](https://vid.best/watch/garden-like-painting-sithara-plant) | 281 | Screening clear |
| 145 | [🌱 Nature Is Power — A Sinhala Appreciation of the Earth! Nature Healing Reel Analysis! 🌿✨ Quiet Strength & The Whispers of Trees](https://vid.best/watch/nature-is-power-sinhala-earth-reflection) | 386 | Repeated promotional phrasing; Verify health/psychology claims |
| 149 | [Live Kindly, Enjoy the Time You Have  /  Life Philosophy Reel Analysis! 🌅✨ True Freedom, Happiness & Peaceful Vibes](https://vid.best/watch/live-kindly-enjoy-your-time) | 335 | Screening clear |
| 150 | [Life Lesson Reel Analysis! 🛤️✨ Sanju Doni on Moving Forward and Personal Growth](https://vid.best/watch/some-meetings-end-in-goodbye-sinhala-reflection) | 303 | Screening clear |
| 151 | [🌟 Trust Yourself — Confidence in a Cinematic Moment  /  Motivational Reel Analysis! 🐺✨ Self-Confidence and Inner Strength](https://vid.best/watch/trust-yourself-cinematic-confidence) | 355 | Repeated promotional phrasing |
| 152 | [Past → Present → Progress — Smart ICT's Learning Mindset  /  Educational Reel Analysis! 🚀📚 Apple & Amazon: From Small Starts to Global Giants](https://vid.best/watch/past-present-progress-smart-ict) | 359 | Repeated promotional phrasing |
| 153 | [Viral Cake Illusion Analysis! 🍰🙀 When a Hyper-Realistic Cat Cake Terrifies Real Pets 🐱 Cake or Cat? A Playful Cake Illusion and Reaction](https://vid.best/watch/cake-or-cat-cake-illusion-reaction) | 545 | Repeated promotional phrasing; Verify health/psychology claims |
| 155 | [😂👗 Fashion Means Fashion!  /  Fashion Parody Analysis! When High Fashion Meets Household Junk!](https://vid.best/watch/fashion-means-fashion-our-media) | 480 | Repeated promotional phrasing |
| 156 | [Viral Pet Drama Analysis! 🐕🐾 When the Dog Comes Home Late & Has to Face the Ultimate Cat Interrogation! 😾⏰](https://vid.best/watch/late-home-cat-dog-couple-shaa-bro) | 364 | Repeated promotional phrasing |
| 157 | [🧮 When Maths Symbols Start Dancing — Dilu Teacher's Fun Edit](https://vid.best/watch/maths-symbols-start-dancing-dilu-teacher) | 279 | Screening clear |
| 158 | [🐱 Unstoppable, Cat Version — An Imaginative Music Parody  /  Viral Video Analysis! 🎤🐱 Why the 'Unstoppable' Cat Singer is a Masterpiece](https://vid.best/watch/unstoppable-cat-version-sangeethaya-lk) | 282 | Repeated promotional phrasing |
| 159 | [🦌🐾 An Animal Close-Up and a Reflection on Compassion  /  Wildlife Rescue Analysis! 🦌✨ The Amazing 'Bodhisattva' Deer That Asked for Help](https://vid.best/watch/animal-compassion-anil-oskar) | 418 | Repeated promotional phrasing |
| 160 | [🐜 Remembering Kindness — Gratitude Reflection  /  Viral Reel Analysis! ✨ The Hidden Philosophy of the Ant & True Gratitude](https://vid.best/watch/remembering-kindness-sinhala-gratitude) | 492 | Repeated promotional phrasing |
| 161 | [Are You in the Right Place? 🏃‍♂️🎥 Reflection on Value  /  Viral Reel Analysis! Why The 'Fast Cameraman' is a Powerful Life Lesson](https://vid.best/watch/are-you-in-the-right-place-sinhala-reflection) | 308 | Repeated promotional phrasing |
| 162 | [😃 Outdoor Challenge Comedy — Big Reactions Around the Table](https://vid.best/watch/outdoor-challenge-comedy-big-reactions-around-the-table) | 298 | Screening clear |
| 164 | [Viral Animal Comedy! 🤣🐂 Woman Mimics a Bull in a Hilarious Standoff!](https://vid.best/watch/viral-animal-comedy-woman-mimics-a-bull-in-a-hilarious-standoff-paul-butterfield-rick-danko-levon-he) | 322 | Screening clear |
| 165 | [Viral Wildlife Comedy! 🐒🍷 Drunk Animals Eating Fermented Marula Fruit](https://vid.best/watch/viral-wildlife-comedy-drunk-animals-eating-fermented-marula-fruit) | 328 | Repeated promotional phrasing |
| 166 | [Funny couple riding a motorcycle  /  Viral Motorcycle Comedy! 🏍️🤣 Hilarious Couple Fails & Epic Dirt Bike Crashes](https://vid.best/watch/funny-couple-riding-a-motorcycle-viral-motorcycle-comedy-hilarious-couple-fails-epic-dirt-bike-crash) | 287 | Repeated promotional phrasing |
| 167 | [Harry Potter AI Parody! 🪄🤣 Gen Z Dumbledore, Pizza Hagrid & Hogwarts Chaos](https://vid.best/watch/harry-potter-ai-parody-gen-z-dumbledore-pizza-hagrid-hogwarts-chaos) | 323 | Repeated promotional phrasing |
| 168 | [Epic Cinematic Analysis! ⚔️🐘 The Lord of the Rings: Rohan vs. The Mumakil](https://vid.best/watch/epic-cinematic-analysis-the-lord-of-the-rings-rohan-vs-the-mumakil) | 320 | Repeated promotional phrasing |
| 169 | [✨ The Lord of the Rings: The Return of the King  /  Éowyn's Epic Showdown with the Witch-king 🛡️⚔️ /  Epic Cinematic Analysis! 🗡️ I Am No Man](https://vid.best/watch/the-lord-of-the-rings-the-return-of-the-king-e-owyn-s-epic-showdown-with-the-witch-king-epic-cinemat) | 339 | Repeated promotional phrasing |
| 170 | [🏰✨ The Lord of the Rings  /  The Siege of Minas Tirith: Gandalf's Stand Against the Armored Trolls 🏰⚔️](https://vid.best/watch/the-lord-of-the-rings-the-siege-of-minas-tirith-gandalf-s-stand-against-the-armored-trolls) | 340 | Repeated promotional phrasing |
| 171 | [Viral Comedy Fails Analysis! 🤣 Hilarious Slapstick & Celebrity Reaction Edits](https://vid.best/watch/viral-comedy-fails-analysis-hilarious-slapstick-celebrity-reaction-edits) | 342 | Repeated promotional phrasing; Verify health/psychology claims |
| 172 | [Man Tries to Blend In With a Gorilla It Doesn't Go as Planned! 🦍😱](https://vid.best/watch/man-tries-to-blend-in-with-a-gorilla-it-doesn-t-go-as-planned) | 286 | Repeated promotional phrasing |
| 173 | [🤣Funny couple😅sony♥️Viral Couple Comedy Analysis! 🤣📱 Girlfriend Caught Checking His Phone!](https://vid.best/watch/funny-couple-sony-viral-couple-comedy-analysis-girlfriend-caught-checking-his-phone) | 340 | Repeated promotional phrasing |
| 174 | [Viral Firecracker Prank Analysis! 💥🤣 Epic Jump Scare & Hilarious Couple 😂  /  Instagram Viral Comedy Reels  /  Priyal Kukreja](https://vid.best/watch/viral-firecracker-prank-analysis-epic-jump-scare-hilarious-couple-instagram-viral-comedy-reels-priya) | 336 | Repeated promotional phrasing |
| 177 | [Viral Funny Animal Compilation! 🐶🤣 The Dramatic Corgi "Play Dead" Fail](https://vid.best/watch/viral-funny-animal-compilation-the-dramatic-corgi-play-dead-fail) | 299 | Repeated promotional phrasing |
| 178 | [The poor puppy not have anything🥺 Heartwarming Animated Story! 🐶🐟 Cute Puppy Rescues a Goldfish](https://vid.best/watch/the-poor-puppy-not-have-anything-short-viralshorts-emotionalstory-cutedog-streetdog-subscribe) | 313 | Repeated promotional phrasing |
| 179 | [Viral Couple Comedy Analysis! 🤣 BTS vs. Results & Hilarious Jump Fail](https://vid.best/watch/viral-couple-comedy-analysis-bts-vs-results-hilarious-jump-fail) | 352 | Repeated promotional phrasing |
| 180 | [⭐ Bruno Mars - The Lazy Song (Official Music Video) Epic Music Video Analysis! 🐒🎸 (Monkey Dance)](https://vid.best/watch/bruno-mars-the-lazy-song-official-music-video) | 326 | Repeated promotional phrasing |
| 181 | [Heartwarming Animal Rescue! 🦆🐶 Puppy Saves Ducklings & Shares Sweet Friendship  /  Bé cún này thông minh, và nặng tình quá trời...](https://vid.best/watch/heartwarming-animal-rescue-puppy-saves-ducklings-shares-sweet-friendship-be-cu-n-na-y-tho-ng-minh-va) | 373 | Repeated promotional phrasing; Verify statistics/algorithm claims |
| 182 | [🌟 Funny Indian TV Moments! 🤣 Ishani Gets Drunk & Ranveer's Hilarious Reactions Ishani funny moment](https://vid.best/watch/funny-indian-tv-moments-ishani-gets-drunk-ranveer-s-hilarious-reactions-ishani-funny-moment) | 288 | Repeated promotional phrasing |
| 183 | [Why Silent Comedy Shorts Are Winning! 🤫📱 The Secret to Global Views!](https://vid.best/watch/why-silent-comedy-shorts-are-winning-the-secret-to-global-views) | 306 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 184 | [Harry Potter AI Parody! 🪄😂 Dudley's Monkey Tail & Chaotic Dursley Fails](https://vid.best/watch/harry-potter-ai-parody-dudley-s-monkey-tail-chaotic-dursley-fails) | 314 | Repeated promotional phrasing |
| 185 | [😊 Sleep well best relaxing, calm, focus concentrate music rain,nature Sleep Well & Relaxing Music! 🌧️💤 Calm Rain Sounds for Focus and Deep Sleep!](https://vid.best/watch/sleep-well-best-relaxing-calm-focus-concentrate-music-rain-nature-sleep-well-relaxing-music-calm-rai) | 402 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
| 186 | [🏞️🎹🕊️ Flying: Relaxing Sleep Music for Meditation, Stress Relief & Relaxation by Peder B. Helland](https://vid.best/watch/flying-relaxing-sleep-music-for-meditation-stress-relief-relaxation-by-peder-b-helland) | 291 | Repeated promotional phrasing; Verify health/psychology claims; Verify statistics/algorithm claims |
