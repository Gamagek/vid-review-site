# Vid.Best deployment verification

GitHub Actions use pinned Node 24 action runtimes on `ubuntu-24.04`. The application's CI runtime remains Node 22.

The Portainer workflow validates the production Compose template without starting services, runs regression tests and a Worker dry run, and then runs a GET-only preflight against the existing `video-site` Stack 27 on Endpoint 3. Cloudflare Access credentials are checked against the policy token's Client ID fingerprint. Credentials, live YAML and response bodies are never printed.

Preflight creates an AES-256-GCM backup of the live YAML and environment and authenticates it by decrypting it in memory. The artifact is uploaded even when a later Docker inventory request fails. Before a production write, a fresh backup must be uploaded and its content must still match the live stack. The encryption secret is `PORTAINER_BACKUP_ENCRYPTION_KEY`, or the existing Portainer API key when a separate backup key is unset.

Transient GET failures have at most three attempts, with a 45-second timeout per attempt. Access denials, TLS certificate failures, redirects, malformed JSON and unexpected response types fail without retries. A PUT is always sent once. Neither updater automatically rolls back after a failed or unresolved update.

If the live container inventory cannot be obtained, preflight diagnoses endpoint metadata and Docker API version with bounded GETs and blocks production writes. Endpoint snapshots are diagnostic data and never substitute for current container health. A reachable Portainer stack API or public gateway alone does not prove every container is healthy.

Deployments preserve existing environment entries, services and storage definitions, refuse changes to the management tunnel service, and send `Prune: false` and `PullImage: false`. Before changing the stack, the cached tunnel image tag must match its running image ID. The tunnel container's identity is verified again after an update. All Portainer deployment jobs share a concurrency group with cancellation disabled.

For an infrastructure-only verification merge, include `[read-only-preflight]` in the merge commit message. This blocks both Worker/D1 writes and Portainer deployment jobs while allowing CI, preflight, encrypted backup retention and GET-only public health checks. Manual workflow dispatch also defaults to `read_only: true`.

Public checks use `https://vid.best/api/health` and `https://video.megasale.win/health`. They validate the response body as well as HTTP status, run even after a failed preflight, and report public service availability separately from Docker inventory health.
