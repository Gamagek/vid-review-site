ALTER TABLE videos ADD COLUMN cache_source_url TEXT;
ALTER TABLE videos ADD COLUMN cache_status TEXT NOT NULL DEFAULT 'none'
  CHECK (cache_status IN ('none', 'pending', 'running', 'complete', 'failed'));
ALTER TABLE videos ADD COLUMN cache_error TEXT;
ALTER TABLE videos ADD COLUMN cache_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE videos ADD COLUMN cache_next_attempt_at TEXT;
ALTER TABLE videos ADD COLUMN cached_at TEXT;

CREATE INDEX IF NOT EXISTS idx_videos_auto_cache
  ON videos (cache_status, cache_next_attempt_at, redistribution_certified, updated_at);
