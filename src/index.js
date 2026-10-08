import { parseInstagramUrl } from "../public/instagram-utils.js";
import {
  requestMemberLogin,
  verifyMemberLogin,
  memberMe,
  updateMemberPreferences,
  logoutMember,
  getCurrentMember,
  notifyNewVideoSubscribers,
} from "./member-auth.js";

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
const AUTO_CACHE_VIDEO_TYPES = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/ogg", "ogv"],
  ["video/quicktime", "mov"],
]);
const AUTO_CACHE_BLOCKED_HOST_SUFFIXES = [
  "tiktok.com", "tiktokcdn.com", "tiktokv.com", "muscdn.com", "byteoversea.com", "ibytedtos.com",
  "youtube.com", "youtu.be", "googlevideo.com",
  "facebook.com", "fbcdn.net", "instagram.com", "cdninstagram.com",
  "vimeo.com", "vimeocdn.com", "dailymotion.com", "dmcdn.net", "twitch.tv",
];
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

  if (path === "/api/account/login" && request.method === "POST") return requestMemberLogin(request, env);
  if (path === "/api/account/verify" && request.method === "POST") return verifyMemberLogin(request, env);
  if (path === "/api/account/me" && request.method === "GET") return memberMe(request, env);
  if (path === "/api/account/preferences" && request.method === "POST") return updateMemberPreferences(request, env);
  if (path === "/api/account/session" && request.method === "DELETE") return logoutMember(request, env);
  if (path === "/api/account/saved" && request.method === "GET") return listSavedVideos(request, env);
  if (path === "/api/home/mini-feed" && request.method === "GET") return homeMiniFeed(request, env);
  if (path === "/api/notifications/latest" && request.method === "GET") return latestNotifications(env);
  if (path === "/api/facebook/resolve" && request.method === "GET") return resolveFacebookEndpoint(request, env);
  if (path === "/api/facebook/thumbnail" && request.method === "GET") return facebookThumbnailEndpoint(request, env);
  if (path === "/api/instagram/thumbnail" && request.method === "GET") return instagramThumbnailEndpoint(request);

  if (path === "/api/tiktok/preflight" && request.method === "GET") {
    return tikTokPreflight(request, env, ctx);
  }
  if (path === "/api/tiktok/previews" && request.method === "GET") {
    return tikTokPreviewBatch(request, env);
  }
  if (path === "/api/tiktok/embed" && request.method === "GET") {
    return tikTokEmbedModel(request, env);
  }
  if (path === "/api/tiktok/cached-previews" && request.method === "GET") {
    return tikTokCachedPreviewBatch(request, env);
  }
  if (path === "/api/tiktok/cached-poster" && request.method === "GET") {
    return tikTokCachedPoster(request, env);
  }

  if (path === "/api/instagram/previews" && request.method === "GET") {
    return instagramPreviewBatch(request, env);
  }

  if (path === "/robots.txt" && request.method === "GET") {
    return robotsResponse(request, env);
  }

  if ((path === "/privacy" || path === "/terms") && request.method === "GET") {
    const legalAsset = await env.ASSETS.fetch(request);
    return secureAssetResponse(legalAsset, path);
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
      return createVideo(request, env, ctx);
    }
  }

  match = path.match(/^\/api\/videos\/(\d+)\/reactions$/);
  if (match && request.method === "POST") {
    return toggleReaction(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)\/view$/);
  if (match && request.method === "POST") return recordViewerView(request, env, Number(match[1]));

  match = path.match(/^\/api\/videos\/(\d+)\/recommendations$/);
  if (match && request.method === "GET") {
    return recommendVideos(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)\/interest$/);
  if (match && request.method === "POST") {
    return recordVideoInterest(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)\/save$/);
  if (match && request.method === "POST") {
    return setSavedVideo(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)\/comments$/);
  if (match) {
    if (request.method === "GET") return listComments(env, Number(match[1]));
    if (request.method === "POST") return submitComment(request, env, Number(match[1]));
  }

  match = path.match(/^\/api\/videos\/(\d+)$/);
  if (match && ["PATCH", "DELETE"].includes(request.method)) {
    await requireAdmin(request, env);
    if (request.method === "PATCH") return updateVideo(request, env, Number(match[1]), ctx);
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

async function tikTokPreflight(request, env) {
  const requested = cleanText(new URL(request.url).searchParams.get("url"), 2000);
  const share = normalizeTikTokShareUrl(requested);
  if (!share) throw new AppError(400, "Use a normal TikTok sharing link");

  try {
    const preview = await fetchTikTokPreview(env, share);
    return json({
      ok: true,
      provider: "tiktok",
      video_id: preview.video_id,
      title: preview.title,
      caption: preview.caption,
      author_name: preview.author_name,
      author_url: preview.author_url,
      description: preview.description,
      thumbnail_url: preview.thumbnail_url,
      preview_card: true,
      client_embed: false,
      open_url: share,
      cached: preview.cache_source !== "gateway",
      cache_source: preview.cache_source,
    }, 200, {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
    });
  } catch (error) {
    const reason = error instanceof AppError
      ? error.message.replace(/^TikTok preview /i, "").slice(0, 120)
      : "upstream-timeout-or-network";
    return json({ ok: false, provider: "tiktok", reason }, 200, {
      "Cache-Control": "public, max-age=10, stale-while-revalidate=30",
    });
  }
}

function normalizeTikTokAuthorUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || host !== "tiktok.com") return null;
    if (!/^\/@[^/]+\/?$/.test(url.pathname)) return null;
    return `https://www.tiktok.com${url.pathname}`;
  } catch {
    return null;
  }
}

function normalizeTikTokThumbnailUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const allowed = /^([a-z0-9-]+\.)*tiktokcdn(?:-[a-z0-9-]+)?\.com$/.test(host)
      || host === "muscdn.com"
      || host.endsWith(".muscdn.com");
    return url.protocol === "https:" && allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

function tikTokPreviewFromRow(row, cacheSource = "d1") {
  if (!row) return null;
  return {
    video_id: String(row.video_id || ""),
    title: cleanText(row.title, 160, "TikTok video"),
    caption: cleanText(row.title, 220),
    author_name: cleanText(row.author_name, 120),
    author_url: normalizeTikTokAuthorUrl(row.author_url),
    description: cleanText(row.description, 260),
    thumbnail_url: normalizeTikTokThumbnailUrl(row.thumbnail_url),
    cache_source: cacheSource,
    fetched_at: row.fetched_at || null,
  };
}

async function readTikTokOEmbedCache(env, videoId) {
  if (!env.DB || !/^\d{15,25}$/.test(String(videoId || ""))) return null;
  return env.DB.prepare(
    `SELECT video_id, share_url, title, author_name, author_url, description, thumbnail_url, fetched_at
     FROM tiktok_oembed_cache
     WHERE video_id = ?`,
  ).bind(String(videoId)).first();
}

async function writeTikTokOEmbedCache(env, share, preview) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO tiktok_oembed_cache (
       video_id, share_url, title, author_name, author_url, description, thumbnail_url, fetched_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(video_id) DO UPDATE SET
       share_url = excluded.share_url,
       title = excluded.title,
       author_name = excluded.author_name,
       author_url = excluded.author_url,
       description = excluded.description,
       thumbnail_url = excluded.thumbnail_url,
       fetched_at = excluded.fetched_at,
       updated_at = excluded.updated_at`,
  ).bind(
    preview.video_id,
    share,
    preview.title || null,
    preview.author_name || null,
    preview.author_url || null,
    preview.description || null,
    preview.thumbnail_url || null,
    preview.fetched_at || new Date().toISOString(),
  ).run();
}

function tikTokEdgeCache() {
  return typeof caches !== "undefined" && caches.default ? caches.default : null;
}

function tikTokEdgeCacheKey(videoId) {
  return new Request(`https://vid.best/__tiktok-oembed-cache/${encodeURIComponent(videoId)}`);
}

async function readTikTokEdgeCache(videoId) {
  const cache = tikTokEdgeCache();
  if (!cache) return null;
  try {
    const response = await cache.match(tikTokEdgeCacheKey(videoId));
    if (!response) return null;
    const payload = await response.json();
    const fetchedAt = Date.parse(payload?.fetched_at || "");
    if (!payload?.video_id || !Number.isFinite(fetchedAt) || fetchedAt + 7 * 86400000 <= Date.now()) return null;
    return { ...payload, cache_source: fetchedAt + 86400000 <= Date.now() ? "edge-stale" : "edge" };
  } catch {
    return null;
  }
}

async function writeTikTokEdgeCache(preview) {
  const cache = tikTokEdgeCache();
  if (!cache || !preview?.video_id) return;
  const response = new Response(JSON.stringify(preview), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${preview.cache_source.includes("stale") ? 30 : Math.max(1, Math.min(86400, Math.floor((Date.parse(preview.fetched_at) + 86400000 - Date.now()) / 1000) || 300))}`,
    },
  });
  try { await cache.put(tikTokEdgeCacheKey(preview.video_id), response); } catch {}
}

function tikTokD1RowIsFresh(row) {
  const timestamp = Date.parse(String(row?.fetched_at || ""));
  return Number.isFinite(timestamp) && Date.now() - timestamp < 24 * 60 * 60 * 1000;
}

function buildTikTokOEmbedGatewayUrl(env, canonicalShare) {
  const configured = String(
    env.TIKTOK_OEMBED_GATEWAY || "https://tiktok-oembed-gateway.gkasunc.workers.dev/",
  ).trim();
  let endpoint;
  try {
    endpoint = new URL(configured);
  } catch {
    throw new AppError(503, "TikTok oEmbed gateway URL is invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port) {
    throw new AppError(503, "TikTok oEmbed gateway must use HTTPS");
  }
  endpoint.searchParams.set("url", canonicalShare);
  return endpoint.toString();
}

function unwrapTikTokOEmbedPayload(payload) {
  const candidates = [
    payload,
    payload?.oembed,
    payload?.data,
    payload?.result,
    payload?.payload,
    payload?.data?.oembed,
    payload?.result?.oembed,
    payload?.payload?.oembed,
    payload?.data?.data,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && String(candidate.type || "").toLowerCase() === "video") {
      return candidate;
    }
  }
  return null;
}

const tikTokMetadataRequests = new WeakMap();
async function fetchTikTokPreview(env, share, options = {}) {
  const canonical = normalizeTikTokShareUrl(share);
  if (!canonical) throw new AppError(400, "Use a normal TikTok sharing link");
  const owner = env.DB || env;
  let requests = tikTokMetadataRequests.get(owner);
  if (!requests) { requests = new Map(); tikTokMetadataRequests.set(owner, requests); }
  const id = canonical.match(/\/video\/(\d+)/)[1];
  if (!requests.has(id)) requests.set(id, fetchTikTokPreviewOnce(env, canonical, options).finally(() => requests.delete(id)));
  return requests.get(id);
}

async function fetchTikTokPreviewOnce(env, share, options = {}) {
  const canonicalShare = normalizeTikTokShareUrl(share);
  if (!canonicalShare) throw new AppError(400, "Use a normal TikTok sharing link");
  const videoId = canonicalShare.match(/\/video\/(\d+)\/?$/)?.[1] || "";
  if (!/^\d{15,25}$/.test(videoId)) throw new AppError(400, "TikTok video ID is invalid");

  if (!options.force) {
    const edgeHit = await readTikTokEdgeCache(videoId);
    if (edgeHit) return edgeHit;
  }

  const durable = await readTikTokOEmbedCache(env, videoId);
  if (!options.force && durable && tikTokD1RowIsFresh(durable)) {
    const preview = tikTokPreviewFromRow(durable, "d1");
    await writeTikTokEdgeCache(preview);
    return preview;
  }

  try {
    const cooldown = await env.DB?.prepare("SELECT setting_value FROM app_settings WHERE setting_key = ?")
      .bind("tiktok_metadata_cooldown").first();
    const remaining = Math.ceil((Number(cooldown?.setting_value || 0) - Date.now()) / 1000);
    if (remaining > 0) {
      const error = new AppError(503, "TikTok preview is cooling down. Please try later.", null, { "Retry-After": String(remaining) });
      error.cooldown = true;
      throw error;
    }
    const gatewayUrl = buildTikTokOEmbedGatewayUrl(env, canonicalShare);
    const response = await fetch(gatewayUrl, {
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "User-Agent": "VidBest-oEmbed-Gateway/1.0",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) {
      const header = response.headers.get("Retry-After");
      const seconds = /^\d+$/.test(header || "") ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
      const retry = Math.max(response.status === 429 ? 60 : 30, Number.isFinite(seconds) ? seconds : 0);
      await response.body?.cancel();
      const error = new AppError(response.status === 429 ? 429 : 503, "TikTok preview is temporarily unavailable. Please try later.", null, { "Retry-After": String(retry) });
      error.upstreamStatus = response.status;
      throw error;
    }

    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      throw new AppError(502, "TikTok oEmbed gateway returned a non-JSON response");
    }

    let gatewayPayload;
    try { gatewayPayload = await response.json(); } catch { gatewayPayload = null; }
    const metadata = unwrapTikTokOEmbedPayload(gatewayPayload);
    if (!metadata) {
      throw new AppError(502, "TikTok oEmbed gateway did not return a video response");
    }
    if (metadata.video_id && String(metadata.video_id) !== videoId) throw new AppError(502, "TikTok gateway returned a different video");
    const fetchedAt = Date.parse(gatewayPayload?.fetched_at || "");
    const stale = gatewayPayload?.stale === true;
    if (stale && (!Number.isFinite(fetchedAt) || fetchedAt + 7 * 86400000 <= Date.now())) throw new AppError(503, "Cached TikTok details have expired");

    const preview = {
      video_id: videoId,
      title: cleanText(metadata?.title, 160, "TikTok video"),
      caption: cleanText(metadata?.title, 220),
      author_name: cleanText(metadata?.author_name, 120),
      author_url: normalizeTikTokAuthorUrl(metadata?.author_url),
      description: cleanText(metadata?.description || metadata?.video_description || metadata?.text, 260),
      thumbnail_url: normalizeTikTokThumbnailUrl(metadata?.thumbnail_url),
      cache_source: stale ? "gateway-stale" : "gateway",
      fetched_at: Number.isFinite(fetchedAt) && fetchedAt <= Date.now() ? new Date(fetchedAt).toISOString() : new Date().toISOString(),
    };

    await writeTikTokOEmbedCache(env, canonicalShare, preview);
    await writeTikTokEdgeCache(preview);
    return preview;
  } catch (error) {
    const retry = Math.max(30, Number(error.headers?.["Retry-After"]) || 30);
    if ([404,410].includes(error.upstreamStatus)) {
      await env.DB?.prepare("DELETE FROM tiktok_oembed_cache WHERE video_id = ?").bind(videoId).run();
      try { await tikTokEdgeCache()?.delete(tikTokEdgeCacheKey(videoId)); } catch {}
    }
    if (!error.cooldown && ![404,410].includes(error.upstreamStatus)) {
      await env.DB?.prepare(`INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`)
        .bind("tiktok_metadata_cooldown", String(Date.now() + retry * 1000)).run();
    }
    if (durable && ![404,410].includes(error.upstreamStatus) && Date.parse(durable.fetched_at) + 7 * 86400000 > Date.now()) {
      const stale = tikTokPreviewFromRow(durable, "d1-stale");
      await writeTikTokEdgeCache(stale);
      return stale;
    }
    if (!error.headers?.["Retry-After"]) throw new AppError(503, "TikTok preview is temporarily unavailable. Please try later.", null, { "Retry-After": String(retry) });
    throw error;
  }
}

async function persistTikTokOEmbedMetadata(env, row) {
  if (!row || detectMediaProvider(row) !== "tiktok") return null;
  const share = normalizeTikTokShareUrl(row.source_url);
  if (!share) return null;
  try {
    const preview = await fetchTikTokPreview(env, share, { force: true });
    if (preview.thumbnail_url && !row.thumbnail_url) {
      await env.DB.prepare(
        "UPDATE videos SET thumbnail_url = COALESCE(thumbnail_url, ?) WHERE id = ?",
      ).bind(preview.thumbnail_url, Number(row.id)).run();
    }
    return preview;
  } catch (error) {
    console.error("TikTok oEmbed metadata refresh failed", error?.message || error);
    return null;
  }
}

async function tikTokEmbedModel(request, env) {
  const requested = cleanText(new URL(request.url).searchParams.get("url"), 2000);
  const share = normalizeTikTokShareUrl(requested);
  if (!share) throw new AppError(400, "Use a normal TikTok sharing link");

  const preview = await fetchTikTokPreview(env, share);
  return json({
    ok: true,
    schema_version: 4,
    provider: "tiktok",
    mode: "metadata-card",
    source_url: share,
    canonical_url: share,
    open_url: share,
    video_id: preview.video_id,
    title: preview.title,
    caption: preview.caption,
    author_name: preview.author_name,
    author_url: preview.author_url,
    description: preview.description,
    thumbnail_url: preview.thumbnail_url,
    poster_url: preview.video_id
      ? `/api/tiktok/cached-poster?id=${encodeURIComponent(preview.video_id)}`
      : null,
    cache_source: preview.cache_source,
  }, 200, {
    "Cache-Control": `public, max-age=${preview.cache_source.includes("stale") ? 30 : 86400}, stale-while-revalidate=3600`,
  });
}

async function tikTokCachedPreviewBatch(request, env) {
  const requestUrl = new URL(request.url);
  const requested = requestUrl.searchParams.getAll("url");
  if (requested.length > 24) throw new AppError(400, "A maximum of 24 cached TikTok preview URLs is supported");

  const shares = [...new Set(requested.map(normalizeTikTokShareUrl).filter(Boolean))].slice(0, 24);
  if (!shares.length) throw new AppError(400, "Add at least one TikTok video URL");

  const previews = [];
  for (const share of shares) {
    const videoId = share.match(/\/video\/(\d+)\/?$/)?.[1] || "";
    const row = await readTikTokOEmbedCache(env, videoId);
    const preview = tikTokPreviewFromRow(row, "d1");
    previews.push({
      url: share,
      video_id: videoId || null,
      title: preview?.title || null,
      caption: preview?.caption || null,
      author_name: preview?.author_name || null,
      author_url: preview?.author_url || null,
      description: preview?.description || null,
      thumbnail_url: preview?.thumbnail_url || null,
      poster_url: videoId ? `/api/tiktok/cached-poster?id=${encodeURIComponent(videoId)}` : null,
      cache_source: preview ? "d1" : "missing",
    });
  }

  return json({
    ok: true,
    count: previews.length,
    previews,
  }, 200, {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
  });
}

function splitPosterLines(value, maxChars = 25, maxLines = 4) {
  const words = cleanText(value, 180, "TikTok video").split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? current + " " + word : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

async function tikTokCachedPoster(request, env) {
  const videoId = cleanText(new URL(request.url).searchParams.get("id"), 30);
  if (!/^\d{15,25}$/.test(videoId)) throw new AppError(400, "TikTok video ID is invalid");

  const row = await readTikTokOEmbedCache(env, videoId);
  const title = cleanText(row?.description || row?.title, 180, "TikTok video");
  const author = cleanText(row?.author_name, 80, "TikTok");
  const lines = splitPosterLines(title);
  const lineSvg = lines.map((line, index) =>
    `<text x="64" y="${690 + index * 62}" font-size="42" font-weight="750" fill="#ffffff">${escapeXml(line)}</text>`
  ).join("");
  const suffix = escapeXml(videoId.slice(-8));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#10152b"/>
      <stop offset=".55" stop-color="#23294a"/>
      <stop offset="1" stop-color="#11141f"/>
    </linearGradient>
    <radialGradient id="glow" cx=".72" cy=".18" r=".72">
      <stop offset="0" stop-color="#25f4ee" stop-opacity=".42"/>
      <stop offset=".48" stop-color="#fe2c55" stop-opacity=".16"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="720" height="1280" fill="url(#bg)"/>
  <rect width="720" height="1280" fill="url(#glow)"/>
  <circle cx="360" cy="420" r="104" fill="#070914" fill-opacity=".62" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>
  <text x="360" y="443" text-anchor="middle" font-family="system-ui,sans-serif" font-size="72" font-weight="800" fill="#fff">TikTok</text>
  <text x="64" y="620" font-family="system-ui,sans-serif" font-size="25" font-weight="800" letter-spacing="4" fill="#7debf0">CACHED PREVIEW</text>
  <g font-family="system-ui,sans-serif">${lineSvg}</g>
  <text x="64" y="1010" font-family="system-ui,sans-serif" font-size="30" font-weight="650" fill="#d8dcf0">@${escapeXml(author.replace(/^@/, ""))}</text>
  <text x="64" y="1120" font-family="system-ui,sans-serif" font-size="22" fill="#9fa8c8">No TikTok player request yet</text>
  <text x="64" y="1170" font-family="system-ui,sans-serif" font-size="20" fill="#76809f">Video …${suffix}</text>
  </svg>`;

  return new Response(svg, {
    status: 200,
    headers: securityHeaders(new Headers({
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Cross-Origin-Resource-Policy": "same-origin",
    })),
  });
}

function tikTokBackfillRetryDelay(attempt) {
  if (attempt <= 1) return "+15 minutes";
  if (attempt === 2) return "+1 hour";
  if (attempt === 3) return "+6 hours";
  if (attempt === 4) return "+1 day";
  return null;
}

async function recordTikTokBackfillFailure(env, share, error) {
  const videoId = share.match(/\/video\/(\d+)\/?$/)?.[1] || "";
  if (!videoId) return;
  const existing = await env.DB.prepare(
    "SELECT failure_count FROM tiktok_oembed_backfill_failures WHERE video_id = ?",
  ).bind(videoId).first();
  const attempt = Number(existing?.failure_count || 0) + 1;
  const retry = tikTokBackfillRetryDelay(attempt);
  const message = cleanText(error?.message || "TikTok oEmbed backfill failed", 300);
  await env.DB.prepare(
    `INSERT INTO tiktok_oembed_backfill_failures (
       video_id, share_url, failure_count, last_error, next_retry_at, updated_at
     ) VALUES (?, ?, ?, ?, ${retry ? "datetime('now', ?)" : "NULL"}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(video_id) DO UPDATE SET
       share_url = excluded.share_url,
       failure_count = excluded.failure_count,
       last_error = excluded.last_error,
       next_retry_at = excluded.next_retry_at,
       updated_at = excluded.updated_at`,
  ).bind(...(retry
    ? [videoId, share, attempt, message, retry]
    : [videoId, share, attempt, message])).run();
}

export async function processTikTokOEmbedBackfill(env, options = {}) {
  if (!env.DB) return [];
  const limit = clampInteger(options.limit, 1, 6, 3);
  const candidates = await env.DB.prepare(
    `SELECT v.id, v.source_url, v.thumbnail_url
     FROM videos v
     WHERE (
       v.media_type = 'tiktok'
       OR v.source_url LIKE 'https://www.tiktok.com/%/video/%'
       OR v.source_url LIKE 'https://tiktok.com/%/video/%'
     )
       AND NOT EXISTS (
         SELECT 1 FROM tiktok_oembed_cache c
         WHERE v.source_url LIKE '%/video/' || c.video_id || '%'
       )
       AND NOT EXISTS (
         SELECT 1 FROM tiktok_oembed_backfill_failures f
         WHERE v.source_url LIKE '%/video/' || f.video_id || '%'
           AND (f.failure_count >= 5 OR (f.next_retry_at IS NOT NULL AND f.next_retry_at > datetime('now')))
       )
     ORDER BY v.id ASC
     LIMIT ?`,
  ).bind(limit).all();

  const outcomes = [];
  for (const row of candidates.results || []) {
    const share = normalizeTikTokShareUrl(row.source_url);
    if (!share) continue;
    const videoId = share.match(/\/video\/(\d+)\/?$/)?.[1] || "";
    try {
      const preview = await fetchTikTokPreview(env, share, { force: true });
      if (preview.thumbnail_url && !row.thumbnail_url) {
        await env.DB.prepare(
          "UPDATE videos SET thumbnail_url = COALESCE(thumbnail_url, ?) WHERE id = ?",
        ).bind(preview.thumbnail_url, Number(row.id)).run();
      }
      await env.DB.prepare(
        "DELETE FROM tiktok_oembed_backfill_failures WHERE video_id = ?",
      ).bind(videoId).run();
      outcomes.push({ id: Number(row.id), video_id: videoId, status: "complete" });
    } catch (error) {
      await recordTikTokBackfillFailure(env, share, error);
      outcomes.push({
        id: Number(row.id),
        video_id: videoId,
        status: "failed",
        error: cleanText(error?.message || "Backfill failed", 120),
      });
    }
  }
  return outcomes;
}

async function tikTokPreviewBatch(request, env) {
  const requestUrl = new URL(request.url);
  const requested = requestUrl.searchParams.getAll("url");
  if (requested.length > 24) throw new AppError(400, "A maximum of 24 TikTok preview URLs is supported");

  const shares = [...new Set(requested.map(normalizeTikTokShareUrl).filter(Boolean))].slice(0, 24);
  if (!shares.length) throw new AppError(400, "Add at least one TikTok video URL");

  const sorted = [...shares].sort();
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(
    `${requestUrl.origin}/__vidbest-tiktok-previews?urls=${encodeURIComponent(sorted.join("|"))}`,
  );
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const previews = [];
  for (let index = 0; index < shares.length; index += 4) {
    const chunk = shares.slice(index, index + 4);
    const settled = await Promise.allSettled(chunk.map((share) => fetchTikTokPreview(env, share)));
    settled.forEach((result, offset) => {
      const share = chunk[offset];
      if (result.status === "fulfilled") {
        previews.push({ url: share, ...result.value });
      } else {
        previews.push({
          url: share,
          video_id: share.match(/\/video\/(\d+)/)?.[1] || null,
          title: null,
          caption: null,
          author_name: null,
          author_url: null,
          description: null,
          thumbnail_url: null,
          error: result.reason instanceof Error ? result.reason.message.slice(0, 120) : "Preview unavailable",
        });
      }
    });
  }

  const result = json({
    ok: true,
    count: previews.length,
    previews,
  }, 200, {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600, stale-if-error=86400",
  });
  if (cache) await cache.put(cacheKey, result.clone());
  return result;
}

function handleError(error) {
  if (error instanceof AppError || Number.isInteger(error?.status)) {
    return json(
      { success: false, error: error.message || "Request failed", ...(error.details ? { details: error.details } : {}) },
      Number.isInteger(error?.status) ? error.status : 500,
      error.headers || {},
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
      `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self'${nonceSource} https://www.instagram.com/embed.js https://widget.tagembed.com https://www.tiktok.com https://cdn.jsdelivr.net https://www.youtube.com https://player.vimeo.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https: https://www.tiktok.com blob:; connect-src 'self' https://*.tagembed.com; frame-src 'self' https://*.tagembed.com https://www.youtube-nocookie.com https://www.youtube.com https://www.facebook.com https://player.vimeo.com https://www.dailymotion.com https://player.twitch.tv https://clips.twitch.tv https://www.instagram.com https://www.tiktok.com https://www.tiktokcdn.com https://www.tiktokv.com; upgrade-insecure-requests`,
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
  const instagramThumbnail = provider === "instagram" && row.source_url
    ? `/api/instagram/thumbnail?url=${encodeURIComponent(row.source_url)}`
    : null;
  return {
    ...row,
    provider,
    embed_url: provider === "facebook" ? getSafeFacebookEmbedUrl(row) : row.embed_url,
    thumbnail_url: row.thumbnail_url || instagramThumbnail || null,
    featured: Boolean(row.featured),
    trending: Boolean(row.trending),
    published: Boolean(row.published),
    redistribution_certified: Boolean(row.redistribution_certified),
    has_captions: Boolean(row.has_captions),
    seo_tags: parseTags(row.seo_tags),
    reactions: row.reactions || { like: 0, love: 0, useful: 0 },
  };
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
    if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") return "facebook";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  } catch {
    // Relative and malformed values are handled by their existing media type.
  }
  return video.embed_url ? "embed" : "direct";
}

async function requireCurrentMember(request, env) {
  const member = await getCurrentMember(request, env);
  if (!member) throw new AppError(401, "Sign in with email to save videos and personalize Vid.Best.");
  return member;
}

async function setSavedVideo(request, env, videoId) {
  requireSameOrigin(request);
  const member = await requireCurrentMember(request, env);
  const video = await env.DB.prepare(
    "SELECT id, primary_category, subcategory FROM videos WHERE id = ? AND published = 1",
  ).bind(videoId).first();
  if (!video) throw new AppError(404, "Video not found");

  const body = await readJson(request, 2048);
  const existing = await env.DB.prepare(
    "SELECT 1 AS saved FROM member_saved_videos WHERE member_id = ? AND video_id = ?",
  ).bind(member.id, videoId).first();
  const shouldSave = body.saved === undefined ? !existing : toBoolean(body.saved, Boolean(existing));

  if (shouldSave) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO member_saved_videos (member_id, video_id) VALUES (?, ?)",
    ).bind(member.id, videoId).run();
  } else {
    await env.DB.prepare(
      "DELETE FROM member_saved_videos WHERE member_id = ? AND video_id = ?",
    ).bind(member.id, videoId).run();
  }

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM member_saved_videos WHERE member_id = ?",
  ).bind(member.id).first();
  return json({
    success: true,
    saved: shouldSave,
    saved_count: Number(countRow?.count || 0),
    message: shouldSave
      ? "Saved. Vid.Best will use this to improve your suggestions."
      : "Removed from saved videos.",
  });
}

async function listSavedVideos(request, env) {
  const member = await requireCurrentMember(request, env);
  const limit = clampInteger(new URL(request.url).searchParams.get("limit"), 1, 48, 24);
  const result = await env.DB.prepare(
    `SELECT v.*, s.created_at AS saved_at
     FROM member_saved_videos s
     JOIN videos v ON v.id = s.video_id
     WHERE s.member_id = ? AND v.published = 1
     ORDER BY s.created_at DESC
     LIMIT ?`,
  ).bind(member.id, limit).all();
  const videos = await hydrateVideos(env, result.results || []);
  return json({ videos, count: videos.length }, 200, { "Cache-Control": "private, no-store" });
}

async function homeMiniFeed(request, env) {
  const limit = clampInteger(new URL(request.url).searchParams.get("limit"), 4, 12, 8);
  const member = await getCurrentMember(request, env);

  const [watchedResult, likedResult] = await Promise.all([
    env.DB.prepare(
      `SELECT v.* FROM videos v
       WHERE v.published = 1
       ORDER BY v.views DESC, v.reaction_count DESC, v.updated_at DESC
       LIMIT ?`,
    ).bind(limit).all(),
    env.DB.prepare(
      `SELECT v.*, COALESCE(r.positive_reactions, 0) AS positive_reactions
       FROM videos v
       LEFT JOIN (
         SELECT video_id,
           SUM(CASE WHEN reaction IN ('like','love') THEN 1 ELSE 0 END) AS positive_reactions
         FROM reactions
         GROUP BY video_id
       ) r ON r.video_id = v.id
       WHERE v.published = 1
       ORDER BY positive_reactions DESC, v.reaction_count DESC, v.views DESC, v.updated_at DESC
       LIMIT ?`,
    ).bind(limit).all(),
  ]);

  let personalizedRows = [];
  let savedRows = [];
  if (member) {
    const categories = Array.isArray(member.category_filter) ? member.category_filter.filter(Boolean).slice(0, 8) : [];
    const categoryBonus = categories.length
      ? `CASE WHEN v.primary_category IN (${categories.map(() => "?").join(",")}) THEN 36 ELSE 0 END`
      : "0";
    const personalized = await env.DB.prepare(
      `SELECT v.*,
       (
         ${categoryBonus}
         + COALESCE((
           SELECT COUNT(*) * 12
           FROM member_saved_videos s
           JOIN videos sv ON sv.id = s.video_id
           WHERE s.member_id = ? AND sv.primary_category = v.primary_category
         ), 0)
         + COALESCE((
           SELECT COUNT(*) * 18
           FROM member_saved_videos s
           JOIN videos sv ON sv.id = s.video_id
           WHERE s.member_id = ? AND sv.subcategory = v.subcategory
         ), 0)
         + MIN(v.reaction_count * 2, 30)
         + MIN(CAST(v.views / 25 AS INTEGER), 30)
         + v.featured * 6
         + v.trending * 10
       ) AS personalization_score
       FROM videos v
       WHERE v.published = 1
         AND NOT EXISTS (
           SELECT 1 FROM member_saved_videos saved
           WHERE saved.member_id = ? AND saved.video_id = v.id
         )
       ORDER BY personalization_score DESC, v.updated_at DESC
       LIMIT ?`,
    ).bind(...categories, member.id, member.id, member.id, limit).all();
    personalizedRows = personalized.results || [];

    const saved = await env.DB.prepare(
      `SELECT v.*, s.created_at AS saved_at
       FROM member_saved_videos s
       JOIN videos v ON v.id = s.video_id
       WHERE s.member_id = ? AND v.published = 1
       ORDER BY s.created_at DESC
       LIMIT ?`,
    ).bind(member.id, limit).all();
    savedRows = saved.results || [];
  } else {
    const generic = await env.DB.prepare(
      `SELECT v.* FROM videos v
       WHERE v.published = 1
       ORDER BY v.trending DESC, v.featured DESC, v.reaction_count DESC, v.views DESC, v.updated_at DESC
       LIMIT ?`,
    ).bind(limit).all();
    personalizedRows = generic.results || [];
  }

  const [forYou, mostWatched, mostLiked, saved] = await Promise.all([
    hydrateVideos(env, personalizedRows),
    hydrateVideos(env, watchedResult.results || []),
    hydrateVideos(env, likedResult.results || []),
    hydrateVideos(env, savedRows),
  ]);

  return json({
    authenticated: Boolean(member),
    personalized: Boolean(member),
    saved_count: saved.length,
    saved_ids: saved.map((video) => Number(video.id)),
    sections: {
      for_you: forYou,
      most_watched: mostWatched,
      most_liked: mostLiked,
      saved,
    },
  }, 200, { "Cache-Control": "private, no-store" });
}

async function latestNotifications(env) {
  const result = await env.DB.prepare(
    `SELECT id, slug, title, primary_category, subcategory, description, thumbnail_url, created_at
     FROM videos
     WHERE published = 1
     ORDER BY id DESC
     LIMIT 12`,
  ).all();
  return json({
    videos: (result.results || []).map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      title: row.title,
      primary_category: row.primary_category,
      subcategory: row.subcategory,
      description: cleanText(row.description, 220),
      thumbnail_url: row.thumbnail_url || null,
      created_at: row.created_at,
    })),
  }, 200, { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" });
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
    : `SELECT v.*
       FROM videos v ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`;
  const listStatement = env.DB.prepare(selectSql).bind(...bindings, limit, offset);
  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS total FROM videos v ${whereSql}`).bind(...bindings);
  const [listResult, countRow] = await env.DB.batch([listStatement, countStatement]);
  const videoRows = listResult.results || [];
  const videos = await hydrateVideos(env, videoRows);

  return json({
    videos,
    pagination: { limit, offset, total: Number(countRow.results?.[0]?.total || 0) },
  });
}

async function hydrateVideos(env, rows) {
  if (!rows.length) return [];
  await enrichFacebookRows(env, rows);
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
    `SELECT v.*, 
            a.transcript, a.language AS transcript_language,
            CASE WHEN length(a.captions_vtt) > 0 THEN 1 ELSE 0 END AS has_captions
     FROM videos v LEFT JOIN video_analysis a ON a.video_id = v.id AND a.source_url = v.source_url
     WHERE v.slug = ? AND v.published = 1`,
  ).bind(slug).first();
  if (!row) throw new AppError(404, "Video not found");
  await enrichFacebookRows(env, [row]);
  const [video] = await hydrateVideos(env, [row]);
  return json({ video });
}

// A prepared player is not a view. The active swipe viewer records its own visits.
async function recordViewerView(request, env, videoId) {
  requireSameOrigin(request);
  const video = await env.DB.prepare("SELECT id FROM videos WHERE id = ? AND published = 1").bind(videoId).first();
  if (!video) throw new AppError(404, "Video not found");
  const fingerprint = await requestFingerprint(request, await resolveReactionSalt(env));
  const attempts = await recordRateLimit(env, `video-view:${videoId}`, fingerprint, 1, 1800, false);
  if (attempts === 1) await env.DB.prepare("UPDATE videos SET views = views + 1 WHERE id = ? AND published = 1").bind(videoId).run();
  const row = await env.DB.prepare("SELECT views FROM videos WHERE id = ? AND published = 1").bind(videoId).first();
  return json({ views: Number(row?.views || 0), counted: attempts === 1 }, 200, { "Cache-Control": "no-store" });
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

async function createVideo(request, env, ctx) {
  const body = await readJson(request);
  const baseUrl = getBaseUrl(request, env);
  const data = await validateVideoPayload(body, null, baseUrl, env);
  data.slug = await uniqueSlug(env, data.title, body.slug);

  const row = await env.DB.prepare(
    `INSERT INTO videos (
      slug, title, source_url, source_page_url, embed_url, media_type, r2_key,
      redistribution_certified, redistribution_certified_at,
      cache_source_url, cache_status, cache_error, cache_attempts, cache_next_attempt_at, cached_at,
      primary_category, subcategory, description, review_text,
      seo_title, seo_description, seo_tags, thumbnail_url,
      featured, trending, published
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
  ).bind(
    data.slug,
    data.title,
    data.source_url,
    data.source_page_url,
    data.embed_url,
    data.media_type,
    data.r2_key,
    Number(data.redistribution_certified),
    data.redistribution_certified_at,
    data.cache_source_url,
    data.cache_status,
    data.cache_error,
    data.cache_attempts,
    data.cache_next_attempt_at,
    data.cached_at,
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

  if (row?.published) {
    ctx?.waitUntil?.(notifyNewVideoSubscribers(env, row));
    if (detectMediaProvider(row) === "facebook") ctx?.waitUntil?.(persistFacebookPreview(env, row));
  }
  if (detectMediaProvider(row) === "tiktok" && String(env.TIKTOK_OEMBED_REFRESH_ON_PUBLISH || "") === "1") {
    ctx?.waitUntil?.(persistTikTokOEmbedMetadata(env, row));
  }
  if (row?.cache_status === "pending") {
    ctx?.waitUntil?.(processAuthorizedCacheJobs(env, { videoId: Number(row.id), limit: 1 }));
  }
  return json({ success: true, video: serializeVideo(row) }, 201);
}

async function updateVideo(request, env, id, ctx) {
  const existing = await env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first();
  if (!existing) throw new AppError(404, "Video not found");
  const body = await readJson(request);
  const data = await validateVideoPayload(body, existing, getBaseUrl(request, env), env);

  const row = await env.DB.prepare(
    `UPDATE videos SET
      title = ?, source_url = ?, source_page_url = ?, embed_url = ?, media_type = ?, r2_key = ?,
      redistribution_certified = ?, redistribution_certified_at = ?,
      cache_source_url = ?, cache_status = ?, cache_error = ?, cache_attempts = ?, cache_next_attempt_at = ?, cached_at = ?,
      primary_category = ?, subcategory = ?, description = ?, review_text = ?,
      seo_title = ?, seo_description = ?, seo_tags = ?, thumbnail_url = ?,
      featured = ?, trending = ?, published = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? RETURNING *`,
  ).bind(
    data.title,
    data.source_url,
    data.source_page_url,
    data.embed_url,
    data.media_type,
    data.r2_key,
    Number(data.redistribution_certified),
    data.redistribution_certified_at,
    data.cache_source_url,
    data.cache_status,
    data.cache_error,
    data.cache_attempts,
    data.cache_next_attempt_at,
    data.cached_at,
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


  if (row?.published && !existing.published) {
    ctx?.waitUntil?.(notifyNewVideoSubscribers(env, row));
  }
  if (row?.published && detectMediaProvider(row) === "facebook") {
    ctx?.waitUntil?.(persistFacebookPreview(env, row));
  }
  if (
    detectMediaProvider(row) === "tiktok"
    && String(env.TIKTOK_OEMBED_REFRESH_ON_PUBLISH || "") === "1"
    && (existing.source_url !== row.source_url || (!existing.published && row.published))
  ) {
    ctx?.waitUntil?.(persistTikTokOEmbedMetadata(env, row));
  }
  if (row?.cache_status === "pending") {
    ctx?.waitUntil?.(processAuthorizedCacheJobs(env, { videoId: Number(row.id), limit: 1 }));
  }
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
  const customThumbnail = validateOptionalUrl(thumbnailText);
  const thumbnailUrl = customThumbnail || media.thumbnail_url;

  const storedVideo = Boolean(media.r2_key && isStoredVideoKey(media.r2_key));
  const cacheSourceCandidate = body.cache_source_url === undefined
    ? existing?.cache_source_url
    : body.cache_source_url;
  const cacheSourceUrl = cleanText(cacheSourceCandidate, 2000)
    ? validateAuthorizedCacheSourceUrl(cacheSourceCandidate)
    : null;
  const redistributionCertified = toBoolean(
    body.media_rights_confirmed,
    Boolean(existing?.redistribution_certified),
  );
  if ((storedVideo || cacheSourceUrl) && !redistributionCertified) {
    throw new AppError(400, "Certify that you own this video or have permission to redistribute and cache it before storing or auto-caching it on Vid.Best");
  }

  const sourcePageCandidate = body.source_page_url === undefined
    ? existing?.source_page_url
    : body.source_page_url;
  const sourcePageUrl = media.r2_key || cacheSourceUrl
    ? validateOptionalUrl(cleanText(sourcePageCandidate || suppliedSource, 2000))
    : null;
  const redistributionCertifiedAt = redistributionCertified
    ? (existing?.redistribution_certified_at || new Date().toISOString())
    : null;

  const cacheSourceChanged = Boolean(existing) && cacheSourceUrl !== (existing?.cache_source_url || null);
  const shouldQueueAutoCache = Boolean(cacheSourceUrl && redistributionCertified && !media.r2_key)
    && (!existing || cacheSourceChanged || existing.cache_status !== "complete");
  const cacheStatus = media.r2_key
    ? (existing?.cached_at ? "complete" : "none")
    : shouldQueueAutoCache
      ? "pending"
      : (cacheSourceUrl ? cleanText(existing?.cache_status, 20, "pending") : "none");

  return {
    title,
    source_url: media.source_url,
    source_page_url: sourcePageUrl,
    embed_url: media.embed_url,
    media_type: media.media_type,
    r2_key: media.r2_key,
    redistribution_certified: redistributionCertified,
    redistribution_certified_at: redistributionCertifiedAt,
    cache_source_url: cacheSourceUrl,
    cache_status: cacheStatus,
    cache_error: shouldQueueAutoCache ? null : (existing?.cache_error || null),
    cache_attempts: shouldQueueAutoCache ? 0 : Number(existing?.cache_attempts || 0),
    cache_next_attempt_at: shouldQueueAutoCache ? null : (existing?.cache_next_attempt_at || null),
    cached_at: media.r2_key ? (existing?.cached_at || null) : null,
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

async function persistFacebookPreview(env, row) {
  try {
    const preview = await fetchFacebookPreview(env, row.source_url);
    if (!preview) return;
    const nextEmbed = buildFacebookPlayerUrl(preview.url);
    const nextThumbnail = preview.thumbnail_url || row.thumbnail_url || null;
    await env.DB.prepare(
      "UPDATE videos SET embed_url = COALESCE(?, embed_url), thumbnail_url = COALESCE(?, thumbnail_url), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).bind(nextEmbed || null, nextThumbnail, Number(row.id)).run();
  } catch (error) {
    console.error("Facebook preview enrichment failed", error?.message || error);
  }
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
      embed_url: null,
      media_type: "tiktok",
      provider: "tiktok",
      r2_key: null,
      thumbnail_url: null,
    };
  }

  if (hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "fb.watch") {
    return {
      source_url: url.toString(),
      embed_url: buildFacebookPlayerUrl(url.toString()),
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
    const instagram = parseInstagramUrl(url.toString());
    if (!instagram) throw new AppError(400, "Use a full public Instagram post or Reel URL");
    return {
      source_url: instagram.sourceUrl,
      embed_url: instagram.embedUrl,
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
  const isVideoUpload = contentType.startsWith("video/") || isHlsUpload || ["audio/aac", "audio/mp4"].includes(contentType);
  if (isVideoUpload && request.headers.get("X-Media-Rights-Confirmed") !== "1") {
    throw new AppError(400, "Certify that you own this video or have permission to redistribute and cache it before uploading");
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
    customMetadata: {
      originalFilename: filename.slice(0, 180),
      ...(isVideoUpload ? { redistributionCertified: "1" } : {}),
    },
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

function isStoredVideoKey(key) {
  return /\.(?:mp4|webm|ogg|ogv|mov|m3u8|ts|m4s|aac|m4a)$/i.test(String(key || ""));
}

function isBlockedAutoCacheHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
  return AUTO_CACHE_BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function validateAuthorizedCacheSourceUrl(value) {
  let url;
  try {
    url = new URL(cleanText(value, 2000));
  } catch {
    throw new AppError(400, "Authorized cache source URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || isBlockedAutoCacheHost(url.hostname)) {
    throw new AppError(400, "Use a public HTTPS media URL from storage or a CDN you control. Social-platform and private-network media URLs are not accepted for automatic caching.");
  }
  return url.toString();
}

function autoCacheBaseUrl(env) {
  try {
    const url = new URL(cleanText(env.PUBLIC_BASE_URL, 500, "https://vid.best"));
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {}
  return "https://vid.best";
}

function autoCacheRetryDelay(attempts) {
  return attempts <= 1 ? "+15 minutes" : attempts === 2 ? "+1 hour" : "+6 hours";
}

async function cacheAuthorizedVideo(env, video) {
  const id = Number(video.id);
  const attempts = Number(video.cache_attempts || 0) + 1;
  await env.DB.prepare(
    `UPDATE videos
     SET cache_status = 'running', cache_error = NULL, cache_attempts = ?,
         cache_next_attempt_at = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? AND r2_key IS NULL`,
  ).bind(attempts, id).run();

  let key = null;
  try {
    const requestedUrl = validateAuthorizedCacheSourceUrl(video.cache_source_url);
    const response = await fetch(requestedUrl, {
      method: "GET",
      headers: { Accept: "video/mp4,video/webm,video/ogg,video/quicktime" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok || !response.body) throw new Error(`Authorized media source returned HTTP ${response.status}`);

    validateAuthorizedCacheSourceUrl(response.url || requestedUrl);
    const contentType = (response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
    const extension = AUTO_CACHE_VIDEO_TYPES.get(contentType);
    if (!extension) {
      throw new Error("Automatic cache accepts direct MP4, WebM, Ogg or MOV files. HLS packages must use the existing authorized folder upload.");
    }

    const maximum = clampInteger(env.MAX_AUTO_CACHE_BYTES || env.MAX_UPLOAD_BYTES, 1_000_000, 500_000_000, 104_857_600);
    const contentLength = Number(response.headers.get("Content-Length"));
    if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
      throw new Error("Authorized media source must provide a valid Content-Length");
    }
    if (contentLength > maximum) {
      throw new Error(`Authorized media file exceeds the ${Math.floor(maximum / 1_048_576)} MB automatic-cache limit`);
    }

    const date = new Date().toISOString().slice(0, 10);
    key = `uploads/auto/${date}/${id}-${crypto.randomUUID()}.${extension}`;
    await env.BUCKET.put(key, response.body, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
        contentDisposition: "inline",
      },
      customMetadata: {
        redistributionCertified: "1",
        autoCached: "1",
        sourceOrigin: new URL(requestedUrl).origin.slice(0, 180),
      },
    });

    const mediaUrl = `${autoCacheBaseUrl(env)}/media/${encodeR2Key(key)}`;
    await env.DB.prepare(
      `UPDATE videos SET
         source_page_url = COALESCE(source_page_url, source_url),
         source_url = ?, embed_url = NULL, media_type = 'r2', r2_key = ?,
         cache_status = 'complete', cache_error = NULL, cache_next_attempt_at = NULL,
         cached_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND redistribution_certified = 1`,
    ).bind(mediaUrl, key, id).run();
    return { id, status: "complete", key };
  } catch (error) {
    if (key) {
      try { await env.BUCKET.delete(key); } catch {}
    }
    const message = cleanText(error?.message || "Automatic cache failed", 400);
    const exhausted = attempts >= 3;
    await env.DB.prepare(
      `UPDATE videos SET
         cache_status = 'failed', cache_error = ?,
         cache_next_attempt_at = ${exhausted ? "NULL" : "datetime('now', ?)"},
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).bind(...(exhausted ? [message, id] : [message, autoCacheRetryDelay(attempts), id])).run();
    console.error("Authorized auto-cache failed", id, message);
    return { id, status: "failed", error: message };
  }
}

export async function processAuthorizedCacheJobs(env, options = {}) {
  const limit = clampInteger(options.limit, 1, 4, 2);
  const videoId = Number(options.videoId || 0);
  const whereVideo = Number.isSafeInteger(videoId) && videoId > 0 ? "AND id = ?" : "";
  const statement = env.DB.prepare(
    `SELECT id, cache_source_url, cache_status, cache_attempts
     FROM videos
     WHERE redistribution_certified = 1
       AND r2_key IS NULL
       AND cache_source_url IS NOT NULL
       AND length(cache_source_url) > 0
       AND cache_status IN ('pending', 'failed')
       AND cache_attempts < 3
       AND (cache_next_attempt_at IS NULL OR cache_next_attempt_at <= datetime('now'))
       ${whereVideo}
     ORDER BY updated_at ASC
     LIMIT ?`,
  );
  const result = Number.isSafeInteger(videoId) && videoId > 0
    ? await statement.bind(videoId, limit).all()
    : await statement.bind(limit).all();

  const outcomes = [];
  for (const video of result.results || []) {
    outcomes.push(await cacheAuthorizedVideo(env, video));
  }
  return outcomes;
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
  await enrichFacebookRows(env, [row]);
  const [video] = await hydrateVideos(env, [row]);
  if (video.provider === "tiktok") {
    const tiktokId = extractTikTokId(video.source_url);
    const previewRow = tiktokId ? await readTikTokOEmbedCache(env, tiktokId) : null;
    video.tiktok_preview = tikTokPreviewFromRow(previewRow, previewRow ? "d1" : "missing");
  }
  const viewer = new URL(request.url).searchParams.get("viewer") === "1";
  if (!viewer) ctx.waitUntil(env.DB.prepare("UPDATE videos SET views = views + 1 WHERE id = ?").bind(video.id).run());
  const scriptNonce = createCspNonce();
  const response = dynamicHtml(renderWatchHtml(video, request, env, scriptNonce), 200, scriptNonce);
  response.headers.set("Cache-Control", "private, no-store");
  if (viewer) response.headers.set("X-Robots-Tag", "noindex,nofollow");
  return response;
}

function renderWatchHtml(video, request, env, scriptNonce) {
  const viewer = new URL(request.url).searchParams.get("viewer") === "1";
  const saiyaaraWidget = video.provider === "tiktok" &&
    video.slug === "saiyaara-a-cinematic-romance" && !viewer;
  const baseUrl = getBaseUrl(request, env);
  const playbackOrigin = new URL(request.url).origin;
  const canonical = `${baseUrl}/watch/${encodeURIComponent(video.slug)}`;
  const title = cleanText(watchDisplayTitle(video), 70);
  const description = cleanText(video.seo_description || video.description || `Discover ${video.title} on Vid.Best.`, 180);
  const tiktokId = video.provider === "tiktok" ? extractTikTokId(video.source_url) : "";
  const thumbnail = video.thumbnail_url
    ? absoluteUrl(video.thumbnail_url, baseUrl)
    : tiktokId
      ? `${baseUrl}/api/tiktok/cached-poster?id=${encodeURIComponent(tiktokId)}`
      : "";
  const tags = Array.isArray(video.seo_tags) ? video.seo_tags.slice(0, 20) : [];
  const uploadDate = video.source_published_at || video.created_at;
  const videoSchema = {
    "@type": "VideoObject",
    "@id": `${canonical}#video`,
    name: watchDisplayTitle(video),
    description,
    ...(thumbnail ? { thumbnailUrl: [thumbnail] } : {}),
    uploadDate,
    url: canonical,
    mainEntityOfPage: canonical,
    ...(video.source_duration ? { duration: video.source_duration } : {}),
    ...(video.provider === "facebook" && getSafeFacebookEmbedUrl(video) ? { embedUrl: getSafeFacebookEmbedUrl(video) } : video.embed_url && video.provider !== "tiktok" ? { embedUrl: preparePlaybackEmbed(video.embed_url, playbackOrigin) } : {}),
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
  <link rel="stylesheet" href="/styles.css?v=20261008-saiyaara-2">
  <script type="application/ld+json" nonce="${scriptNonce}">${jsonForHtml(schema)}</script>
  ${video.provider === "tiktok" ? '<script src="/tiktok-preview-service.js?v=20261008-6" defer></script>' : ""}
  ${saiyaaraWidget ? '<script src="/saiyaara-tagembed.js?v=20261008-2" defer></script>' : ""}
  <script src="/watch.js?v=20261008-2" defer></script>
  <link rel="stylesheet" href="/swipe-viewer.css?v=20261006-1">
  <script src="/${viewer ? "swipe-player-bridge" : "swipe-viewer"}.js?v=20261008-2" defer></script>
  ${video.provider === "instagram" ? '<link rel="stylesheet" href="/instagram-player.css"><script type="module" src="/instagram-player.js"></script>' : ""}
  ${video.provider === "tiktok" ? '<!-- TikTok watch pages start with cached oEmbed metadata; the standard TikTok embed is created only after user action. -->' : ""}
</head>
<body class="watch-page" data-viewer-embed="${viewer ? "1" : "0"}" data-video-slug="${escapeHtml(video.slug)}" data-site-views="${Number(video.views) + (viewer ? 0 : 1)}" data-video-id="${Number(video.id)}" data-video-provider="${escapeHtml(video.provider)}">
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
        <button type="button" data-swipe-open>⛶ Fullscreen / Swipe</button>
        <span id="persistent-player-status" role="status">Scroll to keep watching</span>
        <button type="button" data-player-mode="restore" hidden>Return</button>
        <button type="button" data-player-mode="theater">Pop-up</button>
        <button type="button" data-player-mode="close" aria-label="Close persistent player">Close</button>
      </div>
      <div class="watch-player-stage">${renderMedia(video, playbackOrigin, viewer)}</div>
    </section>
    <article class="watch-copy glass-panel">
      <div class="tile-badges"><span class="badge">${escapeHtml(video.primary_category)}</span><span class="badge secondary">${escapeHtml(video.subcategory)}</span></div>
      <h1>${escapeHtml(watchDisplayTitle(video))}</h1>
      <p class="lead">${escapeHtml(video.description)}</p>
      <p class="site-view-count">${Number(video.views) + (viewer ? 0 : 1)} Vid.Best views</p>
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
      <a class="source-link" href="${escapeHtml(video.source_page_url || video.source_url)}" target="_blank" rel="noopener noreferrer nofollow">Open original source ↗</a>
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
  <footer class="site-footer">
    <span>Vid.Best · Video discovery and reviews</span>
    <span><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></span>
  </footer>
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

function renderMedia(video, playbackOrigin, viewer = false) {
  const provider = String(video.provider || "").toLowerCase();

  if (provider === "instagram") {
    const instagram = parseInstagramUrl(video.source_url);
    if (!instagram) return '<p>Use a full public Instagram post or Reel link to load this video.</p>';
    return `<div class="instagram-player" data-instagram-source="${escapeHtml(instagram.sourceUrl)}"><iframe id="watch-media-frame" class="instagram-official-player" src="${escapeHtml(instagram.embedUrl)}" title="${escapeHtml(video.title)}" loading="eager" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><noscript><a href="${escapeHtml(instagram.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open on Instagram</a></noscript></div>`;
  }

  if (provider === "hls") {
    const poster = video.thumbnail_url ? ` poster="${escapeHtml(video.thumbnail_url)}"` : "";
    const captions = video.has_captions
      ? `<track kind="captions" src="/captions/${encodeURIComponent(video.slug)}.vtt" srclang="${escapeHtml(video.transcript_language || "en")}" label="Generated captions">`
      : "";
    return `<video id="watch-media-video" data-hls="1" controls playsinline preload="metadata"${poster}><source src="${escapeHtml(video.source_url)}" type="application/vnd.apple.mpegurl">${captions}Your browser does not support HLS video.</video>`;
  }

  if (provider === "tiktok") {
    // Only the canonical Saiyaara watch page opts into the owner-supplied
    // Tagembed widget. The swipe preparation document remains metadata-only.
    if (video.slug === "saiyaara-a-cinematic-romance" && !viewer) {
      const poster = video.tiktok_preview?.thumbnail_url || video.thumbnail_url ||
        `/api/tiktok/cached-poster?id=${encodeURIComponent(extractTikTokId(video.source_url))}`;
      return `<div class="saiyaara-tagembed-player" data-saiyaara-tagembed-host data-saiyaara-player="watch" data-saiyaara-poster="${escapeHtml(poster)}">
        <div class="tagembed-widget" style="width:100%;height:100%;overflow:auto;" data-widget-id="2236794" data-caption="1" data-header="1" data-post-id="5592899"></div>
      </div>`;
    }
    const tiktokId = extractTikTokId(video.source_url);
    if (!tiktokId) return "";
    const preview = video.tiktok_preview || {};
    const previewTitle = cleanText(
      preview.title || preview.caption || watchDisplayTitle(video),
      180,
      watchDisplayTitle(video),
    );
    const previewAuthor = cleanText(
      preview.author_name || extractTikTokUsername(video.source_url),
      90,
      "TikTok creator",
    );
    const previewDescription = cleanText(
      preview.description,
      260,
      "Preview details are cached by Vid.Best. Open the original TikTok post to watch the video.",
    );
    const imageUrl = preview.thumbnail_url || `/api/tiktok/cached-poster?id=${encodeURIComponent(tiktokId)}`;
    return `<article class="tiktok-preview-card" data-tiktok-id="${escapeHtml(tiktokId)}" data-tiktok-source="${escapeHtml(video.source_url)}" data-tiktok-player-mode="metadata-card">
      <button type="button" class="tiktok-preview-card-media" data-tiktok-show-preview aria-label="Play TikTok video in popup">
        <img class="tiktok-preview-card-image" src="${escapeHtml(imageUrl)}" data-tiktok-fallback="/api/tiktok/cached-poster?id=${encodeURIComponent(tiktokId)}" alt="" loading="eager" decoding="async">
        <span class="tiktok-preview-card-play" aria-hidden="true">▶</span>
      </button>
      <div class="tiktok-preview-card-body">
        <span class="tiktok-preview-card-kicker">TikTok preview</span>
        <strong data-tiktok-card-title>${escapeHtml(previewTitle)}</strong>
        <span class="tiktok-preview-card-author" data-tiktok-card-author>${escapeHtml(previewAuthor)}</span>
        <p data-tiktok-card-description>${escapeHtml(previewDescription)}</p>
        <div class="tiktok-preview-card-actions">
          <button type="button" class="button primary" data-tiktok-show-preview>Play in popup</button>
        </div>
        <p class="tiktok-preview-card-note">The TikTok embed loads only after you choose Play.</p>
      </div>
    </article>`;
  }
  if (provider === "facebook") {
    const facebookEmbed = getSafeFacebookEmbedUrl(video);
    if (facebookEmbed) {
      return `<iframe id="watch-media-frame" class="facebook-official-player" src="${escapeHtml(facebookEmbed)}" title="${escapeHtml(watchDisplayTitle(video))}" loading="eager" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    }
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
async function resolveFacebookEndpoint(request, env) {
  const url = new URL(request.url);
  const requested = cleanText(url.searchParams.get("url"), 2000);
  if (!requested) throw new AppError(400, "Add a Facebook video URL");

  const resolved = await resolveFacebookContentUrl(env, requested);
  if (!resolved) throw new AppError(422, "Facebook video URL could not be resolved to a supported video page");

  return json({
    ok: true,
    provider: "facebook",
    source_url: resolved,
    embed_url: buildFacebookPlayerUrl(resolved),
  }, 200, { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" });
}


async function instagramThumbnailEndpoint(request) {
  const requested = cleanText(new URL(request.url).searchParams.get("url"), 2000);
  const instagram = parseInstagramUrl(requested);
  if (!instagram) throw new AppError(400, "Add a full public Instagram post or Reel URL");

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(
    "https://vid.best/__instagram-thumbnail?url=" + encodeURIComponent(instagram.sourceUrl),
  );
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: 200,
        headers: {
          "Content-Type": cached.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  }

  const preview = await fetchInstagramPreview(instagram.sourceUrl);
  const thumbnailUrl = safeInstagramThumbnailUrl(preview?.thumbnail_url);
  if (!thumbnailUrl) throw new AppError(404, "Instagram thumbnail is unavailable");

  const response = await fetch(thumbnailUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: "https://www.instagram.com/",
      "User-Agent": "VidBest-Instagram-Preview/1.0",
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new AppError(502, "Instagram thumbnail fetch failed");
  const contentType = (response.headers.get("Content-Type") || "").toLowerCase().split(";", 1)[0].trim();
  if (!contentType.startsWith("image/")) throw new AppError(502, "Instagram preview did not return an image");

  const image = new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
  if (cache) {
    try { await cache.put(cacheKey, image.clone()); } catch {}
  }
  return image;
}

async function fetchInstagramPreview(sourceUrl) {
  const instagram = parseInstagramUrl(sourceUrl);
  if (!instagram) return null;

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(
    "https://vid.best/__instagram-preview?url=" + encodeURIComponent(instagram.sourceUrl),
  );
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const payload = await cached.json();
        if (payload?.source_url === instagram.sourceUrl || payload?.url === instagram.sourceUrl) return payload;
      } catch {}
    }
  }

  let metadata = {};
  try {
    const endpoint = new URL("https://graph.facebook.com/v26.0/instagram_oembed");
    endpoint.searchParams.set("url", instagram.sourceUrl);
    endpoint.searchParams.set("maxwidth", "540");
    const response = await fetch(endpoint.toString(), {
      headers: { Accept: "application/json", "User-Agent": "VidBest-Instagram-Preview/1.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) {
      try { metadata = await response.json(); } catch { metadata = {}; }
    }
  } catch {}

  let html = "";
  let title = cleanText(metadata?.title || "", 180);
  let description = cleanText(metadata?.description || "", 320);
  let authorName = cleanText(metadata?.author_name || "", 120);
  let authorUrl = "";
  try {
    const candidate = new URL(String(metadata?.author_url || ""));
    const host = candidate.hostname.toLowerCase().replace(/^www\./, "");
    if (candidate.protocol === "https:" && host === "instagram.com" && /^\/[^/]+\/?$/.test(candidate.pathname)) {
      authorUrl = "https://www.instagram.com" + candidate.pathname;
    }
  } catch {}

  let thumbnailUrl = safeInstagramThumbnailUrl(metadata?.thumbnail_url);
  if (!thumbnailUrl || !title || !description || !authorName) {
    try {
      const response = await fetch(instagram.sourceUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "VidBest-Instagram-Preview/1.0",
        },
        signal: AbortSignal.timeout(7000),
      });
      if (response.ok) html = await response.text();
    } catch {}
  }

  if (html) {
    thumbnailUrl = thumbnailUrl
      || safeInstagramThumbnailUrl(readMetaTag(html, "og:image"))
      || safeInstagramThumbnailUrl(readMetaTag(html, "twitter:image"))
      || safeInstagramThumbnailUrl(readMetaTag(html, "og:image:url"));
    title = title || decodeHtmlEntities(cleanText(readMetaTag(html, "og:title") || readMetaTag(html, "twitter:title"), 180));
    description = description || decodeHtmlEntities(cleanText(readMetaTag(html, "og:description") || readMetaTag(html, "description"), 320));
    authorName = authorName || cleanText(readMetaTag(html, "author"), 120);
  }

  const payload = {
    url: instagram.sourceUrl,
    source_url: instagram.sourceUrl,
    embed_url: instagram.embedUrl,
    id: instagram.id,
    kind: instagram.sourceUrl.includes("/reel/") ? "reel" : instagram.sourceUrl.includes("/tv/") ? "tv" : "post",
    title: title || null,
    description: description || null,
    author_name: authorName || null,
    author_url: authorUrl || null,
    thumbnail_url: thumbnailUrl || null,
    embed_available: Boolean(metadata?.html),
  };

  if (cache) {
    try {
      const cached = json(payload, 200, {
        "Cache-Control": payload.thumbnail_url
          ? "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800"
          : "public, max-age=600, stale-while-revalidate=1800",
      });
      await cache.put(cacheKey, cached.clone());
    } catch {}
  }
  return payload;
}

async function instagramPreviewBatch(request, env) {
  const requestUrl = new URL(request.url);
  const requested = requestUrl.searchParams.getAll("url");
  if (requested.length > 24) throw new AppError(400, "A maximum of 24 Instagram preview URLs is supported");

  const normalized = [...new Map(
    requested
      .map((value) => parseInstagramUrl(value))
      .filter(Boolean)
      .map((item) => [item.sourceUrl, item]),
  ).values()].slice(0, 24);

  if (!normalized.length) throw new AppError(400, "Add at least one Instagram post or Reel URL");

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const sorted = normalized.map((item) => item.sourceUrl).sort();
  const cacheKey = new Request(
    requestUrl.origin + "/__vidbest-instagram-previews?urls=" + encodeURIComponent(sorted.join("|")),
  );
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const previews = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const chunk = normalized.slice(index, index + 4);
    const settled = await Promise.allSettled(chunk.map((item) => fetchInstagramPreview(item.sourceUrl)));
    settled.forEach((result, offset) => {
      const item = chunk[offset];
      if (result.status === "fulfilled" && result.value) {
        previews.push(result.value);
      } else {
        previews.push({
          url: item.sourceUrl,
          source_url: item.sourceUrl,
          embed_url: item.embedUrl,
          id: item.id,
          kind: item.sourceUrl.includes("/reel/") ? "reel" : "post",
          title: null,
          description: null,
          author_name: null,
          author_url: null,
          thumbnail_url: null,
          embed_available: false,
        });
      }
    });
  }

  const response = json({ ok: true, count: previews.length, previews }, 200, {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=1800, stale-if-error=3600",
  });
  if (cache) {
    try { await cache.put(cacheKey, response.clone()); } catch {}
  }
  return response;
}

function safeInstagramThumbnailUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const allowed = host === "instagram.com"
      || host.endsWith(".instagram.com")
      || host === "cdninstagram.com"
      || host.endsWith(".cdninstagram.com")
      || host === "fbcdn.net"
      || host.endsWith(".fbcdn.net")
      || host === "lookaside.fbsbx.com";
    return allowed ? url.toString() : "";
  } catch {
    return "";
  }
}

async function facebookThumbnailEndpoint(request, env) {
  const url = new URL(request.url);
  const requested = cleanText(url.searchParams.get("url"), 2000);
  if (!requested || !isFacebookUrl(requested)) throw new AppError(400, "Add a Facebook video URL");
  let normalized;
  try {
    const value = new URL(requested);
    value.hash = "";
    normalized = value.toString();
  } catch {
    throw new AppError(400, "Invalid Facebook video URL");
  }
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request("https://vid.best/__facebook-thumbnail?url=" + encodeURIComponent(normalized));
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, { status: 200, headers: {
      "Content-Type": cached.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
    }});
  }
  const preview = await fetchFacebookPreview(env, normalized);
  const thumbnailUrl = safeFacebookThumbnailUrl(preview?.thumbnail_url);
  if (!thumbnailUrl) throw new AppError(404, "Facebook thumbnail is unavailable");
  const response = await fetch(thumbnailUrl, {
    headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "User-Agent": "VidBest-Facebook-Preview/1.0" },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new AppError(502, "Facebook thumbnail fetch failed");
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) throw new AppError(502, "Facebook preview did not return an image");
  const image = new Response(response.body, { status: 200, headers: {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
    "X-Content-Type-Options": "nosniff",
  }});
  if (cache) { try { await cache.put(cacheKey, image.clone()); } catch {} }
  return image;
}
const KNOWN_FACEBOOK_RESOLUTIONS = new Map([
  ["https://www.facebook.com/share/v/1EwUUT7MN8/", "https://www.facebook.com/darmalipi/videos/pause-for-a-moment-breathe-observe-dscover-the-profound-peace-of-theravada-vipas/1986667352042256/"],
]);

async function enrichFacebookRows(env, rows) {
  const candidates = rows.filter((row) => {
    if (!isFacebookUrl(row?.source_url)) return false;
    if (!row.thumbnail_url) return true;
    try {
      const stored = new URL(String(row.embed_url || ""));
      const href = stored.searchParams.get("href") || "";
      return !isSupportedFacebookContentUrl(href);
    } catch {
      return true;
    }
  });
  if (!candidates.length) return;

  for (let index = 0; index < candidates.length; index += 4) {
    const chunk = candidates.slice(index, index + 4);
    const settled = await Promise.allSettled(chunk.map((row) => fetchFacebookPreview(env, row.source_url)));
    settled.forEach((result, offset) => {
      const row = chunk[offset];
      if (result.status !== "fulfilled" || !result.value) return;
      const preview = result.value;
      row.embed_url = buildFacebookPlayerUrl(preview.url);
      if (!row.thumbnail_url && preview.thumbnail_url) row.thumbnail_url = preview.thumbnail_url;
      row.facebook_preview_title = preview.title || row.title || "Facebook video";
      row.facebook_preview_description = preview.description || row.description || "";
      row.facebook_preview_author = preview.author || "facebook.com";
    });
  }
}

async function fetchFacebookPreview(env, sourceUrl) {
  if (!isFacebookUrl(sourceUrl)) return null;
  let input;
  try {
    input = new URL(String(sourceUrl));
  } catch {
    return null;
  }
  if (input.protocol !== "https:") return null;
  input.hash = "";

  const original = input.toString();
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(
    "https://vid.best/__facebook-preview?url=" + encodeURIComponent(original),
  );

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const payload = await cached.json();
        if (payload?.url && isSupportedFacebookContentUrl(payload.url)) return payload;
      } catch {}
    }
  }

  const resolvedUrl = await resolveFacebookContentUrl(env, original);
  if (!resolvedUrl) return null;

  let title = "";
  let description = "";
  let thumbnailUrl = "";
  let author = "";

  try {
    const response = await fetch(resolvedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "VidBest-Facebook-Facade/1.0",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) {
      const html = await response.text();
      title = decodeHtmlEntities(cleanText(readMetaTag(html, "og:title") || readMetaTag(html, "twitter:title"), 180));
      description = decodeHtmlEntities(cleanText(readMetaTag(html, "og:description") || readMetaTag(html, "description"), 320));
      thumbnailUrl = safeFacebookThumbnailUrl(readMetaTag(html, "og:image") || readMetaTag(html, "twitter:image"));
    }
  } catch {}

  try {
    const parsed = new URL(resolvedUrl);
    const authorMatch = parsed.pathname.match(/^\/([^/]+)\/(?:videos|reels?)/i);
    author = authorMatch?.[1] ? decodeURIComponent(authorMatch[1]) : "";
  } catch {}

  if (!thumbnailUrl || !title || !description) {
    const fallback = await fetchMicrolinkFacebookPreview(original);
    if (fallback) {
      title = title || fallback.title || "";
      description = description || fallback.description || "";
      thumbnailUrl = thumbnailUrl || fallback.thumbnail_url || "";
    }
  }

  const payload = {
    url: resolvedUrl,
    title,
    description,
    thumbnail_url: thumbnailUrl || null,
    author: author || "facebook.com",
  };

  if (cache) {
    try {
      const cached = json(payload, 200, {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800",
      });
      await cache.put(cacheKey, cached.clone());
    } catch {}
  }
  return payload;
}

function readMetaTag(html, key) {
  const escaped = String(key).replace(/[.*+?^$()|[\\]{}]/g, "\\$&");
  const source = String(html || "");
  const patterns = [
    new RegExp("<meta[^>]+(?:property|name)=[\\\"]" + escaped + "[\\\"][^>]+content=[\\\"]([^\\\"]*)[\\\"][^>]*>", "i"),
    new RegExp("<meta[^>]+content=[\\\"]([^\\\"]*)[\\\"][^>]+(?:property|name)=[\\\"]" + escaped + "[\\\"][^>]*>", "i"),
    new RegExp("<meta[^>]+(?:property|name)='" + escaped + "'[^>]+content='([^']*)'[^>]*>", "i"),
    new RegExp("<meta[^>]+content='([^']*)'[^>]+(?:property|name)='" + escaped + "'[^>]*>", "i"),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}
function safeFacebookThumbnailUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    const allowed = host === "facebook.com"
      || host.endsWith(".facebook.com")
      || host === "fbcdn.net"
      || host.endsWith(".fbcdn.net");
    return allowed ? url.toString() : "";
  } catch {
    return "";
  }
}

function isFacebookUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch";
  } catch {
    return false;
  }
}

function isFacebookShareUrl(value) {
  if (!isFacebookUrl(value)) return false;
  try {
    const path = new URL(String(value)).pathname.toLowerCase();
    return /^\/share\/v\/[^/]+\/?$/.test(path) || /^\/share\/r\/[^/]+\/?$/.test(path);
  } catch {
    return false;
  }
}

function isSupportedFacebookContentUrl(value) {
  if (!isFacebookUrl(value)) return false;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") return false;
    const path = url.pathname.toLowerCase();
    return /^\/reel\/[^/]+\/?$/.test(path)
      || /^\/[^/]+\/reels?\/(?:pfbid[\w-]+|[^/]+)\/?$/.test(path)
      || /^\/[^/]+\/videos\/[^/]+\/?$/.test(path)
      || /^\/watch\/\?(?:[^#]*&)?v=\d+/.test(url.pathname + url.search)
      || /^\/video\.php$/.test(path) && url.searchParams.has("v");
  } catch {
    return false;
  }
}

async function resolveFacebookContentUrl(env, sourceUrl) {
  if (!isFacebookUrl(sourceUrl)) return null;
  let input;
  try {
    input = new URL(String(sourceUrl));
  } catch {
    return null;
  }
  if (input.protocol !== "https:") return null;
  if (!isFacebookShareUrl(input)) return input.toString();
  const known = KNOWN_FACEBOOK_RESOLUTIONS.get(input.toString());

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(
    "https://vid.best/__facebook-resolve?url=" + encodeURIComponent(input.toString()),
  );
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const payload = await cached.json();
        if (isSupportedFacebookContentUrl(payload?.url)) return payload.url;
      } catch {}
    }
  }

  try {
    const response = await fetch(input.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "VidBest-Facebook-Facade/1.0",
      },
      signal: AbortSignal.timeout(7000),
    });
    const finalUrl = String(response.url || "");
    if (!response.ok || !isSupportedFacebookContentUrl(finalUrl)) return known || null;

    if (cache) {
      const cached = json({ url: finalUrl }, 200, {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      });
      await cache.put(cacheKey, cached.clone());
    }
    return finalUrl;
  } catch {
    return known || null;
  }
}

function getSafeFacebookEmbedUrl(video) {
  if (!video) return "";
  const stored = String(video.embed_url || "");
  try {
    const embed = new URL(stored);
    if (embed.protocol === "https:" && embed.hostname === "www.facebook.com" && embed.pathname === "/plugins/video.php") {
      const href = embed.searchParams.get("href") || "";
      if (isSupportedFacebookContentUrl(href) || isFacebookUrl(href)) return embed.toString();
    }
  } catch {}
  return buildFacebookPlayerUrl(video.source_url);
}

async function fetchMicrolinkFacebookPreview(sourceUrl) {
  try {
    const target = new URL(String(sourceUrl));
    if (target.protocol !== "https:") return null;
    const api = new URL("https://api.microlink.io/");
    api.searchParams.set("url", target.toString());
    api.searchParams.set("meta", "true");
    api.searchParams.set("filter", "title,description,image.url,author,url");
    const response = await fetch(api.toString(), {
      headers: { Accept: "application/json", "User-Agent": "VidBest-Facebook-Facade/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const data = payload?.data || {};
    return {
      title: decodeHtmlEntities(cleanText(data.title, 180)),
      description: decodeHtmlEntities(cleanText(data.description, 320)),
      thumbnail_url: safeFacebookThumbnailUrl(data?.image?.url),
      author: decodeHtmlEntities(cleanText(data.author, 120)),
    };
  } catch {
    return null;
  }
}

function buildFacebookPlayerUrl(sourceUrl) {
  try {
    const url = new URL(String(sourceUrl || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch")) return "";
    const params = new URLSearchParams({
      height: "314",
      href: url.toString(),
      show_text: "false",
      width: "560",
      t: "0",
      autoplay: "true",
      muted: "true",
    });
    return `https://www.facebook.com/plugins/video.php?${params.toString()}`;
  } catch {
    return "";
  }
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
  await enrichFacebookRows(env, rows);
  const homepage = page === 1 ? `<url><loc>${escapeXml(`${base}/`)}</loc></url>` : "";
  const entries = rows.map((row) => {
    const canonical = `${base}/watch/${encodeURIComponent(row.slug)}`;
    const provider = detectMediaProvider(row);
    const thumbnail = row.thumbnail_url
      ? absoluteUrl(row.thumbnail_url, base)
      : provider === "tiktok"
        ? `${base}/api/tiktok/cached-poster?id=${encodeURIComponent(row.source_url.match(/\/video\/(\d+)/)?.[1] || "")}`
        : "";
    const description = cleanText(row.seo_description || row.description || `Discover ${row.title} on Vid.Best.`, 180);
    let videoEntry = "";
    const canDescribeVideo = thumbnail && (Boolean(row.embed_url) || Boolean(row.source_published_at) || provider === "tiktok" || provider === "facebook");
    if (canDescribeVideo) {
      const playerUrl = provider === "tiktok"
        ? ""
        : provider === "facebook"
          ? getSafeFacebookEmbedUrl(row)
          : row.embed_url
            ? preparePlaybackEmbed(row.embed_url, base)
            : "";
      const location = playerUrl
        ? `<video:player_loc allow_embed="yes">${escapeXml(playerUrl)}</video:player_loc>`
        : `<video:content_loc>${escapeXml(absoluteUrl(row.source_url, base))}</video:content_loc>`;
      const publicationDate = row.source_published_at || row.created_at;
      const duration = parseDurationSeconds(row.source_duration);
      videoEntry = `<video:video><video:thumbnail_loc>${escapeXml(thumbnail)}</video:thumbnail_loc><video:title>${escapeXml(row.title)}</video:title><video:description>${escapeXml(description)}</video:description>${location}<video:publication_date>${escapeXml(publicationDate)}</video:publication_date>${duration ? `<video:duration>${duration}</video:duration>` : ""}</video:video>`;
    }
    return `<url><loc>${escapeXml(canonical)}</loc><lastmod>${escapeXml(row.updated_at)}</lastmod>${videoEntry}</url>`;
  }).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${homepage}${entries}</urlset>`;
  return new Response(body, {
    headers: securityHeaders(new Headers({ "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" })),
  });
}

function parseDurationSeconds(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0 && numeric < 86400) return Math.floor(numeric);
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function robotsResponse(request, env) {
  const base = getBaseUrl(request, env);
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api/",
    "Allow: /api/tiktok/cached-poster",
    "Allow: /api/tiktok/preflight",
    `Sitemap: ${base}/sitemap.xml`,
  ].join("\n") + "\n";
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
