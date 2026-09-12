PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS viewer_interests (
  fingerprint TEXT NOT NULL,
  primary_category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN -20 AND 100),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (fingerprint, primary_category, subcategory)
);

CREATE INDEX IF NOT EXISTS idx_viewer_interests_updated
  ON viewer_interests (updated_at);

INSERT INTO videos (
  slug,
  title,
  source_url,
  embed_url,
  media_type,
  r2_key,
  primary_category,
  subcategory,
  description,
  review_text,
  seo_title,
  seo_description,
  seo_tags,
  thumbnail_url,
  featured,
  trending,
  published
)
SELECT
  'youtube-embed-experience-demo',
  'YouTube Embedded Player Experience Demo',
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?rel=0&playsinline=1&enablejsapi=1&origin=https%3A%2F%2Fhome.vid.best',
  'youtube',
  NULL,
  'Technology',
  'Web Development',
  'A working Vid.Best demonstration of a privacy-enhanced YouTube embed inside a permanent, crawlable review page.',
  'This test page demonstrates the universal video workflow: a trusted provider URL is normalized into a safe embed, surrounded by original editorial copy, custom metadata, reactions, moderated comments, persistent playback and related-video discovery. The embedded video remains hosted and controlled by YouTube.',
  'YouTube Embedded Player Experience Demo',
  'Test the Vid.Best persistent YouTube player, custom SEO, reactions, moderated comments and interest-based video suggestions.',
  '["YouTube embed","video player demo","persistent mini player","video SEO","Vid.Best"]',
  'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg',
  1,
  1,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM videos WHERE slug = 'youtube-embed-experience-demo'
);
