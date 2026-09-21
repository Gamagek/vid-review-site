import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = String(process.env.TIKTOK_GATEWAY_TOKEN || "");
const ALLOWED_ORIGIN = String(process.env.ALLOWED_ORIGIN || "https://vid.best");
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.FETCH_TIMEOUT_MS || 8000), 2000), 15000);
const MAX_RESPONSE_BYTES = 256 * 1024;

function send(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  });
  res.end(body);
}

function authorized(req) {
  const value = String(req.headers.authorization || "");
  return TOKEN.length >= 32 && value.startsWith("Bearer ") && value.slice(7) === TOKEN;
}

function parseTikTokUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;
  const id = url.pathname.match(/^\/video\/(\d+)/)?.[1] || url.pathname.match(/^\/player\/v1\/(\d+)/)?.[1] || url.pathname.match(/^\/@[^/]+\/video\/(\d+)/)?.[1];
  if (!id) return null;
  return { id: id, inputUrl: url.toString() };
}

async function readLimited(response) {
  const reader = response.body && response.body.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
    chunks.push(part.value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

async function resolveTikTok(sourceUrl) {
  const parsed = parseTikTokUrl(sourceUrl);
  if (!parsed) return { ok: false, provider: "tiktok", availability: "invalid", reason: "Enter a valid TikTok video URL." };
  const oembedUrl = "https://www.tiktok.com/oembed?url=" + encodeURIComponent(parsed.inputUrl);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let response;
  try {
    response = await fetch(oembedUrl, { headers: { accept: "application/json" }, redirect: "error", signal: controller.signal });
  } catch (error) {
    return { ok: false, provider: "tiktok", video_id: parsed.id, source_url: parsed.inputUrl, availability: "unavailable", reason: error && error.name === "AbortError" ? "TikTok metadata request timed out from the cloud gateway." : "TikTok metadata could not be reached from the cloud gateway." };
  } finally { clearTimeout(timer); }
  const text = await readLimited(response);
  if (!response.ok) return { ok: false, provider: "tiktok", video_id: parsed.id, source_url: parsed.inputUrl, availability: "unavailable", reason: "TikTok oEmbed returned HTTP " + response.status + ".", upstream_status: response.status };
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, provider: "tiktok", video_id: parsed.id, source_url: parsed.inputUrl, availability: "unavailable", reason: "TikTok returned invalid oEmbed JSON." }; }
  return {
    ok: true, provider: "tiktok", video_id: parsed.id, source_url: parsed.inputUrl, availability: "metadata_available",
    title: typeof data.title === "string" ? data.title.slice(0, 300) : "",
    author_name: typeof data.author_name === "string" ? data.author_name.slice(0, 160) : "",
    author_url: typeof data.author_url === "string" ? data.author_url.slice(0, 500) : "",
    thumbnail_url: typeof data.thumbnail_url === "string" ? data.thumbnail_url.slice(0, 2000) : "",
    embed_width: data.width || "100%", embed_height: data.height || "100%", official_embed: true,
    playback_note: "Playback still runs from TikTok in the visitor's browser; this gateway does not proxy or rehost the video.",
  };
}

const server = http.createServer(async function (req, res) {
  res.setHeader("access-control-allow-origin", ALLOWED_ORIGIN);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": ALLOWED_ORIGIN, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, OPTIONS" });
    res.end(); return;
  }
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
  if (req.method === "GET" && url.pathname === "/health") { send(res, 200, { ok: true, service: "vidbest-tiktok-gateway" }); return; }
  if (req.method === "GET" && url.pathname === "/v1/tiktok/resolve") {
    if (!authorized(req)) { send(res, 401, { ok: false, error: "Unauthorized" }); return; }
    const sourceUrl = url.searchParams.get("url") || "";
    if (sourceUrl.length > 2000) { send(res, 413, { ok: false, error: "URL is too long" }); return; }
    try {
      const result = await resolveTikTok(sourceUrl);
      send(res, 200, result, { "cache-control": result.ok ? "public, max-age=300" : "public, max-age=60" });
    } catch (error) {
      send(res, 502, { ok: false, provider: "tiktok", availability: "unavailable", reason: error && error.message ? error.message : "Gateway error" });
    }
    return;
  }
  send(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, "0.0.0.0", function () { console.log("Vid.Best TikTok gateway listening on :" + PORT); });