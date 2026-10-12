-- Verified ant/gratitude theme; explicitly labelled editorial illustration, not a screenshot.
-- Replace only this known invalid HTML cover; preserve owner changes and every other field.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/remembering-kindness-illustrated-v1.webp'
WHERE id = 160 AND slug = 'remembering-kindness-sinhala-gratitude'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND source_url = 'https://www.facebook.com/share/r/18dmC2npkB/'
  AND thumbnail_url = 'https://www.facebook.com/share/r/18dmC2npkB/';
