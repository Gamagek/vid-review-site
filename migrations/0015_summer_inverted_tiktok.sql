INSERT INTO videos (
  slug, title, source_url, embed_url, media_type, r2_key,
  primary_category, subcategory, description, review_text,
  seo_title, seo_description, seo_tags, thumbnail_url,
  featured, trending, published
)
SELECT
  'summer-inverted-7332342275151760642',
  'Summer😊#Inverted',
  'https://www.tiktok.com/@looooooooch/video/7332342275151760642',
  'https://www.tiktok.com/player/v1/7332342275151760642?controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=1&loop=0&autoplay=0&music_info=1&description=1&rel=1&native_context_menu=1&closed_caption=1&muted=0',
  'tiktok',
  NULL,
  'Social Media & Trending',
  'TikTok Viral Challenges',
  '',
  '',
  '',
  '',
  '[]',
  NULL,
  0,
  0,
  1
WHERE NOT EXISTS (
  SELECT 1
  FROM videos
  WHERE slug = 'summer-inverted-7332342275151760642'
);
