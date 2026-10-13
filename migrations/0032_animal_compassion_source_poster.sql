-- Original public poster from the exact Anil Oskar source video, unaltered.
-- Only replace the known HTML thumbnail; preserve owner edits and all dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/animal-compassion-source-poster-v1.jpg'
WHERE id = 159 AND slug = 'animal-compassion-anil-oskar'
  AND published = 1 AND media_type = 'facebook'
  AND primary_category = 'Social Media & Trending'
  AND subcategory = 'Facebook Reels Highlights'
  AND source_url = 'https://www.facebook.com/100063535697972/videos/382088081635044/'
  AND thumbnail_url = 'https://www.facebook.com/100063535697972/videos/382088081635044/'
  AND updated_at = '2026-10-12T13:59:42.010Z';
