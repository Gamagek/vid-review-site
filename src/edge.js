import app from "./index.js";

const CRAWLER_PATTERN = /\b(?:bot|crawler|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|pinterestbot|duckduckbot|baiduspider|yandexbot)\b/i;
const EXTERNAL_VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "tiktok.com",
  "www.tiktok.com",
  "facebook.com",
  "www.facebook.com",
]);

export function isLikelyCrawler(value) {
  const userAgent = typeof value === "string"
    ? value
    : value?.headers?.get?.("User-Agent") || "";
  return CRAWLER_PATTERN.test(userAgent);
}

function isExternalEmbed(value) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return EXTERNAL_VIDEO_HOSTS.has(hostname)
      || hostname.endsWith(".youtube.com")
      || hostname.endsWith(".tiktok.com")
      || hostname.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

export function sanitizeWatchHtml(html, sourceMetadata = null) {
  let output = String(html || "").replace(
    "Human-curated video discovery",
    "Curated video discovery",
  );

  const scriptPattern = /\s*<script type="application\/ld\+json" nonce="([^"]*)">([\s\S]*?)<\/script>/i;
  const scriptMatch = output.match(scriptPattern);
  if (!scriptMatch) return output;

  const usesFallbackThumbnail = /<meta property="og:image" content="[^"]*\/favicon\.svg(?:\?[^"]*)?">/i.test(output);
  if (usesFallbackThumbnail) {
    // A site icon is not a genuine video thumbnail. Keep the page indexable,
    // but omit VideoObject markup until a real video thumbnail is supplied.
    return output.replace(scriptPattern, "");
  }

  let schema;
  try {
    schema = JSON.parse(scriptMatch[2]);
  } catch {
    return output.replace(scriptPattern, "");
  }

  if (isExternalEmbed(schema.embedUrl)) {
    // The core Worker only knows when the D1 record was created. Google defines
    // uploadDate as when the video itself was first published, so external
    // embeds only keep VideoObject markup when that source date was verified.
    if (!sourceMetadata?.source_published_at) return output.replace(scriptPattern, "");
    schema.uploadDate = sourceMetadata.source_published_at;
    if (sourceMetadata.source_duration) schema.duration = sourceMetadata.source_duration;
  }

  const safeJson = JSON.stringify(schema).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
  const replacement = `\n  <script type="application/ld+json" nonce="${scriptMatch[1]}">${safeJson}</script>`;
  return output.replace(scriptPattern, replacement);
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

function isVideoMutation(url, method) {
  if (method === "POST" && url.pathname === "/api/videos") return true;
  return method === "PATCH" && /^\/api\/videos\/\d+$/.test(url.pathname);
}

function extractYoutubeId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = null;
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0];
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function refreshSourceMetadata(videoId, sourceUrl, env) {
  if (!Number.isSafeInteger(Number(videoId)) || Number(videoId) < 1) return;
  const youtubeId = extractYoutubeId(sourceUrl);
  if (!youtubeId || !env.YOUTUBE_API_KEY) {
    await env.DB.prepare("DELETE FROM video_source_metadata WHERE video_id = ?")
      .bind(videoId).run();
    return;
  }

  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    id: youtubeId,
    key: env.YOUTUBE_API_KEY,
  });
  let response;
  try {
    response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error("YouTube metadata request failed", error?.name || "unknown");
    return;
  }
  if (!response.ok) {
    console.error("YouTube metadata request returned", response.status);
    return;
  }

  const payload = await response.json();
  const item = payload.items?.[0];
  const publishedAt = String(item?.snippet?.publishedAt || "").trim();
  const duration = String(item?.contentDetails?.duration || "").trim();
  if (!publishedAt) return;

  await env.DB.prepare(
    `INSERT INTO video_source_metadata (video_id, source_published_at, source_duration, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(video_id) DO UPDATE SET
       source_published_at = excluded.source_published_at,
       source_duration = excluded.source_duration,
       updated_at = excluded.updated_at`,
  ).bind(videoId, publishedAt, duration || null).run();
}

async function loadSourceMetadata(html, env) {
  const id = Number(html.match(/<body[^>]*data-video-id="(\d+)"/i)?.[1] || 0);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  try {
    return await env.DB.prepare(
      "SELECT source_published_at, source_duration FROM video_source_metadata WHERE video_id = ?",
    ).bind(id).first();
  } catch (error) {
    // A manual deployment may briefly run before the newest migration. In that
    // case the page remains available and external VideoObject markup is omitted.
    console.error("Source metadata lookup unavailable", error?.message || error);
    return null;
  }
}

async function fetchHandler(request, env, ctx) {
  let url = new URL(request.url);

  if (url.pathname === "/api/admin/session" && request.method === "DELETE" && !sameOriginMutationAllowed(request)) {
    return jsonError(403, "Cross-origin request rejected");
  }

  if (url.pathname === "/api/videos" && request.method === "POST") {
    request = await defaultNewVideoToDraft(request);
    url = new URL(request.url);
  }

  const videoMutation = isVideoMutation(url, request.method);
  const mutationPayloadPromise = videoMutation
    ? request.clone().json().catch(() => null)
    : Promise.resolve(null);

  const crawlerWatchRequest = request.method === "GET"
    && url.pathname.startsWith("/watch/")
    && isLikelyCrawler(request);
  const delegatedContext = crawlerWatchRequest ? { waitUntil() {} } : ctx;
  const response = await app.fetch(request, env, delegatedContext);

  if (videoMutation && response.ok) {
    const [mutationPayload, responsePayload] = await Promise.all([
      mutationPayloadPromise,
      response.clone().json().catch(() => null),
    ]);
    const videoId = Number(responsePayload?.video?.id || 0);
    if (videoId > 0 && mutationPayload?.source_url) {
      const work = refreshSourceMetadata(videoId, mutationPayload.source_url, env)
        .catch((error) => console.error("Source metadata enrichment failed", error?.message || error));
      if (ctx?.waitUntil) ctx.waitUntil(work);
      else await work;
    }
  }

  if (request.method === "GET" && url.pathname.startsWith("/watch/") && response.ok) {
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("text/html")) {
      const rawHtml = await response.text();
      const sourceMetadata = await loadSourceMetadata(rawHtml, env);
      const html = sanitizeWatchHtml(rawHtml, sourceMetadata);
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=3600");
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
