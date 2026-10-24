// No YouTube iframe is created until a deliberate button click.
// This script has no analytics, YouTube API requests or background polling.
(() => {
  "use strict";
  const button = document.getElementById("playlist-load");
  const shell = document.getElementById("playlist-player");
  const status = document.getElementById("playlist-status");
  if (!button || !shell) return;

  let loaded = false;
  button.addEventListener("click", () => {
    if (loaded || !shell.isConnected) return;
    loaded = true;
    const iframe = document.createElement("iframe");
    iframe.title = "Fantastic Beasts YouTube playlist player";
    iframe.width = "960";
    iframe.height = "540";
    iframe.loading = "eager";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.addEventListener("load", () => {
      if (status) status.textContent = "The YouTube player frame loaded. Use its controls to choose a video.";
    }, { once: true });
    iframe.addEventListener("error", () => {
      if (status) status.textContent = "The player could not load. Use the original YouTube playlist link below.";
    }, { once: true });
    // User-initiated playback only; does not request YouTube on the initial page.
    iframe.src = "https://www.youtube.com/embed?listType=playlist&list=PLfDrdp3ebgGt_Ew5TiazwOx4U-VBZv10S&autoplay=1&playsinline=1";
    shell.replaceChildren(iframe);
    if (status) status.textContent = "Loading the YouTube playlist player…";
  });
})();
