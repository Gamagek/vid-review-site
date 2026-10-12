-- Actual frame from the existing public test video. No publication/date edits.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/lab-review-source-frame-v1.jpg'
WHERE id = 2 AND slug = 'lab-review-1-player-test'
  AND media_type = 'raw' AND source_url = '/lab-media/lab-review-1.mp4'
  AND published = 1 AND (thumbnail_url IS NULL OR thumbnail_url = '');
