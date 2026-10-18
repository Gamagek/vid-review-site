// Each isolated document renders one official embed. Metadata is reused by the
// shared parent broker; closing still destroys the cross-origin player/audio.
(() => {
  if (window.VidBestTikTokCachePlayerStarted) return;
  window.VidBestTikTokCachePlayerStarted = true;
  const status = document.getElementById("cache-status");
  const host = document.getElementById("tiktok-embed-host");
  const link = document.getElementById("tiktok-source");
  const limitedMessage = "TikTok cache requests are limited to 20 videos per viewer per day. Your request is currently limited; please try again later.";
  let started = false;

  function notify(state, message) {
    status.textContent = message;
    window.parent.postMessage({ channel: "vidbest-tiktok-oembed", video_id: host.dataset.videoId || "", state, message }, location.origin);
  }

  async function start() {
    if (started) return;
    started = true;
    try {
      const source = new URL(link.href);
      const match = source.pathname.match(/^\/@([A-Za-z0-9_.]{1,32})\/video\/(\d{15,25})$/);
      if (source.origin !== "https://www.tiktok.com" || !match) throw new Error("Invalid TikTok source.");
      host.dataset.videoId = match[2];
      let broker = window.VidBestTikTokOEmbedCache;
      try { broker = window.parent.VidBestTikTokOEmbedCache || broker; } catch {}
      if (!broker) throw new Error("Metadata cache unavailable.");
      const data = await broker.lookup(source.href, (url, options) => fetch(url, options));
      const metadata = data.metadata;
      const remaining = metadata.remaining_today === null ? "" : ` ${metadata.remaining_today} video requests left at the last lookup.`;
      const reused = data.reused ? " Reusing saved video details." : "";

      // Construct DOM from validated text. Never insert API-provided HTML/scripts.
      const blockquote = document.createElement("blockquote");
      blockquote.className = "tiktok-embed";
      blockquote.setAttribute("cite", source.href);
      blockquote.setAttribute("data-video-id", match[2]);
      blockquote.setAttribute("data-embed-from", "oembed");
      const section = document.createElement("section");
      const author = document.createElement("a");
      author.href = `https://www.tiktok.com/@${match[1]}`;
      author.target = "_blank";
      author.rel = "noopener noreferrer";
      author.textContent = String(metadata.author_name || "@" + match[1]).slice(0, 120);
      const caption = document.createElement("p");
      caption.textContent = String(metadata.title || "TikTok video").slice(0, 2200);
      section.append(author, caption);
      blockquote.append(section);
      host.replaceChildren(blockquote);
      const script = document.createElement("script");
      script.src = "https://www.tiktok.com/embed.js";
      script.async = true;
      script.addEventListener("error", () => notify("error", "TikTok's embed script could not load. Please use the source link below."), { once: true });
      script.addEventListener("load", () => notify("loading", "TikTok's official player may still be loading or unavailable. If it shows an error, close it or use the source link below." + reused + remaining), { once: true });
      notify("loading", "Opening TikTok's official player from cached details…" + reused + remaining);
      document.body.append(script);
    } catch (error) {
      notify("error", error?.code === "limited" ? limitedMessage : "The TikTok embed could not load. No automatic retry was made; please wait before trying again or use the source link below.");
    }
  }
  void start();
})();
