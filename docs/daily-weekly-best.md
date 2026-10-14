# Daily Weekly Best editorial section

The public hub is `/daily-weekly-best`, reached from one homepage footer link. Its `films`, `basketball` and `games` branches link ten independent long-form reviews. These pages are not D1 video rows and are never added to the homepage feed, video directory, category counts, member notifications or pending drafts. The user requested a discreet real section; it remains public and crawlable, without cloaking or authentication.

## Source and editorial boundaries

All ten video IDs, exact source titles, official publishers and original upload timestamps were verified against YouTube oEmbed and public watch metadata on 15 October 2026 in Sri Lanka. Nine explicitly returned `playableInEmbed: true`; Hexed's official Disney UK announcement supplies its embedded player and oEmbed supplies its identity. No full feature, soundtrack, basketball possession log or hands-on game test is claimed. The pages are independent contextual previews, critical essays or viewing guides, with sources and their evidence limits visible. They do not describe speculation as a verified scene, claim a worldwide popularity ranking or change an older trailer into a fresh October upload.

The initial sources are Harry Potter, Disney UK, Warner Bros., Warner Bros. Australia, Marvel Entertainment, Capcom USA, Mythri Movie Makers, World Of Ramayana, NBA and NBA 2K. Three sources are fresh October uploads; the others are explicitly dated older previews relevant to forthcoming or recently launched releases. Article dates are separate from those original video dates. No existing owner content, publish date, media route, poster or draft is edited, and no Last updated label is added.

## Authoring and validation

Source documents live in `content/daily-weekly-best/*.md`; verified metadata is in `catalog.json`. `npm run editorial:build` creates the fourteen committed HTML assets. `npm run check` checks that those assets still match their source documents before compiling the Worker. The ten documents contain 3,023–3,226 words. The requested length is an editorial requirement, not a Google indexing rule or guarantee.

`src/daily-weekly-best.js` serves only known canonical pages through Static Assets, with strict YouTube-only frame permission, proper HEAD, redirects and 404s; it makes no D1/R2 writes. Article and VideoObject metadata distinguish article publication, original upload, illustrative article image and the original YouTube poster. The separate XML sitemap lists the hub, three branches and ten reviews and is linked from the root sitemap. Public audit checks include the editorial text and internal links; stored Google inspections include actual reviews and exclude collection pages.

## Google discovery publication

A deployment audit remains a zero-inspection, no-submission diagnostic. A successful publication commit deliberately marked `[daily-weekly-best-publish]` opts in to two extra checks after deployment: verify exact YouTube identities, embeds and actual JPEG poster bytes, then submit the root and new editorial sitemap through Google's supported Search Console API. The publication script refuses to act unless all fourteen live pages already passed the public audit. It inspects only the ten new reviews, not the already-inspected existing library. No restricted Indexing API, credential exposure or claim of forced indexing is involved.

The ordinary daily audit continues to use its bounded quota. An explicit new publication is a legitimate content deployment, not an empty commit to resubmit unchanged sitemaps. Review existing diagnostics and artifact attempts before any retry. Ordinary status checks must not reuse the publication opt-in merely to refresh Google processing state.

The local public-source poster fetch returned HTTP 200 `text/html` (195 bytes), not image bytes, and is not recorded as successful image verification. Post-deployment Actions checks verify actual JPEG responses before Google publication. The local Wrangler dev listener failed with `uv_interface_addresses`; tests and Worker dry-run compilation succeeded, and actual deployed HTTP responses remain a separate required verification. These limits are not reasons to copy provider media or bypass controls.

Portainer auto deployment remains paused. This feature adds no migration, container, volume, Access/email policy, gateway route or frontend credential.

## Verified initial publication

PR 160, CI 38630136450 / 38630365755 and Worker deployment 38630365814 completed successfully. Publication audit 38630516160 / artifact 11925703709 verified all fourteen public pages, ten exact official oEmbed identities/embeds and ten real JPEG source posters. Google accepted the root/new editorial sitemap at 20:18 UTC on 14 October (15 October in Sri Lanka); immediate processing was pending, and exactly ten new stored statuses were inspected: six discovered, four unknown, zero indexed. This does not establish that Google has crawled or indexed the new reviews. The ordinary post-deployment audit is still read-only with zero inspections.

Live QA identified a stylesheet filename colliding with the page-prefix matcher. The corrected matcher leaves sibling files to Static Assets. `verify-daily-weekly-best-assets.mjs` performs credential-free reads of the stylesheet and ten hosted covers, verifies content types and exact reviewed bytes, and writes its own safe artifact. It runs after deployment or on daily/manual checks, not in the pre-deployment push diagnostic. The source/Google first-publication steps remain separately opt-in and are not retriggered by this repair.
