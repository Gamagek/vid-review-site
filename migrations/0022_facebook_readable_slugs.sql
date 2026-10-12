-- Preserve old review links when replacing seeded placeholder URLs.
-- Publication flags, editorial copy and both timestamps remain unchanged.
CREATE TABLE IF NOT EXISTS video_slug_redirects (
  old_slug TEXT PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_video_slug_redirects_video ON video_slug_redirects(video_id);

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-01', id FROM videos
WHERE slug = 'facebook-reel-pending-01'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'this-man-expressive-soft-drink-reaction');
UPDATE videos SET slug = 'this-man-expressive-soft-drink-reaction'
WHERE slug = 'facebook-reel-pending-01'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'this-man-expressive-soft-drink-reaction');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-02', id FROM videos
WHERE slug = 'facebook-reel-pending-02'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'be-generous-go-further-sinhala-reflection');
UPDATE videos SET slug = 'be-generous-go-further-sinhala-reflection'
WHERE slug = 'facebook-reel-pending-02'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'be-generous-go-further-sinhala-reflection');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-03', id FROM videos
WHERE slug = 'facebook-reel-pending-03'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'sindu-kanna-3-pol-karu');
UPDATE videos SET slug = 'sindu-kanna-3-pol-karu'
WHERE slug = 'facebook-reel-pending-03'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'sindu-kanna-3-pol-karu');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-04', id FROM videos
WHERE slug = 'facebook-reel-pending-04'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'pol-karu-playful-fashion-show');
UPDATE videos SET slug = 'pol-karu-playful-fashion-show'
WHERE slug = 'facebook-reel-pending-04'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'pol-karu-playful-fashion-show');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-05', id FROM videos
WHERE slug = 'facebook-reel-pending-05'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'order-now-limited-stock-potta-kusuma');
UPDATE videos SET slug = 'order-now-limited-stock-potta-kusuma'
WHERE slug = 'facebook-reel-pending-05'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'order-now-limited-stock-potta-kusuma');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-06', id FROM videos
WHERE slug = 'facebook-reel-pending-06'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'garden-like-painting-sithara-plant');
UPDATE videos SET slug = 'garden-like-painting-sithara-plant'
WHERE slug = 'facebook-reel-pending-06'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'garden-like-painting-sithara-plant');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-07', id FROM videos
WHERE slug = 'facebook-reel-pending-07'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'nature-is-power-sinhala-earth-reflection');
UPDATE videos SET slug = 'nature-is-power-sinhala-earth-reflection'
WHERE slug = 'facebook-reel-pending-07'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'nature-is-power-sinhala-earth-reflection');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-08', id FROM videos
WHERE slug = 'facebook-reel-pending-08'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'sunset-over-water-kind-hearted-sinhala-reflection');
UPDATE videos SET slug = 'sunset-over-water-kind-hearted-sinhala-reflection'
WHERE slug = 'facebook-reel-pending-08'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'sunset-over-water-kind-hearted-sinhala-reflection');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-09', id FROM videos
WHERE slug = 'facebook-reel-pending-09'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'shared-facebook-reel-09-general-draft');
UPDATE videos SET slug = 'shared-facebook-reel-09-general-draft'
WHERE slug = 'facebook-reel-pending-09'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'shared-facebook-reel-09-general-draft');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-10', id FROM videos
WHERE slug = 'facebook-reel-pending-10'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'think-like-lion-legends-club-lk');
UPDATE videos SET slug = 'think-like-lion-legends-club-lk'
WHERE slug = 'facebook-reel-pending-10'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'think-like-lion-legends-club-lk');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-11', id FROM videos
WHERE slug = 'facebook-reel-pending-11'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'live-kindly-enjoy-your-time');
UPDATE videos SET slug = 'live-kindly-enjoy-your-time'
WHERE slug = 'facebook-reel-pending-11'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'live-kindly-enjoy-your-time');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-12', id FROM videos
WHERE slug = 'facebook-reel-pending-12'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'some-meetings-end-in-goodbye-sinhala-reflection');
UPDATE videos SET slug = 'some-meetings-end-in-goodbye-sinhala-reflection'
WHERE slug = 'facebook-reel-pending-12'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'some-meetings-end-in-goodbye-sinhala-reflection');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-13', id FROM videos
WHERE slug = 'facebook-reel-pending-13'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'trust-yourself-cinematic-confidence');
UPDATE videos SET slug = 'trust-yourself-cinematic-confidence'
WHERE slug = 'facebook-reel-pending-13'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'trust-yourself-cinematic-confidence');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-14', id FROM videos
WHERE slug = 'facebook-reel-pending-14'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'past-present-progress-smart-ict');
UPDATE videos SET slug = 'past-present-progress-smart-ict'
WHERE slug = 'facebook-reel-pending-14'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'past-present-progress-smart-ict');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-15', id FROM videos
WHERE slug = 'facebook-reel-pending-15'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'cake-or-cat-cake-illusion-reaction');
UPDATE videos SET slug = 'cake-or-cat-cake-illusion-reaction'
WHERE slug = 'facebook-reel-pending-15'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'cake-or-cat-cake-illusion-reaction');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-16', id FROM videos
WHERE slug = 'facebook-reel-pending-16'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'was-there-no-other-way-lol-handhiya');
UPDATE videos SET slug = 'was-there-no-other-way-lol-handhiya'
WHERE slug = 'facebook-reel-pending-16'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'was-there-no-other-way-lol-handhiya');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-17', id FROM videos
WHERE slug = 'facebook-reel-pending-17'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'fashion-means-fashion-our-media');
UPDATE videos SET slug = 'fashion-means-fashion-our-media'
WHERE slug = 'facebook-reel-pending-17'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'fashion-means-fashion-our-media');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-18', id FROM videos
WHERE slug = 'facebook-reel-pending-18'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'late-home-cat-dog-couple-shaa-bro');
UPDATE videos SET slug = 'late-home-cat-dog-couple-shaa-bro'
WHERE slug = 'facebook-reel-pending-18'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'late-home-cat-dog-couple-shaa-bro');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-19', id FROM videos
WHERE slug = 'facebook-reel-pending-19'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'maths-symbols-start-dancing-dilu-teacher');
UPDATE videos SET slug = 'maths-symbols-start-dancing-dilu-teacher'
WHERE slug = 'facebook-reel-pending-19'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'maths-symbols-start-dancing-dilu-teacher');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-20', id FROM videos
WHERE slug = 'facebook-reel-pending-20'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'unstoppable-cat-version-sangeethaya-lk');
UPDATE videos SET slug = 'unstoppable-cat-version-sangeethaya-lk'
WHERE slug = 'facebook-reel-pending-20'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'unstoppable-cat-version-sangeethaya-lk');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-21', id FROM videos
WHERE slug = 'facebook-reel-pending-21'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'animal-compassion-anil-oskar');
UPDATE videos SET slug = 'animal-compassion-anil-oskar'
WHERE slug = 'facebook-reel-pending-21'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'animal-compassion-anil-oskar');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-22', id FROM videos
WHERE slug = 'facebook-reel-pending-22'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'remembering-kindness-sinhala-gratitude');
UPDATE videos SET slug = 'remembering-kindness-sinhala-gratitude'
WHERE slug = 'facebook-reel-pending-22'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'remembering-kindness-sinhala-gratitude');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-23', id FROM videos
WHERE slug = 'facebook-reel-pending-23'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'are-you-in-the-right-place-sinhala-reflection');
UPDATE videos SET slug = 'are-you-in-the-right-place-sinhala-reflection'
WHERE slug = 'facebook-reel-pending-23'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'are-you-in-the-right-place-sinhala-reflection');

INSERT OR IGNORE INTO video_slug_redirects (old_slug, video_id)
SELECT 'facebook-reel-pending-24', id FROM videos
WHERE slug = 'facebook-reel-pending-24'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'outdoor-challenge-comedy-big-reactions-around-the-table');
UPDATE videos SET slug = 'outdoor-challenge-comedy-big-reactions-around-the-table'
WHERE slug = 'facebook-reel-pending-24'
AND NOT EXISTS (SELECT 1 FROM videos WHERE slug = 'outdoor-challenge-comedy-big-reactions-around-the-table');
