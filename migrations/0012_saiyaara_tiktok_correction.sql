-- Correct the production Saiyaara TikTok record without changing its permanent slug.
UPDATE videos
SET title = 'Saiyaara; A Cinematic Romance',
    seo_title = 'Saiyaara; A Cinematic Romance'
WHERE id = 8
  AND source_url LIKE 'https://www.tiktok.com/@saiyaara.4ever/video/7669587518156705056%';
