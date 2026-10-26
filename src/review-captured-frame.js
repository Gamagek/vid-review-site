// Source-controlled editorial frames only. Never download or query D1 from this resolver.
export function capturedReviewFrame(row, image, thumbnail, origin) {
  if (image?.kind !== 'video_frame' || row.id <= 10 || row.media_type === 'raw' || row.published === 0 ||
      !Number.isFinite(image.seconds) || image.seconds < 0 || !Number.isFinite(image.sourceDuration) || image.seconds >= image.sourceDuration ||
      !/^[a-f0-9]{64}$/.test(image.source_sha256 || '') || !/^[a-f0-9]{64}$/.test(image.sha256 || '') ||
      image.path !== `/review-source-images/${row.id}-${image.sha256.slice(0,16)}.jpg` ||
      image.sourceUrl !== row.source_url || image.expectedThumbnail !== (row.thumbnail_url || '') ||
      !Number.isSafeInteger(image.bytes) || image.bytes < 200 || image.bytes > 150000 ||
      !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
      image.width < 1 || image.height < 1 || image.width > 960 || image.height > 1920 ||
      typeof image.caption !== 'string' || !image.caption.trim()) return null;
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' || base.username || base.password) return null;
    return {url:new URL(image.path,base).href,width:image.width,height:image.height,
      caption:image.caption,alt:image.alt || image.caption,kind:'video_frame'};
  } catch { return null; }
}
