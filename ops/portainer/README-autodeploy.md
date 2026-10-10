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
| PORTAINER_AUTO_DEPLOY_ENABLED | Repository variable | Leave unset or false until production review passes |
| PORTAINER_TLS_CA_PEM | Optional secret | Additional trusted CA PEM; never disables TLS verification |
| PORTAINER_BACKUP_ENCRYPTION_KEY | Optional secret | Independent high-entropy backup key; defaults to the Portainer API key |

The production flag must be available at repository scope because GitHub evaluates
the deployment job condition before environment-level variables become available.

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
then reads `GET /api/stacks/27/file`. It parses the live and candidate Compose YAML,
rejects removal of existing services, changes to existing mounts, volume/network
definitions, ports, replicas or the management tunnel, and checks all baseline
containers. It also confirms the cached tunnel image matches its running image.
Jobs save an encrypted YAML and environment backup outside the checkout and upload
it as an artifact. Preflight performs no Portainer writes.
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
not redeployed. The deploy job performs a fresh read-only check and uploads its
encrypted rollback backup **before** invoking `--deploy`. The updater checks that
the live YAML and environment still match that backup before any write. A
Git-managed stack is refused by the file updater.

HTTP 200 alone does not prove deployment success. The updater polls the existing
stack until it is Active, its YAML and environment match the requested update,
every expected service is running, and services with healthchecks are healthy.
The default eight-minute health window exceeds the app's 180-second start period.
The existing cloudflared container must retain its container ID. The deploy job
allows 30 minutes for an update and verified recovery.

On an update or health failure, the updater waits for any asynchronous deployment
to finish before submitting the previous YAML and environment. It then verifies
rollback status, configuration and health. HTTP 4xx rejections, particularly 409
conflicts with another deployment, do not trigger a rollback. If the stack remains
Deploying or the management path is unavailable, it refuses a concurrent rollback
and reports failure. No delete or prune requests are issued.

## Encrypted recovery backup

Artifacts `portainer-preflight-{run_id}-{attempt}` and
`portainer-rollback-{run_id}-{attempt}` are retained for 14 days. They contain only
an AES-256-GCM envelope. Each backup uses a random salt and IV and an HKDF-derived
key. Credentials, inline YAML secrets and environment values are never uploaded
in plaintext. Keep the independent backup key, or the API key used for that run,
available securely: rotating a key does not decrypt old artifacts.

`readBackup` in `scripts/portainer-backup.mjs` authenticates and decrypts a
downloaded envelope for an operator-controlled recovery tool. Its result contains
`yaml`, `env`, stack ID and endpoint ID. Never print that result or write it into
the checkout, CI logs or an unencrypted artifact. The automatic rollback uses
the exact same live YAML and environment captured before the update.

## Production readiness limitations

A successful authentication preflight alone is insufficient to enable automatic
production writes. Before enabling the flag:

- Complete the read-only check against the actual live stack and investigate any
  preservation guard failure before enabling production writes.
- Confirm the Portainer API user can update stack 27. Read-only success proves
  read permission, not write permission.
- Retain backups of persistent application data separately. A YAML/environment
  backup cannot undo data migrations or application writes.
- Verify recovery through an independent management path. The stack includes
  cloudflared, which also carries the Portainer management route; a failed tunnel
  restart can prevent the API rollback from reaching Portainer.
- Review production images and startup dependencies. The candidate uses
  `cloudflare/cloudflared:latest`, `node:22-alpine`, an unpinned npm SDK install
  and the latest yt-dlp download at startup. Automatic updates freeze the tunnel
  configuration and verify its cached image. Application startup downloads still
  mean recreating a container can change dependencies even with `PullImage=false`.

Access remains enabled. No public API bypass, frontend API key, video hostname
routing change or live container mutation is part of preflight.
