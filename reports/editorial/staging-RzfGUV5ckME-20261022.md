# Single-review publication — RzfGUV5ckME

**Status: BLOCKED pending independent live verification.** The database accepted publication, but subsequent reads reached the account's D1 daily row-read quota. The public watch request returned HTTP500. Do not claim VERIFIED LIVE.

## Actual writes

The source-ID lookup returned no record (507 rows read; no source-ID index exists). One parameterized, duplicate-guarded INSERT changed exactly one videos row, returning id **521**, slug `lord-of-the-rings-game-movie-gollum-talion-minas-ithil`, published **1**, created_at **2026-10-22T00:00:00.000Z** (22 October in Sri Lanka). INSERT metrics: 513 reads, 7 writes including indexes. No existing video was updated.

A primary-key-guarded metadata INSERT saved source_published_at **2025-01-08T13:00:37Z** and source_duration **PT2H8S** for 521 (one metadata row changed, 5 rows read). The subsequent id521 readback failed with Cloudflare error7500: free-tier daily row-read limit exceeded. No further D1 requests are permitted until availability/reset. These write receipts are distinct from an independently verified public page.

## Evidence and editorial limits

YouTube oEmbed/player metadata independently confirm the source ID, Superhero FXL Games, public access, embeddability, January8,2025 upload and 7208-second duration. Source chapter names and the English transcript were inspected directly. They place the transition to Talion/Shelob around the uploader's “The Ranger's Journey” chapter at1:09:02. The preliminary Gemini summary's broad ranges are not precise scene timestamps.

The full Gemini JSON is absent from PR269; prior conversation retrieval recovered supplied scene/audio observations and voice claims, not the literal JSON. Browser playback did not load footage. Storyboard downloads returned HTML. Neither is counted as direct viewing.

Three exposed TwelveLabs connections were checked: Thin Review Enrichment27items, Review Audit42items, Primary VidBest Video Reviews73items across two pages. None listed this source. One authorized ingestion was submitted to Primary (job01a164bd-841f-70c0-b538-50efd38fa1f8); no ready item or completed analysis was returned. No TwelveLabs validation is claimed.

Checked game background:
- https://www.shadowofwar.com/characters/
- https://www.shadowofwar.com/regions/
- https://store.steampowered.com/app/356190/Middleearth_Shadow_of_War/
- https://www.imdb.com/title/tt6579422/fullcredits/
- https://www.imdb.com/title/tt12789698/fullcredits/
- https://gdcvault.com/play/1025463/Scoring-Middle-earth-Shadow-of

The transcript supports the ring bargain, conflict over the Palantír, Castamir's betrayal, the Witch-king and closing Carnán/Tar Goroth thread. Its transcription errors were not copied into public prose. Underlying-game voice credits distinguish Liam O'Brien's Shadow of War Gollum from Wayne Forester's Daedalic Gollum; Talion/Troy Baker, Celebrimbor/Alastair Duncan and Shelob/Pollyanna McIntosh are not presented as a new upload cast. Grigg/Schyman score attribution is grounded in the composers' own GDC postmortem; no cue-by-cue match, sound-mix measurement or Howard Shore attribution is claimed.

The complete original English review has seven sections and1209words. Public copy identifies a cinematic game-movie compilation, distinguishes separate adaptations, and states the limits of supplied listening notes. Its metadata differs from the five existing theatrical Lord of the Rings scene-review entries inspected.

## Artwork and scope

Existing owner-approved **Fiery Fortress Fantasy Poster.png** provides Talion, Gollum and a small bottom vid.best watermark. Source SHA256:84cb28fa1e34e0a7a8cdeaf6122275c54521a0a071885fa1ed748fe677299895. Encoding only:1672×941WebP,257410bytes, SHA256:44d8c8408b0fbb5d3d3ad55f28965e2db6152a3d5b98914c284fb99b2ce1396b.

The existing manifest binds artwork to521's exact source/title/slug/publication state and reuses the right-side layout. Caption/alt identify conceptual artwork rather than a captured frame;2025lettering follows the upload's title. The original remote YouTube poster is preserved. A real captured frame remains pending; none was uploaded.

Payload: `content/editorial-quality/2026-10-22-lotr.json`. There are no new migrations, runtime-code edits, auth changes or automatic/bulk publishing triggers.

## Validation and continuation

Local SQLite simulation inserts one video, suppresses a repeat insert and preserves an unrelated record's date/text/counters. Existing Worker render returns200 with seven semantic headings, canonical, correct YouTube embed, separate Article/review and VideoObject/source dates, and PT2H8S duration. SEO description:152characters. Existing artwork/SEO regressions pass after matching their alt-text convention; Worker bundle dry-run passes.

After deployment, verify image HTTP200 and byte hash without D1. Once quota availability returns, **read id521 first by primary key** and compare full fields/source metadata to the saved payload. Check identity matches once if necessary; do not blindly insert another record. Verify page200, player, seven sections, tags, SEO, canonical, schema, date, artwork and sitemap inclusion. Preserve every existing record/date/counter. Until independent public/database checks pass, report **BLOCKED**.
