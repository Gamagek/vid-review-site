-- Preparation belongs to the media pipeline, not the owner's review fields/dates.
CREATE TABLE IF NOT EXISTS facebook_preview_jobs (
  video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  thumbnail_value TEXT NOT NULL DEFAULT '',
  canonical_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  poster_status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_token TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS facebook_preview_jobs_due ON facebook_preview_jobs(status, next_attempt_at);
