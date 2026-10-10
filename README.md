# Vid.Best

## Member notifications

Passwordless member sign-in, optional email alerts, browser alerts and install shortcuts are available from the home-page notification hub.

Vid.Best is a Cloudflare-native video review and discovery platform built with:

- Cloudflare Workers for routing and edge server-side rendering (SSR)
- Cloudflare Static Assets for the public and admin interfaces
- Cloudflare D1 (`video-reviews-db`) for reviews, reactions, comments, discovery requests and verified source metadata
- Cloudflare R2 (`vid-assets`) for uploaded video/image assets
- Gemini, through the Worker secret `GEMINI_KEY`, for structured editorial drafts
- A private, optional Teamwork API for administrator-requested OCR, transcription and page evidence
- Dynamic `/watch/:slug` pages with unique metadata and canonical URLs
- Trusted provider embeds plus direct/R2 media in a persistent watch experience
- Privacy-hashed category preferences for related-video ranking
- Published-only XML/video sitemaps

There is **no need to create or commit one physical HTML file per video**. A request such as `/watch/example-video` is rendered by the Worker from its D1 record and returned as normal HTML to browsers and search crawlers.

## Architecture decisions

### Deliberate publishing instead of search-page generation

A public search that finds nothing does not create an indexable page. Visitors can submit a discovery request, which enters the administrator queue. A useful review is created only after an administrator selects a source, generates/edits the draft and deliberately enables **Published**.

New records are draft-first. This avoids turning arbitrary visitor searches into thousands of thin public pages.

### Editorial AI and media analysis

Gemini drafting runs through the Worker. The optional service in `services/teamwork/` performs administrator-requested frame OCR, transcription and page extraction on Oracle Linux, then returns evidence for human review. It never publishes pages. Ollama is optional and disabled by default; on a very small machine, leave it disabled and let Gemini create the editorial draft from the extracted evidence.

### 4get / external crawler integration

The Teamwork API can query an operator-configured 4get JSON endpoint during an administrator analysis job. Results remain private evidence until the administrator verifies and saves a draft. Public searches never trigger crawling or automatic page publication.

### Edge SSR and caching

Published watch pages are rendered from D1 by the Worker. Workers caching is enabled for responses that are explicitly cacheable; administrator and sensitive API responses already use `no-store`. Watch pages use a short freshness period plus `stale-while-revalidate` for resilience.

### TikTok oEmbed gateway and cache

TikTok metadata requests are centralized in `src/index.js`. The configured Worker variable is:

`TIKTOK_OEMBED_GATEWAY=https://tiktok-oembed-gateway.gkasunc.workers.dev/`

The public browser calls Vid.Best's same-origin `/api/tiktok/embed` endpoint. The Worker requests the gateway with a validated full HTTPS sharing URL using `URLSearchParams`. Normalized metadata is fresh for 24 hours in D1 and Cloudflare Cache API; stale metadata is retained for at most seven days without resetting its original age. Concurrent requests for the same ID share one request. A persistent D1 cooldown honors upstream `Retry-After`; removed videos do not use stale metadata. The shared browser client adds a five-minute session cache, request coalescing and failure cooldowns.

The gateway repository `Gamagek/tiktok-oembed-gateway` adds a global Durable Object cache, bounded upstream concurrency and persisted refresh limits/cooldowns. Deploy its `OEMBED_CACHE` binding and SQLite migration with the supplied `wrangler.toml`. Edge caches alone are local to each Cloudflare location and cannot coordinate global request bursts. Neither cache stores video bytes.

### TikTok playback and video-cache diagnosis

Admin-approved TikTok downloads use a durable D1 job in `src/tiktok-cache-jobs.js`.
Save a rights-confirmed TikTok record to queue it, or use its explicit retry button.
The existing 15-minute cron resumes eligible jobs after failures or restarts, with
at most three webhook attempts, persistent backoff, and a conditional D1 lease
that prevents simultaneous Save/Retry/cron requests from duplicating work. The
authenticated `GET /api/admin/videos/:id/cache-tiktok` only checks R2; it never
calls a scraper. The admin shows queued, failed, or verified complete status.
An accepted webhook is not a completed upload. Existing Summer/Saiyaara paths and
records without saved redistribution rights are excluded.

The webhook uses `redirect: "manual"` and rejects redirects explicitly. Its
`CACHE_HOOK_SECRET` must match the Portainer value (32+ characters); the older
`VIDBEST_CACHE_HOOK_SECRET` alias remains supported. `SIGN_SECRET` is independent.
HTTP 502, auth failure, malformed acknowledgments, and storage failure produce
different actionable status messages. No secrets or raw provider responses are
sent to the browser. `VIDBEST_AUTO_CACHE_TIKTOK=0` pauses automatic video jobs.

The same cron copies validated oEmbed thumbnails directly from their allowlisted
image CDN to `vid-assets/uploads/tiktok-thumbnails/`. This does not depend on
Oracle or Portainer. Copies are capped at 2 MB, validated by type and signature,
and failed image fetches get a persistent 24-hour retry cooldown. Custom admin
thumbnails are preserved. The cached-poster endpoint uses the R2 image when it
exists and retains the text poster if storage is unavailable. D1 holds metadata;
the gateway already has its separate `TIKTOK_OEMBED_KV` and Durable Object cache.

The owner-supplied Portainer v55 stack also had a response mismatch: its tester
recognized `download_link.watermark`, but its private resolver only returned
`data.wmplay`. The compatible [v56 stack and deployment notes](ops/portainer/README.md)
fix that mismatch without changing credentials, rights checks, protected videos,
or the shared monthly provider budget.

Standard TikTok cards open one on-demand Cloudflare player at `https://tiktok-oembed-gateway.gkasunc.workers.dev/watch?url=...`. No TikTok `embed.js`, blockquote injection, or official player iframe is mounted. The gateway checks the private `vid-assets` R2 bucket first and serves signed, byte-range MP4 responses directly from Cloudflare when a valid copy exists. Cached playback does not depend on Oracle or its tunnel.

On a cache miss the gateway signs a request to the existing Node/Portainer `/status` endpoint at `video.megasale.win`. Only that Node service can prepare and upload a missing copy. The Worker distinguishes preparation, storage failures, gateway authorization failures, unreachable services and source failures. It never equates cached oEmbed JSON or an iframe `load` event with video availability. The controlled player polls preparation at three-second intervals, at most 15 times, honors real backend cooldowns, and offers a deliberate retry. It does not automatically retry a terminal error or circumvent a provider block.

The frontend's former 14-second timeout no longer destroys the iframe or invents a 15-minute browser cooldown. Existing old session cooldown entries are ignored. Cross-origin status messages must match the exact Worker origin, active frame window, video ID and allowed event type. The swipe viewer records a standard TikTok view only after a real `playing` event and its existing viewing interval; error/metadata pages do not count.

Deploy the gateway repository first with its `VIDEO_CACHE` R2 binding and matching `SIGN_SECRET`. Then deploy this app. The browser never receives the secret. The owner-supplied Saiyaara Tagembed player and other provider paths are unchanged.

Operational checks and the supplied Portainer code's remaining limitations are documented in the gateway repository's `OPERATIONS.md`. oEmbed metadata lives in D1/Durable Objects, not as playable MP4s in R2. An empty R2 bucket cannot provide a cached video, regardless of successful metadata responses. Private R2 access is expected; no public bucket setting is needed.

### Saiyaara: cached preview and click-loaded Tagembed

`public/saiyaara-tagembed.js` owns the canonical Saiyaara player across grid,
watch, floating popup and fullscreen/swipe. Every surface initially uses the
same first-party `/api/tiktok/cached-poster?id=7669587518156705056&v=2` image.
There is **no Tagembed iframe on page load or when a card enters the viewport**.
Only clicking **Load video** requests widget 2236794, post 5592899. The verified
`caption=0&header=0` display options remove the redundant post header/caption;
creator attribution remains in the Vid.Best player. The complete provider
viewport, including its action row, scales inside the available space without
cropping. Grid cards retain their standard 230px media height.

The poster cache pins the exact public image already displayed by this owner's
post. It validates the image type/magic bytes, limits it to 2 MB and stores it in
R2. The browser caches successful images for a day. A D1 lease shared by the
background warmup and cron limits unsuccessful upstream fetches to once per day.
The first miss serves a local text poster immediately, cached for only 60 seconds,
while warming R2. The known expired TikTok thumbnail URL is not used for this
player. No video files or Tagembed HTML are copied, and no API key is required.

At most one Tagembed iframe is active per document. Normal/mini/popup resizing
keeps it alive. Fullscreen transfers use `Element.moveBefore()` where supported,
preserving iframe state without another provider load. Older browsers return to
the poster and wait for another deliberate click. Swiping away destroys the
inactive player. Closing fullscreen does not automatically reload an old URL.

Iframe listeners are attached before `src` is set. A document load is not a
playback signal, so there is no timeout claiming an already-playing video is
unavailable. No vendor SDK or undocumented postMessage play/mute/quality commands
are injected. The inspected Tagembed post autoplays muted and does not expose a
remote sound/quality API. `allow="autoplay"` delegates browser permission but
cannot force the provider to unmute or choose a rendition. Those options must
be enabled in Tagembed or supplied through an owner-authorized direct video.
Actual widget plays still count toward the provider plan; the cached poster and
click gate reduce unused loads, not the provider's quota enforcement.

### Video SEO correctness

The watch page includes canonical, Open Graph and X/Twitter metadata. `VideoObject` JSON-LD is emitted conservatively:

- a real video thumbnail is required; the site favicon is never used as a fake video thumbnail in structured data;
- for YouTube sources, the Worker can verify the original publication date and duration through the YouTube Data API and store them in D1;
- for other trusted providers, an administrator can supply the verified original publication date and duration when the provider API is unavailable;
- external embeds without a verified original publication date remain normal indexable pages, but their potentially inaccurate `VideoObject` block is omitted;
- only published D1 records appear in the sitemap.

### Player

Instagram posts and Reels use a dedicated official embed wrapper in
`public/instagram-player.js`, with a portrait layout, reload, fullscreen (where
supported) and an original-post link. Homepage Instagram cards offer an explicit
**Show Instagram preview** action; only one such preview stays open at a time.
Closing the preview removes the iframe. URL normalization is shared with the
Worker, so old published records also get clean embed URLs without database edits.
Instagram does not share a direct media URL or a supported playback/EQ API with
this wrapper. Its own embed may send viewers to Instagram to watch; iframe load
is not treated as proof of playback. Generic playback and Audio Lab controls are
excluded from Instagram pages. Other providers keep their existing player paths.

TikTok watch pages and homepage cards use cached metadata cards with thumbnails, titles and creators. Standard cards use the controlled Cloudflare player described above; Saiyaara retains its independent Tagembed test player. Closing a popup or swiping away removes the active iframe and its status listener. Missing metadata does not prevent a playback attempt.

Self-hosted/raw video uses the browser's native player plus Vid.Best controls for play/pause, 10-second rewind/forward, playback speed, zoom, fullscreen and picture-in-picture when the browser supports it. Other trusted provider links keep their existing provider-owned embed paths for YouTube, Vimeo, Dailymotion, Twitch, Instagram and Facebook. Arbitrary iframe HTML is never accepted.

On a watch page, scrolling beyond the player starts a three-second delay. The player then becomes a mini-player; native media and YouTube can begin muted when browser policy allows. **Return**, **Pop-up** and **Close** controls preserve a deliberate user escape path. Reduced-motion visitors do not get automatic playback.

For owned R2 media, the optional Teamwork API can generate WebVTT captions through a mounted `whisper.cpp` model. Provider embeds continue to use provider-supplied captions. Adaptive low-bandwidth switching still requires multiple encoded renditions/HLS or DASH rather than a single MP4 object.

### Recommendations and privacy

Each watch page has search/category filtering and a **Watch next** panel. Ranking combines matching category/subcategory, popularity and optional **Show more/fewer like this** signals. The Worker stores a salted one-way fingerprint derived from the request IP and user agent; it does not store the raw IP address in the preference table. Preferences expire after 180 days.

### Comments

Public comments are never shown immediately. Text and optional allowlisted image attachments are stored as `pending`, rate-limited, and only `approved` comments are returned publicly. Rejected comment images are removed from R2. This is intentionally safer than auto-publishing and hiding content later.

## Important security step

If any GitHub, R2, Cloudflare or admin credential was ever pasted into a message or committed to a file, revoke it and create a new one before deployment. Never place credentials in `wrangler.toml`, JavaScript, Git history or screenshots.

## Beginner deployment

### 1. Install tools

Install Node.js 22 or newer, then from the project folder:

```bash
npm install
npx wrangler login
```

### 2. Configure D1 and R2

The repository is configured for:

- D1: `video-reviews-db`
- R2: `vid-assets`

If you create replacement resources, update their IDs/names in `wrangler.toml`.

Set `PUBLIC_BASE_URL` to the final HTTPS site origin. Until the custom domain is ready, remove or replace the placeholder so generated canonical URLs use the actual request origin.

### 3. Add Worker secrets

```bash
npx wrangler secret put GEMINI_KEY
npx wrangler secret put ADMIN_SECRET_KEY
npx wrangler secret put REACTION_SALT
npx wrangler secret put TEAMWORK_API_KEY
```

Use long, different values for the administrator secret and reaction/rate-limit salt. If `REACTION_SALT` is absent, migration `0009` lets the Worker create a separate random installation salt in private D1 storage so comments, reactions and recommendations still work. A Cloudflare secret remains the preferred production setting.

For YouTube text search and verified YouTube publication metadata:

```bash
npx wrangler secret put YOUTUBE_API_KEY
```

Set `TEAMWORK_API_URL` as a Worker environment variable only after the private service has been deployed behind HTTPS. Use the same random 32-byte-or-longer value for `TEAMWORK_API_KEY` on both systems. The Worker remains usable when the optional service is absent; only **Scan media** is disabled.

### 4. Apply migrations before deployment

```bash
npm run db:migrate:remote
npm run deploy
```

Apply all migrations through `0010_video_analysis.sql` before deploying the updated Worker.

### 5. Custom domain

In Cloudflare, attach the final custom domain to the Worker, then make `PUBLIC_BASE_URL` match that HTTPS origin and redeploy.

## How publishing works

1. Open `/admin.html` and enter `ADMIN_SECRET_KEY`.
2. The secret is exchanged for an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` session cookie and is not kept in browser storage.
3. Search YouTube or paste a supported public URL, or upload a supported asset to R2.
4. Choose category/subcategory.
5. Optionally choose **Scan media**. Owned R2 video can be transcribed and OCR-scanned; external provider pages are crawl-only and are not downloaded.
6. Review the private OCR/transcript evidence, add verified notes, then use **AI Generate**.
7. Check and edit all generated claims, title, description and tags.
8. Supply a genuine thumbnail URL or upload a PNG/JPEG/WebP/AVIF/GIF thumbnail from the admin form.
9. For a non-YouTube provider, enter the verified original publish date and duration in seconds so the page can safely emit `VideoObject` metadata.
10. Enable **Published** only after the record is useful and verified.
11. Save. The Worker serves `/watch/the-generated-slug` immediately from D1 and includes published pages in the sitemap.

After migrations `0007` and `0008`, `/watch/youtube-embed-experience-demo` is a published test page using the sample YouTube video ID from Google's IFrame Player API documentation. It demonstrates verified video metadata, custom editorial SEO, reactions, moderated comments, persistent playback and recommendations.

## Upload types

The Worker currently accepts this explicit allowlist:

- Images: AVIF, GIF, JPEG, PNG, WebP
- Video: MP4, Ogg, QuickTime/MOV, WebM

Objects are stored under the managed `uploads/` prefix and only that prefix is publicly served through `/media/...`.

## GitHub Actions

Two workflows are included:

- `.github/workflows/ci.yml` — tests and validates the Worker on pull requests and `main` pushes.
- `.github/workflows/deploy.yml` — tests, validates, applies D1 migrations, then deploys on `main` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured as GitHub Actions secrets. If those secrets are absent, deployment steps are skipped rather than exposing credentials or failing mysteriously.

Worker runtime secrets such as `GEMINI_KEY`, `ADMIN_SECRET_KEY`, `REACTION_SALT` and `YOUTUBE_API_KEY` remain in Cloudflare.

## API overview

| Route | Access | Purpose |
|---|---|---|
| `GET /api/videos` | Public | Filter published reviews |
| `GET /api/videos/:slug` | Public | Retrieve one published review |
| `POST /api/account/login` | Public | Request a passwordless email sign-in link |
| `POST /api/account/verify` | Public | Consume a one-time sign-in token and create a member session |
| `GET /api/account/me` | Public | Return the current member session |
| `POST /api/account/preferences` | Member | Update email notification preferences |
| `DELETE /api/account/session` | Member | Sign out |
| `GET /api/notifications/latest` | Public | Return the newest published videos for browser alert checks |
| `POST /api/discovery-requests` | Public | Request review of a missing video |
| `POST /api/videos/:id/reactions` | Public | Toggle a privacy-hashed reaction |
| `GET /api/videos/:id/recommendations` | Public | Retrieve ranked related videos |
| `POST /api/videos/:id/interest` | Public | Store a privacy-hashed more/fewer preference |
| `GET/POST /api/videos/:id/comments` | Public | Read approved / submit pending comments |
| `GET /api/admin/discover?q=...` | Admin | Search YouTube or inspect a direct URL |
| `POST /api/ai/generate` | Admin | Generate a structured Gemini draft |
| `POST/GET /api/ai/analyze-media...` | Admin | Start and poll a private Teamwork analysis job |
| `GET/PUT /api/admin/videos/:id/analysis` | Admin | Read or save reviewed transcript/OCR evidence |
| `GET /captions/:slug.vtt` | Public | Serve generated captions for a published matching source |
| `POST/PATCH/DELETE /api/videos...` | Admin | Manage review records |
| `GET/PATCH /api/admin/discovery-requests...` | Admin | Process visitor requests |
| `PUT/GET/DELETE /api/assets...` | Admin | Manage R2 assets |
| `GET /media/:key` | Public | Stream managed R2 media with byte-range support |

## SEO notes

### Search Console indexing checks

- Submit `https://vid.best/sitemap.xml` in the verified Vid.Best property. It links to the public page, video and eligible category sitemaps.
- The homepage includes server-rendered links to the 12 most recently updated published reviews; `/videos` provides the existing larger directory. Drafts remain excluded.
- `/index.html` and trailing-slash variants of public page routes redirect to their preferred paths. Tracking parameters use the existing clean canonical; search/filter and sign-in URLs remain `noindex`.
- The temporary signed `/watch?user=...&id=...` helper is `noindex`; editorial `/watch/:slug` pages remain eligible for indexing.
- For **Duplicate without user-selected canonical**, inspect the affected URL and compare its declared canonical with Google's selected canonical. The report summary alone does not identify the affected URL.
- For **Discovered – currently not indexed**, Google knows the URL but has not crawled it yet. Inspect a representative published URL, run the live test, check its rendered content and request indexing after fixes. Review originality and usefulness of the editorial text; demo pages are not a substitute for substantive reviews.
- These changes support discovery and canonical consistency. They do not guarantee indexing or change Search Console's historical report immediately.

- A sitemap supports discovery but never guarantees indexing.
- Do not publish scraped/search-result pages merely to create more URLs.
- AI output is a draft; factual accuracy, originality, rights and editorial usefulness still require review.
- Embedding a public video does not transfer copyright. Only embed or host material you are permitted to use.
- A fast response is useful for users, but there is no guaranteed universal "under 30 ms" Worker response time or special Google ranking threshold at that number.

## Project structure

```text
Vid.Best/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_discovery_requests.sql
│   ├── 0003_security_rate_limits.sql
│   ├── 0004_maintenance_indexes.sql
│   ├── 0005_source_video_metadata.sql
│   ├── 0006_test_player_and_comment_images.sql
│   ├── 0007_universal_video_experience.sql
│   ├── 0008_verified_demo_metadata.sql
│   ├── 0009_app_settings.sql
│   └── 0010_video_analysis.sql
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── admin-safety.js
│   ├── styles.css
│   ├── app.js
│   ├── admin.js
│   ├── watch.js
│   └── favicon.svg
├── src/
│   ├── index.js
│   └── edge.js
├── services/teamwork/       # Optional private Oracle media-analysis API
├── test/
│   ├── worker.test.js
│   └── edge.test.js
├── package.json
└── wrangler.toml
```

## License

MIT. See `LICENSE`.

### Instagram card sizing

Homepage Instagram cards mount Meta's official `instagram.com/embed.js` SDK
with a normalized post permalink. Like Facebook cards, the embed occupies the
interactive preview surface, but it scales the full Instagram post to fit the shared tile height (230px,
220px at the existing mobile breakpoint).
The generic forced iframe height excludes this surface. ResizeObserver tracks
SDK height changes and centers the scaled post with letterboxing; it does not
grow the grid row, crop, or hide Instagram controls. The card title opens the Vid.Best review.
Facebook's `/plugins/video.php` is not an Instagram player, and its autoplay or
`show_text` options are not applied to Instagram. A loaded embed is not proof of
playback: Meta can still offer “Watch on Instagram” for a particular post.
Reference: https://github.com/facebook/meta-embeds-for-wordpress

### Screen-fit swipe viewer

**Fullscreen / Swipe** opens the viewer element itself in browser fullscreen (or a screen-fit overlay if unavailable). It does not fullscreen the document underneath a modal. The feed uses native vertical scrolling and CSS scroll snapping: swipe anywhere over the video, scroll the wheel, or use next/previous and arrow keys. A transparent gesture surface enables swiping over cross-origin embeds. **Player controls** opens a compact panel in the details area, separate from the provider frame: seek bar, elapsed/duration, and 10-second jumps for native/YouTube/Vimeo players. **Original controls** enables the provider’s captions/settings; swipe on the details area in that mode. Closing the compact panel restores swiping over the video. Controls and text retain mobile sizing.

Reactions and **More/Fewer like this** use the existing site APIs. Preference changes refresh upcoming recommendations. Reviews expand into a scrollable sheet and collapse back to the video. Completed videos advance automatically when the native/YouTube/Vimeo player exposes an ended event. Android Back exits browser fullscreen without exposing an empty original player; a subsequent Back closes the viewer.

The active and next supported players are mounted in their own scroll cards, so the next card is activated without rebuilding its iframe. Native/R2 media use `preload=auto` (metadata only on a declared 2G/data-saver connection); YouTube/Vimeo use their official APIs and remain cued/paused until active. HLS prepares a short low-quality buffer for the next card, then stops segment loading until activation. At most three player documents (previous/current/next) stay mounted. Providers without a reliable pause API only have markup prepared offscreen, and are destroyed on departure. Preparation never auto-plays hidden videos. Only the active player can play; leaving the tab pauses it. Provider buffering and autoplay restrictions still apply, so instant third-party media playback cannot be guaranteed.

`/watch/:slug?viewer=1` never increments views and is private/no-store/noindex. After the active ready card remains visible for 1.5 seconds, `/api/videos/:id/view` records a Vid.Best visit, deduplicated per fingerprint/video in 30-minute windows. Initial watch-page and revisited-card counts are not added again by the viewer. The displayed counts come from Vid.Best D1, not provider metrics. These are site visits, not completed-playback measurements.

Sound is requested automatically on the active card; offscreen cards always stay muted and paused. If audible autoplay is blocked, playback retries muted and the Sound button offers a real user-gesture retry. Sound labels reflect the actual media state. The swipe viewer uses native audio for TikTok/R2; Audio Lab remains available on the normal watch page without a hidden AudioContext intercepting swipe audio.

For multi-rendition HLS in the swipe viewer, hls.js starts at level 0 with a small buffer. After two seconds of playback and four seconds buffered, its bandwidth-based automatic selection can increase quality. Declared data-saver/2G stays capped at the lowest rendition. Safari native HLS and YouTube/Vimeo embeds use provider/browser adaptation; YouTube has no supported quality-selection API. A single MP4/R2 source has only its existing quality—this frontend does not transcode it or invent alternate renditions.
