# Owner-requested artwork lettering removal

19 October 2026: the owner explicitly requests that no image visibly contain AI-generated wording. This supersedes the earlier visible-footer preference for all existing and future conceptual review art.

Scope: edit the 70 currently published generated sidebar/social review illustrations using built-in imagegen, preserving each composition, main title and Vid.Best branding as closely as possible. Keep exact source/title/slug identity guards and source/owner posters, VideoObject thumbnails, reviews, dates, held media and drafts. Store versioned clean WebPs and retain generation/edit provenance internally. Use public captions describing conceptual review artwork and explaining that it is not a source video frame, without visible AI-generated wording. Synchronize manifest, watch/sidebar previews, Open Graph/Twitter/WebPage associations and dynamic image maps.

Current branch: fix/review-art-remove-ai-lettering-20261019. Resume this work before another image-generation batch. Existing hourly task preference updated without changing its schedule or enabled state. No new automation.

Initial read-only inventory at2026-10-19T07:29:48.786Z:243saved/239published, protected-field digest8af32575fba55e56e6320e4274b7f51311fb512d8ba0c6de29c38ce484b589dc (excludes views/reaction_count/comments_count). Current100%Worker9a77a25c-c339-47d1-a8a9-12cd4bd3bc42. No D1/R2 write or migration planned.

Release gate: verify all edited image bytes/dimensions/hash and lettering visually, relevant full regressions and Worker dry-run, PR CI, merge/deployment, live image/HTML/social/map associations and owner-data preservation. Until verified, no publication claim. Original image generation history is preserved; the public design preference does not change how the art was produced.
