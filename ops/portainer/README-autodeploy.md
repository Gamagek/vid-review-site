# GitHub Actions → Portainer CE auto-deployment

The workflow **always runs a read-only API preflight** after tests on every main push;
preflight verifies Service Auth, Portainer API, stack ID/name/type and a readable
YAML backup. It does not mutate Portainer. A production deployment can only start
when the separate `PORTAINER_AUTO_DEPLOY_ENABLED=true` flag has been set.

This workflow updates **only** the existing standalone Compose stack `video-site`
(Portainer stack 27, endpoint 3) after a **main** push and after CI-style tests pass.
It never creates another tunnel or deletes volumes. A no-change YAML is not redeployed.
Site Worker deployments remain in the existing Cloudflare `Deploy` workflow.

## Required connection setup

Already entered by the owner:
- Repository Secret: `PORTAINER_API_KEY` (keep private)
- Repository Variable: `PORTAINER_STACK_ID=27`
- Repository Variable: `PORTAINER_ENDPOINT_ID=3`

Still required before it can actually connect:
1. Add repository variable `PORTAINER_URL` with a **working trusted-HTTPS origin**
   (for example `https://portainer.megasale.win` **after** configuring a protected Tunnel route).
   **Do not** use an unprotected public management hostname. TLS validation is not disabled.
   If using a private/self-signed CA with a certificate valid for the hostname, add
   `PORTAINER_TLS_CA_PEM` as a GitHub Actions secret containing the CA PEM chain.
2. Under Settings → Environments, create `portainer-production`. Restrict deployments
   to the `main` branch. An optional protection rule can require approval for a rollout.
3. Optional repository variable `PORTAINER_STACK_FILE` chooses which reviewed YAML
   should be active. Default: `ops/portainer/vidbest-v56.yaml`.
   For PR #90's optional historical TikTok container **after it is merged and tested**,
   choose `ops/portainer/vidbest-v56-with-optional-v7.yaml`.
4. First merge PR #91 with the deployment flag unset. Inspect the GitHub Actions
`Portainer production stack (after tests)` read-only `preflight` job to confirm
`READ-ONLY PREFLIGHT PASSED`. Then, and only then, create repository variable
   `PORTAINER_AUTO_DEPLOY_ENABLED=true`. Without this switch, the workflow tests
   changes but does not touch the live stack.

## What it checks

- Requires the current Portainer stack to be named `video-site`, be standalone
  Compose (type 2), and belong to the expected Endpoint ID.
- Reads and keeps the *existing* Stack environment variables, including secrets;
  no key or env value is printed.
- Downloads the current stack source as an ephemeral in-memory backup.
- Uses Portainer `PUT /api/stacks/{id}?endpointId={endpointId}` with `Prune=false`
  and `PullImage=false`.
- Checks running container statuses and the health of app, rapidapi-tester and
  optional legacy-v7. Attempts to restore the previous YAML if post-update health fails.

## Limitations

Portainer CE's API token gives significant privileges: protect it in GitHub
Secrets. A public GitHub repo should **not** execute a privileged self-hosted
runner on the production VPS. Use GitHub-hosted `ubuntu-latest` with an HTTPS
protected endpoint instead.

If Cloudflare Access is enabled for the protected Portainer hostname,
create one service-token policy scoped to the deployment application and add
`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as **repository secrets**.
The workflow automatically sends both service-token headers when configured.
Do not enable deployment until the hostname and auth path are reachable,
otherwise runs will fail before altering the Stack.

Rollback is best-effort, not a transactional restore of external mutable state.
Always keep an independent Portainer backup of your current stack and env.
