import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  escapeHtml,
  githubLoginAllowed,
  proxyMcpRequest,
  validatePublicOrigin,
} from "./security.js";

const FRESH_HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'",
};

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:610px;margin:10vh auto;padding:0 20px;color:#222}article{padding:20px;border:1px solid #ddd;border-radius:12px}button{padding:12px 20px;margin:8px 6px 0 0;border:1px solid #333;border-radius:8px;background:#fff;cursor:pointer}.primary{background:#222;color:#fff}code{overflow-wrap:anywhere}</style></head><body><article>${body}</article></body></html>`;
}

function htmlResponse(html, extraHeaders = {}) {
  const headers = new Headers(FRESH_HTML_HEADERS);
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  // Always enforce anti-framing and non-cacheability, even if a library updates headers.
  headers.set("Cache-Control", "no-store");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", FRESH_HTML_HEADERS["Content-Security-Policy"]);
  return new Response(html, { headers });
}

function redirect(location, headers = new Headers()) {
  const h = new Headers(headers);
  h.set("Location", location);
  h.set("Cache-Control", "no-store");
  h.set("Referrer-Policy", "no-referrer");
  return new Response(null, { status: 302, headers: h });
}

// This authorization request was already validated by parseAuthRequest() at /authorize.
function deniedClientRedirect(originalRequest, publicOrigin) {
  const location = new URL(originalRequest.redirectUri);
  location.searchParams.set("error", "access_denied");
  location.searchParams.set("error_description", "GitHub authorization denied");
  if (originalRequest.state) location.searchParams.set("state", originalRequest.state);
  location.searchParams.set("iss", publicOrigin);
  return location.href;
}

async function exchangeGitHubCode(code, env, origin) {
  const form = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code,
    redirect_uri: `${origin}/callback`,
  });
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("GitHub token exchange failed");
  const body = await response.json();
  // GitHub OAuth token endpoint may return HTTP 200 with an error object.
  if (body.error || typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("GitHub denied token exchange");
  }
  return body.access_token;
}

async function getGitHubLogin(accessToken) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": "vidbest-vidnavigator-mcp-gateway",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("GitHub identity verification failed");
  const user = await response.json();
  if (!user || typeof user.login !== "string") throw new Error("Missing GitHub login");
  return user.login;
}

// This handler is invoked only for a token OAuthProvider has validated.
const protectedMcpHandler = {
  async fetch(request, env, ctx) {
    if (!githubLoginAllowed(ctx?.props?.githubLogin, env.ALLOWED_GITHUB_LOGIN)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!ctx?.auth?.scope?.includes("mcp:use")) {
      return new Response("Insufficient scope", { status: 403 });
    }
    return proxyMcpRequest(request, env.VIDNAVIGATOR_API_KEY);
  },
};

const authorizationHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const oauth = env.OAUTH_PROVIDER;
    const origin = validatePublicOrigin(env.PUBLIC_ORIGIN);
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.ALLOWED_GITHUB_LOGIN) {
      return new Response("OAuth gateway not configured", { status: 503 });
    }
    try {
      if (url.pathname === "/authorize" && request.method === "GET") {
        const authRequest = await oauth.parseAuthRequest(request);
        const client = await oauth.lookupClient(authRequest.clientId);
        const consent = await oauth.beginConsent(authRequest);
        const clientName = client?.clientName || client?.client_name || "Unknown MCP client";
        const rendered = page("Authorize VidNavigator", `
          <h1>VidNavigator video analysis</h1>
          <p><strong>${escapeHtml(clientName)}</strong> requests access to the VidNavigator MCP tools using your account.</p>
          <p>Approved tools can send video URLs and analysis requests to VidNavigator. Requests may use your VidNavigator credits.</p>
          <p>Client ID: <code>${escapeHtml(authRequest.clientId)}</code></p>
          <p>Redirect: <code>${escapeHtml(authRequest.redirectUri)}</code></p>
          <p>Signing in will be restricted to GitHub account <strong>${escapeHtml(env.ALLOWED_GITHUB_LOGIN)}</strong>.</p>
          <form method="POST" action="/authorize">
            <input type="hidden" name="handle" value="${escapeHtml(consent.handle)}">
            <button class="primary" name="action" value="approve">Approve and sign in with GitHub</button>
            <button name="action" value="deny">Deny</button>
          </form>`);
        return htmlResponse(rendered, consent.headers);
      }
      if (url.pathname === "/authorize" && request.method === "POST") {
        const form = await request.formData();
        const handle = form.get("handle");
        if (typeof handle !== "string" || handle.length > 1024) {
          return new Response("Invalid authorization request", { status: 400 });
        }
        if (form.get("action") === "deny") {
          const denied = await oauth.denyConsent(request, handle);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        if (form.get("action") !== "approve") {
          return new Response("Invalid authorization action", { status: 400 });
        }
        // Consent is required before sending the browser to an upstream OAuth identity provider.
        const approved = await oauth.approveConsent(request, handle, { scope: ["mcp:use"] });
        const upstream = await oauth.beginUpstream(approved.request, { headers: approved.headers });
        const github = new URL("https://github.com/login/oauth/authorize");
        github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
        github.searchParams.set("redirect_uri", `${origin}/callback`);
        github.searchParams.set("state", upstream.state);
        github.searchParams.set("scope", "read:user");
        return redirect(github.href, upstream.headers);
      }
      if (url.pathname === "/callback" && request.method === "GET") {
        const resumed = await oauth.finishUpstream(request);
        const original = resumed.request;
        if (url.searchParams.get("error")) {
          return redirect(deniedClientRedirect(original, origin), resumed.headers);
        }
        const code = url.searchParams.get("code");
        if (!code) return redirect(deniedClientRedirect(original, origin), resumed.headers);
        const githubToken = await exchangeGitHubCode(code, env, origin);
        const githubLogin = await getGitHubLogin(githubToken);
        if (!githubLoginAllowed(githubLogin, env.ALLOWED_GITHUB_LOGIN)) {
          return redirect(deniedClientRedirect(original, origin), resumed.headers);
        }
        // Never persist or return GitHub access tokens. The only grant property is the verified login.
        const completed = await oauth.completeAuthorization({
          request: original,
          userId: githubLogin.toLowerCase(),
          scope: original.scope,
          metadata: { label: "Owner-only VidNavigator MCP" },
          props: { githubLogin },
        });
        return redirect(completed.redirectTo, resumed.headers);
      }
      if (url.pathname === "/" && request.method === "GET") {
        return new Response("VidNavigator OAuth MCP gateway. Use /mcp in ChatGPT.", {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      // Never return OAuth client secrets, GitHub tokens or upstream API keys to callers.
      console.error("Gateway authorization failure", error instanceof Error ? error.name : "Unknown");
      return new Response("Authentication failed. Retry the connection.", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
  },
};

export default {
  async fetch(request, env, ctx) {
    let origin;
    try { origin = validatePublicOrigin(env.PUBLIC_ORIGIN); }
    catch { return new Response("Set a valid PUBLIC_ORIGIN", { status: 503 }); }
    if (new URL(request.url).origin !== origin) {
      return new Response("Incorrect gateway host", { status: 421 });
    }
    const provider = new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: protectedMcpHandler,
      defaultHandler: authorizationHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: ["mcp:use", "offline_access"],
      requiredScopes: ["mcp:use"],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: "VidNavigator owner-only MCP gateway",
      },
      accessTokenTTL: 3600,
      refreshTokenTTL: 2592000,
    });
    return provider.fetch(request, env, ctx);
  },
};