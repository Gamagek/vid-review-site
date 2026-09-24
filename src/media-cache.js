const encoder = new TextEncoder();

const AUTHORIZED_PROVIDERS = new Set(["direct", "r2"]);
const CACHE_PROFILE = "360p";
const CACHE_OUTPUT_PREFIX = "uploads/media-cache/360p/";
const CALLBACK_PATH = "/api/internal/media-cache/callback";
const MAX_RESULT_BYTES = 95 * 1024 * 1024;

export function isAuthorizedMediaCacheCandidate(video, rightsConfirmed) {
  if (!rightsConfirmed) return false;
  const provider = String(video?.provider || "").toLowerCase();
  if (!AUTHORIZED_PROVIDERS.has(provider)) return false;
  return /^https:\/\//i.test(String(video?.source_url || ""));
}

export async function queueAuthorizedMediaCache(env, video, { rightsConfirmed = false } = {}) {
  const provider = String(video?.provider || "").toLowerCase();
  if (!rightsConfirmed) return { status: "not-requested", job: null };
  if (provider === "tiktok") return { status: "unsupported", job: null };
  if (!AUTHORIZED_PROVIDERS.has(provider)) return { status: "unsupported", job: null };
  if (!isAuthorizedMediaCacheCandidate(video, true)) return { status: "unsupported", job: null };

  const sourceUrl = String(video.source_url);
  const outputKey = CACHE_OUTPUT_PREFIX + Number(video.id) + "-" + await shortHash(sourceUrl) + ".mp4";
  const status = env.MEDIA_TRANSCODER_URL ? "queued" : "waiting_transcoder";

  const row = await env.DB.prepare(
    `INSERT INTO media_cache_jobs (
       video_id, source_url, profile, output_key, status, rights_confirmed, attempts, error
     ) VALUES (?, ?, ?, ?, ?, 1, 0, NULL)
     ON CONFLICT(video_id, source_url, profile) DO UPDATE SET
       output_key = excluded.output_key,
       status = excluded.status,
       rights_confirmed = 1,
       attempts = 0,
       error = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     RETURNING id, video_id, source_url, profile, output_key, status, rights_confirmed, attempts, error, created_at, updated_at`,
  ).bind(Number(video.id), sourceUrl, CACHE_PROFILE, outputKey, status).first();

  return { status: row?.status || status, job: row || null };
}

export async function dispatchMediaCacheJob(env, job, baseUrl) {
  if (!job?.id) return { ok: false, status: "missing-job" };
  const transcoderUrl = String(env.MEDIA_TRANSCODER_URL || "").trim().replace(/\/$/, "");
  if (!transcoderUrl) {
    await updateJob(env, job.id, "waiting_transcoder", "MEDIA_TRANSCODER_URL is not configured");
    return { ok: false, status: "waiting_transcoder" };
  }

  const callbackSecret = String(env.MEDIA_CACHE_CALLBACK_SECRET || "").trim();
  const serviceSecret = String(env.MEDIA_TRANSCODER_SECRET || "").trim();
  if (!callbackSecret || !serviceSecret) {
    await updateJob(env, job.id, "waiting_transcoder", "Media cache secrets are not configured");
    return { ok: false, status: "waiting_transcoder" };
  }

  await env.DB.prepare(
    `UPDATE media_cache_jobs
     SET status = 'processing', attempts = attempts + 1, error = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND status IN ('queued', 'processing')`,
  ).bind(job.id).run();

  const callbackUrl = new URL(CALLBACK_PATH, baseUrl).toString();
  try {
    const response = await fetch(transcoderUrl + "/v1/jobs", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + serviceSecret,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        job_id: String(job.id),
        source_url: job.source_url,
        output_key: job.output_key,
        profile: CACHE_PROFILE,
        max_width: 640,
        max_height: 640,
        video_bitrate: "800k",
        audio_bitrate: "96k",
        callback_url: callbackUrl,
        callback_secret: callbackSecret,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const detail = await safeResponseText(response);
      await updateJob(env, job.id, "failed", "Transcoder HTTP " + response.status + (detail ? ": " + detail.slice(0, 180) : ""));
      return { ok: false, status: "failed" };
    }
    return { ok: true, status: "processing" };
  } catch (error) {
    await updateJob(env, job.id, "failed", cleanError(error));
    return { ok: false, status: "failed" };
  }
}

export async function handleMediaCacheCallback(request, env) {
  const expected = String(env.MEDIA_CACHE_CALLBACK_SECRET || "").trim();
  const authorization = String(request.headers.get("Authorization") || "");
  if (!expected || authorization !== "Bearer " + expected) {
    return json({ success: false, error: "Unauthorized callback" }, 401);
  }
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid callback JSON" }, 400);
  }

  const jobId = Number(body?.job_id || 0);
  const status = String(body?.status || "").toLowerCase();
  if (!Number.isSafeInteger(jobId) || jobId < 1) return json({ success: false, error: "Invalid job id" }, 400);
  if (!new Set(["complete", "failed"]).has(status)) return json({ success: false, error: "Invalid job status" }, 400);

  const job = await env.DB.prepare("SELECT * FROM media_cache_jobs WHERE id = ?").bind(jobId).first();
  if (!job) return json({ success: false, error: "Cache job not found" }, 404);

  if (status === "failed") {
    await updateJob(env, jobId, "failed", cleanError(body?.error || "Transcoder failed"));
    return json({ success: true, status: "failed" });
  }

  const resultUrl = validateResultUrl(body?.result_url, env);
  if (!resultUrl) return json({ success: false, error: "Transcoder result URL is not allowed" }, 400);
  if (!env.BUCKET) return json({ success: false, error: "R2 bucket is unavailable" }, 503);

  try {
    const response = await fetch(resultUrl, {
      headers: { Accept: "video/mp4,application/octet-stream;q=0.8" },
      signal: AbortSignal.timeout(15000),
      cf: { cacheEverything: false },
    });
    if (!response.ok) throw new Error("Result HTTP " + response.status);
    const contentType = String(response.headers.get("Content-Type") || "").split(";", 1)[0].toLowerCase();
    if (contentType && contentType !== "video/mp4" && contentType !== "application/octet-stream") {
      throw new Error("Transcoder result is not MP4");
    }
    const statedLength = Number(response.headers.get("Content-Length") || 0);
    if (statedLength > MAX_RESULT_BYTES) throw new Error("360p cache exceeds the 95 MB safety limit");

    if (!response.body) throw new Error("Transcoder returned an empty file");

    await env.BUCKET.put(job.output_key, response.body, {
      httpMetadata: {
        contentType: "video/mp4",
        cacheControl: "public, max-age=31536000, immutable",
        contentDisposition: "inline",
      },
      customMetadata: {
        provider: "vidbest-authorized-cache",
        profile: CACHE_PROFILE,
        videoId: String(job.video_id),
        sourceUrl: job.source_url,
      },
    });

    await env.DB.prepare(
      `UPDATE media_cache_jobs
       SET status = 'complete', error = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).bind(jobId).run();

    return json({
      success: true,
      status: "complete",
      video_id: Number(job.video_id),
      media_url: buildMediaCacheUrl(job.output_key),
    });
  } catch (error) {
    await updateJob(env, jobId, "failed", cleanError(error));
    return json({ success: false, error: cleanError(error) }, 502);
  }
}

export async function getMediaCacheForVideo(env, videoId, sourceUrl, includeNonComplete = false) {
  const sql = includeNonComplete
    ? `SELECT id, video_id, source_url, profile, output_key, status, rights_confirmed, attempts, error, created_at, updated_at
       FROM media_cache_jobs WHERE video_id = ? ORDER BY updated_at DESC LIMIT 1`
    : `SELECT id, video_id, source_url, profile, output_key, status, rights_confirmed, attempts, error, created_at, updated_at
       FROM media_cache_jobs WHERE video_id = ? AND source_url = ? AND status = 'complete'
       ORDER BY updated_at DESC LIMIT 1`;
  return includeNonComplete
    ? env.DB.prepare(sql).bind(Number(videoId)).first()
    : env.DB.prepare(sql).bind(Number(videoId), String(sourceUrl || "")).first();
}

export async function cleanupMediaCacheForVideo(env, videoId, keepSourceUrl = "") {
  const result = await env.DB.prepare(
    `SELECT output_key FROM media_cache_jobs
     WHERE video_id = ? AND (? = '' OR source_url <> ?)`,
  ).bind(Number(videoId), String(keepSourceUrl), String(keepSourceUrl)).all();

  for (const row of result.results || []) {
    if (row.output_key && env.BUCKET) {
      try { await env.BUCKET.delete(row.output_key); } catch (error) {
        console.error("Media cache cleanup failed", error?.message || error);
      }
    }
  }
  await env.DB.prepare(
    `DELETE FROM media_cache_jobs
     WHERE video_id = ? AND (? = '' OR source_url <> ?)`,
  ).bind(Number(videoId), String(keepSourceUrl), String(keepSourceUrl)).run();
}

export function buildMediaCacheUrl(key) {
  return key ? "/media/" + encodeR2Key(key) : null;
}

async function shortHash(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
  return [...digest].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateResultUrl(value, env) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return null;
    const allowed = new Set(
      String(env.MEDIA_TRANSCODER_RESULT_HOSTS || "")
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!allowed.size) {
      try {
        const configured = new URL(String(env.MEDIA_TRANSCODER_URL || ""));
        if (configured.hostname) allowed.add(configured.hostname.toLowerCase());
      } catch {
        return null;
      }
    }
    return allowed.has(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

function encodeR2Key(key) {
  return String(key || "").split("/").map(encodeURIComponent).join("/");
}

async function updateJob(env, id, status, error = null) {
  await env.DB.prepare(
    `UPDATE media_cache_jobs
     SET status = ?, error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).bind(status, cleanError(error), Number(id)).run();
}

function cleanError(value) {
  const text = String(value || "Unknown media cache error").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 500) || "Unknown media cache error";
}

async function safeResponseText(response) {
  try { return await response.text(); } catch { return ""; }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
