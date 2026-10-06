PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS member_saved_videos (
  member_id INTEGER NOT NULL,
  video_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (member_id, video_id),
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_saved_videos_member_created
  ON member_saved_videos (member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_saved_videos_video
  ON member_saved_videos (video_id);
