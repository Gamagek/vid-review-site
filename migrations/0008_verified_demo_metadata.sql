PRAGMA foreign_keys = ON;

-- Verified from the YouTube Data API record for Google's documented IFrame API
-- sample video. Keeping the source date separate prevents Vid.Best's page date
-- from being misrepresented as the original video's upload date.
INSERT INTO video_source_metadata (
  video_id,
  source_published_at,
  source_duration,
  updated_at
)
SELECT
  id,
  '2013-04-10T17:25:04.000Z',
  'PT15M51S',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM videos
WHERE slug = 'youtube-embed-experience-demo'
ON CONFLICT(video_id) DO UPDATE SET
  source_published_at = excluded.source_published_at,
  source_duration = excluded.source_duration,
  updated_at = excluded.updated_at;
