import { parseInstagramUrl } from "./instagram-utils.js";

let activeCard = null;

function makeButton(label, className = "button ghost") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function createPreview(card) {
  const source = parseInstagramUrl(card.dataset.videoSource);
  const media = card.querySelector(".tile-media");
  if (!source || !media) return;

  const panel = document.createElement("section");
  panel.className = "instagram-mini-preview";
  panel.setAttribute("aria-label", "Instagram Reel preview");

  const copy = document.createElement("div");
  copy.className = "instagram-mini-preview-copy";

  const thumb = document.createElement("img");
  thumb.className = "instagram-mini-preview-thumb";
  thumb.loading = "lazy";
  thumb.decoding = "async";
  thumb.alt = "";
  thumb.src = card.dataset.videoThumbnail ||
    "/api/instagram/thumbnail?url=" + encodeURIComponent(source.sourceUrl);
  thumb.addEventListener("error", () => {
    thumb.hidden = true;
    panel.classList.add("instagram-mini-preview-no-image");
  }, { once: true });

  const text = document.createElement("div");
  text.className = "instagram-mini-preview-text";

  const provider = document.createElement("strong");
  provider.textContent = "Instagram Reel";

  const description = document.createElement("span");
  description.textContent = "Official Instagram preview";

  text.append(provider, description);
  copy.append(thumb, text);

  const actions = document.createElement("div");
  actions.className = "instagram-mini-preview-actions";

  const play = makeButton("Play here");
  const open = document.createElement("a");
  open.className = "button text-button";
  open.href = media.href || "#";
  open.textContent = "Open";
  open.setAttribute("aria-label", "Open Instagram Reel on Vid.Best");

  const status = document.createElement("span");
  status.className = "instagram-mini-preview-status";
  status.setAttribute("role", "status");

  function restore() {
    panel.classList.remove("is-playing");
    panel.replaceChildren(copy, actions, status);
    play.textContent = "Play here";
    status.textContent = "";
    activeCard = activeCard === panel ? null : activeCard;
  }

  function playInside() {
    activeCard?.__restore?.();
    const frame = document.createElement("iframe");
    frame.className = "instagram-mini-preview-frame";
    frame.title = card.dataset.videoTitle || "Instagram Reel";
    frame.src = source.embedUrl;
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen; web-share";
    frame.allowFullscreen = true;

    const controls = document.createElement("div");
    controls.className = "instagram-mini-preview-playing-actions";
    const close = makeButton("Close preview");
    close.addEventListener("click", restore);
    controls.append(close);

    panel.classList.add("is-playing");
    panel.replaceChildren(frame, controls);
    status.textContent = "Instagram controls playback inside the preview.";
    activeCard = panel;
    panel.__restore = restore;
  }

  play.addEventListener("click", playInside);
  actions.append(play, open);
  panel.append(copy, actions, status);
  media.after(panel);
}

function decorate() {
  document.querySelectorAll('.video-tile[data-video-provider="instagram"]:not([data-instagram-preview-card])')
    .forEach((card) => {
      card.dataset.instagramPreviewCard = "1";
      createPreview(card);
    });
}

document.addEventListener("vidbest:grid-rendered", decorate);
document.addEventListener("DOMContentLoaded", decorate);
window.addEventListener("pagehide", () => activeCard?.__restore?.());
