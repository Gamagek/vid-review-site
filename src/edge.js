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
const COMMENT_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const COMMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const LAB_REVIEW_ROUTE = "/lab-media/lab-review-1.mp4";
const LAB_REVIEW_KEY = "Lab review 1.mp4";
const textEncoder = new TextEncoder();

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
    return output.replace(scriptPattern, "");
  }

  let schema;
  try {
    schema = JSON.parse(scriptMatch[2]);
  } catch {
    return output.replace(scriptPattern, "");
  }

  if (isExternalEmbed(schema.embedUrl)) {
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

function responseHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...extra,
  };
}

function jsonResponse(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(extra),
  });
}

function jsonError(status, message, extra = {}) {
  return jsonResponse({ success: false, error: message }, status, extra);
}

function cleanText(value, maximum, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function cleanLongText(value, maximum, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(String(value))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function publicFingerprint(request, env) {
  const salt = String(env.REACTION_SALT || "");
  if (salt.length < 16) return null;
  return sha256Hex([
    salt,
    request.headers.get("CF-Connecting-IP") || "unknown",
    request.headers.get("User-Agent") || "unknown",
  ].join("|"));
}

async function consumePublicRateLimit(request, env, scope, limit, windowSeconds) {
  const fingerprint = await publicFingerprint(request, env);
  if (!fingerprint) return jsonError(503, "Rate-limit secret is not configured");
  const windowStartedAt = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (scope, fingerprint, window_started_at, request_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(scope, fingerprint) DO UPDATE SET
       request_count = CASE
         WHEN rate_limits.window_started_at < excluded.window_started_at THEN 1
         ELSE rate_limits.request_count + 1
       END,
       window_started_at = MAX(rate_limits.window_started_at, excluded.window_started_at)
     RETURNING request_count`,
  ).bind(scope, fingerprint, windowStartedAt).first();
  if (Number(row?.request_count || 0) > limit) {
    return jsonError(429, "Too many requests. Please wait and try again.", { "Retry-After": String(windowSeconds) });
  }
  return null;
}

function commentImageExtension(contentType) {
  return {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[contentType] || "img";
}

async function submitMultipartComment(request, env, videoId) {
  const video = await env.DB.prepare("SELECT id FROM videos WHERE id = ? AND published = 1").bind(videoId).first();
  if (!video) return jsonError(404, "Video not found");

  const statedLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(statedLength) && statedLength > COMMENT_IMAGE_MAX_BYTES + 512_000) {
    return jsonError(413, "Comment image must be 5 MB or smaller");
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Invalid comment form");
  }

  if (cleanText(form.get("website"), 200)) {
    return jsonResponse({ success: true, status: "pending" }, 202);
  }

  const rateLimited = await consumePublicRateLimit(request, env, "comment", 5, 600);
  if (rateLimited) return rateLimited;

  const author = cleanText(form.get("author"), 50, "Guest") || "Guest";
  const body = cleanLongText(form.get("body"), 800);
  if (body.length < 2) return jsonError(400, "Comment is too short");

  const image = form.get("image");
  const hasImage = image && typeof image === "object" && Number(image.size || 0) > 0;
  if (hasImage) {
    const contentType = cleanText(image.type, 100).toLowerCase();
    if (!COMMENT_IMAGE_TYPES.has(contentType)) return jsonError(415, "Comment image must be PNG, JPEG, WebP, AVIF or GIF");
    if (Number(image.size) > COMMENT_IMAGE_MAX_BYTES) return jsonError(413, "Comment image must be 5 MB or smaller");
  }

  const inserted = await env.DB.prepare(
    "INSERT INTO comments (video_id, author, body, status, image_key) VALUES (?, ?, ?, 'pending', NULL) RETURNING id",
  ).bind(videoId, author, body).first();
  const commentId = Number(inserted?.id || 0);
  if (!commentId) return jsonError(500, "Unable to save comment");

  if (hasImage) {
    const contentType = cleanText(image.type, 100).toLowerCase();
    const date = new Date().toISOString().slice(0, 10);
    const key = `comment-images/${date}/${commentId}-${crypto.randomUUID()}.${commentImageExtension(contentType)}`;
    try {
      await env.BUCKET.put(key, image.stream(), {
        httpMetadata: {
          contentType,
          cacheControl: "private, max-age=0, no-store",
          contentDisposition: "inline",
        },
      });
      await env.DB.prepare("UPDATE comments SET image_key = ? WHERE id = ?").bind(key, commentId).run();
    } catch (error) {
      await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(commentId).run();
      console.error("Comment image upload failed", error?.message || error);
      return jsonError(500, "Unable to save comment image");
    }
  }

  return jsonResponse({
    success: true,
    status: "pending",
    message: "Comment submitted for moderation",
  }, 202);
}

async function listPublicCommentsWithImages(env, videoId) {
  const result = await env.DB.prepare(
    "SELECT id, author, body, image_key, created_at FROM comments WHERE video_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 50",
  ).bind(videoId).all();
  return jsonResponse({
    comments: (result.results || []).map((comment) => ({
      id: comment.id,
      author: comment.author,
      body: comment.body,
      created_at: comment.created_at,
      image_url: comment.image_key ? `/comment-media/${comment.id}` : null,
    })),
  }, 200, { "Cache-Control": "public, max-age=30" });
}

async function validateAdminRead(request, env, ctx) {
  const url = new URL("/api/admin/videos?limit=1", request.url);
  const probe = new Request(url, {
    method: "GET",
    headers: request.headers,
  });
  return app.fetch(probe, env, ctx);
}

async function listAdminCommentsWithImages(request, env, ctx) {
  const auth = await validateAdminRead(request, env, ctx);
  if (!auth.ok) return auth;
  const url = new URL(request.url);
  const status = cleanText(url.searchParams.get("status"), 20, "pending");
  if (!new Set(["pending", "approved", "rejected"]).has(status)) return jsonError(400, "Unknown comment status");
  const result = await env.DB.prepare(
    `SELECT c.id, c.video_id, c.author, c.body, c.status, c.image_key, c.created_at, v.title AS video_title
     FROM comments c JOIN videos v ON v.id = c.video_id
     WHERE c.status = ? ORDER BY c.created_at ASC LIMIT 100`,
  ).bind(status).all();
  return jsonResponse({
    comments: (result.results || []).map((comment) => ({
      ...comment,
      image_url: comment.image_key ? `/api/admin/comments/${comment.id}/image` : null,
      image_key: undefined,
    })),
  });
}

async function serveBucketObject(request, bucket, key, allowedTypes, fallbackContentType = "") {
  if (!bucket) return jsonError(503, "Media bucket binding is unavailable");

  if (request.method === "HEAD") {
    const object = await bucket.head(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    let contentType = (headers.get("Content-Type") || fallbackContentType).split(";", 1)[0].trim().toLowerCase();
    if (!allowedTypes.has(contentType)) return new Response("Not found", { status: 404 });
    headers.set("Content-Type", contentType);
    headers.set("ETag", object.httpEtag);
    headers.set("Content-Length", String(object.size));
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(null, { headers });
  }

  const hasRange = request.headers.has("Range");
  const object = await bucket.get(key, hasRange ? { range: request.headers } : {});
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  let contentType = (headers.get("Content-Type") || fallbackContentType).split(";", 1)[0].trim().toLowerCase();
  if (!allowedTypes.has(contentType)) return new Response("Not found", { status: 404 });
  headers.set("Content-Type", contentType);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "public, max-age=86400");
  let status = 200;
  if (object.range) {
    const offset = object.range.offset ?? Math.max(0, object.size - (object.range.suffix || object.range.length || 0));
    const length = object.range.length ?? object.range.suffix ?? object.size;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    status = 206;
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(object.body, { status, headers });
}

async function serveCommentImage(request, env, ctx, commentId, administrator = false) {
  if (administrator) {
    const auth = await validateAdminRead(request, env, ctx);
    if (!auth.ok) return auth;
  }
  const comment = await env.DB.prepare(
    "SELECT image_key, status FROM comments WHERE id = ?",
  ).bind(commentId).first();
  if (!comment?.image_key) return new Response("Not found", { status: 404 });
  if (!administrator && comment.status !== "approved") return new Response("Not found", { status: 404 });
  return serveBucketObject(request, env.BUCKET, comment.image_key, COMMENT_IMAGE_TYPES);
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
    console.error("Source metadata lookup unavailable", error?.message || error);
    return null;
  }
}

async function handleCustomEdgeRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === LAB_REVIEW_ROUTE && ["GET", "HEAD"].includes(request.method)) {
    return serveBucketObject(request, env.LAB_MEDIA, LAB_REVIEW_KEY, new Set(["video/mp4"]), "video/mp4");
  }

  let match = path.match(/^\/comment-media\/(\d+)$/);
  if (match && ["GET", "HEAD"].includes(request.method)) {
    return serveCommentImage(request, env, ctx, Number(match[1]), false);
  }

  match = path.match(/^\/api\/admin\/comments\/(\d+)\/image$/);
  if (match && ["GET", "HEAD"].includes(request.method)) {
    return serveCommentImage(request, env, ctx, Number(match[1]), true);
  }

  match = path.match(/^\/api\/videos\/(\d+)\/comments$/);
  if (match && request.method === "GET") {
    return listPublicCommentsWithImages(env, Number(match[1]));
  }
  if (match && request.method === "POST" && (request.headers.get("Content-Type") || "").includes("multipart/form-data")) {
    return submitMultipartComment(request, env, Number(match[1]));
  }

  if (path === "/api/admin/comments" && request.method === "GET") {
    return listAdminCommentsWithImages(request, env, ctx);
  }

  return null;
}

async function fetchHandler(request, env, ctx) {
  try {
    const custom = await handleCustomEdgeRoutes(request, env, ctx);
    if (custom) return custom;
  } catch (error) {
    console.error("Custom edge route failed", error?.stack || error);
    return jsonError(500, "Internal server error");
  }

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

  const rejectedCommentMatch = url.pathname.match(/^\/api\/admin\/comments\/(\d+)$/);
  const moderationPayloadPromise = rejectedCommentMatch && request.method === "PATCH"
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

  if (rejectedCommentMatch && request.method === "PATCH" && response.ok) {
    const moderationPayload = await moderationPayloadPromise;
    if (moderationPayload?.status === "rejected") {
      const commentId = Number(rejectedCommentMatch[1]);
      const comment = await env.DB.prepare("SELECT image_key FROM comments WHERE id = ?").bind(commentId).first();
      if (comment?.image_key) {
        const cleanup = Promise.all([
          env.BUCKET.delete(comment.image_key),
          env.DB.prepare("UPDATE comments SET image_key = NULL WHERE id = ?").bind(commentId).run(),
        ]).catch((error) => console.error("Rejected comment image cleanup failed", error?.message || error));
        if (ctx?.waitUntil) ctx.waitUntil(cleanup);
        else await cleanup;
      }
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
      headers.set("Cache-Control", "public, max-age=60");
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
