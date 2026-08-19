PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS discovery_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  normalized_query TEXT NOT NULL UNIQUE,
  source_url TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
  request_count INTEGER NOT NULL DEFAULT 1,
  resolved_video_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (resolved_video_id) REFERENCES videos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_requests_status
  ON discovery_requests (status, request_count DESC, updated_at ASC);
