PRAGMA foreign_keys = ON;

ALTER TABLE comments ADD COLUMN image_key TEXT;

CREATE INDEX IF NOT EXISTS idx_comments_image_key
  ON comments (image_key);

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
  'lab-review-1-player-test',
  'Lab Review 1 — Player Feature Test',
  '/lab-media/lab-review-1.mp4',
  NULL,
  'raw',
  NULL,
  'Technology',
  'Gadget Reviews',
  'A live Vid.Best test video used to validate the featured carousel, mini video bar, pop-up player, reactions, sharing and moderated comments.',
  'This record is intentionally published as a feature test. Use it to verify playback behavior, the responsive carousel, mini-player controls, pop-up viewing, reactions, sharing and comment moderation before applying the same experience to the rest of the library.',
  'Lab Review 1 Player Feature Test',
  'Test the Vid.Best carousel, mini-player, pop-up playback, reactions, sharing and moderated comments with Lab Review 1.',
  '["Lab Review 1","video player test","Vid.Best","carousel","mini player","R2 video"]',
  NULL,
  1,
  1,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM videos WHERE slug = 'lab-review-1-player-test'
);
