-- The public source verifies a blue-and-orange dusk sky montage with birds.
-- This is an explicitly labelled editorial illustration, not a source frame.
-- Replace only the exact broken HTML cover; preserve every owner-edited field and date.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/live-kindly-illustrated-v1.webp'
WHERE id = 149 AND slug = 'live-kindly-enjoy-your-time'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND source_url = 'https://www.facebook.com/share/v/1CjSQwbJVD/'
  AND thumbnail_url = 'https://www.facebook.com/share/v/1CjSQwbJVD/';
