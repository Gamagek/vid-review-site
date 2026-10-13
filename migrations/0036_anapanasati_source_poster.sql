-- Exact public Open Graph poster from the saved Dhamma Articles Facebook reel.
-- Fill only the still-missing cover and preserve owner edits, text and dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/anapanasati-source-poster-v1.jpg'
WHERE id = 44 AND slug = 'facebook-discovery'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Spirituality'
  AND subcategory = 'Meditation & Mindfulness'
  AND source_url = 'https://www.facebook.com/share/v/1EwUUT7MN8/'
  AND thumbnail_url IS NULL
  AND updated_at = '2026-09-27T18:58:50.569Z';
