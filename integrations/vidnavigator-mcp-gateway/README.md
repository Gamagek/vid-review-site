# Vid.Best — VidNavigator ChatGPT OAuth MCP gateway

**Status: source-code / review candidate, NOT deployed.** A separate Cloudflare Worker proxies the official VidNavigator Streamable HTTP MCP endpoint at `https://api.vidnavigator.com/mcp/` and adds OAuth 2.1 that ChatGPT can use. It does **not** touch Vid.Best's website Worker or D1 database.

## Why this exists

VidNavigator's official public MCP starter documents `Authorization: Bearer YOUR_API_KEY` for tools such as Cursor. ChatGPT's custom MCP setup requires OAuth discovery and authentication, so entering that API key into ChatGPT's OAuth Client ID/Secret boxes does not work. This gateway is a small, independently deployed OAuth *server* and MCP *resource server*, and forwards authenticated MCP requests to VidNavigator with an API key stored as a **Cloudflare Worker secret**.

This implementation uses Cloudflare's official `@cloudflare/workers-oauth-provider` v1.2.3 to provide PKCE, protected resource discovery, OAuth client registration (DCR and CIMD), state- and browser-bound consent, client grant storage and refresh/revocation. **GitHub OAuth is the login provider**, with an exact owner-only allowlist (`ALLOWED_GITHUB_LOGIN`). OAuth clients must receive explicit consent first. GitHub access tokens are used only for identity verification and are never saved in the token's `props`. VidNavigator's API key is never returned to the MCP client.

## Important limitations

- **No live deployment has been performed.** There is no validated public gateway URL or working ChatGPT connection yet.
- The local tests cover the fixed-upstream proxy and basic security; **OAuth end-to-end, DCR/CIMD discovery, the GitHub callback, and VidNavigator interoperability still require a real staging deployment and test**. Do not deploy this unchanged for unrelated users or expose unrestricted access.
- The account owner must complete the setup below; **never commit or paste API keys or OAuth client secrets in issues, chats, logs or the repository**.
- VidNavigator features and credits depend on the user's separate VidNavigator plan.
- The `mcp:use` permission allows tool calls that can send source URLs and analysis requests to VidNavigator and consume paid credits. This gateway does **not** automatically update D1 or publish reviews.
- Cloudflare KV has eventual consistency; standard OAuth helper controls limit browser-bound transactions and protect against CSRF, but usage should be owner-only.

## 1. Prepare the dedicated Cloudflare Worker

Use this **standalone folder**, NOT the root `wrangler.toml` used by Vid.Best.

1. In Cloudflare **Workers & Pages → KV**, create a KV namespace, e.g. `vidnavigator-mcp-oauth`.
2. In `wrangler.toml` in this folder, replace `REPLACE_WITH_OAUTH_KV_NAMESPACE_ID` with its namespace ID (an ID, not a token).
3. Replace `PUBLIC_ORIGIN = "https://REPLACE-ME.workers.dev"` with the **exact URL of your own deployed Worker**, without a trailing slash. For example, if Cloudflare is configured to create `vidnavigator-mcp-gateway.<your-subdomain>.workers.dev`, use that exact HTTPS origin. **Do not assume the example hostname is yours.**
4. Keep `ALLOWED_GITHUB_LOGIN = "Gamagek"` only if that is the account that should be allowed to authorize MCP clients.
5. This Worker must be separately deployed as `vidnavigator-mcp-gateway`, not as Vid.Best's main Worker.

## 2. Create a GitHub OAuth App (for your own sign-in)

Open **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**. This is a GitHub **OAuth App**, not a GitHub PAT or GitHub Actions token.

- Application name: `VidNavigator ChatGPT MCP Gateway`
- Homepage URL: `<PUBLIC_ORIGIN>`
- Authorization callback URL: `<PUBLIC_ORIGIN>/callback`
- Create the app; obtain its Client ID and Client Secret. Do not paste the values in this repo or chat.

The GitHub login in the allowlist will need to sign in and approve access when connecting ChatGPT. The app requests the `read:user` GitHub scope solely to verify the GitHub account identity. **Review the requested OAuth scope before authorizing.**

## 3. Set secrets in Cloudflare, not GitHub code

In Cloudflare Dashboard → **Workers & Pages → vidnavigator-mcp-gateway → Settings → Variables and Secrets**, enter these as **Secret** values:

| Secret name | Value |
| --- | --- |
| `VIDNAVIGATOR_API_KEY` | VidNavigator Dev-tools API key |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |

Alternatively, from an **authenticated** development terminal inside this folder:

```bash
npx wrangler secret put VIDNAVIGATOR_API_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

The commands prompt privately for values. **Never pass secret values as command arguments**, put them in source-controlled `.dev.vars`, or share screenshot values.

## 4. Deploy via GitHub Actions (manual)

The repository workflow `.github/workflows/deploy-vidnavigator-mcp.yml` is manual (`workflow_dispatch`) — it never auto-deploys on a push or pull request.

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository **Actions secrets**. Use a suitably restricted Cloudflare API token able to deploy this Worker and access the namespace. Never use your Global API Key.
2. After review, merge the gateway Pull Request, make sure `wrangler.toml` has your actual namespace ID and URL, then go to **Actions → Deploy VidNavigator MCP Gateway → Run workflow**.
3. Check that deployment succeeded and the Worker URL is your exact `PUBLIC_ORIGIN`. Use Cloudflare Dashboard to enter the **three Worker secrets** above if not already present.

Alternatively, with a working authenticated local Wrangler session:

```bash
cd integrations/vidnavigator-mcp-gateway
npm install
npm run check
npm run deploy
```

`wrangler login` may require you to complete Cloudflare OAuth in a browser; GitHub Actions is often easier on an Android phone.

## 5. Smoke test discovery BEFORE connecting ChatGPT

Substitute your actual Worker origin:

```text
GET <PUBLIC_ORIGIN>/.well-known/oauth-authorization-server
GET <PUBLIC_ORIGIN>/.well-known/oauth-protected-resource/mcp
GET <PUBLIC_ORIGIN>/mcp
```

The first endpoint should return authorization server metadata including `/authorize`, `/oauth/token`, and `/oauth/register` (DCR); the second should describe the protected `/mcp` resource and its authorization server. **An unauthenticated `/mcp` must return 401, never forward VidNavigator data or disclose the upstream key.**

Only after this passes:

1. ChatGPT → **Settings → Plugins → Add → Custom MCP server**.
2. MCP Server URL: `<PUBLIC_ORIGIN>/mcp` (NOT the VidNavigator upstream URL).
3. Authentication: **OAuth**. Prefer *Dynamic Client Registration* or *Client Identifier Metadata Document* when discovery offers it. Do **not** paste VidNavigator's API key as OAuth Client ID or Client Secret.
4. Create/connect; review the gateway consent dialog and then sign in via GitHub as the allowed account.
5. First invoke a harmless tool discovery/read-only call and ensure the VidNavigator tools appear. Only then test a video request while monitoring VidNavigator credit usage.

**If discovery still fails:** do not invent OAuth client credentials in Advanced Settings. Check `PUBLIC_ORIGIN`, KV ID, deployment URL, discovery response, and Cloudflare Worker logs. Do not print secrets in diagnostics.

## Safeguards and scope

- GitHub account allowlist enforced using an identity verified against `https://api.github.com/user`.
- Standard OAuth consent/state/browser binding handled by the official Cloudflare OAuth library.
- MCP inbound bearer tokens are validated by OAuthProvider before forwarding.
- Fixed HTTPS upstream URL (not client-controlled), redirects explicitly blocked to avoid API-key leakage.
- Arbitrary request headers, client cookies, and client bearer credentials are not forwarded; only permitted MCP HTTP headers are passed.
- Upstream `Set-Cookie` and other extraneous response headers are not forwarded.
- All content that appears in the consent page is HTML-escaped; CSP prohibits framing and scripts.
- Separate Worker, KV namespace and GitHub OAuth App. No Vid.Best D1 binding and no database writes.
- GitHub login tokens are used transiently and discarded after identity verification.

## References

- [Official VidNavigator MCP starter](https://github.com/vidnavigator/vidnavigator-mcp-starter)
- [Cloudflare Workers OAuth provider](https://github.com/cloudflare/workers-oauth-provider)
- [Cloudflare OAuth upstream sign-in helpers](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/upstream-sign-in.md)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)