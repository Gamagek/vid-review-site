-- Clearly labelled symbolic editorial artwork, based on verified public source text.
-- Change only the exact broken HTML cover; retain owner edits and all video dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/past-present-progress-illustrated-v1.webp'
WHERE id = 152 AND slug = 'past-present-progress-smart-ict'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND source_url = 'https://www.facebook.com/share/r/1FNFrJHddw/'
  AND thumbnail_url = 'https://www.facebook.com/share/r/1FNFrJHddw/';
