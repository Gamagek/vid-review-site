const CATEGORIES = Object.freeze({
  "Entertainment, Movies & Games": [
    "Movie Trailers",
    "Film Reviews",
    "Gameplay & Let's Plays",
    "Esports",
    "Anime & Animation",
    "Pop Culture",
  ],
  "Lifestyle, Health & Fitness": [
    "Workout Routines",
    "Nutrition & Diet",
    "Mental Health",
    "Mindfulness & Yoga",
    "Daily Vlogs",
    "Fashion & Style",
  ],
  "Environment & Sustainability": [
    "Renewable Energy",
    "Electric Vehicles & E-Bikes",
    "Wildlife & Conservation",
    "Zero Waste Living",
    "Eco-Tech",
  ],
  Technology: [
    "AI & Machine Learning",
    "Gadget Reviews",
    "Software & Coding",
    "Web Development",
    "Cybersecurity",
    "Tech News",
  ],
  "Food & Cooking": [
    "Quick Recipes",
    "Street Food",
    "Baking & Pastry",
    "Restaurant Reviews",
    "Healthy Meals",
    "Chef Secrets",
  ],
  Education: [
    "Tutorials & How-Tos",
    "Science & History",
    "Language Learning",
    "Online Courses",
    "Academic Lectures",
    "Buddhist Studies & Philosophy",
  ],
  "Funny & Comedy": [
    "Skits & Sketches",
    "Stand-Up Comedy",
    "Pranks",
    "Memes & Compilation",
    "Bloopers",
  ],
  Music: [
    "Music Videos",
    "Live Performances",
    "Instrument Tutorials",
    "Cover Songs",
    "Lo-Fi & Relaxation",
  ],
  "Arts & Culture": [
    "Digital Art & Design",
    "Painting & Drawing",
    "Architecture",
    "Photography",
    "Literature & Book Reviews",
  ],
  "Adventure & Travel": [
    "Solo Travel",
    "Camping & Hiking",
    "Extreme Sports",
    "Travel Guides",
    "Road Trips",
  ],
  "Business & Economy": [
    "Startups & Entrepreneurship",
    "Personal Finance & Investing",
    "E-Commerce & Marketing",
    "Crypto & Web3",
    "Economy News",
  ],
  "Social Media & Trending": [
    "YouTube Trends",
    "TikTok Viral Challenges",
    "Facebook Reels Highlights",
    "Instagram Reels",
    "Creator News & Drama",
  ],
  Spirituality: [
    "Buddhism",
    "Hinduism",
    "Christianity",
    "Islam",
    "Meditation & Mindfulness",
    "Spiritual Philosophy",
    "Sacred Texts & Teachings",
    "Devotional Practices",
    "Contemplative Traditions",
    "Interfaith & Comparative Spirituality",
  ],
  Other: [
    "Other",
  ],
});

const REACTIONS = new Set(["like", "love", "useful"]);
const COMMENT_STATUSES = new Set(["pending", "approved", "rejected"]);
const DISCOVERY_STATUSES = new Set(["pending", "resolved", "rejected"]);
const SAFE_UPLOAD_TYPES = new Set([
  "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/ogg", "video/quicktime", "video/webm",
  "application/vnd.apple.mpegurl", "application/x-mpegurl",
  "video/mp2t", "video/iso.segment", "audio/aac", "audio/mp4",
]);
const encoder = new TextEncoder();
const ADMIN_SESSION_COOKIE = "__Host-vidbest_admin";
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
const REACTION_SALT_SETTING = "reaction_salt";

class AppError extends Error {
  constructor(status, message, details, headers = {}) {
    super(message);
    this.status = status;
    this.details = details;
    this.headers = headers;
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      return handleError(error);
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: securityHeaders(new Headers()),
    });
  }

  if (path === "/api/health" && request.method === "GET") {
    return json({ status: "ok", service: env.APP_NAME || "Vid.Best" });
  }

  if (path === "/api/categories" && request.method === "GET") {
    return json({ categories: CATEGORIES }, 200, { "Cache-Control": "no-store, max-age=0" });
  }

  if (path === "/api/discovery-requests" && request.method === "POST") {
    return requestDiscovery(request, env);
  }

  if (path === "/api/tiktok/thumbnail" && request.method === "GET") {
    return tikTokThumbnail(request, env, ctx);
  }
  if (path === "/api/tiktok/preflight" && request.method === "GET") {
    return tikTokPreflight(request, env, ctx);
  }
  if (path === "/api/admin/tiktok/cache" && request.method === "POST") {
    await requireAdmin(request, env);
    return cacheTikTokVideos(request, env);
  }

  if (path === "/robots.txt" && request.method === "GET") {
    return robotsResponse(request, env);
  }

  if (path === "/sitemap.xml" && request.method === "GET") {
    return sitemapIndexResponse(request, env);
  }

  let match = path.match(/^\/sitemaps\/videos-(\d+)\.xml$/);
  if (match && request.method === "GET") {
    return videoSitemapResponse(request, env, Number(match[1]));
  }

  if (path.startsWith("/watch/") && request.method === "GET") {
    return watchPage(request, env, ctx, path.slice("/watch/".length));
  }

  if (path.startsWith("/media/") && ["GET", "HEAD"].includes(request.method)) {
    return serveR2Object(request, env, path.slice("/media/".length));
  }

  if (path.startsWith("/captions/") && path.endsWith(".vtt") && request.method === "GET") {
    return serveCaptions(env, safeDecode(path.slice("/captions/".length, -4)));
  }

  if (path === "/api/videos") {
    if (request.method === "GET") return listVideos(request, env, false);
    if (request.method === "POST") {
      await requireAdmin(request, env);
      return createVideo(request, env);
    }
  }

  match = path.match(/^\/api\/videos\/(\d+)\/reactions$/);
  if (match && request.method === "POST") {
    return toggleReaction(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)\/recommendations$/);
  if (match && request.method === "GET") {
    return recommendVideos(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)\/interest$/);
  if (match && request.method === "POST") {
    return recordVideoInterest(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)\/comments$/);
  if (match) {
    if (request.method === "GET") return listComments(env, Number(match[1]));
    if (request.method === "POST") return submitComment(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)$/);
  if (match && ["PATCH", "DELETE"].includes(request.method)) {
    await requireAdmin(request, env);
    if (request.method === "PATCH") return updateVideo(request, env, Number(match[1]));
    if (request.method === "DELETE") return deleteVideo(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/([^/]+)$/);
  if (match && request.method === "GET") {
    return getPublicVideo(env, safeDecode(match[1]));
  }

  if (path === "/api/admin/session" && request.method === "POST") {
    const fingerprint = await assertLoginAllowed(request, env);
    let authentication;
    try {
      authentication = await requireAdmin(request, env);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        await recordRateLimit(env, "admin-login", fingerprint, 5, 900, false);
      }
      throw error;
    }
    await clearRateLimit(env, "admin-login", fingerprint);
    const response = json({ success: true });
    if (authentication === "bearer") response.headers.append("Set-Cookie", await createAdminSessionCookie(env));
    return response;
  }

  if (path === "/api/admin/session" && request.method === "DELETE") {
    const response = json({ success: true });
    response.headers.append("Set-Cookie", clearAdminSessionCookie());
    return response;
  }

  if (path === "/api/admin/videos" && request.method === "GET") {
    await requireAdmin(request, env);
    return listVideos(request, env, true);
  }

  if (path === "/api/admin/discover" && request.method === "GET") {
    await requireAdmin(request, env);
    return discoverVideos(request, env);
  }

  if (path === "/api/admin/discovery-requests" && request.method === "GET") {
    await requireAdmin(request, env);
    return listDiscoveryRequests(request, env);
  }

  match = path.match(/^\/api\/admin\/discovery-requests\/(\d+)$/);
  if (match && request.method === "PATCH") {
    await requireAdmin(request, env);
    return updateDiscoveryRequest(request, env, Number(match[1]));
  }

  if (path === "/api/admin/comments" && request.method === "GET") {
    await requireAdmin(request, env);
    return listAdminComments(request, env);
  }

  match = path.match(/^\/api\/admin\/comments\/(\d+)$/);
  if (match && request.method === "PATCH") {
    await requireAdmin(request, env);
    return moderateComment(request, env, Number(match[1]));
  }

  if (path === "/api/ai/generate" && request.method === "POST") {
    await requireAdmin(request, env);
    return generateAiCopy(request, env);
  }

  if (path === "/api/ai/analyze-media" && request.method === "POST") {
    await requireAdmin(request, env);
    return startMediaAnalysis(request, env);
  }

  match = path.match(/^\/api\/ai\/analyze-media\/([0-9a-f]{32})$/);
  if (match && request.method === "GET") {
    await requireAdmin(request, env);
    return getMediaAnalysis(env, match[1]);
  }

  match = path.match(/^\/api\/admin\/videos\/(\d+)\/analysis$/);
  if (match && ["GET", "PUT"].includes(request.method)) {
    await requireAdmin(request, env);
    if (request.method === "GET") return getStoredVideoAnalysis(env, Number(match[1]));
    return storeVideoAnalysis(request, env, Number(match[1]));
  }

  if (path === "/api/assets") {
    await requireAdmin(request, env);
    if (request.method === "GET") return listAssets(request, env);
    if (request.method === "PUT") return uploadAsset(request, env);
  }

  match = path.match(/^\/api\/assets\/(.+)$/);
  if (match && request.method === "DELETE") {
    await requireAdmin(request, env);
    return deleteAsset(env, safeDecode(match[1]));
  }

  if (path.startsWith("/api/")) {
    throw new AppError(404, "API route not found");
  }

  const assetResponse = await env.ASSETS.fetch(request);
  return secureAssetResponse(assetResponse, path);
}

async function tikTokPreflight(request, env, ctx) {
  const requested = cleanText(new URL(request.url).searchParams.get("url"), 2000);
  const share = normalizeTikTokShareUrl(requested);
  if (!share) throw new AppError(400, "Use a normal TikTok sharing link");
  const requestUrl = new URL(request.url);
  const cacheKey = new Request(requestUrl.origin + "/__vidbest-tiktok-preflight?url=" + encodeURIComponent(share));
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    const preview = await fetchAndStoreTikTokPreview(env, share);
    const videoId = share.match(/\/video\/(\d+)\/?$/)?.[1] || null;
    const result = json({
      ok: true,
      provider: "tiktok",
      video_id: videoId,
      title: preview.metadata.title,
      author_name: preview.metadata.author_name,
      thumbnail_url: buildTikTokThumbnailProxyUrl(share),
      official_player: true,
      standard_embed: true,
      cached: false,
    }, 200, { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800" });
    if (cache) await cache.put(cacheKey, result.clone());
    return result;
  } catch (error) {
    return tikTokPreflightFallback(requestUrl, cache, cacheKey, env, share, error);
  }
}

async function tikTokThumbnail(request, env, ctx) {
  const requested = cleanText(new URL(request.url).searchParams.get("url"), 2000);
  const share = normalizeTikTokShareUrl(requested);
  if (!share) throw new AppError(400, "Use a normal TikTok sharing link");

  const requestUrl = new URL(request.url);
  const cacheKey = new Request(
    `${requestUrl.origin}/__vidbest-tiktok-thumbnail?url=${encodeURIComponent(share)}`,
  );
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    const preview = await fetchAndStoreTikTokPreview(env, share);
    const headers = securityHeaders(new Headers(preview.imageResponse.headers));
    headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800");
    headers.set("X-VidBest-TikTok-Cache", "live-r2-snapshot");
    if (!headers.has("Content-Type")) headers.set("Content-Type", "image/jpeg");
    const response = new Response(preview.imageResponse.body, { status: 200, headers });
    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const fallback = await getTikTokPersistentThumbnail(env, share);
    if (fallback) {
      const headers = new Headers();
      fallback.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800");
      headers.set("X-VidBest-TikTok-Cache", "r2-stale");
      headers.set("X-Content-Type-Options", "nosniff");
      const response = new Response(fallback.body, { status: 200, headers });
      if (cache) await cache.put(cacheKey, response.clone());
      return response;
    }
    throw error;
  }
}

async function fetchAndStoreTikTokPreview(env, share) {
  if (!env.BUCKET) throw new AppError(503, "TikTok persistent cache is not configured");

  const metadataUrl = new URL("https://www.tiktok.com/oembed");
  metadataUrl.searchParams.set("url", share);
  const metadataResponse = await fetch(metadataUrl.toString(), {
    headers: { Accept: "application/json", "User-Agent": "VidBest/1.0 (+https://vid.best/)" },
    signal: AbortSignal.timeout(7000),
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": 86400, "400-499": 60, "500-599": 10 },
    },
  });
  if (!metadataResponse.ok) throw new AppError(502, `TikTok preview metadata returned HTTP ${metadataResponse.status}`);

  let metadata;
  try { metadata = await metadataResponse.json(); } catch { metadata = null; }
  const videoId = share.match(/\/video\/(\d+)\/?$/)?.[1] || null;
  if (!videoId || String(metadata?.type || "") !== "video") {
    throw new AppError(502, "TikTok did not return an embeddable video preview");
  }

  const thumbnailUrl = String(metadata?.thumbnail_url || "");
  let thumbnail;
  try {
    const parsedThumbnail = new URL(thumbnailUrl);
    const host = parsedThumbnail.hostname.toLowerCase();
    const allowed = /^([a-z0-9-]+\.)*tiktokcdn(?:-[a-z0-9-]+)?\.com$/.test(host)
      || host === "muscdn.com"
      || host.endsWith(".muscdn.com");
    if (!allowed || parsedThumbnail.protocol !== "https:") throw new Error("Unsupported TikTok thumbnail host");
    thumbnail = parsedThumbnail;
  } catch {
    throw new AppError(502, "TikTok did not provide a usable preview image");
  }

  const imageResponse = await fetch(thumbnail.toString(), {
    headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(7000),
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": 86400, "400-499": 60, "500-599": 10 },
    },
  });
  if (!imageResponse.ok) throw new AppError(502, `TikTok preview image returned HTTP ${imageResponse.status}`);

  const cachedMetadata = {
    title: cleanText(metadata?.title, 160, "TikTok video"),
    author_name: cleanText(metadata?.author_name, 120),
    thumbnail_url: buildTikTokThumbnailProxyUrl(share),
    video_id: videoId,
    canonical_url: share,
    cached_at: new Date().toISOString(),
  };
  const { metadataKey, thumbnailKey } = await tikTokCacheKeys(share);

  await Promise.all([
    env.BUCKET.put(metadataKey, JSON.stringify(cachedMetadata), {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "public, max-age=86400",
      },
      customMetadata: { provider: "tiktok", kind: "oembed-cache", canonicalUrl: share },
    }),
    env.BUCKET.put(thumbnailKey, imageResponse.clone().body, {
      httpMetadata: {
        contentType: imageResponse.headers.get("Content-Type") || "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
        contentDisposition: "inline",
      },
      customMetadata: { provider: "tiktok", kind: "thumbnail-cache", canonicalUrl: share },
    }),
  ]);

  return { metadata: cachedMetadata, imageResponse };
}

async function tikTokCacheKeys(share) {
  const hash = await sha256Hex(share);
  return {
    metadataKey: `uploads/tiktok-cache/${hash}.json`,
    thumbnailKey: `uploads/tiktok-cache/${hash}.image`,
  };
}

async function getTikTokPersistentCache(env, share) {
  if (!env.BUCKET) return null;
  const { metadataKey } = await tikTokCacheKeys(share);
  const object = await env.BUCKET.get(metadataKey);
  if (!object) return null;
  try {
    return JSON.parse(await new Response(object.body).text());
  } catch {
    return null;
  }
}

async function getTikTokPersistentThumbnail(env, share) {
  if (!env.BUCKET) return null;
  const { thumbnailKey } = await tikTokCacheKeys(share);
  return env.BUCKET.get(thumbnailKey);
}

async function tikTokPreflightFallback(requestUrl, cache, cacheKey, env, share, error) {
  const cached = await getTikTokPersistentCache(env, share);
  if (cached?.video_id) {
    const result = json({
      ok: true,
      provider: "tiktok",
      video_id: cached.video_id,
      title: cached.title || "TikTok video",
      author_name: cached.author_name || "",
      thumbnail_url: cached.thumbnail_url || buildTikTokThumbnailProxyUrl(share),
      official_player: true,
      standard_embed: true,
      cached: true,
    }, 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600, stale-if-error=604800",
      "X-VidBest-TikTok-Cache": "r2-stale",
    });
    if (cache) await cache.put(cacheKey, result.clone());
    return result;
  }

  const reason = error instanceof AppError
    ? error.message.replace(/^TikTok preview /i, "").slice(0, 120)
    : "upstream-timeout-or-network";
  const failed = json({ ok: false, provider: "tiktok", reason }, 200, {
    "Cache-Control": "public, max-age=10, stale-while-revalidate=30",
  });
  if (cache) await cache.put(cacheKey, failed.clone());
  return failed;
}

async function cacheTikTokVideos(request, env) {
  const url = new URL(request.url);
  const limit = clampInteger(url.searchParams.get("limit"), 1, 2, 2);
  const offset = clampInteger(url.searchParams.get("offset"), 0, 1000000, 0);
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM videos
     WHERE published = 1
       AND (media_type = 'tiktok'
         OR lower(source_url) LIKE 'https://www.tiktok.com/@%/video/%')`,
  ).first();
  const total = Number(totalRow?.total || 0);
  const rows = await env.DB.prepare(
    `SELECT id, source_url
     FROM videos
     WHERE published = 1
       AND (media_type = 'tiktok'
         OR lower(source_url) LIKE 'https://www.tiktok.com/@%/video/%')
     ORDER BY id ASC
     LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all();

  const failures = [];
  let cached = 0;
  const batch = rows.results || [];
  const outcomes = await Promise.all(batch.map(async (row) => {
    const share = normalizeTikTokShareUrl(row.source_url);
    if (!share) return { id: row.id, ok: false, reason: "invalid-tiktok-url" };
    try {
      await fetchAndStoreTikTokPreview(env, share);
      return { id: row.id, ok: true };
    } catch (error) {
      return { id: row.id, ok: false, reason: cleanText(error?.message || "cache-failed", 160) };
    }
  }));
  for (const outcome of outcomes) {
    if (outcome.ok) cached += 1;
    else failures.push({ id: outcome.id, reason: outcome.reason });
  }

  const nextOffset = offset + (rows.results || []).length;
  return json({
    success: true,
    total,
    offset,
    processed: (rows.results || []).length,
    cached,
    failed: failures,
    next_offset: nextOffset,
    complete: nextOffset >= total,
  });
}

function handleError(error) {
  if (error instanceof AppError) {
    return json(
      { success: false, error: error.message, ...(error.details ? { details: error.details } : {}) },
      error.status,
      error.headers,
    );
  }
  if (error?.name === "AbortError" || error?.name === "TimeoutError") {
    return json({ success: false, error: "An upstream service timed out" }, 504);
  }
  console.error("Unhandled Worker error", error?.stack || error);
  return json({ success: false, error: "Internal server error" }, 500);
}

function json(payload, status = 200, extraHeaders = {}) {
  const headers = securityHeaders(new Headers(extraHeaders));
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers });
}

function securityHeaders(headers, html = false, scriptNonce = "") {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (html) {
    const nonceSource = scriptNonce ? ` 'nonce-${scriptNonce}'` : "";
    headers.set(
      "Content-Security-Policy",
      `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self'${nonceSource} https://www.tiktok.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self' https://www.tiktok.com https://*.tiktok.com https://*.tiktokcdn.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.tiktok.com https://*.tiktok.com https://www.facebook.com https://player.vimeo.com https://www.dailymotion.com https://player.twitch.tv https://clips.twitch.tv https://www.instagram.com; upgrade-insecure-requests`,
    );
  }
  return headers;
}

function secureAssetResponse(response, path) {
  const headers = securityHeaders(new Headers(response.headers), isHtmlResponse(response));
  if (path === "/admin" || path === "/admin.html") {
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isHtmlResponse(response) {
  return (response.headers.get("Content-Type") || "").includes("text/html");
}

async function readJson(request, maxBytes = 65536) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    throw new AppError(415, "Content-Type must be application/json");
  }
  const statedLength = Number(request.headers.get("Content-Length") || 0);
  if (statedLength > maxBytes) throw new AppError(413, "Request body is too large");
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) throw new AppError(413, "Request body is too large");
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError(400, "JSON body must be an object");
    }
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Invalid JSON body");
  }
}

async function requireAdmin(request, env) {
  const expected = String(env.ADMIN_SECRET_KEY || "");
  if (expected.length < 16) {
    throw new AppError(503, "ADMIN_SECRET_KEY is missing or too short");
  }
  const authorization = request.headers.get("Authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (supplied && await secureEqual(supplied, expected)) return "bearer";
  const cookie = readCookie(request, ADMIN_SESSION_COOKIE);
  if (cookie && await verifyAdminSession(cookie, expected)) {
    requireSameOrigin(request);
    return "session";
  }
  throw new AppError(401, "Invalid or expired administrator credentials");
}

function requireSameOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) throw new AppError(403, "Cross-origin request rejected");
}

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

async function createAdminSessionCookie(env) {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const payload = `${expires}.${crypto.randomUUID()}`;
  const signature = await hmacHex(String(env.ADMIN_SECRET_KEY), payload);
  return `${ADMIN_SESSION_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${ADMIN_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function clearAdminSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

async function verifyAdminSession(value, secret) {
  const match = String(value).match(/^(\d{10})\.([0-9a-f-]{36})\.([0-9a-f]{64})$/);
  if (!match || Number(match[1]) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(secret, `${match[1]}.${match[2]}`);
  return secureEqual(match[3], expected);
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secureEqual(a, b) {
  const [hashA, hashB] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let difference = 0;
  for (let index = 0; index < hashA.length; index += 1) difference |= hashA[index] ^ hashB[index];
  return difference === 0;
}

async function requestFingerprint(request, secret) {
  const salt = String(secret || "");
  if (salt.length < 16) throw new AppError(503, "Rate-limit secret is not configured");
  return sha256Hex([
    salt,
    request.headers.get("CF-Connecting-IP") || "unknown",
    request.headers.get("User-Agent") || "unknown",
  ].join("|"));
}

export async function resolveReactionSalt(env) {
  const configured = String(env.REACTION_SALT || "");
  if (configured.length >= 16) return configured;
  if (!env.DB) throw new AppError(503, "Rate-limit storage is not configured");

  const existing = await env.DB.prepare(
    "SELECT setting_value FROM app_settings WHERE setting_key = ?",
  ).bind(REACTION_SALT_SETTING).first();
  if (String(existing?.setting_value || "").length >= 16) return existing.setting_value;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const generated = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    `INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)`,
  ).bind(REACTION_SALT_SETTING, generated).run();
  const stored = await env.DB.prepare(
    "SELECT setting_value FROM app_settings WHERE setting_key = ?",
  ).bind(REACTION_SALT_SETTING).first();
  if (String(stored?.setting_value || "").length < 16) {
    throw new AppError(503, "Rate-limit secret could not be initialized");
  }
  return stored.setting_value;
}

function rateLimitError(windowSeconds) {
  return new AppError(
    429,
    "Too many requests. Please wait and try again.",
    undefined,
    { "Retry-After": String(windowSeconds) },
  );
}

async function recordRateLimit(env, scope, fingerprint, limit, windowSeconds, rejectExceeded = true) {
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
  if (rejectExceeded && Number(row?.request_count || 0) > limit) throw rateLimitError(windowSeconds);
  return Number(row?.request_count || 0);
}

async function consumeRateLimit(request, env, scope, limit, windowSeconds) {
  const fingerprint = await requestFingerprint(request, await resolveReactionSalt(env));
  await recordRateLimit(env, scope, fingerprint, limit, windowSeconds);
  return fingerprint;
}

async function assertLoginAllowed(request, env) {
  const fingerprint = await requestFingerprint(request, await resolveReactionSalt(env));
  const windowSeconds = 900;
  const windowStartedAt = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(
    "SELECT request_count FROM rate_limits WHERE scope = ? AND fingerprint = ? AND window_started_at = ?",
  ).bind("admin-login", fingerprint, windowStartedAt).first();
  if (Number(row?.request_count || 0) >= 5) throw rateLimitError(windowSeconds);
  return fingerprint;
}

async function clearRateLimit(env, scope, fingerprint) {
  await env.DB.prepare("DELETE FROM rate_limits WHERE scope = ? AND fingerprint = ?")
    .bind(scope, fingerprint).run();
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function sha256Hex(value) {
  const bytes = await sha256(value);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AppError(400, "Malformed URL encoding");
  }
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function cleanText(value, maximum, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function cleanLongText(value, maximum, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseTags(value, fallback = []) {
  let tags = value;
  if (typeof tags === "string") {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = tags.split(",");
    }
  }
  if (!Array.isArray(tags)) tags = fallback;
  return [...new Set(tags.map((tag) => cleanText(tag, 40)).filter(Boolean))].slice(0, 20);
}

function serializeVideo(row) {
  if (!row) return null;
  const provider = detectMediaProvider(row);
  const fallbackThumbnail = provider === "tiktok" && !row.thumbnail_url
    ? buildTikTokThumbnailProxyUrl(row.source_url)
    : null;
  return {
    ...row,
    provider,
    thumbnail_url: row.thumbnail_url || fallbackThumbnail,
    featured: Boolean(row.featured),
    trending: Boolean(row.trending),
    published: Boolean(row.published),
    has_captions: Boolean(row.has_captions),
    seo_tags: parseTags(row.seo_tags),
    reactions: row.reactions || { like: 0, love: 0, useful: 0 },
  };
}

function buildTikTokThumbnailProxyUrl(sourceUrl) {
  const share = normalizeTikTokShareUrl(sourceUrl);
  return share ? `/api/tiktok/thumbnail?url=${encodeURIComponent(share)}` : null;
}

function isTikTokThumbnailProxy(value) {
  try {
    const url = new URL(value, "https://vid.best");
    return url.pathname === "/api/tiktok/thumbnail" && Boolean(url.searchParams.get("url"));
  } catch {
    return false;
  }
}

function normalizeTikTokShareUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "tiktok.com") return null;
    const match = url.pathname.match(/^\/@([^/]+)\/video\/(\d+)\/?$/);
    if (!match) return null;
    return `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
  } catch {
    return null;
  }
}

function detectMediaProvider(video) {
  if (video.media_type === "r2" && isHlsManifestKey(video.r2_key)) return "hls";
  if (video.media_type && video.media_type !== "raw") return video.media_type;
  const value = video.embed_url || video.source_url || "";
  try {
    const host = new URL(value, "https://example.com").hostname.toLowerCase().replace(/^www\./, "");
    if (host === "player.vimeo.com" || host === "vimeo.com") return "vimeo";
    if (host === "dailymotion.com" || host === "dai.ly") return "dailymotion";
    if (host === "player.twitch.tv" || host === "clips.twitch.tv" || host === "twitch.tv") return "twitch";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  } catch {
    // Relative and malformed values are handled by their existing media type.
  }
  return video.embed_url ? "embed" : "direct";
}

async function requestDiscovery(request, env) {
  const data = await readJson(request, 8192);
  const query = cleanText(data.query, 120);
  if (query.length < 3) throw new AppError(400, "Enter at least 3 characters or paste a complete video URL");

  const possibleUrl = cleanText(data.source_url || query, 2000);
  const parsedUrl = optionalHttpUrl(possibleUrl);
  const normalized = normalizeDiscoveryQuery(query);
  const fingerprint = await consumeRateLimit(request, env, "discovery", 5, 600);

  let row = await env.DB.prepare(
    `INSERT INTO discovery_requests (
       query, normalized_query, source_url, fingerprint, request_count
     ) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(normalized_query) DO UPDATE SET
       source_url = COALESCE(excluded.source_url, discovery_requests.source_url)
     RETURNING id, query, source_url, status, request_count, created_at, updated_at`,
  ).bind(query, normalized, parsedUrl?.toString() || null, fingerprint).first();

  const visitor = await env.DB.prepare(
    "INSERT OR IGNORE INTO discovery_request_visitors (discovery_request_id, fingerprint) VALUES (?, ?)",
  ).bind(row.id, fingerprint).run();
  if (Number(visitor.meta?.changes || 0) > 0) {
    row = await env.DB.prepare(
      `UPDATE discovery_requests SET
         request_count = MIN(request_count + 1, 9999),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?
       RETURNING id, query, source_url, status, request_count, created_at, updated_at`,
    ).bind(row.id).first();
  }

  return json({
    success: true,
    request: row,
    message: row.status === "resolved"
      ? "This discovery has already been reviewed. Search again shortly."
      : "Discovery request added for administrator review.",
  }, 202);
}

function normalizeDiscoveryQuery(value) {
  return cleanText(value, 120).normalize("NFKC").toLocaleLowerCase("en-US");
}

function optionalHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

async function discoverVideos(request, env) {
  const url = new URL(request.url);
  const query = cleanText(url.searchParams.get("q"), 500);
  if (query.length < 3) throw new AppError(400, "Enter a video URL or at least 3 search characters");
  const directUrl = optionalHttpUrl(query);
  if (directUrl) return json({ results: [await discoverFromUrl(directUrl, request, env)] });

  if (!env.YOUTUBE_API_KEY) {
    throw new AppError(503, "Text video search requires the YOUTUBE_API_KEY Worker secret. You can still paste a direct video URL.");
  }
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "8",
    safeSearch: "strict",
    q: query,
    key: env.YOUTUBE_API_KEY,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    console.error("YouTube search request failed", response.status);
    throw new AppError(502, `YouTube search returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  const results = (payload.items || []).map((item) => {
    const id = cleanText(item.id?.videoId, 20);
    const snippet = item.snippet || {};
    return {
      provider: "youtube",
      video_id: id,
      title: decodeHtmlEntities(cleanText(snippet.title, 160, "YouTube video")),
      description: decodeHtmlEntities(cleanLongText(snippet.description, 1000)),
      source_url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail_url: validateSearchThumbnail(snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url),
      channel: decodeHtmlEntities(cleanText(snippet.channelTitle, 120)),
      published_at: cleanText(snippet.publishedAt, 40),
    };
  }).filter((item) => /^[A-Za-z0-9_-]{11}$/.test(item.video_id));
  return json({ results });
}

async function discoverFromUrl(url, request, env) {
  const media = normalizeMedia(url.toString(), "", getBaseUrl(request, env));
  let metadata = {};
  let endpoint = null;
  if (media.media_type === "youtube") {
    endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`;
  }
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) metadata = await response.json();
    } catch (error) {
      console.error("oEmbed metadata request failed", error?.name || "unknown");
    }
  }
  const providerNames = {
    youtube: "YouTube",
    tiktok: "TikTok",
    facebook: "Facebook",
    vimeo: "Vimeo",
    dailymotion: "Dailymotion",
    twitch: "Twitch",
    instagram: "Instagram",
    direct: "Web video",
  };
  return {
    provider: media.provider || media.media_type,
    video_id: extractYoutubeId(url, url.hostname.toLowerCase().replace(/^www\./, "")) || url.pathname.match(/\/video\/(\d+)/)?.[1] || "",
    title: cleanText(metadata.title, 160, `${providerNames[media.provider] || "Video"} discovery`),
    description: "",
    source_url: media.source_url,
    thumbnail_url: validateSearchThumbnail(metadata.thumbnail_url) || media.thumbnail_url,
    channel: cleanText(metadata.author_name, 120),
    published_at: "",
  };
}

function validateSearchThumbnail(value) {
  const url = optionalHttpUrl(cleanText(value, 2000));
  return url?.toString() || null;
}

function decodeHtmlEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];
    const number = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  });
}

async function listDiscoveryRequests(request, env) {
  const url = new URL(request.url);
  const status = cleanText(url.searchParams.get("status"), 20, "pending");
  if (!DISCOVERY_STATUSES.has(status)) throw new AppError(400, "Unknown discovery request status");
  const result = await env.DB.prepare(
    `SELECT id, query, source_url, status, request_count, resolved_video_id, created_at, updated_at
     FROM discovery_requests WHERE status = ?
     ORDER BY request_count DESC, updated_at ASC LIMIT 100`,
  ).bind(status).all();
  return json({ requests: result.results || [] });
}

async function updateDiscoveryRequest(request, env, id) {
  const data = await readJson(request, 4096);
  const status = cleanText(data.status, 20);
  if (!DISCOVERY_STATUSES.has(status)) throw new AppError(400, "Status must be pending, resolved or rejected");
  const resolvedVideoId = data.resolved_video_id ? clampInteger(data.resolved_video_id, 1, Number.MAX_SAFE_INTEGER, 0) : null;
  if (status === "resolved" && !resolvedVideoId) throw new AppError(400, "resolved_video_id is required when resolving a request");
  const row = await env.DB.prepare(
    `UPDATE discovery_requests SET status = ?, resolved_video_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? RETURNING id, query, status, request_count, resolved_video_id, updated_at`,
  ).bind(status, status === "resolved" ? resolvedVideoId : null, id).first();
  if (!row) throw new AppError(404, "Discovery request not found");
  return json({ success: true, request: row });
}

async function listVideos(request, env, includeUnpublished) {
  const url = new URL(request.url);
  const category = cleanText(url.searchParams.get("category"), 80);
  const subcategory = cleanText(url.searchParams.get("subcategory"), 80);
  const query = cleanText(url.searchParams.get("q"), 120);
  const limit = clampInteger(url.searchParams.get("limit"), 1, 48, 18);
  const offset = clampInteger(url.searchParams.get("offset"), 0, 5000, 0);
  const sort = url.searchParams.get("sort") || "newest";
  const sortSql = {
    newest: "v.created_at DESC",
    trending: "v.trending DESC, v.reaction_count DESC, v.created_at DESC",
    popular: "v.views DESC, v.created_at DESC",
    reactions: "v.reaction_count DESC, v.created_at DESC",
  }[sort] || "v.created_at DESC";

  if (category && !Object.hasOwn(CATEGORIES, category)) throw new AppError(400, "Unknown category");
  if (subcategory && category !== "Other" && (!category || !CATEGORIES[category].includes(subcategory))) {
    throw new AppError(400, "Unknown subcategory for the selected category");
  }

  const where = [];
  const bindings = [];
  if (!includeUnpublished) where.push("v.published = 1");
  if (category) {
    where.push("v.primary_category = ?");
    bindings.push(category);
  }
  if (subcategory) {
    where.push("v.subcategory = ?");
    bindings.push(subcategory);
  }
  if (query) {
    where.push("(v.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR v.description LIKE ? ESCAPE '\\' COLLATE NOCASE OR v.seo_tags LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    const searchValue = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    bindings.push(searchValue, searchValue, searchValue);
  }
  if (url.searchParams.get("featured") === "1") where.push("v.featured = 1");
  if (url.searchParams.get("trending") === "1") where.push("v.trending = 1");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const selectSql = includeUnpublished
    ? `SELECT v.*, m.source_published_at, m.source_duration
       FROM videos v
       LEFT JOIN video_source_metadata m ON m.video_id = v.id
       ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`
    : `SELECT v.* FROM videos v ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`;
  const listStatement = env.DB.prepare(selectSql).bind(...bindings, limit, offset);
  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS total FROM videos v ${whereSql}`).bind(...bindings);
  const [listResult, countRow] = await env.DB.batch([listStatement, countStatement]);
  const videos = await hydrateVideos(env, listResult.results || []);

  return json({
    videos,
    pagination: { limit, offset, total: Number(countRow.results?.[0]?.total || 0) },
  });
}

async function hydrateVideos(env, rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => Number(row.id));
  const placeholders = ids.map(() => "?").join(",");
  const reactionResult = await env.DB.prepare(
    `SELECT video_id, reaction, COUNT(*) AS count FROM reactions WHERE video_id IN (${placeholders}) GROUP BY video_id, reaction`,
  ).bind(...ids).all();
  const reactionsByVideo = new Map();
  for (const item of reactionResult.results || []) {
    if (!reactionsByVideo.has(item.video_id)) reactionsByVideo.set(item.video_id, { like: 0, love: 0, useful: 0 });
    reactionsByVideo.get(item.video_id)[item.reaction] = Number(item.count);
  }
  return rows.map((row) => serializeVideo({ ...row, reactions: reactionsByVideo.get(row.id) }));
}

async function getPublicVideo(env, slug) {
  const row = await env.DB.prepare(
    `SELECT v.*, a.transcript, a.language AS transcript_language,
            CASE WHEN length(a.captions_vtt) > 0 THEN 1 ELSE 0 END AS has_captions
     FROM videos v LEFT JOIN video_analysis a ON a.video_id = v.id AND a.source_url = v.source_url
     WHERE v.slug = ? AND v.published = 1`,
  ).bind(slug).first();
  if (!row) throw new AppError(404, "Video not found");
  const [video] = await hydrateVideos(env, [row]);
  return json({ video });
}

async function recommendVideos(request, env, videoId) {
  const current = await env.DB.prepare(
    "SELECT id, primary_category, subcategory FROM videos WHERE id = ? AND published = 1",
  ).bind(videoId).first();
  if (!current) throw new AppError(404, "Video not found");

  const limit = clampInteger(new URL(request.url).searchParams.get("limit"), 1, 16, 8);
  let fingerprint = "";
  try {
    fingerprint = await requestFingerprint(request, await resolveReactionSalt(env));
  } catch {
    // Recommendations still work without personalization when the salt is unavailable.
  }

  const result = await env.DB.prepare(
    `SELECT v.*,
       (CASE WHEN v.subcategory = ? THEN 60 WHEN v.primary_category = ? THEN 30 ELSE 0 END
        + COALESCE(i.score, 0) * 8
        + MIN(v.reaction_count, 20)
        + MIN(CAST(v.views / 20 AS INTEGER), 20)
        + v.featured * 4
        + v.trending * 6) AS recommendation_score
     FROM videos v
     LEFT JOIN viewer_interests i
       ON i.fingerprint = ?
      AND i.primary_category = v.primary_category
      AND i.subcategory = v.subcategory
     WHERE v.published = 1 AND v.id <> ?
     ORDER BY recommendation_score DESC, v.updated_at DESC
     LIMIT ?`,
  ).bind(current.subcategory, current.primary_category, fingerprint, videoId, limit).all();
  const videos = await hydrateVideos(env, result.results || []);
  return json({ videos, personalized: Boolean(fingerprint) }, 200, { "Cache-Control": "private, max-age=30" });
}

async function recordVideoInterest(request, env, videoId) {
  const video = await env.DB.prepare(
    "SELECT id, primary_category, subcategory FROM videos WHERE id = ? AND published = 1",
  ).bind(videoId).first();
  if (!video) throw new AppError(404, "Video not found");

  const body = await readJson(request, 2048);
  const signal = cleanText(body.signal, 20, "more");
  if (!new Set(["more", "less"]).has(signal)) throw new AppError(400, "Interest signal must be more or less");
  const fingerprint = await consumeRateLimit(request, env, "interest", 30, 3600);
  const delta = signal === "more" ? 5 : -5;
  const row = await env.DB.prepare(
    `INSERT INTO viewer_interests (
       fingerprint, primary_category, subcategory, score, updated_at
     ) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(fingerprint, primary_category, subcategory) DO UPDATE SET
       score = MAX(-20, MIN(100, viewer_interests.score + excluded.score)),
       updated_at = excluded.updated_at
     RETURNING score`,
  ).bind(fingerprint, video.primary_category, video.subcategory, delta).first();
  return json({
    success: true,
    signal,
    score: Number(row?.score || 0),
    message: signal === "more" ? "Your suggestions will show more videos like this." : "Your suggestions will show fewer videos like this.",
  });
}

async function createVideo(request, env) {
  const body = await readJson(request);
  const baseUrl = getBaseUrl(request, env);
  const data = await validateVideoPayload(body, null, baseUrl, env);
  data.slug = await uniqueSlug(env, data.title, body.slug);

  const row = await env.DB.prepare(
    `INSERT INTO videos (
      slug, title, source_url, embed_url, media_type, r2_key,
      primary_category, subcategory, description, review_text,
      seo_title, seo_description, seo_tags, thumbnail_url,
      featured, trending, published
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
  ).bind(
    data.slug,
    data.title,
    data.source_url,
    data.embed_url,
    data.media_type,
    data.r2_key,
    data.primary_category,
    data.subcategory,
    data.description,
    data.review_text,
    data.seo_title,
    data.seo_description,
    JSON.stringify(data.seo_tags),
    data.thumbnail_url,
    Number(data.featured),
    Number(data.trending),
    Number(data.published),
  ).first();

  return json({ success: true, video: serializeVideo(row) }, 201);
}

async function updateVideo(request, env, id) {
  const existing = await env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first();
  if (!existing) throw new AppError(404, "Video not found");
  const body = await readJson(request);
  const data = await validateVideoPayload(body, existing, getBaseUrl(request, env), env);

  const row = await env.DB.prepare(
    `UPDATE videos SET
      title = ?, source_url = ?, embed_url = ?, media_type = ?, r2_key = ?,
      primary_category = ?, subcategory = ?, description = ?, review_text = ?,
      seo_title = ?, seo_description = ?, seo_tags = ?, thumbnail_url = ?,
      featured = ?, trending = ?, published = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? RETURNING *`,
  ).bind(
    data.title,
    data.source_url,
    data.embed_url,
    data.media_type,
    data.r2_key,
    data.primary_category,
    data.subcategory,
    data.description,
    data.review_text,
    data.seo_title,
    data.seo_description,
    JSON.stringify(data.seo_tags),
    data.thumbnail_url,
    Number(data.featured),
    Number(data.trending),
    Number(data.published),
    id,
  ).first();

  const replacedKeys = [
    existing.r2_key && existing.r2_key !== data.r2_key ? existing.r2_key : null,
    existing.thumbnail_url && existing.thumbnail_url !== data.thumbnail_url
      ? managedAssetKeyFromUrl(existing.thumbnail_url, request, env)
      : null,
  ];
  if (existing.source_url !== row.source_url) {
    await env.DB.prepare("DELETE FROM video_analysis WHERE video_id = ?").bind(id).run();
  }
  await cleanupUnusedManagedAssets(env, replacedKeys);

  return json({ success: true, video: serializeVideo(row) });
}

async function deleteVideo(request, env, id) {
  const existing = await env.DB.prepare(
    "SELECT id, r2_key, thumbnail_url FROM videos WHERE id = ?",
  ).bind(id).first();
  if (!existing) throw new AppError(404, "Video not found");
  await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();
  await cleanupUnusedManagedAssets(env, [
    existing.r2_key,
    managedAssetKeyFromUrl(existing.thumbnail_url, request, env),
  ]);
  return json({ success: true });
}

function managedAssetKeyFromUrl(value, request, env) {
  const raw = cleanText(value, 2000);
  if (!raw) return null;
  try {
    const currentOrigin = new URL(request.url).origin;
    const configuredOrigin = getBaseUrl(request, env);
    const url = new URL(raw, currentOrigin);
    if (![currentOrigin, configuredOrigin].includes(url.origin) || !url.pathname.startsWith("/media/")) return null;
    const key = validateR2Key(safeDecode(url.pathname.slice("/media/".length)));
    return key?.startsWith("uploads/") ? key : null;
  } catch {
    return null;
  }
}

async function cleanupUnusedManagedAssets(env, values) {
  if (!env.BUCKET) return;
  const keys = [...new Set(values.filter((key) => typeof key === "string" && key.startsWith("uploads/")))];
  for (const key of keys) {
    try {
      const relativeUrl = `/media/${encodeR2Key(key)}`;
      const reference = await env.DB.prepare(
        `SELECT 1 FROM videos
         WHERE r2_key = ?
            OR thumbnail_url = ?
            OR substr(thumbnail_url, -length(?)) = ?
         LIMIT 1`,
      ).bind(key, relativeUrl, relativeUrl, relativeUrl).first();
      if (!reference) await env.BUCKET.delete(key);
    } catch (error) {
      console.error("Managed asset cleanup failed", error?.message || error);
    }
  }
}

async function validateVideoPayload(body, existing, baseUrl, env) {
  const title = cleanText(body.title, 160, existing?.title || "");
  const category = cleanText(body.primary_category, 80, existing?.primary_category || "");
  const subcategory = cleanText(body.subcategory, 80, existing?.subcategory || "");
  if (!title) throw new AppError(400, "Title is required");
  if (!Object.hasOwn(CATEGORIES, category)) throw new AppError(400, "Select a valid primary category");
  if (category !== "Other" && !CATEGORIES[category].includes(subcategory)) throw new AppError(400, "Select a valid subcategory");
  if (category === "Other" && (!subcategory || subcategory.length > 80)) throw new AppError(400, "Enter a valid custom subcategory");

  const suppliedR2Key = cleanText(body.r2_key, 500, existing?.r2_key || "");
  const suppliedSource = cleanText(body.source_url, 2000, existing?.source_url || "");
  const media = normalizeMedia(suppliedSource, suppliedR2Key, baseUrl);
  const thumbnailCandidate = body.thumbnail_url === undefined ? existing?.thumbnail_url : body.thumbnail_url;
  const thumbnailText = cleanText(thumbnailCandidate, 2000);
  const customThumbnail = media.provider === "tiktok" && isTikTokThumbnailProxy(thumbnailText)
    ? null
    : validateOptionalUrl(thumbnailText);
  const thumbnailUrl = customThumbnail || media.thumbnail_url;
  if (media.provider === "hls" && !toBoolean(body.media_rights_confirmed)) {
    throw new AppError(400, "Confirm that you have permission to store and serve this HLS media before publishing");
  }

  return {
    title,
    source_url: media.source_url,
    embed_url: media.embed_url,
    media_type: media.media_type,
    r2_key: media.r2_key,
    primary_category: category,
    subcategory,
    description: cleanLongText(body.description, 2400, existing?.description || ""),
    review_text: cleanLongText(body.review_text, 7000, existing?.review_text || ""),
    seo_title: cleanText(body.seo_title, 70, existing?.seo_title || title).slice(0, 70),
    seo_description: cleanText(body.seo_description, 180, existing?.seo_description || "").slice(0, 180),
    seo_tags: parseTags(body.seo_tags, parseTags(existing?.seo_tags)),
    thumbnail_url: thumbnailUrl || null,
    featured: toBoolean(body.featured, Boolean(existing?.featured)),
    trending: toBoolean(body.trending, Boolean(existing?.trending)),
    published: toBoolean(body.published, existing ? Boolean(existing.published) : true),
  };
}

function normalizeMedia(sourceInput, r2KeyInput, baseUrl) {
  const r2Key = validateR2Key(r2KeyInput);
  if (r2Key) {
    return {
      source_url: `${baseUrl}/media/${encodeR2Key(r2Key)}`,
      embed_url: null,
      media_type: "r2",
      provider: isHlsManifestKey(r2Key) ? "hls" : "r2",
      r2_key: r2Key,
      thumbnail_url: null,
    };
  }
  if (!sourceInput) throw new AppError(400, "A media link or uploaded R2 asset is required");

  let url;
  try {
    url = new URL(sourceInput);
  } catch {
    throw new AppError(400, "Media link must be a complete HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError(400, "Only HTTP and HTTPS media links are allowed");
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const siteOrigin = new URL(baseUrl).origin;
  const siteHostname = new URL(baseUrl).hostname;

  const youtubeId = extractYoutubeId(url, hostname);
  if (youtubeId) {
    return {
      source_url: url.toString(),
      embed_url: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(siteOrigin)}`,
      media_type: "youtube",
      provider: "youtube",
      r2_key: null,
      thumbnail_url: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }

  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) {
    const id = url.pathname.match(/\/video\/(\d+)/)?.[1];
    if (!id) throw new AppError(400, "Use a full TikTok video URL containing the video ID");
    return {
      source_url: url.toString(),
      embed_url: buildTikTokPlayerUrl(id),
      media_type: "tiktok",
      provider: "tiktok",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  if (hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "fb.watch") {
    return {
      source_url: url.toString(),
      embed_url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url.toString())}&show_text=false&width=1280`,
      media_type: "facebook",
      provider: "facebook",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  if (hostname === "vimeo.com" || hostname.endsWith(".vimeo.com")) {
    const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
    if (!id) throw new AppError(400, "Use a full Vimeo video URL containing the numeric video ID");
    const pathParts = url.pathname.split("/").filter(Boolean);
    const privacyHash = cleanText(url.searchParams.get("h") || pathParts[pathParts.indexOf(id) + 1], 80);
    const privacyQuery = privacyHash && /^[A-Za-z0-9]+$/.test(privacyHash)
      ? `&h=${encodeURIComponent(privacyHash)}`
      : "";
    return {
      source_url: url.toString(),
      embed_url: `https://player.vimeo.com/video/${id}?dnt=1${privacyQuery}`,
      media_type: "raw",
      provider: "vimeo",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  if (hostname === "dailymotion.com" || hostname.endsWith(".dailymotion.com") || hostname === "dai.ly") {
    const id = hostname === "dai.ly"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.pathname.match(/\/(?:embed\/)?video\/([A-Za-z0-9]+)/)?.[1];
    if (!id || !/^[A-Za-z0-9]+$/.test(id)) throw new AppError(400, "Use a full Dailymotion video URL containing the video ID");
    return {
      source_url: url.toString(),
      embed_url: `https://www.dailymotion.com/embed/video/${id}`,
      media_type: "raw",
      provider: "dailymotion",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  if (hostname === "twitch.tv" || hostname.endsWith(".twitch.tv")) {
    const videoId = url.pathname.match(/\/videos\/(\d+)/)?.[1];
    const clipId = hostname === "clips.twitch.tv"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.pathname.match(/\/clip\/([A-Za-z0-9_-]+)/)?.[1];
    if (!videoId && !clipId) throw new AppError(400, "Use a full Twitch video or clip URL");
    return {
      source_url: url.toString(),
      embed_url: videoId
        ? `https://player.twitch.tv/?video=v${videoId}&parent=${encodeURIComponent(siteHostname)}&autoplay=false`
        : `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipId)}&parent=${encodeURIComponent(siteHostname)}&autoplay=false`,
      media_type: "raw",
      provider: "twitch",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) {
    const match = url.pathname.match(/^\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    if (!match) throw new AppError(400, "Use a full public Instagram post or Reel URL");
    const kind = match[1] === "p" ? "p" : "reel";
    return {
      source_url: url.toString(),
      embed_url: `https://www.instagram.com/${kind}/${match[2]}/embed`,
      media_type: "raw",
      provider: "instagram",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  return {
    source_url: url.toString(),
    embed_url: null,
    media_type: "raw",
    provider: "direct",
    r2_key: null,
    thumbnail_url: null,
  };
}

function extractYoutubeId(url, hostname) {
  let id = null;
  if (hostname === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0];
  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtube-nocookie.com") {
    id = url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function validateOptionalUrl(value) {
  if (!value) return null;
  if (value.startsWith("/media/")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    throw new AppError(400, "Thumbnail URL is invalid");
  }
}

function validateR2Key(value) {
  const key = cleanText(value, 500);
  if (!key) return null;
  if (key.startsWith("/") || key.includes("..") || key.includes("\\")) throw new AppError(400, "Invalid R2 object key");
  return key;
}

function encodeR2Key(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function uniqueSlug(env, title, requested) {
  const base = slugify(cleanText(requested, 120) || title) || `video-${crypto.randomUUID().slice(0, 8)}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 6)}`;
    const exists = await env.DB.prepare("SELECT 1 FROM videos WHERE slug = ?").bind(candidate).first();
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

async function toggleReaction(request, env, videoId) {
  const video = await env.DB.prepare("SELECT id FROM videos WHERE id = ? AND published = 1").bind(videoId).first();
  if (!video) throw new AppError(404, "Video not found");
  const body = await readJson(request, 4096);
  const reaction = cleanText(body.reaction, 20);
  if (!REACTIONS.has(reaction)) throw new AppError(400, "Unsupported reaction");

  const fingerprint = await consumeRateLimit(request, env, "reaction", 30, 60);
  const existing = await env.DB.prepare(
    "SELECT id FROM reactions WHERE video_id = ? AND fingerprint = ? AND reaction = ?",
  ).bind(videoId, fingerprint, reaction).first();

  if (existing) {
    await env.DB.prepare("DELETE FROM reactions WHERE id = ?").bind(existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO reactions (video_id, fingerprint, reaction) VALUES (?, ?, ?)",
    ).bind(videoId, fingerprint, reaction).run();
  }
  const counts = await reactionCounts(env, videoId);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  await env.DB.prepare("UPDATE videos SET reaction_count = ? WHERE id = ?").bind(total, videoId).run();
  return json({ success: true, active: !existing, reactions: counts });
}

async function reactionCounts(env, videoId) {
  const result = await env.DB.prepare(
    "SELECT reaction, COUNT(*) AS count FROM reactions WHERE video_id = ? GROUP BY reaction",
  ).bind(videoId).all();
  const counts = { like: 0, love: 0, useful: 0 };
  for (const row of result.results || []) counts[row.reaction] = Number(row.count);
  return counts;
}

async function listComments(env, videoId) {
  const result = await env.DB.prepare(
    "SELECT id, author, body, created_at FROM comments WHERE video_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 50",
  ).bind(videoId).all();
  return json({ comments: result.results || [] }, 200, { "Cache-Control": "public, max-age=30" });
}

async function submitComment(request, env, videoId) {
  const video = await env.DB.prepare("SELECT id FROM videos WHERE id = ? AND published = 1").bind(videoId).first();
  if (!video) throw new AppError(404, "Video not found");
  const data = await readJson(request, 8192);
  if (cleanText(data.website, 200)) return json({ success: true, status: "pending" }, 202);
  await consumeRateLimit(request, env, "comment", 5, 600);
  const author = cleanText(data.author, 50, "Guest") || "Guest";
  const body = cleanLongText(data.body, 800);
  if (body.length < 2) throw new AppError(400, "Comment is too short");
  await env.DB.prepare(
    "INSERT INTO comments (video_id, author, body, status) VALUES (?, ?, ?, 'pending')",
  ).bind(videoId, author, body).run();
  return json({ success: true, status: "pending", message: "Comment submitted for moderation" }, 202);
}

async function listAdminComments(request, env) {
  const url = new URL(request.url);
  const status = cleanText(url.searchParams.get("status"), 20, "pending");
  if (!COMMENT_STATUSES.has(status)) throw new AppError(400, "Unknown comment status");
  const result = await env.DB.prepare(
    `SELECT c.id, c.video_id, c.author, c.body, c.status, c.created_at, v.title AS video_title
     FROM comments c JOIN videos v ON v.id = c.video_id
     WHERE c.status = ? ORDER BY c.created_at ASC LIMIT 100`,
  ).bind(status).all();
  return json({ comments: result.results || [] });
}

async function moderateComment(request, env, commentId) {
  const data = await readJson(request, 4096);
  const status = cleanText(data.status, 20);
  if (!new Set(["approved", "rejected"]).has(status)) throw new AppError(400, "Status must be approved or rejected");
  const comment = await env.DB.prepare("SELECT id, video_id FROM comments WHERE id = ?").bind(commentId).first();
  if (!comment) throw new AppError(404, "Comment not found");
  await env.DB.batch([
    env.DB.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(status, commentId),
    env.DB.prepare(
      "UPDATE videos SET comments_count = (SELECT COUNT(*) FROM comments WHERE video_id = ? AND status = 'approved') WHERE id = ?",
    ).bind(comment.video_id, comment.video_id),
  ]);
  return json({ success: true, status });
}

async function generateAiCopy(request, env) {
  if (!env.GEMINI_KEY) throw new AppError(503, "GEMINI_KEY is not configured");
  const data = await readJson(request, 32768);
  const title = cleanText(data.title, 160);
  const category = cleanText(data.primary_category, 80);
  const subcategory = cleanText(data.subcategory, 80);
  const sourceUrl = cleanText(data.source_url, 1200);
  const notes = cleanLongText(data.notes, 1500);
  if (!title) throw new AppError(400, "Enter a title before using AI Generate");
  if (!Object.hasOwn(CATEGORIES, category) || !CATEGORIES[category].includes(subcategory)) {
    throw new AppError(400, "Choose a valid category and subcategory first");
  }

  const prompt = [
    "Create professional search-friendly editorial copy for a video discovery listing.",
    "Use only the supplied title, category, subcategory, URL and notes.",
    "Do not claim to have watched the video, do not invent measurements, quotes, people, events or product claims.",
    "Write neutral, useful copy that clearly signals uncertainty when details are unavailable.",
    `Title: ${title}`,
    `Category: ${category}`,
    `Subcategory: ${subcategory}`,
    `Source URL: ${sourceUrl || "not supplied"}`,
    `Admin notes: ${notes || "none"}`,
  ].join("\n");

  const model = cleanText(env.GEMINI_MODEL, 80, "gemini-3.1-flash-lite");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            seoTitle: { type: "STRING", description: "SEO title, maximum 65 characters" },
            seoDescription: { type: "STRING", description: "Meta description, maximum 160 characters" },
            description: { type: "STRING", description: "Helpful listing summary, 90 to 160 words" },
            reviewText: { type: "STRING", description: "Editorial discovery review, 160 to 300 words" },
            tags: { type: "ARRAY", items: { type: "STRING" }, description: "8 to 14 concise SEO tags" },
          },
          required: ["seoTitle", "seoDescription", "description", "reviewText", "tags"],
        },
      },
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    const errorBody = cleanText(await response.text(), 300);
    console.error("Gemini request failed", response.status, errorBody);
    throw new AppError(502, `Gemini returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  const text = (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("").trim();
  if (!text) throw new AppError(502, "Gemini returned an empty response");
  let generated;
  try {
    generated = JSON.parse(text);
  } catch {
    throw new AppError(502, "Gemini returned invalid structured data");
  }

  return json({
    success: true,
    generated: {
      seo_title: cleanText(generated.seoTitle, 65),
      seo_description: cleanText(generated.seoDescription, 160),
      description: cleanLongText(generated.description, 2400),
      review_text: cleanLongText(generated.reviewText, 7000),
      seo_tags: parseTags(generated.tags),
    },
  });
}

function teamworkConfiguration(env) {
  const secret = String(env.TEAMWORK_API_KEY || "");
  let base;
  try {
    base = new URL(String(env.TEAMWORK_API_URL || ""));
  } catch {
    throw new AppError(503, "TEAMWORK_API_URL is not configured");
  }
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new AppError(503, "TEAMWORK_API_URL must be a credential-free HTTPS URL");
  }
  if (secret.length < 32) throw new AppError(503, "TEAMWORK_API_KEY is not configured");
  base.pathname = base.pathname.replace(/\/$/, "");
  base.search = "";
  base.hash = "";
  return { base: base.toString().replace(/\/$/, ""), secret };
}

async function readTeamworkResponse(response) {
  const text = await response.text();
  if (encoder.encode(text).byteLength > 300_000) throw new AppError(502, "Teamwork response is too large");
  let payload;
  try {
    payload = JSON.parse(text || "{}");
  } catch {
    throw new AppError(502, "Teamwork returned invalid JSON");
  }
  if (!response.ok) {
    const message = cleanText(payload.detail || payload.error, 240, `HTTP ${response.status}`);
    throw new AppError(502, `Teamwork analysis failed: ${message}`);
  }
  return payload;
}

async function callTeamwork(env, pathname, options = {}) {
  const { base, secret } = teamworkConfiguration(env);
  let response;
  try {
    response = await fetch(`${base}${pathname}`, {
      ...options,
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new AppError(504, "Teamwork API timed out");
    throw new AppError(502, "Teamwork API is unavailable");
  }
  return readTeamworkResponse(response);
}

async function startMediaAnalysis(request, env) {
  const data = await readJson(request, 8192);
  const title = cleanText(data.title, 160);
  const r2Key = validateR2Key(data.r2_key);
  const baseUrl = getBaseUrl(request, env);
  let sourceUrl = cleanText(data.source_url, 2000);
  let mediaOwned = false;
  if (r2Key) {
    if (!r2Key.startsWith("uploads/")) throw new AppError(400, "Only administrator uploads can be deeply scanned");
    sourceUrl = `${baseUrl}/media/${encodeR2Key(r2Key)}`;
    mediaOwned = true;
  }
  if (!optionalHttpUrl(sourceUrl)) throw new AppError(400, "Enter or upload a valid media URL first");
  const job = await callTeamwork(env, "/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      source_url: sourceUrl,
      title,
      media_owned: mediaOwned,
      scan_frames: mediaOwned,
      transcribe: mediaOwned,
      crawl_page: !mediaOwned,
      ground_search: toBoolean(data.ground_search, false),
      search_query: cleanText(data.search_query || title, 200),
    }),
  });
  return json({ success: true, job }, 202);
}

async function getMediaAnalysis(env, jobId) {
  const job = await callTeamwork(env, `/v1/jobs/${jobId}`);
  return json({ success: true, job });
}

function normalizeAnalysisLanguage(value) {
  const language = cleanText(value, 20).toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language) ? language : "";
}

function normalizeCaptions(value) {
  const captions = cleanLongText(value, 120_000);
  if (!captions) return "";
  if (!/^WEBVTT(?:\s|$)/.test(captions)) throw new AppError(400, "Captions must use WebVTT format");
  return captions;
}

function parseWarnings(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 20);
}

async function getStoredVideoAnalysis(env, videoId) {
  const video = await env.DB.prepare("SELECT id FROM videos WHERE id = ?").bind(videoId).first();
  if (!video) throw new AppError(404, "Video not found");
  const row = await env.DB.prepare(
    `SELECT source_url, transcript, ocr_text, captions_vtt, language, analysis_provider, warnings_json, updated_at
     FROM video_analysis WHERE video_id = ?`,
  ).bind(videoId).first();
  if (!row) return json({ analysis: null });
  let storedWarnings = [];
  try {
    storedWarnings = JSON.parse(row.warnings_json || "[]");
  } catch {
    storedWarnings = [];
  }
  return json({
    analysis: {
      ...row,
      warnings: parseWarnings(storedWarnings),
      warnings_json: undefined,
    },
  });
}

async function storeVideoAnalysis(request, env, videoId) {
  const video = await env.DB.prepare("SELECT id FROM videos WHERE id = ?").bind(videoId).first();
  if (!video) throw new AppError(404, "Video not found");
  const data = await readJson(request, 240_000);
  const sourceUrl = cleanText(data.source_url, 2000);
  const current = await env.DB.prepare("SELECT source_url FROM videos WHERE id = ?").bind(videoId).first();
  if (!sourceUrl || sourceUrl !== current?.source_url) throw new AppError(409, "Analysis does not match the current video source");
  const transcript = cleanLongText(data.transcript, 60_000);
  const ocrText = cleanLongText(data.ocr_text, 20_000);
  const captions = normalizeCaptions(data.captions_vtt);
  const language = normalizeAnalysisLanguage(data.language);
  const provider = cleanText(data.analysis_provider, 80, "teamwork");
  const warnings = parseWarnings(data.warnings);
  await env.DB.prepare(
    `INSERT INTO video_analysis (
       video_id, source_url, transcript, ocr_text, captions_vtt, language, analysis_provider, warnings_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(video_id) DO UPDATE SET
       source_url = excluded.source_url,
       transcript = excluded.transcript,
       ocr_text = excluded.ocr_text,
       captions_vtt = excluded.captions_vtt,
       language = excluded.language,
       analysis_provider = excluded.analysis_provider,
       warnings_json = excluded.warnings_json,
       updated_at = excluded.updated_at`,
  ).bind(videoId, sourceUrl, transcript, ocrText, captions, language, provider, JSON.stringify(warnings)).run();
  return json({ success: true });
}

async function serveCaptions(env, slug) {
  const row = await env.DB.prepare(
    `SELECT a.captions_vtt FROM video_analysis a
     JOIN videos v ON v.id = a.video_id
     WHERE v.slug = ? AND v.published = 1 AND a.source_url = v.source_url`,
  ).bind(slug).first();
  if (!row?.captions_vtt) throw new AppError(404, "Captions not found");
  const headers = securityHeaders(new Headers({
    "Content-Type": "text/vtt; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Disposition": "inline",
  }));
  return new Response(row.captions_vtt, { headers });
}

function detectUploadContentType(filename, supplied) {
  const declared = cleanText(supplied, 100).toLowerCase();
  if (SAFE_UPLOAD_TYPES.has(declared)) return declared;
  const name = cleanText(filename, 180).toLowerCase();
  if (name.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (name.endsWith(".ts")) return "video/mp2t";
  if (name.endsWith(".m4s")) return "video/iso.segment";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".ogg") || name.endsWith(".ogv")) return "video/ogg";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".avif")) return "image/avif";
  return declared;
}

async function uploadAsset(request, env) {
  const filename = cleanText(request.headers.get("X-File-Name") || new URL(request.url).searchParams.get("filename"), 180);
  if (!filename) throw new AppError(400, "X-File-Name header is required");
  if (!request.body) throw new AppError(400, "Upload body is empty");
  const contentType = detectUploadContentType(
    filename,
    request.headers.get("Content-Type"),
  );
  if (!SAFE_UPLOAD_TYPES.has(contentType)) {
    throw new AppError(415, "Unsupported media type. Use MP4, WebM, Ogg, MOV, HLS (.m3u8/.ts/.m4s) or a supported image.");
  }
  const maximum = clampInteger(env.MAX_UPLOAD_BYTES, 1_000_000, 500_000_000, 104_857_600);
  const contentLength = Number(request.headers.get("Content-Length"));
  if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
    throw new AppError(411, "A valid Content-Length header is required");
  }
  if (contentLength > maximum) {
    throw new AppError(413, `File exceeds the ${Math.floor(maximum / 1_048_576)} MB upload limit`);
  }

  const requestedKey = cleanText(request.headers.get("X-Asset-Key"), 700);
  const isHlsUpload = /\.(m3u8|ts|m4s|aac|m4a)$/i.test(filename) || /\.(m3u8|ts|m4s|aac|m4a)$/i.test(requestedKey);
  if (isHlsUpload && request.headers.get("X-Media-Rights-Confirmed") !== "1") {
    throw new AppError(400, "Confirm that you have permission to store and serve this media before uploading HLS files");
  }
  let key;
  if (requestedKey) {
    key = validateR2Key(requestedKey);
    if (!key || !key.startsWith("uploads/hls/")) {
      throw new AppError(400, "Custom asset keys are only allowed under uploads/hls/");
    }
    const extension = key.split(".").pop()?.toLowerCase() || "";
    if (!["m3u8", "ts", "m4s", "mp4", "aac", "m4a"].includes(extension)) {
      throw new AppError(415, "HLS package contains an unsupported file type");
    }
  } else {
    const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "asset";
    const date = new Date().toISOString().slice(0, 10);
    key = isHlsUpload
      ? `uploads/hls/${crypto.randomUUID()}/${safeName}`
      : `uploads/${date}/${crypto.randomUUID()}-${safeName}`;
  }
  await env.BUCKET.put(key, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
      contentDisposition: "inline",
    },
    customMetadata: { originalFilename: filename.slice(0, 180) },
  });
  const baseUrl = getBaseUrl(request, env);
  return json({ success: true, key, url: `${baseUrl}/media/${encodeR2Key(key)}` }, 201);
}

async function listAssets(request, env) {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const result = await env.BUCKET.list({ prefix: "uploads/", limit: 100, cursor });
  return json({
    objects: result.objects.map((object) => ({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded,
      etag: object.etag,
    })),
    truncated: result.truncated,
    cursor: result.truncated ? result.cursor : null,
  });
}

async function deleteAsset(env, keyInput) {
  const key = validateR2Key(keyInput);
  if (!key || !key.startsWith("uploads/")) throw new AppError(400, "Invalid managed asset key");
  await env.BUCKET.delete(key);
  return json({ success: true });
}

async function serveR2Object(request, env, keyInput) {
  const key = validateR2Key(safeDecode(keyInput));
  if (!key || !key.startsWith("uploads/")) throw new AppError(404, "Asset not found");
  if (request.method === "HEAD") {
    const object = await env.BUCKET.head(key);
    if (!object) throw new AppError(404, "Asset not found");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    secureStoredContentType(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Content-Length", String(object.size));
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(null, { headers });
  }

  const hasRange = request.headers.has("Range");
  const object = await env.BUCKET.get(key, hasRange ? { range: request.headers } : {});
  if (!object) throw new AppError(404, "Asset not found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  secureStoredContentType(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (isHlsManifestKey(key)) {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  } else {
    headers.set("Cache-Control", headers.get("Cache-Control") || "public, max-age=31536000, immutable");
  }
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

function isHlsManifestKey(key) {
  return /\.m3u8$/i.test(String(key || ""));
}

function secureStoredContentType(headers) {
  const contentType = (headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType === "application/x-mpegurl") headers.set("Content-Type", "application/vnd.apple.mpegurl");
  const normalized = (headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!SAFE_UPLOAD_TYPES.has(normalized)) {
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", "attachment");
  }
}

async function watchPage(request, env, ctx, slugInput) {
  const slug = safeDecode(slugInput).split("/")[0];
  const legacySlugRedirects = new Map([
    ["fyppppppppppppppppppppppp-fyp-ahaanpanday-aneetpadda-saiyaara", "saiyaara-a-cinematic-romance"],
  ]);
  const redirectSlug = legacySlugRedirects.get(slug);
  if (redirectSlug) {
    return Response.redirect(new URL(`/watch/${redirectSlug}`, request.url), 301);
  }
  const row = await env.DB.prepare(
    `SELECT v.*, a.transcript, a.language AS transcript_language,
            CASE WHEN length(a.captions_vtt) > 0 THEN 1 ELSE 0 END AS has_captions,
            m.source_published_at, m.source_duration
     FROM videos v
     LEFT JOIN video_analysis a ON a.video_id = v.id AND a.source_url = v.source_url
     LEFT JOIN video_source_metadata m ON m.video_id = v.id
     WHERE v.slug = ? AND v.published = 1`,
  ).bind(slug).first();
  if (!row) return dynamicHtml(notFoundPage(), 404);
  const [video] = await hydrateVideos(env, [row]);
  ctx.waitUntil(env.DB.prepare("UPDATE videos SET views = views + 1 WHERE id = ?").bind(video.id).run());
  const scriptNonce = createCspNonce();
  return dynamicHtml(renderWatchHtml(video, request, env, scriptNonce), 200, scriptNonce);
}

function renderWatchHtml(video, request, env, scriptNonce) {
  const baseUrl = getBaseUrl(request, env);
  const playbackOrigin = new URL(request.url).origin;
  const canonical = `${baseUrl}/watch/${encodeURIComponent(video.slug)}`;
  const title = cleanText(watchDisplayTitle(video), 70);
  const description = cleanText(video.seo_description || video.description || `Discover ${video.title} on Vid.Best.`, 180);
  const thumbnail = video.thumbnail_url ? absoluteUrl(video.thumbnail_url, baseUrl) : `${baseUrl}/favicon.svg`;
  const tags = Array.isArray(video.seo_tags) ? video.seo_tags.slice(0, 20) : [];
  const uploadDate = video.source_published_at || video.created_at;
  const videoSchema = {
    "@type": "VideoObject",
    "@id": `${canonical}#video`,
    name: watchDisplayTitle(video),
    description,
    thumbnailUrl: [thumbnail],
    uploadDate,
    url: canonical,
    mainEntityOfPage: canonical,
    ...(video.source_duration ? { duration: video.source_duration } : {}),
    ...(video.embed_url && video.provider !== "tiktok" ? { embedUrl: preparePlaybackEmbed(video.embed_url, playbackOrigin) } : {}),
    ...(!video.embed_url && video.provider !== "tiktok" ? { contentUrl: video.source_url } : {}),
    ...(tags.length ? { keywords: tags.join(", ") } : {}),
    ...(video.primary_category ? { genre: [video.primary_category, video.subcategory].filter(Boolean) } : {}),
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: { "@type": "WatchAction" },
        userInteractionCount: Number(video.views) + 1,
      },
      {
        "@type": "InteractionCounter",
        interactionType: { "@type": "LikeAction" },
        userInteractionCount: Number(video.reaction_count),
      },
    ],
    publisher: { "@type": "Organization", name: env.APP_NAME || "Vid.Best", url: baseUrl },
    ...(video.transcript ? { transcript: cleanLongText(video.transcript, 5000) } : {}),
  };
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${baseUrl}#website`,
        url: baseUrl,
        name: env.APP_NAME || "Vid.Best",
        inLanguage: "en",
        publisher: { "@id": `${baseUrl}#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${baseUrl}#organization`,
        name: env.APP_NAME || "Vid.Best",
        url: baseUrl,
      },
      {
        "@type": "WebPage",
        "@id": canonical,
        url: canonical,
        name: title,
        description,
        inLanguage: video.transcript_language || "en",
        datePublished: video.created_at,
        dateModified: video.updated_at,
        primaryImageOfPage: thumbnail,
        mainEntity: { "@id": `${canonical}#video` },
        isPartOf: { "@id": `${baseUrl}#website` },
      },
      videoSchema,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: baseUrl },
          { "@type": "ListItem", position: 2, name: video.primary_category, item: `${baseUrl}/?category=${encodeURIComponent(video.primary_category)}` },
          { "@type": "ListItem", position: 3, name: video.title, item: canonical },
        ],
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} | Vid.Best</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="video.other">
  <meta property="og:site_name" content="Vid.Best">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(thumbnail)}">
  <meta property="og:updated_time" content="${escapeHtml(video.updated_at)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(thumbnail)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json" nonce="${scriptNonce}">${jsonForHtml(schema)}</script>
  <script src="/watch.js" defer></script>
</head>
<body class="watch-page" data-video-id="${Number(video.id)}" data-video-provider="${escapeHtml(video.provider)}">
  <header class="site-header compact">
    <a class="brand" href="/" aria-label="Vid.Best homepage"><span class="brand-mark">V</span><span>Vid.Best</span></a>
    <form class="watch-search" action="/" method="get" role="search">
      <label class="sr-only" for="watch-site-search">Search all videos</label>
      <input id="watch-site-search" name="q" type="search" maxlength="120" placeholder="Search videos">
      <button type="submit" aria-label="Search">Search</button>
    </form>
    <a class="button ghost" href="/">Explore videos</a>
  </header>
  <main class="watch-shell">
    <div id="watch-player-anchor" class="watch-player-anchor" aria-hidden="true"></div>
    <section id="watch-player" class="watch-player glass-panel" data-provider="${escapeHtml(video.provider)}" aria-label="Video player">
      <div class="persistent-player-bar">
        <strong>Now playing</strong>
        <span id="persistent-player-status" role="status">Scroll to keep watching</span>
        <button type="button" data-player-mode="restore" hidden>Return</button>
        <button type="button" data-player-mode="theater">Pop-up</button>
        <button type="button" data-player-mode="close" aria-label="Close persistent player">Close</button>
      </div>
      <div class="watch-player-stage">${renderMedia(video, playbackOrigin)}</div>
    </section>
    <article class="watch-copy glass-panel">
      <div class="tile-badges"><span class="badge">${escapeHtml(video.primary_category)}</span><span class="badge secondary">${escapeHtml(video.subcategory)}</span></div>
      <h1>${escapeHtml(watchDisplayTitle(video))}</h1>
      <p class="lead">${escapeHtml(video.description)}</p>
      <div class="watch-reactions" data-reactions='${escapeHtml(JSON.stringify(video.reactions))}'>
        <button type="button" data-reaction="like">👍 <span>${video.reactions.like}</span></button>
        <button type="button" data-reaction="love">✨ <span>${video.reactions.love}</span></button>
        <button type="button" data-reaction="useful">💡 <span>${video.reactions.useful}</span></button>
      </div>
      <div class="interest-actions" aria-label="Personalize video suggestions">
        <button class="button ghost" type="button" data-interest="more">Show more like this</button>
        <button class="button text-button" type="button" data-interest="less">Show fewer like this</button>
        <p id="interest-status" class="form-status" role="status"></p>
      </div>
      ${video.review_text ? `<section class="review-copy"><h2>Review & discovery notes</h2>${paragraphs(video.review_text)}</section>` : ""}
      ${video.transcript ? `<details class="transcript-panel"><summary>Read transcript</summary><div>${paragraphs(video.transcript)}</div></details>` : ""}
      <a class="source-link" href="${escapeHtml(video.source_url)}" target="_blank" rel="noopener noreferrer nofollow">Open original source ↗</a>
    </article>
    <section class="comments-panel glass-panel">
      <h2>Community comments</h2>
      <form id="watch-comment-form" class="comment-form">
        <input name="author" maxlength="50" placeholder="Your name (optional)" autocomplete="name">
        <textarea name="body" maxlength="800" required placeholder="Share a helpful comment"></textarea>
        <input class="honeypot" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="button primary" type="submit">Send for review</button>
        <p class="form-status" role="status"></p>
      </form>
      <div id="watch-comments" class="comment-list" aria-live="polite"></div>
    </section>
    <aside class="related-panel glass-panel" aria-labelledby="related-heading">
      <div class="related-heading">
        <div><p class="eyebrow">Smart discovery</p><h2 id="related-heading">Watch next</h2></div>
        <p>Category, popularity and your privacy-hashed preferences shape these suggestions.</p>
      </div>
      <form id="related-filter" class="related-filter" role="search">
        <label><span>Search suggestions</span><input name="q" type="search" maxlength="120" placeholder="Topic or keyword"></label>
        <label><span>Category</span><select name="category"><option value="">Recommended</option></select></label>
        <button class="button ghost" type="submit">Filter</button>
      </form>
      <div id="watch-related" class="related-video-list" aria-live="polite"></div>
    </aside>
  </main>
  <footer class="site-footer">Vid.Best · Human-curated video discovery</footer>
</body>
</html>`;
}

function extractTikTokId(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.pathname.match(/\/video\/(\d+)/)?.[1] || "";
  } catch {
    return "";
  }
}

function buildTikTokPlayerUrl(id) {
  const params = new URLSearchParams({
    controls: "1",
    progress_bar: "1",
    play_button: "1",
    volume_control: "1",
    fullscreen_button: "1",
    timestamp: "1",
    loop: "0",
    autoplay: "0",
    music_info: "1",
    description: "1",
    rel: "1",
    native_context_menu: "1",
    closed_caption: "1",
    muted: "0",
  });
  return `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?${params.toString()}`;
}

function extractTikTokUsername(value) {
  try {
    const match = new URL(value).pathname.match(/^\/@([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function buildTikTokPostUrl(value, id) {
  try {
    const url = new URL(value);
    const videoMatch = url.pathname.match(/\/video\/(\d+)/);
    if (videoMatch?.[1] === id) return url.toString();
  } catch {}
  return "";
}

function watchDisplayTitle(video) {
  return /saiyaara/i.test(String(video.slug || "")) || /saiyaara/i.test(String(video.title || ""))
    ? "Saiyaara; A Cinematic Romance"
    : video.title;
}

function renderMedia(video, playbackOrigin) {
  const provider = String(video.provider || "").toLowerCase();

  if (provider === "hls") {
    const poster = video.thumbnail_url ? ` poster="${escapeHtml(video.thumbnail_url)}"` : "";
    const captions = video.has_captions
      ? `<track kind="captions" src="/captions/${encodeURIComponent(video.slug)}.vtt" srclang="${escapeHtml(video.transcript_language || "en")}" label="Generated captions">`
      : "";
    return `<video id="watch-media-video" data-hls="1" controls playsinline preload="metadata"${poster}><source src="${escapeHtml(video.source_url)}" type="application/vnd.apple.mpegurl">${captions}Your browser does not support HLS video.</video>`;
  }

  if (provider === "tiktok") {
    const tiktokId = extractTikTokId(video.source_url);
    if (!tiktokId) return "";
    const embedUrl = buildTikTokPlayerUrl(tiktokId);
    return `<iframe id="watch-media-frame" class="tiktok-official-player" data-tiktok-share="${escapeHtml(video.source_url)}" src="${escapeHtml(embedUrl)}" title="${escapeHtml(watchDisplayTitle(video))}" loading="eager" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }
  if (video.embed_url) {
    const embedUrl = preparePlaybackEmbed(video.embed_url, playbackOrigin);
    if (embedUrl) {
      return `<iframe id="watch-media-frame" src="${escapeHtml(embedUrl)}" title="${escapeHtml(watchDisplayTitle(video))}" loading="eager" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"></iframe>`;
    }
  }

  const poster = video.thumbnail_url ? ` poster="${escapeHtml(video.thumbnail_url)}"` : "";
  const captions = video.has_captions
    ? `<track kind="captions" src="/captions/${encodeURIComponent(video.slug)}.vtt" srclang="${escapeHtml(video.transcript_language || "en")}" label="Generated captions">`
    : "";
  return `<video id="watch-media-video" controls playsinline preload="metadata"${poster}><source src="${escapeHtml(video.source_url)}">${captions}Your browser does not support this video.</video>`;
}
function preparePlaybackEmbed(value, playbackOrigin) {
  try {
    const url = new URL(value);
    const pageUrl = new URL(playbackOrigin);
    const hostname = url.hostname.toLowerCase().replace(/^www\\./, "");
    if (url.hostname === "www.youtube-nocookie.com" || url.hostname.endsWith(".youtube.com")) {
      url.searchParams.set("enablejsapi", "1");
      url.searchParams.set("playsinline", "1");
      url.searchParams.set("origin", pageUrl.origin);
    }
    if (url.hostname === "player.twitch.tv" || url.hostname === "clips.twitch.tv") {
      url.searchParams.set("parent", pageUrl.hostname);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function paragraphs(text) {
  return cleanLongText(text, 7000).split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function dynamicHtml(html, status = 200, scriptNonce = "") {
  const headers = securityHeaders(new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" }), true, scriptNonce);
  return new Response(html, { status, headers });
}

function createCspNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Video not found | Vid.Best</title><link rel="stylesheet" href="/styles.css"></head><body><main class="empty-page"><h1>Video not found</h1><p>This review may be unpublished or removed.</p><a class="button primary" href="/">Return home</a></main></body></html>`;
}

async function sitemapIndexResponse(request, env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM videos WHERE published = 1").first();
  const base = getBaseUrl(request, env);
  const pages = Math.max(1, Math.ceil(Number(row?.total || 0) / 1000));
  const entries = Array.from({ length: pages }, (_, index) => (
    `<sitemap><loc>${escapeXml(`${base}/sitemaps/videos-${index + 1}.xml`)}</loc></sitemap>`
  )).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`, {
    headers: securityHeaders(new Headers({ "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" })),
  });
}

async function videoSitemapResponse(request, env, page) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 50000) throw new AppError(404, "Sitemap page not found");
  const base = getBaseUrl(request, env);
  const result = await env.DB.prepare(
    `SELECT v.slug, v.title, v.description, v.seo_description, v.thumbnail_url,
            v.embed_url, v.source_url, v.media_type, v.created_at, v.updated_at,
            m.source_published_at
     FROM videos v
     LEFT JOIN video_source_metadata m ON m.video_id = v.id
     WHERE v.published = 1 ORDER BY v.id ASC LIMIT 1000 OFFSET ?`,
  ).bind((page - 1) * 1000).all();
  const rows = result.results || [];
  if (page > 1 && !rows.length) throw new AppError(404, "Sitemap page not found");
  const homepage = page === 1 ? `<url><loc>${escapeXml(`${base}/`)}</loc></url>` : "";
  const entries = rows.map((row) => {
    const canonical = `${base}/watch/${encodeURIComponent(row.slug)}`;
    const thumbnail = row.thumbnail_url ? absoluteUrl(row.thumbnail_url, base) : "";
    const description = cleanText(row.seo_description || row.description || `Discover ${row.title} on Vid.Best.`, 180);
    let videoEntry = "";
    const canDescribeVideo = thumbnail && (!row.embed_url || row.source_published_at);
    if (canDescribeVideo) {
      const location = row.embed_url
        ? `<video:player_loc allow_embed="yes">${escapeXml(preparePlaybackEmbed(row.embed_url, base))}</video:player_loc>`
        : `<video:content_loc>${escapeXml(absoluteUrl(row.source_url, base))}</video:content_loc>`;
      const publicationDate = row.source_published_at || row.created_at;
      videoEntry = `<video:video><video:thumbnail_loc>${escapeXml(thumbnail)}</video:thumbnail_loc><video:title>${escapeXml(row.title)}</video:title><video:description>${escapeXml(description)}</video:description>${location}<video:publication_date>${escapeXml(publicationDate)}</video:publication_date></video:video>`;
    }
    return `<url><loc>${escapeXml(canonical)}</loc><lastmod>${escapeXml(row.updated_at)}</lastmod>${videoEntry}</url>`;
  }).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${homepage}${entries}</urlset>`;
  return new Response(body, {
    headers: securityHeaders(new Headers({ "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" })),
  });
}

function robotsResponse(request, env) {
  const base = getBaseUrl(request, env);
  const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`;
  return new Response(body, {
    headers: securityHeaders(new Headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" })),
  });
}

function getBaseUrl(request, env) {
  const configured = cleanText(env.PUBLIC_BASE_URL, 500);
  if (configured && !configured.includes("YOUR-DOMAIN")) {
    try {
      const url = new URL(configured);
      if (["http:", "https:"].includes(url.protocol)) return url.origin;
    } catch {
      // Fall back to the current request origin.
    }
  }
  return new URL(request.url).origin;
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return `${base}/favicon.svg`;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function escapeXml(value) {
  return escapeHtml(value);
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
}
