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

The admin secret is exchanged for a signed, eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` cookie and is not retained in browser storage. State-changing cookie-authenticated requests also require a same-origin `Origin` header. Using the site over HTTPS is required.

Uploads are restricted to a small allowlist of raster image and video MIME types. Keep active formats such as SVG and HTML out of the same-origin media bucket.
