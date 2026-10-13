-- Exact, unaltered public poster from the saved Facebook video's own backdrop.
-- Preserve original dates and skip concurrent owner edits or custom covers.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/trust-yourself-source-poster-v1.jpg'
WHERE id = 151 AND slug = 'trust-yourself-cinematic-confidence'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND subcategory = 'Facebook Reels Highlights'
  AND source_url = 'https://www.facebook.com/share/v/1ApXSebvxw/'
  AND thumbnail_url = 'https://www.facebook.com/share/v/1ApXSebvxw/'
  AND updated_at = '2026-10-12T17:33:17.120Z';
