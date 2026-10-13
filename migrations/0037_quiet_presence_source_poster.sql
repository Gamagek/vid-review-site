-- Exact public Open Graph poster from the saved Quiet Presence Facebook reel.
-- Replace only the known expiring provider poster and preserve owner edits and dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/quiet-presence-source-poster-v1.jpg'
WHERE id = 45 AND slug = 'facebook-discovery-5c11fe'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Music'
  AND subcategory = 'Lo-Fi & Relaxation'
  AND source_url = 'https://www.facebook.com/share/r/1TcfXsB2Zi/'
  AND thumbnail_url LIKE 'https://scontent-%fbcdn.net/v/t15.5256-10/723675293_1323146676617213_4937719645709367254_n.jpg?%'
  AND updated_at = '2026-09-30T17:54:22.518Z';
