-- Store an ordered, owner-curated list of YouTube video IDs on a single Vid.Best video record.
-- The first ID must match videos.source_url; the remaining IDs are passed to the embedded player.
ALTER TABLE videos ADD COLUMN playlist_video_ids TEXT NOT NULL DEFAULT '[]';
