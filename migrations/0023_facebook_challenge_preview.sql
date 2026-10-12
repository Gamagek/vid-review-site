-- A small actual frame is bundled with the site, avoiding expiring CDN URLs.
-- Preserve custom uploaded covers, publication status and both timestamps.
UPDATE videos
SET thumbnail_url = 'https://vid.best/facebook-previews/outdoor-challenge-comedy-v1.jpg'
WHERE slug IN ('facebook-reel-pending-24', 'outdoor-challenge-comedy-big-reactions-around-the-table')
  AND source_url = 'https://www.facebook.com/share/v/1EK7gSexaj/'
  AND (thumbnail_url IS NULL OR thumbnail_url = '' OR thumbnail_url LIKE 'https://%.fbcdn.net/%');
