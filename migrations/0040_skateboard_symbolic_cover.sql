-- A visibly labelled symbolic illustration, not source footage or an authenticity verdict.
-- Repair only the audited expired poster; keep owner text, dates, sources and cache intact.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/dog-skateboard-illustrated-v1.webp'
WHERE id = 32
  AND slug = 'the-extreme-skateboarding-corgi-is-this-viral-stunt-real-or-fake'
  AND published = 1 AND media_type = 'tiktok'
  AND title = 'The Extreme Skateboarding Corgi: Is This Viral Stunt Real or Fake'
  AND primary_category = 'Social Media & Trending'
  AND subcategory = 'TikTok Viral Challenges'
  AND substr(source_url, 1, instr(source_url || '?', '?') - 1)
    = 'https://www.tiktok.com/@phpetstars/video/7376458900440190214'
  AND substr(thumbnail_url, 1, instr(thumbnail_url || '?', '?') - 1)
    = 'https://p16-common-sign.tiktokcdn-eu.com/tos-maliva-p-0068/oMnBJGAfie0mFBA3IIk6RcmDQEaEJ6Gw1UXlQ6~tplv-tiktokx-origin.image'
  AND created_at = '2026-09-25T18:55:37.183Z'
  AND updated_at = '2026-09-25T18:55:37.183Z'
  AND EXISTS (
    SELECT 1 FROM tiktok_oembed_cache c
    WHERE c.video_id = '7376458900440190214'
      AND c.share_url = 'https://www.tiktok.com/@phpetstars/video/7376458900440190214'
      AND c.author_name = 'pawchew'
      AND c.author_url = 'https://www.tiktok.com/@phpetstars'
      AND c.title = 'A dog on a skateboard#dog #puppy #funny #fyp #dogsoftiktok'
  );
