# GitHub Actions → Cloudflare Access → Portainer

The workflow validates the repository and runs a read-only preflight against the
existing `video-site` stack (ID 27, endpoint 3). It does not create, replace or
delete a stack. Production writes require both the workflow flag
`PORTAINER_AUTO_DEPLOY_ENABLED=true` and an explicit `--deploy` invocation.
Direct script invocation defaults to read-only. Manual workflow dispatch defaults
to `read_only=true`, which skips deployment even if the production flag is enabled.

## Connection configuration

Jobs use GitHub Environment `portainer-production`. Environment settings take
precedence over repository fallbacks; check that scope when repairing a credential.

| Setting | Type | Required value |
| --- | --- | --- |
| PORTAINER_URL | Variable | https://portainer.megasale.win |
| PORTAINER_STACK_ID | Variable | 27 |
| PORTAINER_ENDPOINT_ID | Variable | 3 |
| PORTAINER_STACK_FILE | Optional variable | ops/portainer/vidbest-v56.yaml |
| PORTAINER_API_KEY | Secret | Existing Portainer API key |
| CF_ACCESS_CLIENT_ID | Secret | Cloudflare service token **Client ID** |
| CF_ACCESS_CLIENT_SECRET | Secret | Matching service token **Client Secret** |
| PORTAINER_AUTO_DEPLOY_ENABLED | Variable | Leave unset or false until production review passes |
| PORTAINER_TLS_CA_PEM | Optional secret | Additional trusted CA PEM; never disables TLS verification |

A Cloudflare token UUID used in a policy selector is different from its Client ID.
The Client ID and Client Secret must come from the same service token. Neither is
printed. Do not use an Access browser cookie or an account API token in these secrets.

## Verified Access identity

On 2026-10-10 the connected Cloudflare account was inspected directly:

- Application: `portainer.megasale.win`, self-hosted.
- Existing `VidBest Portainer Admin` email Allow policy remains in place.
- `VidBest GitHub Auto Deploy`: Service Auth (`non_identity`), including only token
  `530a942e-7c6f-4740-96c3-5a029e9e59ab`.
- Token `VidBest-GitHub-AutoDeploy` is enabled and unexpired.
- Both workflow jobs pin a non-secret SHA-256 fingerprint of that token's Client ID.

The pin makes an incorrect GitHub Client ID fail locally before credentials are
sent. Changing to a different service token requires reviewing and updating both
fingerprints in the workflow after updating the scoped Access policy and secrets.
Rotating a Client Secret must be coordinated with its effective GitHub Secret.
The connected GitHub plugin does not expose Secrets reads or writes.

## What preflight proves

The script sends `CF-Access-Client-Id`, `CF-Access-Client-Secret` and `X-API-Key`
on each API request. Redirects are not followed.

It verifies the Client ID pin, reads `GET /api/stacks/27`, checks the returned
stack ID, name, endpoint, standalone Compose type and existing environment array,
then reads `GET /api/stacks/27/file`. The YAML backup remains in memory.
Only after all checks pass does it print `READ-ONLY PREFLIGHT PASSED`.
Read-only mode rejects all API methods other than GET.

Logs expose only request method/path, status, a sanitized MIME type, fixed error
classifications and YAML hash prefixes. They never expose service credentials,
environment values, redirect query strings, cookies or response bodies.
A successful Client ID comparison followed by an Access login redirect narrows
the remaining issue to service-secret authentication; it does not prove the
Portainer API key works.

## Production update and rollback

Updates use `PUT /api/stacks/{id}?endpointId={endpointId}`, preserving the exact
existing `Env` array with `Prune=false` and `PullImage=false`. Unchanged YAML is
not redeployed. The current YAML and environment are kept in memory for a
best-effort rollback if the update or container health checks fail.

## Production readiness limitations

A successful authentication preflight alone is insufficient to enable automatic
production writes. Before enabling the flag:

- Compare the live Compose source and mounted volumes with the candidate. The
  updater does not yet reject every service/volume/bind-mount change.
- Keep an independent encrypted backup of the live YAML and environment.
  The in-memory rollback backup is lost if the runner is cancelled or killed.
- Extend the health window beyond the app's 180-second healthcheck start period.
  The current polling window is approximately 120 seconds.
- Verify recovery through an independent management path. The stack includes
  cloudflared, which also carries the Portainer management route; a failed tunnel
  restart can prevent the API rollback from reaching Portainer.
- Pin production images and startup dependencies. The candidate uses
  `cloudflare/cloudflared:latest`, `node:22-alpine`, an unpinned npm SDK install
  and the latest yt-dlp download at startup.
- Verify the restored containers after rollback; the current updater submits
  the old YAML but does not independently confirm rollback health.

Access remains enabled. No public API bypass, frontend API key, video hostname
routing change or live container mutation is part of preflight.
