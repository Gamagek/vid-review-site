const PREVIEW_DELAY_MS = 3000;
const PREVIEW_VISIBILITY = 0.72;
const EMBED_PREVIEW_PROVIDERS = new Set(["youtube", "vimeo", "dailymotion", "twitch"]);
const ALLOWED_EMBED_HOSTS = new Set([
  "www.youtube-nocookie.com",
  "www.youtube.com",
  "player.vimeo.com",
  "www.dailymotion.com",
  "player.twitch.tv",
  "clips.twitch.tv",
]);

const previewState = {
  activeCard: null,
  candidateCard: null,
  timer: null,
  visibility: new Map(),
  observer: null,
};

let tiktokEmbedScriptPromise = null;

document.addEventListener("DOMContentLoaded", initializePreviews);
document.addEventListener("vidbest:grid-rendered", decorateVideoCards);

function initializePreviews() {
  if ("IntersectionObserver" in window) {
    previewState.observer = new IntersectionObserver(handleVisibility, {
      threshold: [0, 0.25, PREVIEW_VISIBILITY, 1],
      rootMargin: "-5% 0px -5%",
    });
  }
  decorateVideoCards();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPreview();
    else chooseVisibleCandidate();
  });
  window.addEventListener("pagehide", () => stopPreview());
}

function decorateVideoCards() {
  if (previewState.activeCard && !previewState.activeCard.isConnected) stopPreview();
  document.querySelectorAll(".video-tile:not([data-preview-ready])").forEach((card) => {
    card.dataset.previewReady = "true";
    const media = card.querySelector(".tile-media");
    if (!media) return;
    card.querySelector(".preview-status").textContent = previewAvailabilityMessage(card);
    media.addEventListener("pointerenter", () => schedulePreview(card));
    media.addEventListener("pointerleave", () => {
      if (previewState.candidateCard === card && (previewState.visibility.get(card) || 0) < PREVIEW_VISIBILITY) {
        cancelCandidate(card);
      }
    });
    media.addEventListener("focus", () => schedulePreview(card));
    media.addEventListener("blur", () => cancelCandidate(card));
    previewState.observer?.observe(card);
  });
}

function previewsAllowed() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const slowNetwork = ["slow-2g", "2g"].includes(connection?.effectiveType);
  return !matchMedia("(prefers-reduced-motion: reduce)").matches && !connection?.saveData && !slowNetwork;
}

function previewAvailabilityMessage(card) {
  if (!previewsAllowed()) return "Open video · preview disabled";
  if (card.dataset.videoProvider === "tiktok" && !parseTikTokShareUrl(card.dataset.videoSource)) {
    return "TikTok preview needs a normal sharing link";
  }
  return canPreview(card) ? "Hold for a 3-second preview" : "Open video to play";
}

function canPreview(card) {
  const provider = card.dataset.videoProvider;
  if (provider === "tiktok") return Boolean(parseTikTokShareUrl(card.dataset.videoSource));
  const direct = Boolean(card.dataset.videoSource) && ["direct", "raw", "r2"].includes(provider);
  const embed = Boolean(card.dataset.videoEmbed) && EMBED_PREVIEW_PROVIDERS.has(provider);
  return direct || embed;
}

function parseTikTokShareUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "tiktok.com") return null;
    const match = url.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/);
    if (!match) return null;
    return { url: url.toString(), id: match[1] };
  } catch {
    return null;
  }
}

function ensureTikTokEmbedScript() {
  const existing = document.querySelector('script[data-vidbest-tiktok-embed]');
  if (existing) return tiktokEmbedScriptPromise || Promise.resolve();
  tiktokEmbedScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.tiktok.com/embed.js";
    script.dataset.vidbestTiktokEmbed = "1";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("TikTok preview script failed to load")), { once: true });
    document.head.append(script);
  });
  return tiktokEmbedScriptPromise;
}

function handleVisibility(entries) {
  entries.forEach((entry) => {
    previewState.visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    if (entry.target === previewState.activeCard && entry.intersectionRatio < 0.25) stopPreview();
  });
  chooseVisibleCandidate();
}

function chooseVisibleCandidate() {
  if (document.hidden || !previewsAllowed()) return;
  let bestCard = null;
  let bestScore = PREVIEW_VISIBILITY;
  for (const [card, ratio] of previewState.visibility) {
    if (!card.isConnected) {
      previewState.visibility.delete(card);
      continue;
    }
    if (card.dataset.videoProvider === "tiktok") continue;
    if (ratio >= bestScore && canPreview(card)) {
      bestCard = card;
      bestScore = ratio;
    }
  }
  if (bestCard && bestCard !== previewState.activeCard && bestCard !== previewState.candidateCard) {
    schedulePreview(bestCard);
  }
}

function schedulePreview(card) {
  if (!card?.isConnected || !previewsAllowed() || !canPreview(card)) return;
  if (previewState.activeCard === card || previewState.candidateCard === card) return;
  cancelCandidate();
  previewState.candidateCard = card;
  card.classList.add("preview-pending");
  card.querySelector(".preview-status").textContent = "Preview starts in 3 seconds";
  previewState.timer = window.setTimeout(() => startPreview(card), PREVIEW_DELAY_MS);
}

function cancelCandidate(card = null) {
  if (card && previewState.candidateCard !== card) return;
  window.clearTimeout(previewState.timer);
  previewState.timer = null;
  const candidate = previewState.candidateCard;
  previewState.candidateCard = null;
  if (candidate?.isConnected) {
    candidate.classList.remove("preview-pending");
    candidate.querySelector(".preview-status").textContent = previewAvailabilityMessage(candidate);
  }
}

function startPreview(card) {
  if (previewState.candidateCard !== card || document.hidden || !card.isConnected) return;
  previewState.candidateCard = null;
  previewState.timer = null;
  stopPreview();
  const surface = card.querySelector(".preview-surface");
  const player = createPreviewPlayer(card);
  card.classList.remove("preview-pending");
  if (card.dataset.videoProvider === "tiktok" && !player) {
    card.querySelector(".preview-status").textContent = "TikTok preview needs a normal sharing link";
    return;
  }
  if (!surface || !player) {
    card.querySelector(".preview-status").textContent = "Open video to play";
    return;
  }
  surface.replaceChildren(player);
  card.classList.add("preview-playing");
  previewState.activeCard = card;
  card.querySelector(".preview-status").textContent = "Muted preview · open for controls";
  if (player instanceof HTMLVideoElement) {
    player.play().catch(() => {
      if (previewState.activeCard !== card) return;
      card.querySelector(".preview-status").textContent = "Tap to open video";
      stopPreview(card);
    });
  }
}

function createPreviewPlayer(card) {
  const provider = card.dataset.videoProvider;
  if (provider === "tiktok") {
    const share = parseTikTokShareUrl(card.dataset.videoSource);
    if (!share) return null;
    const blockquote = document.createElement("blockquote");
    blockquote.className = "tiktok-embed";
    blockquote.setAttribute("cite", share.url);
    blockquote.dataset.videoId = share.id;
    blockquote.dataset.embedFrom = "vidbest-hover";
    blockquote.style.maxWidth = "605px";
    blockquote.style.minWidth = "0";
    blockquote.style.width = "100%";
    const section = document.createElement("section");
    blockquote.append(section);
    ensureTikTokEmbedScript().catch(() => {
      card.querySelector(".preview-status").textContent = "TikTok preview unavailable · open video";
    });
    return blockquote;
  }
  if (["direct", "raw", "r2"].includes(provider)) {
    const source = safeMediaUrl(card.dataset.videoSource);
    if (!source) return null;
    const video = document.createElement("video");
    video.src = source;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", `${card.dataset.videoTitle} muted preview`);
    return video;
  }

  const embed = safePreviewEmbed(card.dataset.videoEmbed, provider);
  if (!embed) return null;
  const iframe = document.createElement("iframe");
  iframe.src = embed;
  iframe.title = `${card.dataset.videoTitle} muted preview`;
  iframe.loading = "eager";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allow = "autoplay; encrypted-media; picture-in-picture";
  iframe.tabIndex = -1;
  return iframe;
}

function safeMediaUrl(value) {
  try {
    const url = new URL(value, location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safePreviewEmbed(value, provider) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !ALLOWED_EMBED_HOSTS.has(url.hostname.toLowerCase())) return "";
    if (provider === "youtube") {
      url.searchParams.set("autoplay", "1");
      url.searchParams.set("mute", "1");
      url.searchParams.set("controls", "0");
    } else if (provider === "vimeo") {
      url.searchParams.set("autoplay", "1");
      url.searchParams.set("muted", "1");
      url.searchParams.set("background", "1");
    } else if (provider === "dailymotion") {
      url.searchParams.set("autoplay", "1");
      url.searchParams.set("mute", "1");
      url.searchParams.set("controls", "0");
    } else if (provider === "twitch") {
      url.searchParams.set("autoplay", "true");
      url.searchParams.set("muted", "true");
      url.searchParams.set("parent", location.hostname);
    }
    return url.href;
  } catch {
    return "";
  }
}

function stopPreview(card = null) {
  if (card && previewState.activeCard !== card) return;
  const active = previewState.activeCard;
  if (!active) return;
  active.querySelector(".preview-surface video")?.pause();
  active.querySelector(".preview-surface")?.replaceChildren();
  active.classList.remove("preview-playing");
  active.querySelector(".preview-status").textContent = previewAvailabilityMessage(active);
  previewState.activeCard = null;
}
