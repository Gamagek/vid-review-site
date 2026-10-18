// Isolated official player. Metadata requests go directly from the viewer to
// the owner's API so its per-viewer daily allowance retains the real caller.
function canonicalSource(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/@([A-Za-z0-9_.]{1,32})\/video\/(\d{15,25})\/?$/);
    if (url.protocol !== "https:" || !["www.tiktok.com", "tiktok.com"].includes(url.hostname) ||
        url.username || url.password || url.port || !match) return null;
    return `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
  } catch { return null; }
}

export function tikTokZeroRequestPlayer(request) {
  const source = canonicalSource(new URL(request.url).searchParams.get("url"));
  if (!source) return Response.json({ ok: false, error: "Use the full TikTok video sharing URL." }, {
    status: 400, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>TikTok video | Vid.Best</title>
<link rel="stylesheet" href="/tiktok-cache-player.css?v=20261018-1"><script src="/tiktok-cache-player.js?v=20261018-1" defer></script></head>
<body><main><p id="cache-status" role="status" aria-live="polite">Loading cached TikTok details…</p>
<div id="tiktok-embed-host"></div><p><a id="tiktok-source" href="${source}" target="_blank" rel="noopener noreferrer">Open this video on TikTok</a></p>
<noscript>Enable JavaScript to load TikTok's official embed, or follow the source link.</noscript></main></body></html>`, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
    // The official embed.js URL redirects here (verified18October2026).
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'; script-src 'self' https://www.tiktok.com https://sf16-website-login.neutral.ttwstatic.com; connect-src 'self' https://tiktokmedia.megasale.win https://www.tiktok.com; frame-src https://www.tiktok.com; style-src 'self' 'unsafe-inline'; img-src https: data:; media-src https://www.tiktok.com blob:",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  } });
}
