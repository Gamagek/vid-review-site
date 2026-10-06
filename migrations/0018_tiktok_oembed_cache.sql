CREATE TABLE IF NOT EXISTS tiktok_oembed_cache (
  video_id TEXT PRIMARY KEY,
  share_url TEXT NOT NULL UNIQUE,
  title TEXT,
  author_name TEXT,
  author_url TEXT,
  description TEXT,
  thumbnail_url TEXT,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tiktok_oembed_cache_fetched_at
  ON tiktok_oembed_cache (fetched_at);
