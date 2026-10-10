const LEGACY_V5_ORIGIN = "https://legacy-video.megasale.win";

export async function signedLegacyV5Page(request, env) {
  const url = new URL(request.url);
  const user = url.searchParams.get("user") || "";
  const id = url.searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_.]{1,32}$/.test(user) || !/^[0-9]{15,25}$/.test(id)) {
    return new Response("Invalid TikTok video URL", { status: 400 });
  }
  if (!env.SIGN_SECRET) return new Response("Legacy player is not configured", { status: 503 });
  const exp = Math.floor(Date.now() / 1000) + 900;
  const material = new TextEncoder().encode(id + "." + exp);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(env.SIGN_SECRET)),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC",key,material));
  const sig = Array.from(signature,b=>b.toString(16).padStart(2,"0")).join("");
  const source = "https://www.tiktok.com/@" + user + "/video/" + id;
  const src = LEGACY_V5_ORIGIN + "/watch?url=" + encodeURIComponent(source) +
    "&exp=" + exp + "&sig=" + sig;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Optional TikTok v5 player</title>' +
    '<style>body{margin:0;min-height:100vh;background:#070707;color:white;display:grid;place-items:center}' +
    'iframe{border:0;width:min(100%,605px);height:min(92vh,900px)}</style></head><body>' +
    '<iframe loading="eager" title="Legacy TikTok preview" allow="fullscreen" src="' + src +
    '"></iframe></body></html>';
  const headers = new Headers({
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-src https://legacy-video.megasale.win; frame-ancestors 'none'; base-uri 'none'"
  });
  headers.set("X-Robots-Tag","noindex, nofollow");
  return new Response(request.method==="HEAD"?null:html,{status:200,headers});
}

