-- Reclassify the existing Itipiso Bhagava YouTube video by its stable YouTube ID.
-- The video may be stored as a watch URL, embed URL, or another normalized form,
-- so the ID match intentionally covers both source columns.
UPDATE videos
SET primary_category = 'Spirituality',
    subcategory = 'Buddhism',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source_url LIKE '%XTjyqOwuluA%'
   OR embed_url LIKE '%XTjyqOwuluA%';
