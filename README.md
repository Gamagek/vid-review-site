# Vid.Best

Vid.Best is a Cloudflare-native video review and discovery platform built with:

- Cloudflare Workers for routing and edge server-side rendering (SSR)
- Cloudflare Static Assets for the public and admin interfaces
- Cloudflare D1 (`video-reviews-db`) for reviews, reactions, comments, discovery requests and verified source metadata
- Cloudflare R2 (`vid-assets`) for uploaded video/image assets
- Gemini, through the Worker secret `GEMINI_KEY`, for structured editorial drafts
- Dynamic `/watch/:slug` pages with unique metadata and canonical URLs
- Published-only XML/video sitemaps

There is **no need to create or commit one physical HTML file per video**. A request such as `/watch/example-video` is rendered by the Worker from its D1 record and returned as normal HTML to browsers and search crawlers.

## Architecture decisions

### Deliberate publishing instead of search-page generation

A public search that finds nothing does not create an indexable page. Visitors can submit a discovery request, which enters the administrator queue. A useful review is created only after an administrator selects a source, generates/edits the draft and deliberately enables **Published**.

New records are draft-first. This avoids turning arbitrary visitor searches into thousands of thin public pages.

### AI stays serverless

Gemini runs through the Worker; this repository does not run Ollama or another local LLM. If a small Oracle/VPS service is added later, keep it focused on lightweight fetching/extraction and return raw captions/transcript/OCR metadata to the Worker. Do not make that VPS responsible for page publishing or local LLM generation on a low-memory machine.

### 4get / external crawler integration

No 4get or Oracle scraper endpoint is currently wired into this repository. The safe integration point is the administrator discovery/ingestion workflow, not the public search route. An external search result should remain temporary until an administrator chooses **Analyze & Save** (or an equivalent moderated action).

### Edge SSR and caching

Published watch pages are rendered from D1 by the Worker. Workers caching is enabled for responses that are explicitly cacheable; administrator and sensitive API responses already use `no-store`. Watch pages use a short freshness period plus `stale-while-revalidate` for resilience.

### Video SEO correctness

The watch page includes canonical, Open Graph and X/Twitter metadata. `VideoObject` JSON-LD is emitted conservatively:

- a real video thumbnail is required; the site favicon is never used as a fake video thumbnail in structured data;
- for YouTube sources, the Worker can verify the original publication date and duration through the YouTube Data API and store them in D1;
- external embeds without a verified original publication date remain normal indexable pages, but their potentially inaccurate `VideoObject` block is omitted;
- only published D1 records appear in the sitemap.

### Player

Self-hosted/raw video uses the browser's native player plus Vid.Best controls for play/pause, 10-second rewind/forward, playback speed and picture-in-picture when the browser supports it. YouTube/TikTok/Facebook use their embed players.

Automatic captions/transcription and adaptive low-bandwidth quality switching are **not yet implemented**. Those require caption files such as WebVTT and, for adaptive playback, multiple encoded renditions/HLS or DASH rather than a single MP4 object.

### Comments

Public comments are never shown immediately. They are stored as `pending`, rate-limited, and only `approved` comments are returned publicly. Image comments are not currently supported. This is intentionally safer than auto-publishing and hiding content later.

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
```

Use long, different values for the administrator secret and reaction/rate-limit salt.

For YouTube text search and verified YouTube publication metadata:

```bash
npx wrangler secret put YOUTUBE_API_KEY
```

### 4. Apply migrations before deployment

```bash
npm run db:migrate:remote
npm run deploy
```

PR #1 adds migrations for security rate limits, maintenance indexing, and verified external-video metadata. Do not deploy the updated Worker before applying all pending migrations.

### 5. Custom domain

In Cloudflare, attach the final custom domain to the Worker, then make `PUBLIC_BASE_URL` match that HTTPS origin and redeploy.

## How publishing works

1. Open `/admin.html` and enter `ADMIN_SECRET_KEY`.
2. The secret is exchanged for an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` session cookie and is not kept in browser storage.
3. Search YouTube or paste a supported public URL, or upload a supported asset to R2.
4. Choose category/subcategory.
5. Add verified notes, transcript/OCR text if available, then use **AI Generate**.
6. Check and edit all generated claims, title, description and tags.
7. Supply a genuine thumbnail when possible.
8. Enable **Published** only after the record is useful and verified.
9. Save. The Worker serves `/watch/the-generated-slug` immediately from D1 and includes published pages in the sitemap.

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
| `POST /api/discovery-requests` | Public | Request review of a missing video |
| `POST /api/videos/:id/reactions` | Public | Toggle a privacy-hashed reaction |
| `GET/POST /api/videos/:id/comments` | Public | Read approved / submit pending comments |
| `GET /api/admin/discover?q=...` | Admin | Search YouTube or inspect a direct URL |
| `POST /api/ai/generate` | Admin | Generate a structured Gemini draft |
| `POST/PATCH/DELETE /api/videos...` | Admin | Manage review records |
| `GET/PATCH /api/admin/discovery-requests...` | Admin | Process visitor requests |
| `PUT/GET/DELETE /api/assets...` | Admin | Manage R2 assets |
| `GET /media/:key` | Public | Stream managed R2 media with byte-range support |

## SEO notes

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
│   └── 0005_source_video_metadata.sql
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
├── test/
│   ├── worker.test.js
│   └── edge.test.js
├── package.json
└── wrangler.toml
```

## License

MIT. See `LICENSE`.
