# Vid.Best TikTok Cloud Availability Gateway

This service is designed for the small Oracle Linux VPS / Portainer deployment.

Purpose:
- Calls TikTok's official oEmbed endpoint from the server.
- Reports whether TikTok returned metadata.
- Returns title, author, thumbnail URL and video ID.
- Lets the Vid.Best Admin panel diagnose provider availability before browser playback.

Important:
- It does not proxy, download, scrape, re-host, or transform TikTok video/audio bytes.
- It therefore cannot remove a TikTok browser/network restriction.
- Playback remains an official TikTok request in the visitor's browser.

Portainer:
1. Deploy this folder as a Stack.
2. Set TIKTOK_GATEWAY_TOKEN to a random secret of 32+ characters.
3. Verify /health.
4. Put the service behind HTTPS (for example your Cloudflare Tunnel).
5. Set Worker variable TIKTOK_GATEWAY_URL to the HTTPS base ending in /v1/tiktok.
6. Set Worker secret TIKTOK_GATEWAY_TOKEN to the same secret.