PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media_cache_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '360p' CHECK (profile = '360p'),
  output_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'complete', 'failed', 'unsupported', 'waiting_transcoder')),
  rights_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (rights_confirmed IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_cache_job_identity
  ON media_cache_jobs (video_id, source_url, profile);

CREATE INDEX IF NOT EXISTS idx_media_cache_status
  ON media_cache_jobs (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_media_cache_video
  ON media_cache_jobs (video_id, updated_at DESC);
