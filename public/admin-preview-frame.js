// Capture a real frame from an owner-uploaded local file, never a provider iframe.
(() => {
  async function capture(file) {
    const source = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    try {
      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Frame capture timed out')), 10000);
        const complete = () => { window.clearTimeout(timeout); resolve(); };
        video.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error('Video frame unavailable')); }, { once: true });
        video.addEventListener('loadeddata', () => {
          const time = Number.isFinite(video.duration) ? Math.min(0.5, video.duration / 10) : 0;
          if (time > 0) {
            video.addEventListener('seeked', complete, { once: true });
            video.currentTime = time;
          } else complete();
        }, { once: true });
        video.src = source;
      });
      if (!video.videoWidth || !video.videoHeight) throw new Error('Video frame unavailable');
      const scale = Math.min(1, 384 / video.videoWidth, 216 / video.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Frame capture unavailable')), 'image/webp', 0.72));
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(source);
    }
  }
  window.VidBestPreviewFrame = { capture };
})();
