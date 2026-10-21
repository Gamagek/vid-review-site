import illustrations from "./review-illustrations.json" with { type: "json" };

// Public response cache: Cloudflare edge first, durable R2 snapshot second, D1 last.
// Never cache member sessions, mutations, error responses, or private headers.
// The browser receives no-store even when the edge holds a fresh copy.
const CACHE_VERSION = "v1";
// A new artwork release must not inherit a fresh XML snapshot missing its images.
// This non-security fingerprint only versions XML keys; API/browser policy is unchanged.
const IMAGE_CATALOG_REVISION = illustrations.reduce((hash, item) => {
  for (const char of `${item.id}:${item.path}:${item.sha256}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return hash;
}, 2166136261).toString(16);
const EDGE_SECONDS = 300;
const MAX_SNAPSHOT_SECONDS = 24 * 60 * 60;
const MAX_BODY_BYTES = 1_500_000;
const flights = new Map();
const SAFE_HEADERS = [
  "Content-Security-Policy", "Referrer-Policy", "Permissions-Policy",
  "X-Frame-Options", "Cross-Origin-Opener-Policy", "X-Robots-Tag",
];

function policyFor(request) {
  if (request.method !== "GET" || request.headers.has("Authorization")) return null;
  const url = new URL(request.url);
  // Never intercept HTTP/www canonical redirects with a cached 200 response.
  if (url.protocol !== "https:" || url.hostname !== "vid.best") return null;
  const path = url.pathname;
  let kind = "";
  let snapshot = true;
  let allowed = [];

  if (path === "/api/videos") {
    kind = "json";
    allowed = ["category", "subcategory", "q", "sort", "featured", "trending", "limit", "offset"];
    const query = url.searchParams.get("q") || "";
    const offset = Number(url.searchParams.get("offset") || 0);
    snapshot = !query && Number.isInteger(offset) && offset >= 0 && offset <= 48;
  } else if (path === "/api/home/mini-feed") {
    // This route includes private saves and personalized recommendations for members.
    if (/(?:^|;)\s*__Host-vidbest_member=/.test(request.headers.get("Cookie") || "")) return null;
    kind = "json";
    allowed = ["limit"];
  } else if (path === "/") {
    if (url.search) return null; // Functional query pages can have different robots rules.
    kind = "html";
  } else if (path === "/videos" || /^\/category\/[a-z0-9-]+$/.test(path)) {
    kind = "html";
    allowed = ["page"];
    const page = url.searchParams.get("page");
    if (page && (!/^[1-9]\d{0,3}$/.test(page) || Number(page) > 1000)) return null;
  } else if (path === "/sitemap.xml" || path === "/image-sitemap.xml" ||
    path === "/image-editorial-sitemap.xml" || path === "/image-source-sitemap.xml" ||
    /^\/sitemaps\/[a-z0-9-]+\.xml$/.test(path)) {
    if (url.search) return null;
    kind = "xml";
  } else return null;

  if ([...url.searchParams.keys()].some((name) => !allowed.includes(name))) return null;
  if ([...url.searchParams.keys()].some((name) => url.searchParams.getAll(name).length !== 1)) return null;
  if (url.search.length > 300) return null;
  const revision = policyRevision(kind);
  const canonical = new URL("https://vid.best/__public_cache/" + revision + path);
  const params = new URLSearchParams(url.searchParams);
  params.sort();
  canonical.search = params.toString();
  return { canonical: canonical.toString(), kind, snapshot };
}

function policyRevision(kind) {
  return kind === "xml" ? `${CACHE_VERSION}-images-${IMAGE_CATALOG_REVISION}` : CACHE_VERSION;
}

function validBody(kind, body) {
  if (!body || body.length > MAX_BODY_BYTES) return false;
  if (kind === "json") {
    try {
      const data = JSON.parse(body);
      if (Object.prototype.hasOwnProperty.call(data, "authenticated") && data.authenticated !== false) return false;
      return Array.isArray(data.videos) || (data.sections && typeof data.sections === "object" &&
        Array.isArray(data.sections.for_you) && data.authenticated === false);
    } catch { return false; }
  }
  return kind === "html" ? /<html[\s>]/i.test(body) : /^\s*<\?xml/.test(body);
}

function browserResponse(response, state) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.delete("Expires");
  headers.delete("Age");
  headers.delete("Set-Cookie");
  headers.set("X-VidBest-Edge-Cache", state);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function snapshotKey(policy) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(policy.canonical));
  const hash = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return "public-api-snapshots/" + CACHE_VERSION + "/" + hash + ".json";
}

async function loadSnapshot(env, policy) {
  if (!policy.snapshot || !env.BUCKET?.get) return null;
  try {
    const object = await env.BUCKET.get(await snapshotKey(policy));
    if (!object) return null;
    const saved = await object.json();
    if (saved?.version !== CACHE_VERSION || saved?.canonical !== policy.canonical ||
      !Number.isFinite(saved.timestamp) || Date.now() - saved.timestamp < 0 ||
      Date.now() - saved.timestamp > MAX_SNAPSHOT_SECONDS * 1000 ||
      !validBody(policy.kind, saved.body)) return null;
    return saved;
  } catch (error) {
    console.warn("Public snapshot read unavailable", error?.message || error);
    return null;
  }
}

function fromSnapshot(saved) {
  const headers = new Headers({
    "Content-Type": saved.type,
    "Cache-Control": "public, max-age=" + EDGE_SECONDS,
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of SAFE_HEADERS) {
    if (saved.headers?.[name]) headers.set(name, saved.headers[name]);
  }
  if (saved.robots) headers.set("X-Robots-Tag", saved.robots);
  return new Response(saved.body, { status: 200, headers });
}

function edgeCache() {
  try { return typeof caches !== "undefined" ? caches.default : null; }
  catch { return null; }
}

async function persist(env, ctx, policy, cacheKey, response, body, type, robots, writeSnapshot = true) {
  const tasks = [];
  const cache = edgeCache();
  if (cache) {
    const headers = new Headers(response.headers);
    headers.set("Content-Type", type);
    headers.set("Cache-Control", "public, max-age=" + EDGE_SECONDS);
    headers.delete("Set-Cookie");
    headers.delete("Content-Length");
    tasks.push(cache.put(cacheKey, new Response(body, { status: 200, headers })));
  }
  if (writeSnapshot && policy.snapshot && env.BUCKET?.put) {
    tasks.push((async () => {
      const key = await snapshotKey(policy);
      await env.BUCKET.put(key, JSON.stringify({
        version: CACHE_VERSION, canonical: policy.canonical, timestamp: Date.now(),
        type, robots, body,
        headers: Object.fromEntries(SAFE_HEADERS.map((name) => [name, response.headers.get(name) || ""])),
      }), { httpMetadata: { contentType: "application/json" } });
    })());
  }
  if (!tasks.length) return;
  const work = Promise.allSettled(tasks).then((settled) => {
    if (settled.some((task) => task.status === "rejected")) console.warn("A public cache write was deferred");
  });
  if (ctx?.waitUntil) {
    try { ctx.waitUntil(work); }
    catch {
      // A disabled background-task context must never turn a successful sitemap,
      // homepage or public API response into HTTP 500.
      await work;
    }
  } else await work;
}

async function resolveMiss(request, env, ctx, handler, policy) {
  const cacheKey = new Request(policy.canonical);
  const cache = edgeCache();
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit?.ok) return browserResponse(hit, "HIT");
    } catch { /* Cloudflare cache is optional; D1 remains the source of truth. */ }
  }

  // One R2 read per cold edge key can prevent expensive database queries in
  // multiple Cloudflare data centers. At most five minutes of routine staleness.
  const saved = await loadSnapshot(env, policy);
  if (saved && Date.now() - saved.timestamp <= EDGE_SECONDS * 1000) {
    const response = fromSnapshot(saved);
    // Serving an existing R2 snapshot must NOT reset its age indefinitely.
    await persist(env, ctx, policy, cacheKey, response, saved.body, saved.type, saved.robots, false);
    return browserResponse(response, "R2-FRESH");
  }

  let response;
  try { response = await handler(); }
  catch (error) {
    if (saved) return browserResponse(fromSnapshot(saved), "R2-STALE");
    throw error;
  }
  if (!response.ok || response.headers.has("Set-Cookie") ||
    /(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get("Cache-Control") || "") &&
      policy.kind !== "json") {
    if (response.status >= 500 && saved) return browserResponse(fromSnapshot(saved), "R2-STALE");
    return response;
  }
  const type = response.headers.get("Content-Type") || "";
  if ((policy.kind === "json" && !type.includes("application/json")) ||
    (policy.kind === "html" && !type.includes("text/html")) ||
    (policy.kind === "xml" && !type.includes("xml"))) return response;
  const body = await response.clone().text();
  if (!validBody(policy.kind, body)) return response;
  const robots = response.headers.get("X-Robots-Tag") || "";
  await persist(env, ctx, policy, cacheKey, response, body, type, robots);
  return browserResponse(response, "MISS");
}

export async function cachedPublicResponse(request, env, ctx, handler) {
  const policy = policyFor(request);
  if (!policy) return null;
  // Concurrent misses within a Worker isolate share the same fetch and D1 work.
  const key = policy.canonical;
  let flight = flights.get(key);
  if (!flight) {
    flight = resolveMiss(request, env, ctx, handler, policy);
    flights.set(key, flight);
    flight.finally(() => { if (flights.get(key) === flight) flights.delete(key); }).catch(() => {});
  }
  return (await flight).clone();
}
