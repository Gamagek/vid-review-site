// Only canonical player URLs and poster bytes are prepared. Videos stay embedded.
const MAX_ATTEMPTS = 4;
const later = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const eligible = row => Number(row?.published) === 1 && row.media_type === 'facebook';
const load = (env, id) => env.DB.prepare('SELECT * FROM facebook_preview_jobs WHERE video_id = ?').bind(id).first();

export function facebookPreviewSummary(job) {
  if (!job) return null;
  return {
    status: job.status === 'running' ? 'preparing' : job.status,
    poster_status: job.poster_status,
    attempts: Number(job.attempts || 0),
    next_attempt_at: job.status === 'running' ? null : job.next_attempt_at || null,
  };
}

export async function queueFacebookPreview(env, row) {
  if (!eligible(row)) return null;
  // Repeated SEO edits neither consume another provider call nor reset a failure budget.
  await env.DB.prepare(`INSERT INTO facebook_preview_jobs (video_id, source_url, thumbnail_value)
    VALUES (?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET
      source_url = excluded.source_url, thumbnail_value = excluded.thumbnail_value,
      canonical_url = NULL, status = 'pending', poster_status = 'pending', attempts = 0,
      next_attempt_at = NULL, lease_token = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE facebook_preview_jobs.source_url <> excluded.source_url
       OR facebook_preview_jobs.thumbnail_value <> excluded.thumbnail_value`)
    .bind(Number(row.id), row.source_url, row.thumbnail_url || '').run();
  return facebookPreviewSummary(await load(env, Number(row.id)));
}

export async function runFacebookPreviewJobs(env, prepare, { videoId, limit = 2 } = {}) {
  // A crash on the final attempt must not leave an eternal "preparing" status.
  await env.DB.prepare(`UPDATE facebook_preview_jobs SET
    status = CASE WHEN canonical_url IS NULL THEN 'needs_source' ELSE 'needs_poster' END,
    next_attempt_at = NULL, lease_token = NULL
    WHERE status = 'running' AND attempts >= ? AND next_attempt_at <= ?`)
    .bind(MAX_ATTEMPTS, new Date().toISOString()).run();
  const result = await env.DB.prepare(`SELECT j.* FROM facebook_preview_jobs j
    JOIN videos v ON v.id = j.video_id AND v.source_url = j.source_url
      AND COALESCE(v.thumbnail_url, '') = j.thumbnail_value
    WHERE v.published = 1 AND v.media_type = 'facebook' AND j.attempts < ?
      AND j.status IN ('pending', 'retry', 'running')
      AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
      ${videoId ? 'AND j.video_id = ?' : ''}
    ORDER BY COALESCE(j.next_attempt_at, ''), j.video_id LIMIT ?`)
    .bind(MAX_ATTEMPTS, new Date().toISOString(), ...(videoId ? [Number(videoId)] : []), Math.max(1, Math.min(3, limit))).all();
  const outcomes = [];
  for (const job of result.results || []) {
    const token = crypto.randomUUID();
    // D1 compare-and-swap is also the cross-isolate lease; crashed work is retried later.
    const claim = await env.DB.prepare(`UPDATE facebook_preview_jobs SET status = 'running',
      attempts = attempts + 1, lease_token = ?, next_attempt_at = ?
      WHERE video_id = ? AND source_url = ? AND thumbnail_value = ? AND attempts = ?
        AND status IN ('pending', 'retry', 'running')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?) RETURNING *`)
      .bind(token, later(120), job.video_id, job.source_url, job.thumbnail_value, job.attempts, new Date().toISOString()).first();
    if (!claim) continue;
    const row = await env.DB.prepare('SELECT * FROM videos WHERE id = ?').bind(job.video_id).first();
    if (!eligible(row) || row.source_url !== job.source_url || (row.thumbnail_url || '') !== job.thumbnail_value) continue;
    let prepared;
    try { prepared = await prepare(env, row); } catch { /* Persist a safe state, never a provider URL/error body. */ }
    const canonical = prepared?.canonical_url || null;
    const poster = prepared?.poster_status || 'missing';
    const ready = canonical && ['saved', 'owner_cover'].includes(poster);
    const exhausted = claim.attempts >= MAX_ATTEMPTS;
    const status = ready ? 'ready' : exhausted ? (canonical ? 'needs_poster' : 'needs_source') : 'retry';
    await env.DB.prepare(`UPDATE facebook_preview_jobs SET canonical_url = ?, poster_status = ?,
      status = ?, next_attempt_at = ?, lease_token = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE video_id = ? AND source_url = ? AND thumbnail_value = ? AND lease_token = ?
        AND EXISTS (SELECT 1 FROM videos v WHERE v.id = video_id AND v.published = 1
          AND v.media_type = 'facebook' AND v.source_url = facebook_preview_jobs.source_url
          AND COALESCE(v.thumbnail_url, '') = facebook_preview_jobs.thumbnail_value)`)
      .bind(canonical, poster, status, ready || exhausted ? null : later(claim.attempts === 1 ? 900 : 3600),
        job.video_id, job.source_url, job.thumbnail_value, token).run();
    outcomes.push(facebookPreviewSummary(await load(env, job.video_id)));
  }
  return outcomes;
}

export async function attachFacebookPreviews(env, rows, buildPlayer) {
  const facebook = rows.filter(eligible);
  if (!facebook.length) return;
  const ids = facebook.map(row => Number(row.id));
  const result = await env.DB.prepare(`SELECT * FROM facebook_preview_jobs WHERE video_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all();
  const jobs = new Map((result.results || []).map(job => [Number(job.video_id), job]));
  for (const row of facebook) {
    const job = jobs.get(Number(row.id));
    if (!job || job.source_url !== row.source_url || job.thumbnail_value !== (row.thumbnail_url || '')) continue;
    row.facebook_preview = facebookPreviewSummary(job);
    if (job.canonical_url) row.embed_url = buildPlayer(job.canonical_url) || row.embed_url;
  }
}

export async function facebookPreviewStatus(env, id) {
  const row = await env.DB.prepare('SELECT id, source_url, thumbnail_url, media_type, published FROM videos WHERE id = ?').bind(id).first();
  if (!row) return Response.json({ error: 'Video not found' }, { status: 404 });
  if (!eligible(row)) return Response.json({ error: 'Publish a Facebook video first' }, { status: 400 });
  const job = await load(env, id);
  const current = job?.source_url === row.source_url && job.thumbnail_value === (row.thumbnail_url || '') ? job : null;
  return Response.json({ success: true, preview: facebookPreviewSummary(current) || { status: 'not_prepared' } }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
