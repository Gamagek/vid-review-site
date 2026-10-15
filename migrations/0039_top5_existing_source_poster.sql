-- Reconnect the already-hosted source poster for this exact published compilation.
-- No image/video is downloaded, rehosted, generated or changed by this migration.
-- Preserve owner edits and every field except the audited expired thumbnail address.
UPDATE videos
SET thumbnail_url = 'https://vid.best/media/uploads/tiktok-thumbnails/7578945803910270230.img'
WHERE id = 81
  AND slug = 'top-5-most-viewed-tiktoks-ever-billions-of-views-explained'
  AND published = 1 AND media_type = 'tiktok'
  AND title = 'Top 5 Most Viewed TikToks Ever! 🌟🤯 Billions of Views Explained'
  AND primary_category = 'Social Media & Trending'
  AND subcategory = 'TikTok Viral Challenges'
  AND substr(source_url, 1, instr(source_url || '?', '?') - 1)
    = 'https://www.tiktok.com/@toop5_/video/7578945803910270230'
  AND substr(thumbnail_url, 1, instr(thumbnail_url || '?', '?') - 1)
    = 'https://p16-common-sign.tiktokcdn-eu.com/tos-no1a-p-0037-no/os6BEmTLgJ4RAIdwpxQsaZFYEAFtkdf0BKBWDe~tplv-tiktokx-origin.image'
  AND created_at = '2026-10-03T15:34:17.920Z'
  AND updated_at = '2026-10-09T21:10:52.165Z'
  AND EXISTS (
    SELECT 1 FROM tiktok_oembed_cache c
    WHERE c.video_id = '7578945803910270230'
      AND c.share_url = 'https://www.tiktok.com/@toop5_/video/7578945803910270230'
      AND c.author_name = 'TOP 5'
      AND c.author_url = 'https://www.tiktok.com/@toop5_'
      AND c.title = 'Top 5 most viewed videos on TikTok | #tiktokvideos #bellapoarch #top5 #foryoupage #viral'
      AND c.thumbnail_url = 'https://vid.best/media/uploads/tiktok-thumbnails/7578945803910270230.img'
  );
