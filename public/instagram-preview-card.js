import { parseInstagramUrl } from "./instagram-utils.js";

let activeModal = null;
let loading = null;

function makeTrigger(label) {
  const element = document.createElement("span");
  element.className = "instagram-preview-trigger";
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  element.textContent = label;
  return element;
}

function openInstagramModal(source, title) {
  activeModal?.close();

  const modal = document.createElement("div");
  modal.className = "instagram-preview-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title || "Instagram preview");

  const panel = document.createElement("section");
  panel.className = "instagram-preview-modal-panel";

  const head = document.createElement("div");
  head.className = "instagram-preview-modal-head";

  const heading = document.createElement("strong");
  heading.textContent = title || "Instagram Reel";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "button ghost instagram-preview-close";
  close.textContent = "Close";

  head.append(heading, close);

  const frame = document.createElement("iframe");
  frame.className = "instagram-preview-modal-frame";
  frame.src = source.embedUrl;
  frame.title = title || "Instagram video";
  frame.loading = "eager";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen; web-share";
  frame.allowFullscreen = true;

  const status = document.createElement("p");
  status.className = "instagram-preview-modal-status";
  status.textContent = "Loading the official Instagram player…";

  const foot = document.createElement("div");
  foot.className = "instagram-preview-modal-foot";

  const open = document.createElement("a");
  open.className = "button ghost";
  open.href = source.sourceUrl;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "Open on Instagram ↗";

  foot.append(open);
  panel.append(head, frame, status, foot);
  modal.append(panel);
  document.body.append(modal);
  document.body.classList.add("instagram-preview-open");

  const closeModal = () => {
    frame.src = "about:blank";
    modal.remove();
    document.body.classList.remove("instagram-preview-open");
    if (activeModal?.modal === modal) activeModal = null;
  };

  const onKey = (event) => {
    if (event.key === "Escape" && modal.isConnected) {
      document.removeEventListener("keydown", onKey);
      closeModal();
    }
  };

  close.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", onKey);
  frame.addEventListener("load", () => {
    status.textContent = "Use the controls inside the official Instagram player.";
  }, { once: true });
  frame.addEventListener("error", () => {
    status.textContent = "Instagram could not load. Use Open on Instagram to view the original.";
  }, { once: true });

  activeModal = { modal, close: closeModal };
}

function renderCard(card, preview = {}) {
  const source = parseInstagramUrl(card.dataset.videoSource);
  const surface = card.querySelector(".preview-surface");
  if (!source || !surface) return;

  const wrapper = document.createElement("span");
  wrapper.className = "instagram-preview-card";
  wrapper.setAttribute("aria-label", "Instagram preview");

  const image = document.createElement("img");
  image.alt = preview.title || card.dataset.videoTitle || "Instagram preview";
  image.loading = "lazy";
  image.decoding = "async";

  const imageUrl = preview.thumbnail_url || card.dataset.videoThumbnail || "";
  if (imageUrl) {
    image.src = imageUrl;
    image.addEventListener("error", () => {
      image.hidden = true;
      wrapper.classList.add("no-thumbnail");
    }, { once: true });
  } else {
    wrapper.classList.add("no-thumbnail");
  }

  const shade = document.createElement("span");
  shade.className = "instagram-preview-shade";

  const content = document.createElement("span");
  content.className = "instagram-preview-content";

  const badge = document.createElement("span");
  badge.className = "instagram-preview-badge";
  badge.textContent = source.sourceUrl.includes("/reel/") ? "Instagram Reel" : "Instagram";

  const title = document.createElement("strong");
  title.className = "instagram-preview-title";
  title.textContent = preview.title || card.dataset.videoTitle || "View Instagram video";

  const author = document.createElement("span");
  author.className = "instagram-preview-author";
  author.textContent = preview.author_name ? "@" + preview.author_name : "Public Instagram content";

  const play = makeTrigger("▶ Play inside Vid.Best");
  const launch = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openInstagramModal(source, title.textContent);
  };
  play.addEventListener("click", launch);
  play.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") launch(event);
  });

  content.append(badge, title, author, play);
  wrapper.append(image, shade, content);
  surface.replaceChildren(wrapper);
  surface.style.opacity = "1";
  card.classList.add("instagram-preview-ready");

  const status = card.querySelector(".preview-status");
  if (status) status.textContent = preview.thumbnail_url
    ? "Instagram preview · play inside Vid.Best"
    : "Instagram · preview card ready";
}

async function loadPreviews() {
  if (loading) return loading;

  const cards = [...document.querySelectorAll('.video-tile[data-video-provider="instagram"]:not([data-instagram-preview-loaded])')];
  const requests = cards
    .map((card) => ({ card, source: parseInstagramUrl(card.dataset.videoSource) }))
    .filter((item) => item.source);

  if (!requests.length) return;
  requests.forEach(({ card }) => { card.dataset.instagramPreviewLoaded = "1"; });

  const params = new URLSearchParams();
  requests.forEach(({ source }) => params.append("url", source.sourceUrl));

  loading = fetch("/api/instagram/previews?" + params.toString(), {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Instagram preview unavailable");
      const byUrl = new Map((payload.previews || []).map((item) => [item.source_url || item.url, item]));
      requests.forEach(({ card, source }) => renderCard(card, byUrl.get(source.sourceUrl) || {}));
    })
    .catch(() => {
      requests.forEach(({ card }) => renderCard(card, {}));
    })
    .finally(() => { loading = null; });

  return loading;
}

document.addEventListener("DOMContentLoaded", loadPreviews);
document.addEventListener("vidbest:grid-rendered", loadPreviews);
window.addEventListener("pagehide", () => activeModal?.close());
