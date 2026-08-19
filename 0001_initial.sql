PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  embed_url TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('youtube', 'tiktok', 'facebook', 'raw', 'r2')),
  r2_key TEXT,
  primary_category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  review_text TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  seo_tags TEXT NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  trending INTEGER NOT NULL DEFAULT 0 CHECK (trending IN (0, 1)),
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  views INTEGER NOT NULL DEFAULT 0,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_published_created
  ON videos (published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_category
  ON videos (published, primary_category, subcategory);
CREATE INDEX IF NOT EXISTS idx_videos_featured
  ON videos (published, featured, trending);

CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'love', 'useful')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (video_id, fingerprint, reaction),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reactions_video
  ON reactions (video_id, reaction);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  author TEXT NOT NULL DEFAULT 'Guest',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_video_status
  ON comments (video_id, status, created_at DESC);
