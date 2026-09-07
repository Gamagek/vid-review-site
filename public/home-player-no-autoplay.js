function stopFeaturedVideoAutoplay() {
  document.querySelectorAll("#featured-carousel .vb-lab-preview").forEach((video) => {
    video.autoplay = false;
    video.removeAttribute("autoplay");
    if (!video.paused) video.pause();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  stopFeaturedVideoAutoplay();
  const carousel = document.querySelector("#featured-carousel");
  if (!carousel) return;
  const observer = new MutationObserver(stopFeaturedVideoAutoplay);
  observer.observe(carousel, { childList: true, subtree: true });
});
