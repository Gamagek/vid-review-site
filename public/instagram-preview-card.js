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

  // Fit the entire Meta embed into the shared tile dimensions, with
  // letterboxing instead of growing the grid row or cropping the controls.
  function resize() {
    const frame = stage.querySelector("iframe");
    // The SDK writes a height attribute; override the generic preview CSS
    // with that declared height rather than inheriting height:100%.
    const declaredHeight = Number(frame?.getAttribute("height"));
    if (frame && declaredHeight >= 100 && declaredHeight <= 5000) frame.style.height = `${declaredHeight}px`;
    const available = Math.min(540, media.clientWidth);
    if (!available) return;
    const width = Math.max(326, available);
    stage.style.width = `${width}px`;
    const height = Math.max(1, stage.offsetHeight);
    const scale = Math.min(1, media.clientWidth / width, media.clientHeight / height);
    stage.style.transform = `scale(${scale})`;
    stage.style.left = `${Math.max(0, (media.clientWidth - width * scale) / 2)}px`;
    stage.style.top = `${Math.max(0, (media.clientHeight - height * scale) / 2)}px`;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(media);
  observer.observe(stage);
  resize();
  const mutations = new MutationObserver(resize);
  mutations.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ["height"] });
  mounted.set(card, { disconnect() { observer.disconnect(); mutations.disconnect(); } });
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
