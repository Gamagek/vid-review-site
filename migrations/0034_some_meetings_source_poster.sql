-- Exact public Open Graph poster from the saved Sanju Doni Facebook reel.
-- Replace only the known HTML-page thumbnail and preserve owner edits and dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/some-meetings-source-poster-v1.jpg'
WHERE id = 150 AND slug = 'some-meetings-end-in-goodbye-sinhala-reflection'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND subcategory = 'Facebook Reels Highlights'
  AND source_url = 'https://www.facebook.com/reel/297960563374326/'
  AND thumbnail_url = 'https://www.facebook.com/reel/297960563374326/'
  AND updated_at = '2026-10-12T17:43:44.501Z';
