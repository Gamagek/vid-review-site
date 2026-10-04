import { parseInstagramUrl } from "./instagram-utils.js";

let sdkPromise;
const mounted = new Map();

function loadInstagramSdk() {
  if (window.instgrm?.Embeds?.process) return Promise.resolve(window.instgrm);
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.addEventListener("load", () => window.instgrm?.Embeds?.process
      ? resolve(window.instgrm) : reject(new Error("Instagram embed unavailable")), { once: true });
    script.addEventListener("error", () => reject(new Error("Instagram embed could not load")), { once: true });
    document.head.append(script);
  });
  return sdkPromise;
}

function renderCard(card) {
  const source = parseInstagramUrl(card.dataset.videoSource);
  const surface = card.querySelector(".preview-surface");
  const oldMedia = card.querySelector(".tile-media");
  if (!source || !surface || !oldMedia) return;

  // As with Facebook, the provider owns the interactive preview surface.
  // Keep iframe controls outside a navigation link; the review title still links.
  const media = document.createElement("div");
  media.className = oldMedia.className;
  media.append(...oldMedia.childNodes);
  oldMedia.replaceWith(media);
  surface.removeAttribute("aria-hidden");
  surface.classList.add("instagram-sdk-host");
  const wrapper = document.createElement("div");
  wrapper.className = "instagram-preview-card";
  const stage = document.createElement("div");
  stage.className = "instagram-sdk-stage";
  const embed = document.createElement("blockquote");
  embed.className = "instagram-media";
  embed.dataset.instgrmPermalink = source.sourceUrl;
  embed.dataset.instgrmVersion = "14";
  embed.textContent = "Loading Instagram preview…";
  stage.append(embed);
  wrapper.append(stage);
  surface.replaceChildren(wrapper);
  card.classList.add("instagram-preview-ready");
  card.querySelector(".preview-status")?.setAttribute("hidden", "");

  // Meta resizes the iframe after loading. Preserve that height, including on
  // narrow cards below Instagram's minimum width, without cropping controls.
  function resize() {
    const available = Math.min(540, media.clientWidth);
    if (!available) return;
    const width = Math.max(326, available);
    const scale = available / width;
    stage.style.width = `${width}px`;
    stage.style.transform = `scale(${scale})`;
    wrapper.style.width = `${available}px`;
    wrapper.style.height = `${Math.ceil(stage.offsetHeight * scale)}px`;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(media);
  observer.observe(stage);
  resize();
  mounted.set(card, observer);
  loadInstagramSdk().then((sdk) => {
    if (card.isConnected) sdk.Embeds.process();
  }).catch(() => {
    embed.textContent = "Instagram preview could not load. Open this review to retry.";
    resize();
  });
}

function loadPreviews() {
  for (const [card, observer] of mounted) {
    if (!card.isConnected) { observer.disconnect(); mounted.delete(card); }
  }
  document.querySelectorAll('.video-tile[data-video-provider="instagram"]:not([data-instagram-preview-loaded])').forEach((card) => {
    card.dataset.instagramPreviewLoaded = "1";
    renderCard(card);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadPreviews, { once: true });
else loadPreviews();
document.addEventListener("vidbest:grid-rendered", loadPreviews);
