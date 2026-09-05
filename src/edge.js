import app from "./index.js";

const CRAWLER_PATTERN = /\b(?:bot|crawler|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|pinterestbot|duckduckbot|baiduspider|yandexbot)\b/i;

export function isLikelyCrawler(value) {
  const userAgent = typeof value === "string"
    ? value
    : value?.headers?.get?.("User-Agent") || "";
  return CRAWLER_PATTERN.test(userAgent);
}

export function sanitizeWatchHtml(html) {
  let output = String(html || "").replace(
    "Human-curated video discovery",
    "Curated video discovery",
  );

  const usesFallbackThumbnail = /<meta property="og:image" content="[^"]*\/favicon\.svg(?:\?[^"]*)?">/i.test(output);
  if (usesFallbackThumbnail) {
    // A site icon is not a genuine video thumbnail. Keep the page indexable,
    // but omit VideoObject markup until a real thumbnail is supplied.
    output = output.replace(
      /\s*<script type="application\/ld\+json" nonce="[^"]*">[\s\S]*?<\/script>/i,
      "",
    );
  }

  return output;
}

function sameOriginMutationAllowed(request) {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

async function defaultNewVideoToDraft(request) {
  if (request.method !== "POST") return request;
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) return request;

  let payload;
  try {
    payload = await request.clone().json();
  } catch {
    return request;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.published !== undefined) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  return new Request(request, {
    headers,
    body: JSON.stringify({ ...payload, published: false }),
  });
}

async function fetchHandler(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/api/admin/session" && request.method === "DELETE" && !sameOriginMutationAllowed(request)) {
    return jsonError(403, "Cross-origin request rejected");
  }

  if (url.pathname === "/api/videos" && request.method === "POST") {
    request = await defaultNewVideoToDraft(request);
  }

  const crawlerWatchRequest = request.method === "GET"
    && url.pathname.startsWith("/watch/")
    && isLikelyCrawler(request);
  const delegatedContext = crawlerWatchRequest ? { waitUntil() {} } : ctx;
  const response = await app.fetch(request, env, delegatedContext);

  if (request.method === "GET" && url.pathname.startsWith("/watch/") && response.ok) {
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("text/html")) {
      const html = sanitizeWatchHtml(await response.text());
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=3600");
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
  }

  return response;
}

async function scheduledHandler(_controller, env, ctx) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const twoDaysAgo = nowSeconds - (2 * 24 * 60 * 60);
  const cleanup = Promise.all([
    env.DB.prepare("DELETE FROM rate_limits WHERE window_started_at < ?")
      .bind(twoDaysAgo).run(),
    env.DB.prepare("DELETE FROM discovery_request_visitors WHERE created_at < datetime('now', '-90 days')")
      .run(),
  ]);
  ctx.waitUntil(cleanup);
}

export default {
  fetch: fetchHandler,
  scheduled: scheduledHandler,
};
