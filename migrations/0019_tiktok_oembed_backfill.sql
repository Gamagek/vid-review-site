CREATE TABLE IF NOT EXISTS tiktok_oembed_backfill_failures (
  video_id TEXT PRIMARY KEY,
  share_url TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tiktok_oembed_backfill_retry
  ON tiktok_oembed_backfill_failures (next_retry_at, failure_count);
