import { parseInstagramUrl } from "./instagram-utils.js";

function renderCard(card) {
  const source = parseInstagramUrl(card.dataset.videoSource);
  const surface = card.querySelector(".preview-surface");
  if (!source || !surface) return;

  const wrapper = document.createElement("span");
  wrapper.className = "instagram-preview-card";
  wrapper.setAttribute("aria-label", "Instagram video preview");

  const frame = document.createElement("iframe");
  frame.className = "instagram-home-player";
  frame.src = source.embedUrl;
  frame.title = card.dataset.videoTitle || "Instagram video";
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen; web-share";
  frame.allowFullscreen = true;
  frame.setAttribute("scrolling", "no");

  const badge = document.createElement("span");
  badge.className = "instagram-preview-badge";
  badge.textContent = source.sourceUrl.includes("/reel/") ? "Instagram Reel" : "Instagram";

  const status = document.createElement("span");
  status.className = "instagram-preview-status";
  status.textContent = "Loading Instagram player…";

  frame.addEventListener("load", () => {
    status.hidden = true;
  }, { once: true });
  frame.addEventListener("error", () => {
    status.hidden = false;
    status.textContent = "Instagram player unavailable · open the video page";
  }, { once: true });

  wrapper.append(frame, badge, status);
  surface.replaceChildren(wrapper);
  surface.style.opacity = "1";
  card.classList.add("instagram-preview-ready");
  card.querySelector(".preview-status")?.setAttribute("hidden", "");
}

function loadPreviews() {
  document
    .querySelectorAll('.video-tile[data-video-provider="instagram"]:not([data-instagram-preview-loaded])')
    .forEach((card) => {
      card.dataset.instagramPreviewLoaded = "1";
      renderCard(card);
    });
}

document.addEventListener("DOMContentLoaded", loadPreviews);
document.addEventListener("vidbest:grid-rendered", loadPreviews);
