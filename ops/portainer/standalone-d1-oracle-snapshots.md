# Isolated Oracle published-video SQLite snapshots — staging only

**Do not merge or enable production failover before the freeze is reconciled.**

This is an independent public-content replica for the existing named Portainer volume.
It is NOT a D1 SQL export, NOT a full recovery of D1's private tables, and NOT a
website failover deployment.

## Fixed targets

- Existing Portainer origin: https://portainer.megasale.win
- Existing Docker endpoint: 3
- Existing helper container: vidbest-d1-backup-helper (not -old)
- Existing named volume: vidbest-d1-fallback-data mounted RW at /backup
- Expected helper image: alpine:3.21, command: sleep 2147483647
- Existing video-site, comparison-api2, database/Redis, tunnel and
  gateway stacks are entirely outside the allowed action scope.

## Deployment gates

1. The read-only preflight performs exact container and volume identity checks
   through Portainer's Docker API (GET requests only). It does not use Portainer
   stack update endpoints or inspect/change other containers.
2. The manual ensure action can START only an already CREATED and verified
   vidbest-d1-backup-helper, when ALLOW_HELPER_START is true. It cannot
   create, replace, recreate, rename, stop or delete containers.
3. The sync action (also on a 4-hour schedule after activation) reads
   published video columns from Cloudflare D1 using the existing GitHub Actions
   deployment token. No SQL writes or exports occur. A complete consistent
   published-only snapshot is materialized using Python's SQLite stdlib,
   checked with PRAGMA integrity_check, then transmitted to the EXISTING helper
   volume using Portainer's Docker archive API.
4. The archive is fetched back from Oracle to verify its SHA-256. A mere HTTP
   PUT response is NOT reported as success. If Portainer or D1 time out,
   the sync aborts, leaving earlier slots intact.
5. A 48-slot rolling window (4 hours x 48 = 8 days) limits disk use.
   Each file must fit within 20 MiB; nominal maximum is about 960 MiB
   plus manifests. Do not confuse this with the host's total free space.
6. Preflight and all pull-request unit tests must pass first. Since the
   current Portainer Docker proxy timed out in past read-only checks, failure
   is possible; repeated blind starts or extra container creation are forbidden.

## Authenticity and privacy

- GitHub Secrets: PORTAINER_API_KEY, CF_ACCESS_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
  This job never prints or exports their values.
- GitHub variables: PORTAINER_URL, PORTAINER_ENDPOINT_ID.
- Only published Vid.Best video fields are copied, based on an allowlist.
  Member sessions, draft reviews, reactions, admin credentials, passwordless
  member tokens and internal tables are not part of the snapshot.
- A corrupt, partial or changed paginated result causes a safe failure.
  D1 quota exhaustion also causes a safe failure; previously valid Oracle
  snapshots remain available, but their age increases.
- Do not publish these snapshots via an unauthenticated Portainer API route.

## Current limitations — do not claim these are solved

- Cloudflare Worker does NOT read these Oracle SQLite files yet.
  No external read-only gateway/tunnel route is configured for the new helper.
  The Worker cannot silently switch to this database when D1 quota runs out.
- /watch/:slug server-side HTML still reads D1 and needs a separate validated
  failover mechanism, matching schema and SEO behavior.
- New publications become visible in the next successful scheduled snapshot
  run (GitHub Actions schedule is best-effort), not instantly. Public interaction
  writes, members, views, reactions and comments are not mirrored.
- Full point-in-time recovery still requires an independently protected D1
  SQL export/backup. Oracle snapshot data is not a source-of-truth database.
- The protected Portainer Docker API experienced 45-second read timeouts in a
  previous production audit. This tool never bypasses those errors or alters
  Cloudflare Access authentication.
- The named local volume is on the existing Oracle disk, not a new 200 GB disk.

## Activation sequence after separate review

1. Run PR unit tests.
2. Confirm Portainer helper remains isolated and current Oracle disk has
   headroom; fix Portainer Docker API instability first.
3. Activate only this workflow after PR review / main freeze reconciliation.
4. Manually run preflight. Check exact identity and mount.
5. Manually run ensure if helper state is Created; it starts only that helper.
6. Manually run sync. Require verified SQLite checksum readback in logs.
7. Independently validate the copied Oracle SQLite file and age.
8. Before claiming auto failover, separately stage/test Worker fallback routing,
   secure Oracle read API/tunnel, stale policy, and /watch HTML behavior.

The other recovery PRs (#267, #270, #272) and existing production deployment
were deliberately not merged, rebased, modified or deployed by this work.
