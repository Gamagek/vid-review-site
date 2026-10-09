import { dispatchAdminTikTokCache, tikTokCacheCandidate } from './admin-tiktok-cache.js';

const ELIGIBLE = `redistribution_certified = 1 AND media_type = 'tiktok'
  AND r2_key IS NULL AND (cache_source_url IS NULL OR cache_source_url = '')`;
const nextDate = seconds => new Date(Date.now() + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const loadRow = (env, id) => env.DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first();

async function markReady(env, row, source) {
  if (!env.BUCKET?.head) throw new Error('R2 storage is not configured. No gateway request was sent.');
  let object;
  try {
    for (const key of [`${source.id}.mp4`, `uploads/tiktok/${source.id}.mp4`, `uploads/${source.id}.mp4`]) {
      const head = await env.BUCKET.head(key);
      if (head?.size > 0 && Date.parse(head.uploaded) + 30 * 86400000 > Date.now() &&
          (!head.httpMetadata?.contentType || ['video/mp4', 'application/octet-stream'].includes(head.httpMetadata.contentType))) {
        object = head; break;
      }
    }
  } catch { throw new Error('R2 storage could not be checked. No gateway request was sent.'); }
  if (!object) return false;
  // Preserve the source/player. The gateway already streams these private R2 keys.
  await env.DB.prepare(`UPDATE videos SET cache_status = 'complete', cache_error = NULL,
    cache_next_attempt_at = NULL, cached_at = ? WHERE id = ? AND source_url = ? AND ${ELIGIBLE}`)
    .bind(new Date(object.uploaded).toISOString(), row.id, row.source_url).run();
  return true;
}

function summary(row) {
  return { status: row.cache_status === 'running' ? 'queued' : row.cache_status,
    cache_status: row.cache_status, error: row.cache_error || null,
    attempts: Number(row.cache_attempts || 0), next_attempt_at: row.cache_next_attempt_at || null,
    cached_at: row.cached_at || null };
}

async function runJob(env, row, manual = false) {
  const source = tikTokCacheCandidate(row);
  if (!source) return null;
  let storageError;
  try {
    if (await markReady(env, row, source)) return summary(await loadRow(env, row.id));
  } catch (error) { storageError = error; }
  // The conditional UPDATE is the cross-isolate lock; a crashed invocation expires in 15 minutes.
  const attempts = (manual && row.cache_attempts >= 3) || row.cache_status === 'complete'
    ? 1 : Math.min(3, Number(row.cache_attempts || 0) + 1);
  const claimed = await env.DB.prepare(`UPDATE videos SET cache_status = 'running', cache_error = NULL,
    cache_attempts = ?, cache_next_attempt_at = ?, cached_at = NULL
    WHERE id = ? AND source_url = ? AND ${ELIGIBLE}
      AND cache_status = ? AND cache_attempts = ?
      AND (cache_next_attempt_at IS NULL OR cache_next_attempt_at <= datetime('now'))
    RETURNING *`).bind(attempts, nextDate(900), row.id, row.source_url, row.cache_status, row.cache_attempts).first();
  if (!claimed) return summary(await loadRow(env, row.id) || row);
  let error;
  if (!manual && row.cache_attempts >= 3 && row.cache_status !== 'complete') {
    error = new Error('Gateway accepted previous requests but no playable R2 object appeared. Check the Portainer job, provider quota and watermarked MP4 result before retrying.');
  } else {
    try {
      if (storageError) throw storageError;
      await dispatchAdminTikTokCache(env, claimed);
      return summary(claimed);
    } catch (cause) { error = cause; }
  }
  const retry = attempts < 3 ? nextDate(Math.max(error.retry || 900, attempts === 2 ? 3600 : 900)) : null;
  await env.DB.prepare(`UPDATE videos SET cache_status = 'failed', cache_error = ?, cache_next_attempt_at = ?
    WHERE id = ? AND source_url = ? AND cache_status = 'running' AND cache_attempts = ? AND ${ELIGIBLE}`)
    .bind(String(error.message).slice(0, 400), retry, row.id, row.source_url, attempts).run();
  return summary(await loadRow(env, row.id) || claimed);
}

export function maybeQueueAdminTikTokCache(env, ctx, row) {
  if (!tikTokCacheCandidate(row) || String(env.VIDBEST_AUTO_CACHE_TIKTOK || '1') === '0' || !ctx?.waitUntil) return;
  ctx.waitUntil(runJob(env, row).catch(error => console.warn('[admin-tiktok-auto-cache]', row.id, error.message)));
}

export async function processAdminTikTokCacheJobs(env, { limit = 2 } = {}) {
  if (!env.DB || String(env.VIDBEST_AUTO_CACHE_TIKTOK || '1') === '0') return [];
  const result = await env.DB.prepare(`SELECT * FROM videos WHERE ${ELIGIBLE}
    AND source_url NOT LIKE '%/video/7332342275151760642%'
    AND source_url NOT LIKE '%/video/7669587518156705056%'
    AND ((cache_status IN ('none', 'pending', 'failed') AND cache_attempts < 3)
      OR cache_status = 'running'
      OR (cache_status = 'complete' AND cached_at < datetime('now', '-30 days')))
    AND (cache_next_attempt_at IS NULL OR cache_next_attempt_at <= datetime('now'))
    ORDER BY COALESCE(cache_next_attempt_at, '0'), id LIMIT ?`).bind(Math.max(1, Math.min(4, Number(limit) || 2))).all();
  const outcomes = [];
  for (const row of result.results || []) outcomes.push(await runJob(env, row));
  return outcomes;
}

export async function adminTikTokCacheStatus(env, databaseId) {
  const row = await loadRow(env, databaseId);
  if (!row) return reply({ error: 'Video not found' }, 404);
  const source = tikTokCacheCandidate(row);
  if (!source) return reply({ error: 'Save redistribution rights and an eligible TikTok URL before caching.' }, 400);
  // Status only checks R2. It never consumes a provider request or starts a download.
  try { await markReady(env, row, source); }
  catch (error) { return reply({ ...summary(row), error: error.message }, 503); }
  return reply({ success: true, ...summary(await loadRow(env, databaseId) || row) });
}

export async function retryAdminTikTokCache(env, databaseId) {
  const row = await loadRow(env, databaseId);
  if (!row) return reply({ error: 'Video not found' }, 404);
  if (!tikTokCacheCandidate(row)) return reply({ error: 'Save the video with redistribution rights confirmed and an eligible TikTok URL before caching.' }, 400);
  const result = await runJob(env, row, true);
  return reply({ success: result.status !== 'failed', ...result }, result.status === 'failed' ? 502 : result.status === 'complete' ? 200 : 202);
}
