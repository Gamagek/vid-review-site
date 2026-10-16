# Bounded thumbnail-byte evidence — 16 October 2026

## Confirmed diagnostic gap and correction

The existing public thumbnail audit accepted a non-empty response labelled with an allowed image MIME type. It did not fingerprint the body or verify its header, so a server returning HTML with an image Content-Type could be counted as available. This is a confirmed code-level coverage gap, not evidence that any current production provider actually returned such a body.

Only `scripts/thumbnail-audit.mjs` and `test/thumbnail-audit.test.js` change behavior. The audit now streams SHA-256 over the same complete bounded response and keeps at most4KiB for JPEG/PNG/WebP/GIF/BMP/AVIF/SVG header recognition. Existing2MiB limits, timeouts, allowed hosts, manual redirects, existing same-video404 fallback, concurrency, source-URL redaction and no-write boundaries remain unchanged.

Complete responses expose `bytes`, `bodySha256`, `bodySignature` and `bodyVerification`. Known header/MIME disagreement becomes `mime_mismatch`; an unrecognized image-labelled body becomes `unverified_image_body`, not available or proven broken. Empty/oversized/failed streams remain separate; no partial digest is called a complete-body fingerprint. SVG is checked as bounded inert text, never executed or entity-expanded.

This is header recognition, not full image decoding, malicious-SVG validation, visual/source relevance, copyright/hosting permission, video playback or Google indexing proof. A minimal or corrupt file with a recognizable header can still fail to decode. Unknown headers require inspection, not automatic replacement. No provider URL/query, response text, token or signed/private address is persisted. Hashes describe retrieved image bytes only.

## Verification

Six new tests plus seven existing thumbnail tests pass13focused. Tests cover all supported raster signatures including compatible-brand AVIF, BOM/XML/comment SVG, image-labelled HTML, MIME mismatch, multichunk hashing beyond the4KiB prefix, one unchanged request, existing fallback behavior, redaction, empty/oversized cancellation and failed-stream/no-retry/partial-digest limits. Full365Node tests, fourteen-page editorial build validation and Wrangler4.124.0dry-run pass locally. Require exact-head CI including the existing fourPython regressions before merge.

One ordinary first-party GET at2026-10-16T17:39:55.244Z checks the existing record32 illustration: HTTP200/image/webp,108624bytes, WebP signature and SHA256 `4c033b0fecaefaa3791f34262f61a696c67e988a694e0d9b60e2a116c126354c`, exactly matching the repository asset. Zero provider requests or production writes. No image bytes or label changed; prior illustration provenance remains authoritative. No full provider inventory was redundantly launched.

Latest actual pre-change completed audit38940564047/artifact12063710533 has211pages/zero failures and161available/11HTTPfailures/eight protected placeholders. It does not contain these new body fields and must not be retroactively described as header/hash verified. Google0Inspections/0submissions in it is not a fresh indexed count.

## Publication and next evidence

Publish the script/tests and exact Sia-release checkpoints through a separate PR with `[read-only-preflight] [seo-only]`. There is no Worker/runtime/frontend/public asset/configuration/migration/D1/R2/media/review/date/rights/security/account/container/Access/email/gateway change. The active Worker stays449c5103; automatic Portainer deployment remains disabled.

The existing script-path push diagnostic uses zero Inspections/read-only maps and will exercise the new fields; do not dispatch a second full audit or an empty production commit. Consume its actual completed artifact next, record any real mismatches/unknowns without guessing image content or replacing owner/source posters, and distinguish diagnostic classifications from proven site/provider failures. Next editorial candidate is published Music192/Fight Song after primary-source verification;193’s preserved visual/audio assertions and all protected-topic/source holds remain explicit.

## Files in this follow-up

- `scripts/thumbnail-audit.mjs`
- `test/thumbnail-audit.test.js`
- `docs/thumbnail-body-evidence-20261016.md`
- `docs/sia-source-context-20261016.md`
- `docs/editorial-quality-queue.json`
- `docs/seo-progress.md`
- `docs/thumbnail-provenance.md`
