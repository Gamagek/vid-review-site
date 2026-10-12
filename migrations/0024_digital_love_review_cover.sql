-- An explicitly labelled illustrated editorial cover, not a video screenshot.
-- Never replace a concurrent owner/custom cover, source, publication state or dates.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/digital-love-illustrated-v1.webp'
WHERE id = 88
  AND slug = 'romantic-ai-art-the-beauty-of-digital-love-sweet-moments'
  AND title = 'Romantic AI Art 💖 The Beauty of Digital Love & Sweet Moments'
  AND media_type = 'raw'
  AND published = 1
  AND (thumbnail_url IS NULL OR thumbnail_url = '');
