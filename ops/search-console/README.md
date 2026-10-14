# Vid.Best review indexing automation

The **Review indexing audit** GitHub workflow runs every day at 04:47 UTC
(10:17 Sri Lanka time), after a successful Cloudflare **Deploy** workflow, and
on manual dispatch. GitHub schedules can be delayed. Each run retains JSON and
text reports for 14 days in its Actions artifacts.
Reports include the workflow attempt number, so a retry retains its own report.
Safe progress messages show public crawl counts, successful Google authentication,
verified property access, sitemap acceptance and completed inspection counts.
The summary counts discovered/not indexed, unknown and crawled/not indexed review URLs.
No credential values, service account identities or Google response bodies are logged.

Without Google credentials it already audits the live published sitemap,
robots.txt, GET/HEAD responses, canonical URLs, noindex directives, review text
in server-rendered HTML, directory pagination and internal links. Missing
Google credentials are explicitly reported as **not_configured**, never as
successful Google submission or indexing.

## One-time Google connection

1. Enable **Google Search Console API** in the Google Cloud project used for
   this automation. The endpoint service is **searchconsole.googleapis.com**.
   The general Google Indexing API and Custom Search API are unnecessary for
   these ordinary video review pages.
2. Create a dedicated service account, for example **vidbest-search-console**.
   It needs no Google Cloud project Editor/Owner role and no Workspace
   domain-wide delegation. Generate a JSON key for that service account.
3. In the verified Search Console property **sc-domain:vid.best**, add the
   service account's **client_email** as a **Full user**. If using a URL-prefix
   property instead, use exactly **https://vid.best/** and give the same access.
4. Add the entire downloaded JSON key as this repository's GitHub Actions
   secret **GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON**:
   <https://github.com/Gamagek/vid-review-site/settings/secrets/actions>.
   Do not put the key in chat, Git, Worker public variables, browser code or
   artifacts. An API key string alone cannot authorize private Search Console
   property access.
5. Only for a URL-prefix property, set the repository Actions variable
   **GOOGLE_SEARCH_CONSOLE_PROPERTY=https://vid.best/**. Otherwise the workflow
   defaults to **sc-domain:vid.best**.
6. Run **Review indexing audit** at
   <https://github.com/Gamagek/vid-review-site/actions/workflows/seo-audit.yml>.
   For this first connection or an intentional resubmission, select
   **submit_sitemaps**. Verify **Search Console: success**, the sitemap
   processing diagnostics, and the stored inspection results in the artifact.
   **Sitemap submitted to Google: true** appears only when submission was requested.

The script requests only the Search Console OAuth scope and verifies Full/Owner
property access. The daily audit submits **https://vid.best/sitemap.xml** and its
discovered review sitemaps, then reads stored Google index information for up to
200 published review URLs. Manual audits read the same stored information and
resubmit sitemaps only when **submit_sitemaps** is selected. Larger libraries
rotate deterministically across days. Calls are paced, bounded and stop on
quota/authentication failures. No quota circumvention or account rotation is used.
Technical audit failures prevent sitemap submission until the public pages pass.
The script never logs credentials, Google error bodies or authenticated URLs.

Deployment and audit-script push diagnostics read the existing Google sitemap
status with GET requests. They use zero URL Inspections and do not submit the
sitemaps again before observing their processing state. Reports distinguish
**Google sitemap mode: read_only**, the actual number of submissions, and
Google's unchanged submission/download timestamps. A missing status stays
**not_verified**; diagnostic mode never submits a missing sitemap as a fallback.
For a local status-only audit, set **GOOGLE_SEARCH_CONSOLE_SUBMIT_SITEMAPS=false**
and **GOOGLE_SEARCH_CONSOLE_INSPECTIONS=0**. CLI submission remains enabled by
default for compatibility; the workflow selects its mode explicitly.

## What the automation can and cannot establish

Sitemap submission helps discovery; it does not force crawl or indexing.
URL Inspection API reports Google's stored index status. It cannot perform
the Search Console live test or send a Request Indexing action.

Google Indexing API is limited to JobPosting and BroadcastEvent within
VideoObject pages (live broadcasts); recorded-video reviews are not eligible.
Automatic Google crawling through ordinary public links and sitemaps has no
site-owner submission counter, but Google chooses which URLs to crawl/index.
API quotas still apply to status inspection. There is no unlimited indexing
API or guarantee that all pages will be indexed.

## Audit evidence from 2026-10-11

- Search Console screenshots last updated 2026-10-04: 81 discovered/not crawled,
  one duplicate without a selected canonical, one indexed page. These are
  historical data; current private URL Inspection data need the Google connection.
- Live D1 contained 127 published reviews, all with distinct nonempty review
  text (average 2,086 characters). Only two had fewer than 600 characters;
  those two are player/demo pages. Length and uniqueness alone do not prove
  editorial quality.
- All 127 review URLs appeared in the live video sitemap and **/videos** HTML.
  Three screenshot examples returned HTTP 200, their own canonical and visible
  server-rendered review text. robots.txt allowed public reviews.
- Cloudflare Bot Fight Mode and crawler protection were disabled already.
  In the available sampled 23-hour analytics window, verified Googlebot made
  two successful robots.txt requests. No verified Googlebot review requests
  appeared in that query. Spoofed Googlebot user agents were excluded.
- Actual defect reproduced: HEAD requests to robots.txt, a review and the
  video sitemap returned 404 while GET returned 200. Fixed HEAD routing and
  empty responses; HEAD and crawler requests no longer increment review views.
- Most external videos had no verified original publication date. The fix
  omits unverified video publication dates, uses player locations for TikTok
  rather than calling a share HTML page a media file, and keeps text reviews
  eligible independently of video rich-result markup.

This does not establish that the HEAD defect caused Google's scheduling
decision. Google normally crawls using GET. Do not label discovered/not crawled
pages as rejected for content quality without URL Inspection evidence.

## Editorial work

The public audit flags short reviews, demo pages and exact duplicate text for
owner review. It does not rewrite, delete or unpublish any existing review.
Existing reviews contain repeated promotional phrasing; improve them with
specific observations, useful limitations/comparisons, factual source checks
and clear provenance. Do not invent first-hand experience, ratings, authors,
upload dates, schema or filler merely to increase indexed counts.

## Release safety

Use the **[seo-only]** marker in the SEO release's merge title. It allows the
normal tested Cloudflare Worker release while skipping Portainer preflight and
stack write jobs. It does not change the Portainer production deployment flag,
Cloudflare Access policies, gateway routing, containers or persistent volumes.
Audit-script/workflow changes that need no Worker release can instead use
**[read-only-preflight]**. Their direct push audit still verifies the new diagnostic
code, while Worker deployment and Portainer production writes remain skipped.

## Primary references

- <https://developers.google.com/search/apis/indexing-api/v3/using-api>
- <https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect>
- <https://developers.google.com/webmaster-tools/v1/sitemaps/submit>
- <https://developers.google.com/webmaster-tools/limits>
- <https://developers.google.com/identity/protocols/oauth2/service-account>
- <https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps>
- <https://support.google.com/webmasters/answer/7440203>
