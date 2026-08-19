# Security policy

## Reporting a vulnerability

Open a private GitHub security advisory for the repository instead of filing a public issue containing exploit details or credentials.

## Deployment checklist

- Revoke any credential that has appeared in chat, logs, screenshots or Git history.
- Use separate long values for `ADMIN_SECRET_KEY` and `REACTION_SALT`.
- Store Gemini and YouTube keys with `wrangler secret put`.
- Give the GitHub Actions Cloudflare token only the permissions required to deploy this Worker and manage its D1 migrations.
- Review generated text before publishing and reject unsafe, inaccurate or rights-infringing submissions.
- Keep dependencies and Wrangler updated, and review Cloudflare deployment logs without recording request authorization headers.

The admin secret is kept only in the browser tab's `sessionStorage`; using the site over HTTPS is required.
