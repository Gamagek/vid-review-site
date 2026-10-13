// Bounded YouTube Data API lookups to verify *original* video publication dates.
// Never infer an external video's uploadDate from the Vid.Best review date.
const MAX_BATCH = 20;
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3/videos";

function youtubeVideoId(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/")[1] || "";
    else if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/)?.[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch { return ""; }
}

function originalPublicationDate(value) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  if (date.getUTCFullYear() < 2005 || date.getTime() > Date.now() + 86400000) return "";
  return date.toISOString();
}

function sourceDuration(value) {
  const text = typeof value === "string" ? value : "";
  return text.length > 2 && text.length < 32
    && /^P(?:\d+D)?T(?:\d+H)?(?:\d+M)?(?:\d+S)?$/.test(text) ? text : null;
}

// The Worker runs every 15 minutes; absent keys cause zero Google requests.
// Videos with existing verified publication dates are never overwritten.
export async function backfillYoutubeMetadata(env, { limit = MAX_BATCH } = {}) {
  if (!env?.DB || !env?.YOUTUBE_API_KEY) return { status: "not_configured", updated: 0 };
  const size = Math.max(1, Math.min(MAX_BATCH, Number(limit) || MAX_BATCH));
  const selected = await env.DB.prepare(
    "SELECT v.id, v.source_url FROM videos v " +
    "LEFT JOIN video_source_metadata m ON m.video_id = v.id " +
    "WHERE v.published = 1 AND v.media_type = 'youtube' " +
    "AND (m.source_published_at IS NULL OR trim(m.source_published_at) = '') " +
    "ORDER BY v.id DESC LIMIT ?"
  ).bind(size).all();
  const rows = selected.results || [];
  const candidates = rows.map(row => ({ ...row, youtubeId: youtubeVideoId(row.source_url) }))
    .filter(row => row.youtubeId);
  if (!candidates.length) return { status: "up_to_date_or_unavailable", updated: 0 };

  // One videos.list request for up to 20 unique YouTube IDs, not one per tile.
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    id: [...new Set(candidates.map(row => row.youtubeId))].join(","),
    key: env.YOUTUBE_API_KEY,
  });
  let payload;
  try {
    const response = await fetch(YOUTUBE_API + "?" + params.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: "provider_unavailable", updated: 0 };
    }
    payload = await response.json();
  } catch {
    return { status: "provider_unavailable", updated: 0 };
  }
  if (!Array.isArray(payload?.items)) return { status: "invalid_provider_response", updated: 0 };

  const confirmed = new Map();
  const ids = new Set(candidates.map(row => row.youtubeId));
  for (const item of payload.items) {
    if (!ids.has(item?.id)) continue;
    const date = originalPublicationDate(item?.snippet?.publishedAt);
    if (!date) continue;
    confirmed.set(item.id, { date, duration: sourceDuration(item?.contentDetails?.duration) });
  }

  let updated = 0;
  for (const row of candidates) {
    const verified = confirmed.get(row.youtubeId);
    if (!verified) continue;
    // Compare-and-save: a concurrent edit must not attach metadata to another video.
    const result = await env.DB.prepare(
      "INSERT INTO video_source_metadata (video_id, source_published_at, source_duration, updated_at) " +
      "SELECT v.id, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM videos v " +
      "WHERE v.id = ? AND v.source_url = ? AND v.published = 1 AND v.media_type = 'youtube' " +
      "ON CONFLICT(video_id) DO UPDATE SET " +
      "source_published_at = excluded.source_published_at, " +
      "source_duration = COALESCE(NULLIF(video_source_metadata.source_duration, ''), excluded.source_duration), " +
      "updated_at = excluded.updated_at " +
      "WHERE video_source_metadata.source_published_at IS NULL " +
      "OR trim(video_source_metadata.source_published_at) = ''"
    ).bind(verified.date, verified.duration, row.id, row.source_url).run();
    updated += Number(result?.meta?.changes || 0);
  }
  return { status: "complete", checked: candidates.length, updated };
}
