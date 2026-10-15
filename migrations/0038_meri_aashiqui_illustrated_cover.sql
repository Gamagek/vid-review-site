-- A visibly labelled symbolic editorial illustration, not source footage or an official poster.
-- Repair only the audited expired TikTok poster; preserve every other field and all owner edits.
UPDATE videos
SET thumbnail_url = 'https://vid.best/review-covers/meri-aashiqui-illustrated-v1.webp'
WHERE id = 12 AND slug = 'tiktok-discovery'
  AND published = 1 AND media_type = 'tiktok'
  AND primary_category = 'Entertainment, Movies & Games'
  AND subcategory = 'Movie Trailers'
  AND title = 'Meri Aashiqui Tum Se Hi: A story that tells the deepest beauty of love, The Ultimate Epic Romance & Dramatic Storytelling'
  -- Match the saved public source and image path without storing tracking or signed query strings.
  AND substr(source_url, 1, instr(source_url || '?', '?') - 1)
    = 'https://www.tiktok.com/@rorozya/video/7622472784039415061'
  AND substr(thumbnail_url, 1, instr(thumbnail_url || '?', '?') - 1)
    = 'https://p16-common-sign.tiktokcdn-eu.com/tos-alisg-p-0037/o4ScgaqIPhFciA8iXBB32AYprAlAIDdkEVAbE~tplv-tiktokx-dmt-logom:tos-alisg-i-0068/oAqElfHI8gQRDTAIAvxEAkCUdByFE37YpfavAD.image'
  AND created_at = '2026-09-22T10:53:05.021Z'
  AND updated_at = '2026-09-22T20:10:20.017Z';
