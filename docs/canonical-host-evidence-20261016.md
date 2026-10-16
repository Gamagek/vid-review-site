# www routing and Siteliner title evidence, 16 October 2026

## Confirmed host configuration gap and bounded repair

The user's Siteliner report was completed at **08:09:16 GMT on 16 October 2026** and flags an error accessing `https://www.vid.best`. The current Worker already includes `www.vid.best` in its canonical-host redirect handler. Existing focused SEO tests pass26/26, including canonical-origin enforcement and protection against a double-slash path becoming another hostname. Rewriting that handler was not supported by the evidence.

Fresh connected Cloudflare reads instead found **no exact www DNS record, no wildcard DNS record, no zone Worker routes and no www Custom Domain**. Only `vid.best` and `home.vid.best` were attached to `vid-review-site`. A Custom Domain matches an exact hostname, so the existing apex binding does not make the Worker receive www requests. This configuration gap is confirmed; the local client's 502 alone was not used to diagnose the production origin.

After rechecking the absence of conflicting DNS/domain entries, the connected Cloudflare **Attach Worker Domain** API added only:

- Hostname: `www.vid.best`; existing service: `vid-review-site`; zone `e93a339b0f6523024dd74886bf232292`.
- Enabled, previews disabled; readback confirms production environment.
- Domain ID: `1f57d98a79734b4b70c6f4768415c604e4147a23`; created16October08:48UTC.
- Automatically managed DNS readback: proxied **AAAA `100::`**, record `d9a25549771e71f9300f1ec70640bc27`.
- Certificate `0fbd6dc8-277a-401b-8f16-751147b54e47` is **active**, explicitly covering `www.vid.best`, verified08:56:51UTC.

Existing apex/home domain IDs and service bindings remain unchanged. No origin address, Worker code/version, WAF, TLS mode, Access/email policy, gateway route, container, volume, R2 object or D1 record was changed. The existing Worker is responsible for the permanent redirect; no second HTML site was published at www. This follows the established dashboard/API management of the apex and home domains without replacing their configuration in Wrangler.

**Public redirect verification remains pending.** Local GET/HEAD attempts for HTTPS www root, a nested editorial URL with encoded query, robots and HTTP www returned502/noLocation. The diagnostic response identifies `server: mitmproxy 12.2.3`, with no Cloudflare ray header; direct name resolution for both apex and www fails temporarily in this execution environment, even while ordinary proxied apex reads succeed. That is insufficient evidence of a continuing Cloudflare-origin502 or a globally successful redirect. Do not label this a verified end-to-end301, invent a DNS-propagation or certificate failure, disable protection, use insecure TLS, or overwrite the working apex. Cloudflare binding/DNS/active certificate are verified; a clean external HTTP result is still required. Treat this as a transient verification limitation, not a reason to disable the existing task or repeatedly probe it from alternate networks.

## Siteliner missing-title warning is not reproduced in current HTML

Read the actual25-page,398037-byte PDF attachment with text/table extraction and a visual render of its first table page. The export visibly contains empty title cells; these are not proof that the corresponding served HTML lacks a title. A parsed subset of76 current canonical pages corresponding to empty export cells all have nonempty titles in the completed production audit. Export-cell counts are not substituted for the UI's48missing-title warning.

Opened actual completed post-release audit **38875505796 /job116889476066 /artifact12034679403**, archive SHA-256 **`99ddbfc81cbc3f38563d3fe0433e65249e2293aab5c717fb327308b2a0227e5b`**. Report generated **08:42:57.609UTC16October**: **211publicpages, zero failed pages, zero unlinked reviews, nonempty titles on all211**. Exact examples with GET/HEAD200 and real titles include:

- `/watch/sia-never-give-up-from-the-lion-soundtrack-lyric-video`
- `/watch/harry-potter-fun-on-the-set-from-the-collectors-edition-of-lego-hp`
- `/watch/khaby-lame-mr-bean-at-airport-security-ultimate-viral-comedy-mashup`
- Homepage, policy pages and editorial reviews.

No title metadata was bulk rewritten, no owner text/emoji removed and no technical repair falsely attributed to the content PR. Whether Siteliner's earlier result reflects its parser/export or a transient earlier response is **unverified**. The new regression specifically proves that a Unicode title with ampersand/angle brackets remains one escaped server-delivered title with the canonical intact and no audit-induced view increment.

## Tests and public navigation

`test/seo.test.js` extends the www test across GET/HEAD and seven public path/query cases with database/assets bindings that throw if called. It adds the Unicode title regression. **27focused/346full Node tests pass**. Deterministic14-page editorial validation and Wrangler4.124.0 dry-run pass. These are code-level tests of the unchanged handler/renderer, not public DNS/TLS or physical-device tests. Publish the tests/evidence through PR/CI with **[read-only-preflight] [seo-only]**, keeping Worker/migrations and privileged Portainer deployment skipped.

Public checks also confirm all14category endpoints HTTP200 with self-canonicals and titles, plus five trust/policy pages and homepage footer links. Existing low-inventory Business, Education, Food, Lifestyle and Other hubs already use `noindex,follow`; their items remain published. No categories were deleted or filled with manufactured reviews. Two actual public player-test/demo records remain an intentional discovery/indexability decision requiring dependency checks; they were not deleted, unpublished or padded.

## Editorial release and Google evidence remain separate

PR [182](https://github.com/Gamagek/vid-review-site/pull/182) merged **`6593c7ac650c1ba24f31761d1d848e030a0fec8b`**, reviewed head `785e851e1e92dcbae30df66cb4f67d5e82255f28`. Exact-head CI38875235351/job116888571374 passes345Node/fourPython tests and Worker dry-run. Main CI38875435905 and Deploy38875436830/job116889244559 succeed. Deploy explicitly reports **No migrations to apply**, active Worker **`06d1f5bb-f9e6-4dc4-aee1-a59c296826b3`**, deployment **`767637ae-5c5b-4ef9-b620-8772676b2b7b`** at08:42:36UTC,100% traffic. Portainer38875435920 validation succeeds; optional/preflight/deploy/incident jobs all skip.

All ten live articles return200 and match the reviewed prose **exactly**, with matching complete JSON-LD, ordered headings and canonical links. Whole-response byte hashes differ because Cloudflare inserts its existing Insights beacon after the content; that difference is not a failed prose deployment. The cover/CSS asset verification succeeds. Fresh read-only D1 at08:52:46UTC remains **184saved/180published**, non-counter hash **`551fd88e1dd6f9669287d134d44b873e3b223155d47af0ade676ee897da85284`**, zero rows written.

The same completed audit makes **zero Inspections and zero sitemap submissions**; indexed status is not rechecked. Root/editorial maps remain processed, zero errors, last downloaded15October09:30UTC; the library map retains20aggregate warnings whose exact types/URLs are unknown. Thumbnail inventory varies externally to **161HTTPavailable/11HTTPfailures/eight protected placeholders**, not a content or cover repair claim. Reuse ordinary completed full Inspection reports; never turn a zero-budget run into a zero-indexed finding or submit ordinary reviews to the restricted Indexing API. The user's Page Indexing screenshot has an older12October report date and a different scope.

## References and next task

The supplied Matt Cutts article is dated4January2006. Its general canonical-host point is relevant, but current Google documentation guides implementation:

- https://www.mattcutts.com/blog/seo-advice-url-canonicalization/
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site

Siteliner's17% internal overlap is not a copied-content or AdSense-penalty verdict. Directory/category cards can legitimately overlap their linked reviews; keep meaningful navigation. Its average1233words and748msfetch/19KBHTML measurements do not certify depth, originality, mobile Core Web Vitals, media load performance or AdSense approval. The ten essays now contain more specific analysis, but unviewed films/unplayed games remain clearly labelled previews/guides.

**Next:** verify real external www GET/HEAD301 with path/query preservation and final apex200 once the normal verification connection works. Then use the next completed ordinary full Inspection and exact20warning evidence, and review actual demo dependencies. The bounded thumbnail-body signature/hash diagnostic remains an independent safe task. No new automation, AdSense account/review action, notification message, security bypass, private URL or secret exposure is authorized by this checkpoint.
