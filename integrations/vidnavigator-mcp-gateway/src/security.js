export const UPSTREAM_MCP_URL = "https://api.vidnavigator.com/mcp/";

export function validatePublicOrigin(value) {
  if (!value) throw new Error("PUBLIC_ORIGIN is not configured");
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid PUBLIC_ORIGIN"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("PUBLIC_ORIGIN must be a plain HTTPS origin without path, credentials or query");
  }
  if (url.hostname === "replace-me.workers.dev") throw new Error("Replace PUBLIC_ORIGIN before deployment");
  return url.origin;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
}

export function githubLoginAllowed(actual, expected) {
  return typeof actual === "string" && typeof expected === "string" && expected.length > 0 && actual.toLowerCase() === expected.toLowerCase();
}

export function upstreamRequestHeaders(incoming, apiKey) {
  if (!apiKey) throw new Error("VIDNAVIGATOR_API_KEY is missing");
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${apiKey}`);
  // Deliberately DO NOT forward client Authorization, Cookie, Host, X-Forwarded-*, or arbitrary headers.
  for (const key of ["accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"]) {
    const value = incoming.headers.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
}

export function filteredUpstreamHeaders(upstream) {
  const headers = new Headers();
  for (const key of ["content-type", "mcp-session-id", "mcp-protocol-version", "retry-after"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

export async function proxyMcpRequest(request, apiKey, fetcher = fetch) {
  const path = new URL(request.url).pathname;
  if (path !== "/mcp" || !["GET", "POST", "DELETE"].includes(request.method)) {
    return new Response("Not found", { status: 404 });
  }
  if (!apiKey) return new Response("VidNavigator secret not configured", { status: 503 });
  try {
    const upstream = await fetcher(UPSTREAM_MCP_URL, {
      method: request.method,
      headers: upstreamRequestHeaders(request, apiKey),
      body: request.method === "POST" ? request.body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
    // Never forward a secret to a URL chosen by an upstream redirect.
    if (upstream.status >= 300 && upstream.status < 400) {
      return new Response("Unexpected upstream redirect", { status: 502 });
    }
    return new Response(upstream.body, { status: upstream.status, headers: filteredUpstreamHeaders(upstream) });
  } catch {
    return new Response("VidNavigator upstream unavailable", { status: 502 });
  }
}
