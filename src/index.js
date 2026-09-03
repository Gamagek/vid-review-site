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
});

const REACTIONS = new Set(["like", "love", "useful"]);
const COMMENT_STATUSES = new Set(["pending", "approved", "rejected"]);
const DISCOVERY_STATUSES = new Set(["pending", "resolved", "rejected"]);
const SAFE_UPLOAD_TYPES = new Set([
  "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/ogg", "video/quicktime", "video/webm",
]);
const encoder = new TextEncoder();
const ADMIN_SESSION_COOKIE = "__Host-vidbest_admin";
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
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
    return json({ categories: CATEGORIES }, 200, { "Cache-Control": "public, max-age=3600" });
  }

  if (path === "/api/discovery-requests" && request.method === "POST") {
    return requestDiscovery(request, env);
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

  match = path.match(/^\/api\/videos\/(\d+)\/comments$/);
  if (match) {
    if (request.method === "GET") return listComments(env, Number(match[1]));
    if (request.method === "POST") return submitComment(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)$/);
  if (match && ["PATCH", "DELETE"].includes(request.method)) {
    await requireAdmin(request, env);
    if (request.method === "PATCH") return updateVideo(request, env, Number(match[1]));
    if (request.method === "DELETE") return deleteVideo(env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/([^/]+)$/);
  if (match && request.method === "GET") {
    return getPublicVideo(env, safeDecode(match[1]));
  }

  if (path === "/api/admin/session" && request.method === "POST") {
    const authentication = await requireAdmin(request, env);
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

function handleError(error) {
  if (error instanceof AppError) {
    return json(
      { success: false, error: error.message, ...(error.details ? { details: error.details } : {}) },
      error.status,
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

function securityHeaders(headers, html = false) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (html) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.tiktok.com https://www.facebook.com; upgrade-insecure-requests",
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
  return {
    ...row,
    featured: Boolean(row.featured),
    trending: Boolean(row.trending),
    published: Boolean(row.published),
    seo_tags: parseTags(row.seo_tags),
    reactions: row.reactions || { like: 0, love: 0, useful: 0 },
  };
}

async function requestDiscovery(request, env) {
  const data = await readJson(request, 8192);
  const query = cleanText(data.query, 120);
  if (query.length < 3) throw new AppError(400, "Enter at least 3 characters or paste a complete video URL");

  const possibleUrl = cleanText(data.source_url || query, 2000);
  const parsedUrl = optionalHttpUrl(possibleUrl);
  const normalized = normalizeDiscoveryQuery(query);
  const salt = String(env.REACTION_SALT || "");
  if (salt.length < 16) throw new AppError(503, "REACTION_SALT is not configured");
  const fingerprint = await sha256Hex([
    salt,
    request.headers.get("CF-Connecting-IP") || "unknown",
    request.headers.get("User-Agent") || "unknown",
  ].join("|"));

  const row = await env.DB.prepare(
    `INSERT INTO discovery_requests (
       query, normalized_query, source_url, fingerprint, request_count
     ) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(normalized_query) DO UPDATE SET
       request_count = MIN(discovery_requests.request_count + 1, 9999),
       source_url = COALESCE(excluded.source_url, discovery_requests.source_url),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     RETURNING id, query, source_url, status, request_count, created_at, updated_at`,
  ).bind(query, normalized, parsedUrl?.toString() || null, fingerprint).first();

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
  } else if (media.media_type === "tiktok") {
    endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url.toString())}`;
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
  const providerNames = { youtube: "YouTube", tiktok: "TikTok", facebook: "Facebook", raw: "Web video" };
  return {
    provider: media.media_type,
    video_id: extractYoutubeId(url, url.hostname.toLowerCase().replace(/^www\./, "")) || url.pathname.match(/\/video\/(\d+)/)?.[1] || "",
    title: cleanText(metadata.title, 160, `${providerNames[media.media_type] || "Video"} discovery`),
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
  if (subcategory && (!category || !CATEGORIES[category].includes(subcategory))) {
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
  const listStatement = env.DB.prepare(
    `SELECT v.* FROM videos v ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`,
  ).bind(...bindings, limit, offset);
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
  const row = await env.DB.prepare("SELECT * FROM videos WHERE slug = ? AND published = 1").bind(slug).first();
  if (!row) throw new AppError(404, "Video not found");
  const [video] = await hydrateVideos(env, [row]);
  return json({ video });
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

  return json({ success: true, video: serializeVideo(row) });
}

async function deleteVideo(env, id) {
  const existing = await env.DB.prepare("SELECT id FROM videos WHERE id = ?").bind(id).first();
  if (!existing) throw new AppError(404, "Video not found");
  await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();
  return json({ success: true });
}

async function validateVideoPayload(body, existing, baseUrl, env) {
  const title = cleanText(body.title, 160, existing?.title || "");
  const category = cleanText(body.primary_category, 80, existing?.primary_category || "");
  const subcategory = cleanText(body.subcategory, 80, existing?.subcategory || "");
  if (!title) throw new AppError(400, "Title is required");
  if (!Object.hasOwn(CATEGORIES, category)) throw new AppError(400, "Select a valid primary category");
  if (!CATEGORIES[category].includes(subcategory)) throw new AppError(400, "Select a valid subcategory");

  const suppliedR2Key = cleanText(body.r2_key, 500, existing?.r2_key || "");
  const suppliedSource = cleanText(body.source_url, 2000, existing?.source_url || "");
  const media = normalizeMedia(suppliedSource, suppliedR2Key, baseUrl);
  const thumbnailCandidate = body.thumbnail_url === undefined ? existing?.thumbnail_url : body.thumbnail_url;
  const thumbnailUrl = validateOptionalUrl(cleanText(thumbnailCandidate, 2000)) || media.thumbnail_url;

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

  const youtubeId = extractYoutubeId(url, hostname);
  if (youtubeId) {
    return {
      source_url: url.toString(),
      embed_url: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&playsinline=1`,
      media_type: "youtube",
      r2_key: null,
      thumbnail_url: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }

  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) {
    const id = url.pathname.match(/\/video\/(\d+)/)?.[1] || url.pathname.match(/\/player\/v1\/(\d+)/)?.[1];
    if (!id) throw new AppError(400, "Use a full TikTok video URL containing the video ID");
    return {
      source_url: url.toString(),
      embed_url: `https://www.tiktok.com/player/v1/${id}?description=1&music_info=1`,
      media_type: "tiktok",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  if (hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "fb.watch") {
    return {
      source_url: url.toString(),
      embed_url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url.toString())}&show_text=false&width=1280`,
      media_type: "facebook",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  return {
    source_url: url.toString(),
    embed_url: null,
    media_type: "raw",
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

  const salt = String(env.REACTION_SALT || "");
  if (salt.length < 16) throw new AppError(503, "REACTION_SALT is not configured");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const agent = request.headers.get("User-Agent") || "unknown";
  const fingerprint = await sha256Hex(`${salt}|${ip}|${agent}`);
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

async function uploadAsset(request, env) {
  const filename = cleanText(request.headers.get("X-File-Name") || new URL(request.url).searchParams.get("filename"), 180);
  if (!filename) throw new AppError(400, "X-File-Name header is required");
  if (!request.body) throw new AppError(400, "Upload body is empty");
  const contentType = cleanText(request.headers.get("Content-Type"), 100, "application/octet-stream").toLowerCase();
  if (!SAFE_UPLOAD_TYPES.has(contentType)) {
    throw new AppError(415, "Unsupported video or raster image type");
  }
  const maximum = clampInteger(env.MAX_UPLOAD_BYTES, 1_000_000, 500_000_000, 104_857_600);
  const contentLength = Number(request.headers.get("Content-Length"));
  if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
    throw new AppError(411, "A valid Content-Length header is required");
  }
  if (contentLength > maximum) {
    throw new AppError(413, `File exceeds the ${Math.floor(maximum / 1_048_576)} MB upload limit`);
  }

  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "asset";
  const date = new Date().toISOString().slice(0, 10);
  const key = `uploads/${date}/${crypto.randomUUID()}-${safeName}`;
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
  if (!key) throw new AppError(404, "Asset not found");
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
  headers.set("Cache-Control", headers.get("Cache-Control") || "public, max-age=31536000, immutable");
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

function secureStoredContentType(headers) {
  const contentType = (headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!SAFE_UPLOAD_TYPES.has(contentType)) {
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", "attachment");
  }
}

async function watchPage(request, env, ctx, slugInput) {
  const slug = safeDecode(slugInput).split("/")[0];
  const row = await env.DB.prepare("SELECT * FROM videos WHERE slug = ? AND published = 1").bind(slug).first();
  if (!row) return dynamicHtml(notFoundPage(), 404);
  const [video] = await hydrateVideos(env, [row]);
  ctx.waitUntil(env.DB.prepare("UPDATE videos SET views = views + 1 WHERE id = ?").bind(video.id).run());
  return dynamicHtml(renderWatchHtml(video, request, env));
}

function renderWatchHtml(video, request, env) {
  const baseUrl = getBaseUrl(request, env);
  const canonical = `${baseUrl}/watch/${encodeURIComponent(video.slug)}`;
  const title = cleanText(video.seo_title || video.title, 70);
  const description = cleanText(video.seo_description || video.description || `Discover ${video.title} on Vid.Best.`, 180);
  const thumbnail = video.thumbnail_url ? absoluteUrl(video.thumbnail_url, baseUrl) : `${baseUrl}/favicon.svg`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description,
    thumbnailUrl: [thumbnail],
    uploadDate: video.created_at,
    url: canonical,
    ...(video.embed_url ? { embedUrl: video.embed_url } : {}),
    ...(!video.embed_url ? { contentUrl: video.source_url } : {}),
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
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} | Vid.Best</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="video.other">
  <meta property="og:site_name" content="Vid.Best">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(thumbnail)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(thumbnail)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">${jsonForHtml(schema)}</script>
  <script src="/watch.js" defer></script>
</head>
<body class="watch-page" data-video-id="${Number(video.id)}">
  <header class="site-header compact">
    <a class="brand" href="/" aria-label="Vid.Best homepage"><span class="brand-mark">V</span><span>Vid.Best</span></a>
    <a class="button ghost" href="/">Explore videos</a>
  </header>
  <main class="watch-shell">
    <section class="watch-player glass-panel">${renderMedia(video)}</section>
    <article class="watch-copy glass-panel">
      <div class="tile-badges"><span class="badge">${escapeHtml(video.primary_category)}</span><span class="badge secondary">${escapeHtml(video.subcategory)}</span></div>
      <h1>${escapeHtml(video.title)}</h1>
      <p class="lead">${escapeHtml(video.description)}</p>
      <div class="watch-reactions" data-reactions='${escapeHtml(JSON.stringify(video.reactions))}'>
        <button type="button" data-reaction="like">👍 <span>${video.reactions.like}</span></button>
        <button type="button" data-reaction="love">✨ <span>${video.reactions.love}</span></button>
        <button type="button" data-reaction="useful">💡 <span>${video.reactions.useful}</span></button>
      </div>
      ${video.review_text ? `<section class="review-copy"><h2>Review & discovery notes</h2>${paragraphs(video.review_text)}</section>` : ""}
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
  </main>
  <footer class="site-footer">Vid.Best · Human-curated video discovery</footer>
</body>
</html>`;
}

function renderMedia(video) {
  if (video.embed_url) {
    return `<iframe src="${escapeHtml(video.embed_url)}" title="${escapeHtml(video.title)}" loading="eager" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"></iframe>`;
  }
  const poster = video.thumbnail_url ? ` poster="${escapeHtml(video.thumbnail_url)}"` : "";
  return `<video controls playsinline preload="metadata"${poster}><source src="${escapeHtml(video.source_url)}">Your browser does not support this video.</video>`;
}

function paragraphs(text) {
  return cleanLongText(text, 7000).split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function dynamicHtml(html, status = 200) {
  const headers = securityHeaders(new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" }), true);
  return new Response(html, { status, headers });
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
    `SELECT slug, title, description, seo_description, thumbnail_url, embed_url, source_url,
            media_type, created_at, updated_at
     FROM videos WHERE published = 1 ORDER BY id ASC LIMIT 1000 OFFSET ?`,
  ).bind((page - 1) * 1000).all();
  const rows = result.results || [];
  if (page > 1 && !rows.length) throw new AppError(404, "Sitemap page not found");
  const homepage = page === 1 ? `<url><loc>${escapeXml(`${base}/`)}</loc></url>` : "";
  const entries = rows.map((row) => {
    const canonical = `${base}/watch/${encodeURIComponent(row.slug)}`;
    const thumbnail = row.thumbnail_url ? absoluteUrl(row.thumbnail_url, base) : "";
    const description = cleanText(row.seo_description || row.description || `Discover ${row.title} on Vid.Best.`, 180);
    let videoEntry = "";
    if (thumbnail) {
      const location = row.embed_url
        ? `<video:player_loc allow_embed="yes">${escapeXml(row.embed_url)}</video:player_loc>`
        : `<video:content_loc>${escapeXml(absoluteUrl(row.source_url, base))}</video:content_loc>`;
      videoEntry = `<video:video><video:thumbnail_loc>${escapeXml(thumbnail)}</video:thumbnail_loc><video:title>${escapeXml(row.title)}</video:title><video:description>${escapeXml(description)}</video:description>${location}<video:publication_date>${escapeXml(row.created_at)}</video:publication_date></video:video>`;
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
