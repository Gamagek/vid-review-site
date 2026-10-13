-- The public source verifies garden/flowers; this explicitly labelled illustration is not a source frame.
-- Replace only the exact broken HTML cover. Preserve owner edits, text and all publication dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/garden-like-painting-illustrated-v1.webp'
WHERE id = 144 AND slug = 'garden-like-painting-sithara-plant'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND source_url = 'https://www.facebook.com/share/v/19wWG3XGpC/'
  AND thumbnail_url = 'https://www.facebook.com/share/v/19wWG3XGpC/';
