# Vid.Best

Vid.Best is a full-stack video review and discovery site designed for Cloudflare Workers. It uses:

- Cloudflare Static Assets for the public and admin interfaces
- Cloudflare D1 (`video-reviews-db`) for reviews, reactions, comments and discovery requests
- Cloudflare R2 (`vid-assets`) for uploaded video files
- Gemini, through the secret `GEMINI_KEY`, for structured editorial drafts
- Dynamic `/watch/:slug` pages with unique metadata, canonical URLs and `VideoObject` JSON-LD
- A published-only XML sitemap at `/sitemap.xml`

No credentials are included in this repository.

## Important security step

If any GitHub, R2, Cloudflare or admin credential was ever pasted into a message or committed to a file, revoke it and create a new one before deployment. Never place credentials in `wrangler.toml`, JavaScript, Git history or screenshots.

## Beginner deployment

### 1. Install the tools

Install [Node.js 22 or newer](https://nodejs.org/), unzip this project, then open a terminal inside the `Vid.Best` folder:

```bash
npm install
npx wrangler login
```

### 2. Create D1 and R2

```bash
npx wrangler d1 create video-reviews-db
npx wrangler r2 bucket create vid-assets
```

The first command prints a D1 `database_id`. Open `wrangler.toml` and replace:

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

Also replace `PUBLIC_BASE_URL` with the final HTTPS domain. Until the custom domain is ready, you may remove that line so the Worker uses its current request URL.

### 3. Add secrets safely

Run these commands one at a time. Wrangler asks you to paste each value without saving it in the repository.

```bash
npx wrangler secret put GEMINI_KEY
npx wrangler secret put ADMIN_SECRET_KEY
npx wrangler secret put REACTION_SALT
```

Use long, different random values for the two local secrets. For example, generate one with:

```bash
openssl rand -hex 32
```

Optional: enable text search in the admin panel with a YouTube Data API key. Direct YouTube, TikTok and Facebook URLs work without it.

```bash
npx wrangler secret put YOUTUBE_API_KEY
```

### 4. Create the tables and deploy

```bash
npm run db:migrate:remote
npm run deploy
```

Open the URL printed by Wrangler. The public site is `/` and the protected publisher console is `/admin.html`.

### 5. Connect a custom domain

In Cloudflare Dashboard, open **Workers & Pages → vid-best → Settings → Domains & Routes**, add your domain, and then set the same origin in `PUBLIC_BASE_URL`. Deploy once more after changing it.

## How publishing works

1. Open `/admin.html` and enter `ADMIN_SECRET_KEY`.
2. Search YouTube or paste a full public video URL.
3. Select the video and choose its category and subcategory.
4. Add factual notes, then press **AI Generate**.
5. Verify and edit every generated claim.
6. Keep **Published** enabled and save.
7. The Worker creates `/watch/the-generated-slug` and includes it in `/sitemap.xml`.

If a visitor searches for a video that is not in D1, they can submit a discovery request. It appears in the admin queue. This deliberately does not auto-publish an unverified page: only completed, useful reviews enter the sitemap.

## Local development

Copy the example environment file and insert development-only values:

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Do not commit `.dev.vars`; it is already ignored.

## GitHub deployment

The included workflow deploys pushes to `main`. In the GitHub repository settings, add these Actions secrets:

- `CLOUDFLARE_API_TOKEN` — a newly created, least-privilege Workers deployment token
- `CLOUDFLARE_ACCOUNT_ID`

Worker runtime secrets such as `GEMINI_KEY` stay in Cloudflare and are not copied into GitHub Actions.

## API overview

| Route | Access | Purpose |
|---|---|---|
| `GET /api/videos` | Public | Filter and retrieve published reviews |
| `GET /api/videos/:slug` | Public | Retrieve one published review |
| `POST /api/discovery-requests` | Public | Request review of a missing video |
| `POST /api/videos/:id/reactions` | Public | Toggle a privacy-hashed reaction |
| `GET/POST /api/videos/:id/comments` | Public | Read approved or submit moderated comments |
| `GET /api/admin/discover?q=...` | Admin | Search YouTube or inspect a direct URL |
| `POST /api/ai/generate` | Admin | Generate structured Gemini copy |
| `POST/PATCH/DELETE /api/videos...` | Admin | Manage review records |
| `GET/PATCH /api/admin/discovery-requests...` | Admin | Process visitor requests |
| `PUT/GET/DELETE /api/assets...` | Admin | Manage R2 assets |
| `GET /media/:key` | Public | Stream R2 media with byte-range support |

## SEO notes

- A sitemap helps discovery but cannot guarantee indexing.
- Only published D1 records appear in the sitemap or public API.
- Every review page has a canonical URL, Open Graph tags, X/Twitter cards and `VideoObject` JSON-LD.
- AI output is a draft. Accuracy, originality, source rights and editorial usefulness remain the publisher's responsibility.
- Embedding a public video does not transfer copyright. Only publish material you are permitted to embed or host.

## Project structure

```text
Vid.Best/
├── .github/workflows/deploy.yml
├── migrations/
│   ├── 0001_initial.sql
│   └── 0002_discovery_requests.sql
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── styles.css
│   ├── app.js
│   ├── admin.js
│   ├── watch.js
│   └── favicon.svg
├── src/index.js
├── .dev.vars.example
├── package.json
└── wrangler.toml
```

## License

MIT. See `LICENSE`.
