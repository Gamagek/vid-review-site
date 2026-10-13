-- Exact public Open Graph poster from the saved Buddha Puthun Facebook video.
-- Replace only the known HTML-page thumbnail and preserve owner edits and dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/right-place-source-poster-v1.jpg'
WHERE id = 161 AND slug = 'are-you-in-the-right-place-sinhala-reflection'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND subcategory = 'Facebook Reels Highlights'
  AND source_url = 'https://www.facebook.com/share/v/1FN1rjnggT/'
  AND thumbnail_url = 'https://www.facebook.com/share/v/1FN1rjnggT/'
  AND updated_at = '2026-10-12T09:21:09.802Z';
