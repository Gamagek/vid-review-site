# Audiovisual editorial packages

This extends `gemini-editorial-evidence.yml` for existing Vid.Best YouTube and TikTok reviews. It is a manual, draft-only workflow: no schedule, publishing, recovery change, D1 write, R2 upload, cache job or deployment. The previously paused automations remain paused.

## What a run does

1. Reuse a supplied JSON catalog or make **one** bounded, read-only published catalog export (maximum 1,000 rows). Sort eligible pages by review word count, character count and ID. IDs 1–10, drafts, raw/test fixtures, unsupported source pages and completed matching local packages are excluded. Preserve the exact source URL, title, slug and stored dates as preconditions. The one export may read the published inventory once; its reported D1 `rows_read` is included in the summary. It is not a claim of zero database cost.
2. Use the existing rights-certified R2 copy when present; otherwise obtain an authorized public analysis copy with yt-dlp. A record must have `redistribution_certified=1` or an explicitly supplied `analysis_download_authorized=true`. Deleting a temporary copy does not itself establish permission. No login cookies, paywall/DRM bypass, proxy rotation or cache-trigger mutation is implemented. The original embedded player remains unchanged.
3. Limit sources to 512 MiB and three hours. Encode the entire timeline into ten-minute MP4 segments at up to 854×480, 12 fps, H.264 video and 64 kbps mono AAC, below 50 MB per segment. Gemini examines each segment with 2 fps sampling plus audio. This covers the timeline, not every original frame; fast motion and subtle sound may still need editorial checking. Silent inputs cannot acquire fabricated audio evidence.
4. Discover available Gemini models; use only the requested model and configured fallbacks. Upload each segment, wait for processing, record timestamped observations, audio, strengths, limitations and uncertainties, then delete that provider file. A separate Google Search grounding request supplies background facts and actual citation supports. Uncited search prose cannot become background evidence.
5. Compose a distinctive review using evidence references, relevant interpretive lenses, best moments and honest tradeoffs. Related recommendations use actual published catalog IDs from the same category. Reject nonexistent scene/source references, unsupported popularity claims and fabricated personal viewing. Natural editorial prose does not establish human authorship; there is no fake human byline or AI-detector evasion.
6. Capture the strongest observed moment, verify that the still is clear and matches the observation, and use it as the reference for a separate conceptual anime illustration. Keep the JPEG below 150 KB and WebP below 350 KB. Both files retain checksums and attribution. Artwork is identified as conceptual and cannot replace the VideoObject's real video thumbnail or become a purported screenshot.
7. Delete local videos and provider uploads before making the package available. A run-local provider-file journal and `always()` cleanup step also handle interruption where the runner remains available. If the runner is lost or the provider rejects deletion, immediate provider cleanup cannot be guaranteed; a successful package is never reported in that state. Raw videos, credentials, downloader diagnostics and upload/session URLs are excluded from artifacts.

## GitHub Actions inputs

Open **Gemini Video Editorial Evidence → Run workflow** on the implementation branch after review:

- Leave URL and ID blank to select the shortest eligible reviews. An explicit URL/ID must match one exact catalog record.
- `limit`: 1–5 records, default 1. This is a bounded batch, not a guarantee that blocked sources will produce a review.
- `plan_only`: defaults to true; inspects the queue without media downloads or Gemini usage.
- `catalog_path`: optional repository JSON array. With a supplied snapshot, no Cloudflare credentials are needed. Without it, use existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets for one read-only export. D1 quota errors are not retried.
- Existing `GEMINI_API_KEY` secret is required for generation. `model` defaults to `gemini-3.8-flash`; `GEMINI_FALLBACK_MODELS` is a comma-separated repository variable. Availability is checked, not assumed.
- Records with signed/private source or thumbnail URLs are held out of the public artifact export and reported by ID; their preimages are not silently rewritten. Handle those records through a separate authorized local snapshot.
- `GEMINI_IMAGE_MODEL` optionally specifies available Gemini image generation models, comma-separated. If absent, the workflow discovers up to two image models from the account's model list, preferring Flash. A model/tool/credit/access failure blocks the package; no unrelated image is substituted. Gemini API and grounded search usage can incur provider charges.

No new secrets, Workers, tunnels, containers or services are created. A supplied local file can be used from the CLI with an exact catalog-matched video ID. The catalog's permission requirement still applies.

```sh
node scripts/gemini-video-evidence.mjs --catalog catalog.json --plan-only --limit 5
node scripts/gemini-video-evidence.mjs --catalog catalog.json --video-id 373 --limit 1 --output-dir editorial-output
node scripts/prepare-editorial-package.mjs --package editorial-output/373/package.json --catalog fresh-catalog.json --out prepared-editorial
```

Unzip an earlier artifact into the same output directory to resume locally. Only completed packages matching the exact current baseline are skipped. GitHub-hosted runners start fresh; draft artifacts are not a persistent global completion queue. Once a reviewed package is published, the longer review naturally moves down the queue.

## Review and publication handoff

Each ready artifact contains timestamped evidence, retained uncertainties, the drafted review, source citations, a best-scene JPEG, a conceptual anime WebP and original publication baseline. `verified=false` and `requires_editorial_review=true` remain explicit. A mock-provider test is not live Gemini evidence.

`prepare-editorial-package.mjs` is offline. It checks a fresh catalog against the original review and metadata, checks image bytes/hashes, and prepares source manifests, static assets, an editorial content record, a guarded single-row update and matching rollback SQL. The `SET` clause changes only description, review text and SEO metadata. It cannot change dates, source identity, slug, title, publication state or counters. The SQL is a reviewable handoff; this tool does not execute it. Release checks must require exactly one changed row, exact readback and a durable backup before any authorized production write.

The existing watch-page renderer then displays the two small sidebar images, appropriate source-frame caption, an Article image pair, real internal recommendation links, and cited background sources. Google Search suggestions are retained in a sandboxed iframe for the exact paired review. Existing source/editorial image sitemaps and video sitemap image entries resolve the frame and artwork through the same guarded manifest, without extra D1 queries. Video player URLs, video thumbnail, source publication metadata and original Vid.Best `created_at` remain unchanged. Any new owner title, source, slug or poster edit disables the old capture association. No indexing guarantee, fabricated rating, release date or AdSense approval claim is made.

Monthly/yearly category collections are **shortlist proposals** only after three distinct evidence-qualified reviews are supplied. Their period is the original Vid.Best publication date in Asia/Colombo, never an invented video release date. They are explicitly limited to the reviewed collection; this does not create an unsupported worldwide/yearwide “best video” ranking or new public landing page.

The Vid.Best recovery freeze still applies to the recovery PRs, infrastructure and production. This implementation is prepared separately for editorial review; it does not resume recovery work or enable scheduled publishing.

## Verification and official API references

The regression suite covers exact source identities, queue ordering/protected rows, audio/silence, evidence references, fallback models, a single read-only catalog request, stale-write detection, rollback/date/counter preservation, actual FFmpeg compression/capture, package cleanup, source preparation and safe source widgets. External providers are mocked in the pipeline tests; the FFmpeg test uses generated synthetic media. Check current-HEAD CI and the Worker dry build before release.

Local validation on 26 October 2026, against main `f77ee7f471444180d1c59d1d29558c78c5cd81c6`: **496/496 Node tests passed** with external network requests blocked and only local test servers allowed. All 15 new pipeline tests passed, including prepared-manifest rendering through the actual Worker, Article image pair, original video thumbnail, both image sitemap families, video sitemap image associations, original publication date and stale-baseline rejection. Worker dry build and workflow YAML parsing passed. The first full run lacked local dependencies; dependencies were then reused from the existing workspace for the passing offline run. An approval review initially blocked retrieving the unrestricted run's results because of a potential Facebook/Microlink disclosure; source inspection confirmed the named test uses mocks, and the passing replacement run additionally blocked all external fetches. No live Gemini analysis, live media download, generated production artwork, D1 write, R2 write, merge, deployment or Google indexing change is claimed by these local checks.

- [Gemini video understanding, generateContent](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding)
- [Gemini Files API](https://ai.google.dev/api/files)
- [Google Search grounding, generateContent](https://ai.google.dev/gemini-api/docs/generate-content/google-search)
- [Pinned yt-dlp release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21)
