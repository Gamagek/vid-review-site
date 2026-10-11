// Curated thumbnails only. No arbitrary image proxy and no dependency on Portainer.
export const thumbnailKey = id => `uploads/tiktok-thumbnails/${id}.img`;
export const isCachedTikTokThumbnail = value => /^https:\/\/vid\.best\/media\/uploads\/tiktok-thumbnails\/\d{15,25}\.img$/.test(String(value || ''));
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_BYTES = 2 * 1024 * 1024;
export const SAIYAARA_ID = '7669587518156705056';
// The poster already displayed by the owner's public Tagembed post. Pin the
// exact image; this is not an arbitrary Tagbox URL or a video download proxy.
export const SAIYAARA_POSTER = 'https://cloud.tagbox.com/media/1808780/2236794/564115/7669587518156705056/oUABBTgv6m1IvAL68NBf3Iu4zN2IiYiohn2C2U~tplv-tiktokx-origin.image';

export function validThumbnailSource(value, id = '') {
  if (id === SAIYAARA_ID && value === SAIYAARA_POSTER) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /(^|\.)(tiktokcdn(?:-[a-z0-9-]+)?\.com|muscdn\.com)$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

function validImage(bytes, type) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  return type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === 'image/png' ? [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
    : type === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
    : type === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    : type === 'image/avif' && ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 32));
}

export async function cacheTikTokThumbnail(env, row) {
  const id = String(row.video_id || '');
  const source = validThumbnailSource(id === SAIYAARA_ID ? SAIYAARA_POSTER : row.thumbnail_url, id);
  if (!/^\d{15,25}$/.test(id) || !source) throw new Error('Invalid TikTok thumbnail source');
  const key = thumbnailKey(id);
  const existing = await env.BUCKET.head(key);
  if (!existing || !TYPES.has(existing.httpMetadata?.contentType)) {
    const response = await fetch(source, { redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' } });
    const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !TYPES.has(type) || Number(response.headers.get('Content-Length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error(`Thumbnail unavailable (HTTP ${response.status}); no redirect was followed.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty thumbnail');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Thumbnail exceeds 2 MB'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!validImage(bytes, type)) throw new Error('Thumbnail did not contain the expected image format');
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=86400' },
      customMetadata: { source: 'tiktok-oembed-thumbnail', video_id: id } });
  }
  const local = `https://vid.best/media/${key}`;
  await env.DB.prepare('UPDATE tiktok_oembed_cache SET thumbnail_url = ? WHERE video_id = ? AND thumbnail_url = ?')
    .bind(local, id, row.thumbnail_url).run();
  await env.DB.prepare(`UPDATE videos SET thumbnail_url = ? WHERE id = ? AND media_type = 'tiktok'
    AND (thumbnail_url IS NULL OR thumbnail_url = '' OR thumbnail_url = ?)`)
    .bind(local, row.id, row.thumbnail_url).run();
  if (typeof caches !== 'undefined' && caches.default) {
    await caches.default.delete(new Request(`https://vid.best/__tiktok-oembed-cache/${id}`));
  }
  return { video_id: id, status: 'complete', thumbnail_url: local };
}

export async function processTikTokThumbnailJobs(env, { limit = 3 } = {}) {
  if (!env.DB || !env.BUCKET) return [];
  const candidates = await env.DB.prepare(`SELECT v.id, c.video_id, c.thumbnail_url FROM videos v
    JOIN tiktok_oembed_cache c ON v.source_url LIKE '%/video/' || c.video_id || '%'
    WHERE v.media_type = 'tiktok' AND v.published = 1 AND c.thumbnail_url IS NOT NULL
      AND c.video_id NOT IN ('7332342275151760642')
      AND c.thumbnail_url NOT LIKE 'https://vid.best/media/uploads/tiktok-thumbnails/%'
    ORDER BY c.fetched_at DESC LIMIT 100`).all();
  const outcomes = [];
  for (const row of candidates.results || []) {
    if (outcomes.length >= Math.max(1, Math.min(4, Number(limit) || 3))) break;
    if (!validThumbnailSource(row.video_id === SAIYAARA_ID ? SAIYAARA_POSTER : row.thumbnail_url, row.video_id)) continue;
    // Shared 24-hour retry lease: failed CDN requests cannot run every 15-minute cron.
    const lease = await env.DB.prepare(`INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
        WHERE CAST(app_settings.setting_value AS REAL) <= ? RETURNING setting_key`)
      .bind(`tiktok_thumbnail_retry:${row.video_id}`, String(Date.now() + 86400000), Date.now()).first();
    if (!lease) continue;
    try { outcomes.push(await cacheTikTokThumbnail(env, row)); }
    catch (error) { outcomes.push({ video_id: row.video_id, status: 'failed', error: error.message }); }
  }
  return outcomes;
}

export async function warmSaiyaaraPoster(env) {
  if (!env.DB || !env.BUCKET) return;
  const row = await env.DB.prepare(`SELECT v.id, c.video_id, c.thumbnail_url FROM videos v
    JOIN tiktok_oembed_cache c ON v.source_url LIKE '%/video/' || c.video_id || '%'
    WHERE v.media_type = 'tiktok' AND v.published = 1 AND c.video_id = ? LIMIT 1`).bind(SAIYAARA_ID).first();
  if (!row) return;
  const lease = await env.DB.prepare(`INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
      WHERE CAST(app_settings.setting_value AS REAL) <= ? RETURNING setting_key`)
    .bind(`tiktok_thumbnail_retry:${SAIYAARA_ID}`, String(Date.now() + 86400000), Date.now()).first();
  if (!lease) return;
  try { return await cacheTikTokThumbnail(env, row); } catch { /* Keep the local text poster; cron respects the same 24h cooldown. */ }
}
