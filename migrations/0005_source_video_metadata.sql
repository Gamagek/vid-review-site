PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS video_source_metadata (
  video_id INTEGER PRIMARY KEY,
  source_published_at TEXT,
  source_duration TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
