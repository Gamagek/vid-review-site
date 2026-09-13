PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS video_analysis (
  video_id INTEGER PRIMARY KEY,
  source_url TEXT NOT NULL,
  transcript TEXT NOT NULL DEFAULT '',
  ocr_text TEXT NOT NULL DEFAULT '',
  captions_vtt TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  analysis_provider TEXT NOT NULL DEFAULT '',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
