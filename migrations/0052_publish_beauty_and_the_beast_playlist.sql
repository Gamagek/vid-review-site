-- Publish Beauty and the Beast (2017) as one Vid.Best watch-page record.
-- This is an external YouTube embed only; Vid.Best does not download or re-host the film.
-- Idempotent by slug and first source video so an existing listing is not duplicated.
INSERT INTO videos (
  slug, title, source_url, embed_url, media_type, playlist_video_ids,
  primary_category, subcategory, description, review_text,
  seo_title, seo_description, seo_tags, thumbnail_url,
  featured, trending, published, created_at, updated_at
)
SELECT
  'beauty-and-the-beast-2017-50-part-playlist',
  'Beauty and the Beast (2017) — 50-Part Film Playlist',
  'https://www.youtube.com/watch?v=ZtYoKYLN3kw',
  'https://www.youtube-nocookie.com/embed/ZtYoKYLN3kw?rel=0&playsinline=1&enablejsapi=1&origin=https%3A%2F%2Fvid.best',
  'youtube',
  '["ZtYoKYLN3kw","FpY-OZkwvcc","zaAghJcyS3M","9JvYzBQFVo4","U6uv2h-TMU0","LlwBWaehcic","zlKViFVFKN8","NHAk-QkzKU0","-xMB4Bc-fWA","3bw3yhFjCFc","asvpTUHu-Wo","XS2GdSmECKI","D3blyRTRJfQ","2llkpls9124","AJmQxxeptg8","lkhsRLobbKY","IOa-fjeMrIg","nnEZoPPzH0s","xzwsXH7wgkI","Ib2dk3D5_Jo","-jRvBE3TcLs","KyCyFKhPgwA","a0X_tVwDBNs","zO1rmXYidtQ","9SYQgf53vTA","7LLNj-9XZwQ","udIFtiRDI0c","MABF5f1vIC8","7jefAlHB3vs","MDLa33gFUVs","LDlqTP5NLb4","WU_HtjCyX2c","5LUGCaKzxOk","55eRsod6iS4","aHqAWNJPivI","GNQEVOGBO5I","0v958mFrB3g","4s1ARmYfjNc","w_1QmpEi0gc","dJ4HhtIqHxw","oU1aPIDdTtM","9127Vh71S94","7BCy1v2SSBI","7KBiS4Xh6Z4","my8pNlh-EaY","3iVbnJcfc-0","uReDjmrRibI","Kal5BqgsUQ4","GwFjV90guOY","AMcXIG0HrIU"]',
  'Entertainment, Movies & Games',
  'Film Reviews',
  'One Vid.Best listing for Beauty and the Beast (2017), curated as 50 sequential YouTube parts. Open the page, play Part 1, then use Next in the same embedded player to continue through Part 50. The videos remain embedded from YouTube; availability and playback are controlled by YouTube and the original uploader.',
  'This page groups the playlist''s 50 entries titled Beauty and the Beast 2017 Part 1 through Part 50 in their published sequence. Start with Part 1 in the embedded player. Use the player''s own Next control to move to the following part without leaving this Vid.Best watch page. Vid.Best embeds the videos from YouTube and does not download or re-upload the film. Individual parts may be unavailable or region-restricted according to the original uploader and YouTube.',
  'Beauty and the Beast (2017) | 50-Part Playlist',
  'Watch Beauty and the Beast (2017) through 50 ordered YouTube parts. Play Part 1 and use Next in the same embedded player.',
  '["Beauty and the Beast 2017","Beauty and the Beast film","fantasy film","50 part playlist","YouTube film playlist","film review"]',
  'https://i.ytimg.com/vi/ZtYoKYLN3kw/hqdefault.jpg',
  0, 0, 1,
  '2026-11-07T00:00:00+05:30',
  '2026-11-07T00:00:00+05:30'
WHERE NOT EXISTS (
  SELECT 1 FROM videos
  WHERE slug = 'beauty-and-the-beast-2017-50-part-playlist'
     OR source_url = 'https://www.youtube.com/watch?v=ZtYoKYLN3kw'
);
