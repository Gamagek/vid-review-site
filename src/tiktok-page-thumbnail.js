// Optional last-resort public metadata lookup. No login, private APIs, cookies,
// challenge bypass, rotating proxies, video downloads, or media scraping.
// Only public Open Graph image metadata is read; CDN bytes are handled by the
// existing strictly allowlisted, size-bounded R2 thumbnail job.
import { validThumbnailSource } from "./tiktok-thumbnail-cache.js";

const MAX_HTML_BYTES = 384 * 1024;
const SUPPORTED_URL = /^\/@[a-zA-Z0-9_.]{1,32}\/video\/(\d{15,25})\/?$/;

function videoId(input) {
  try {
    const url = new URL(String(input || ""));
    if (url.protocol !== "https:" || !["tiktok.com", "www.tiktok.com"].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.port || url.search || url.hash) return "";
    return url.pathname.match(SUPPORTED_URL)?.[1] || "";
  } catch { return ""; }
}

function decodeAttribute(value) {
  return String(value || "")
    .replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([0-9a-f]+));/gi, (entity, decimal, hex) => {
      const name = entity.toLowerCase();
      if (name === "&amp;") return "&";
      if (name === "&quot;") return '"';
      if (name === "&apos;") return "'";
      if (name === "&lt;") return "<";
      if (name === "&gt;") return ">";
      const number = decimal ? Number(decimal) : hex ? Number.parseInt(hex, 16) : NaN;
      return Number.isSafeInteger(number) && number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number) : entity;
    });
}

function htmlAttributes(tag) {
  const attrs = Object.create(null);
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = decodeAttribute(match[2] ?? match[3]);
  }
  return attrs;
}

export function publicTikTokOpenGraphThumbnail(html, sourceUrl) {
  const expected = videoId(sourceUrl);
  if (!expected || typeof html !== "string" || html.length > MAX_HTML_BYTES) return null;
  let canonical = "";
  let image = "";
  for (const match of html.matchAll(/<meta\b[^>]{0,2500}>|<link\b[^>]{0,2500}>/gi)) {
    const tag = match[0], attrs = htmlAttributes(tag);
    if (tag.slice(0,5).toLowerCase() === "<meta") {
      const name = (attrs.property || attrs.name || "").toLowerCase();
      if (name === "og:url") canonical = attrs.content || canonical;
      if (name === "og:image" || name === "twitter:image") image = image || attrs.content || "";
    } else if ((attrs.rel || "").toLowerCase() === "canonical") {
      canonical = canonical || attrs.href || "";
    }
    if (canonical && image) break;
  }
  // A TikTok login/challenge page or cross-posted unrelated image is not
  // evidence that this thumbnail belongs to the requested video.
  if (videoId(canonical) !== expected) return null;
  return validThumbnailSource(image);
}

async function boundedHtml(response) {
  const length = Number(response.headers.get("Content-Length") || 0);
  if (length > MAX_HTML_BYTES || !response.body) return null;
  const reader = response.body.getReader();
  let bytes = 0, html = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchPublicTikTokOpenGraphThumbnail(sourceUrl, fetcher = fetch) {
  if (!videoId(sourceUrl)) return null;
  let response;
  try {
    response = await fetcher(sourceUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(6500),
    });
    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (!response.ok || !contentType.includes("text/html") || response.redirected) return null;
    const html = await boundedHtml(response);
    return html ? publicTikTokOpenGraphThumbnail(html, sourceUrl) : null;
  } catch {
    // Never retry a rate limit, CAPTCHA, redirect, authentication requirement,
    // or unsupported response with other IPs, user agents, or proxy services.
    return null;
  } finally {
    try { await response?.body?.cancel(); } catch {}
  }
}
