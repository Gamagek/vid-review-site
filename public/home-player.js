const PREVIEW_DELAY_MS = 450;
const PREVIEW_VISIBILITY = 0.62;
const ACTIVE_SWITCH_MARGIN = 0.14;
const ACTIVE_MIN_VISIBILITY = 0.08;
const EMBED_PREVIEW_PROVIDERS = new Set(["youtube", "vimeo", "dailymotion", "twitch"]);
const ALLOWED_EMBED_HOSTS = new Set([
  "www.youtube-nocookie.com",
  "www.youtube.com",
  "player.vimeo.com",
  "www.dailymotion.com",
  "player.twitch.tv",
  "clips.twitch.tv",
  "www.facebook.com",
]);

const previewState = {
  activeCard: null,
  candidateCard: null,
  timer: null,
  visibility: new Map(),
  observer: null,
  activeCleanup: null,
  tiktokMetadataRequested: new Set(),
};

document.addEventListener("DOMContentLoaded", initializePreviews);
document.addEventListener("vidbest:grid-rendered", () => {
  decorateVideoCards();
  void loadCachedTikTokFacadePreviews();
});

function initializePreviews() {
  if ("IntersectionObserver" in window) {
    previewState.observer = new IntersectionObserver(handleVisibility, {
      threshold: [0, 0.25, PREVIEW_VISIBILITY, 1],
      rootMargin: "-5% 0px -5%",
    });
  }
  decorateVideoCards();
  void loadCachedTikTokFacadePreviews();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPreview();
    else chooseVisibleCandidate();
  });
  window.addEventListener("pagehide", () => stopPreview());
  document.addEventListener("fullscreenchange", chooseVisibleCandidate);
  document.addEventListener("webkitfullscreenchange", chooseVisibleCandidate);
}

function decorateVideoCards() {
  if (previewState.activeCard && !previewState.activeCard.isConnected) stopPreview();
  document.querySelectorAll(".video-tile:not([data-preview-ready])").forEach((card) => {
    card.dataset.previewReady = "true";
    const media = card.querySelector(".tile-media");
    if (!media) return;
    const status = card.querySelector(".preview-status");
    if (status) status.textContent = previewAvailabilityMessage(card);

    if (card.dataset.videoProvider === "facebook") {
      mountFacebookDirectPlayer(card);
      return;
    }

    if (card.dataset.videoProvider === "tiktok") {
      renderTikTokFacade(card);
      media.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!parseTikTokShareUrl(card.dataset.videoSource)) return;
        event.preventDefault();
        activateTikTokPlayer(card);
      });
      previewState.observer?.observe(card);
      return;
    }

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
  if (card.dataset.videoProvider === "tiktok") {
    return parseTikTokShareUrl(card.dataset.videoSource)
      ? "TikTok · tap to play"
      : "TikTok player needs a normal sharing link";
  }
  if (card.dataset.videoProvider === "facebook") {
    return "Loading Facebook player…";
  }
  return canPreview(card) ? "Preview loads automatically" : "Open video to play";
}

function canPreview(card) {
  const provider = card.dataset.videoProvider;
  if (provider === "tiktok") return false;
  if (provider === "facebook") return false;
  const direct = Boolean(card.dataset.videoSource) && ["direct", "raw", "r2"].includes(provider);
  const embed = Boolean(card.dataset.videoEmbed) && EMBED_PREVIEW_PROVIDERS.has(provider);
  return direct || embed;
}

function parseTikTokShareUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "tiktok.com") return null;
    const match = url.pathname.match(/^\/@([^/]+)\/video\/(\d+)\/?$/);
    if (!match) return null;
    url.search = "";
    url.hash = "";
    return { url: url.toString(), id: match[2], username: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

function handleVisibility(entries) {
  entries.forEach((entry) => {
    previewState.visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);

  });
  chooseVisibleCandidate();
}

function activeTikTokIsFullscreen(card) {
  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
  return Boolean(fullscreen && card?.contains(fullscreen));
}

function chooseVisibleCandidate() {
  if (document.hidden) return;

  const activeRatio = previewState.activeCard
    ? previewState.visibility.get(previewState.activeCard) || 0
    : 0;

  if (previewState.activeCard?.dataset.videoProvider === "tiktok") {
    if (activeTikTokIsFullscreen(previewState.activeCard)) return;
    if (activeRatio < ACTIVE_MIN_VISIBILITY) stopPreview(previewState.activeCard);
    else return;
  }

  if (!previewsAllowed()) return;

  let bestCard = null;
  let bestScore = 0;
  for (const [card, ratio] of previewState.visibility) {
    if (!card.isConnected) {
      previewState.visibility.delete(card);
      continue;
    }
    if (ratio >= PREVIEW_VISIBILITY && canPreview(card) && ratio > bestScore) {
      bestCard = card;
      bestScore = ratio;
    }
  }

  if (previewState.activeCard && (
    activeRatio < ACTIVE_MIN_VISIBILITY
    || (bestCard && bestCard !== previewState.activeCard && bestScore > activeRatio + ACTIVE_SWITCH_MARGIN)
  )) {
    stopPreview(previewState.activeCard);
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
  card.querySelector(".preview-status").textContent = "Preview loading…";
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
  card.querySelector(".preview-status").textContent = card.dataset.videoProvider === "tiktok"
    ? "Loading muted preview…"
    : "Muted preview · open for controls";
  if (card.dataset.videoProvider === "tiktok") armTikTokPreview(card, player);
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
  if (provider === "facebook" || provider === "tiktok") return null;
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
    video.setAttribute("aria-label", card.dataset.videoTitle + " muted preview");
    return video;
  }
  const embed = safePreviewEmbed(card.dataset.videoEmbed, provider);
  if (!embed) return null;
  const iframe = document.createElement("iframe");
  iframe.src = embed;
  iframe.title = card.dataset.videoTitle + " muted preview";
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

function stopPreview(card = null, statusMessage = "") {
  if (card && previewState.activeCard !== card) return;
  const active = previewState.activeCard;
  if (!active) return;
  const provider = active.dataset.videoProvider;
  previewState.activeCleanup?.();
  previewState.activeCleanup = null;
  active.querySelector(".preview-surface video")?.pause();
  active.querySelector(".preview-surface")?.replaceChildren();
  active.classList.remove("preview-playing");
  active.classList.remove("tiktok-player-active");
  active.classList.remove("tiktok-player-loading");
  active.classList.remove("tiktok-player-ready");
  active.classList.remove("facebook-facade-ready");
  active.classList.remove("facebook-direct-player-ready");
  previewState.activeCard = null;

  if (provider === "tiktok") {
    renderTikTokFacade(active);
    const status = active.querySelector(".preview-status");
    if (status && statusMessage) status.textContent = statusMessage;
    return;
  }

  const status = active.querySelector(".preview-status");
  if (status) status.textContent = statusMessage || previewAvailabilityMessage(active);
}

function mountFacebookDirectPlayer(card) {
  if (!card?.isConnected || card.dataset.facebookPlayerMounted === "1") return;
  const surface = card.querySelector(".preview-surface");
  if (!surface) return;

  const embedUrl = safeFacebookDirectEmbed(card.dataset.videoEmbed, card.dataset.videoSource);
  if (!embedUrl) {
    const status = card.querySelector(".preview-status");
    if (status) status.textContent = "Open video to play";
    return;
  }

  const nearViewport = isNearViewport(card);
  const iframe = document.createElement("iframe");
  iframe.className = "facebook-direct-player";
  iframe.src = embedUrl;
  iframe.title = card.dataset.videoTitle || "Facebook video";
  iframe.loading = nearViewport ? "eager" : "lazy";
  iframe.fetchPriority = nearViewport ? "high" : "auto";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allow = "autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen";
  iframe.allowFullscreen = true;
  iframe.setAttribute("playsinline", "true");

  surface.replaceChildren(iframe);
  surface.style.opacity = "1";
  card.classList.add("facebook-direct-player-ready");
  card.dataset.facebookPlayerMounted = "1";
  const status = card.querySelector(".preview-status");
  if (status) status.textContent = "";
}

function isNearViewport(card) {
  const rect = card.getBoundingClientRect();
  return rect.top < window.innerHeight * 1.5 && rect.bottom > -200;
}

function safeFacebookDirectEmbed(embedValue, sourceValue) {
  try {
    const embed = new URL(String(embedValue || ""));
    const host = embed.hostname.toLowerCase().replace(/^www\./, "");
    const href = embed.searchParams.get("href") || "";
    if (
      embed.protocol === "https:" &&
      host === "facebook.com" &&
      embed.pathname === "/plugins/video.php" &&
      isFacebookDirectSource(href)
    ) {
      embed.searchParams.set("show_text", "false");
      embed.searchParams.set("autoplay", "true");
      embed.searchParams.set("muted", "true");
      return embed.toString();
    }
  } catch {}

  try {
    const source = new URL(String(sourceValue || ""));
    const host = source.hostname.toLowerCase().replace(/^www\./, "");
    if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch")) return "";
    const params = new URLSearchParams({
      height: "314",
      href: source.toString(),
      show_text: "false",
      width: "560",
      t: "0",
      autoplay: "true",
      muted: "true",
    });
    return "https://www.facebook.com/plugins/video.php?" + params.toString();
  } catch {
    return "";
  }
}

function isFacebookDirectSource(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch";
  } catch {
    return false;
  }
}

function createTikTokInlineEmbed(sourceUrl, videoId) {
  const blockquote = document.createElement("blockquote");
  blockquote.className = "tiktok-embed";
  blockquote.cite = sourceUrl;
  blockquote.dataset.videoId = videoId;
  blockquote.style.maxWidth = "605px";
  blockquote.style.minWidth = "325px";
  blockquote.style.width = "100%";
  blockquote.style.margin = "0 auto";

  const section = document.createElement("section");
  const link = document.createElement("a");
  link.href = sourceUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer nofollow";
  link.textContent = "Open this video on TikTok";
  section.append(link);
  blockquote.append(section);
  return blockquote;
}

function loadTikTokInlineEmbedScript() {
  return new Promise((resolve, reject) => {
    document.querySelector('script[data-vidbest-home-tiktok-embed="1"]')?.remove();
    const script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    script.dataset.vidbestHomeTiktokEmbed = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("TikTok embed script could not load."));
    document.body.append(script);
  });
}

async function activateTikTokPlayer(card) {
  if (!card?.isConnected || card.dataset.videoProvider !== "tiktok") return;
  const share = parseTikTokShareUrl(card.dataset.videoSource);
  if (!share) return;

  if (previewState.activeCard === card) return;
  stopPreview();
  cancelCandidate();

  const surface = card.querySelector(".preview-surface");
  const status = card.querySelector(".preview-status");
  if (!surface) return;

  const controller = new AbortController();
  let observer = null;
  let readyTimer = null;
  previewState.activeCard = card;
  previewState.activeCleanup = () => {
    controller.abort();
    observer?.disconnect();
    if (readyTimer) window.clearTimeout(readyTimer);
  };
  card.classList.add("preview-playing", "tiktok-player-active", "tiktok-player-loading");
  if (status) status.textContent = "Loading TikTok metadata…";

  try {
    const response = await fetch("/api/tiktok/embed?url=" + encodeURIComponent(share.url), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.video_id || !payload.source_url) {
      throw new Error(payload.error || "TikTok embed metadata is unavailable.");
    }
    if (previewState.activeCard !== card) return;

    surface.replaceChildren(createTikTokInlineEmbed(payload.source_url, String(payload.video_id)));
    if (status) {
      status.textContent = payload.cache_source === "gateway"
        ? "TikTok · gateway metadata loaded"
        : "TikTok · cached metadata";
    }

    observer = new MutationObserver(() => {
      if (previewState.activeCard !== card) return;
      if (!surface.querySelector("iframe")) return;
      observer.disconnect();
      if (readyTimer) window.clearTimeout(readyTimer);
      card.classList.remove("tiktok-player-loading");
      card.classList.add("tiktok-player-ready");
      if (status) status.textContent = "";
    });
    observer.observe(surface, { childList: true, subtree: true });

    await loadTikTokInlineEmbedScript();
    if (previewState.activeCard !== card) return;

    readyTimer = window.setTimeout(() => {
      if (previewState.activeCard !== card || card.classList.contains("tiktok-player-ready")) return;
      stopPreview(card, "TikTok embed is temporarily unavailable");
    }, 10000);
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (previewState.activeCard === card) {
      stopPreview(card, error.message || "TikTok embed is temporarily unavailable");
    }
  }
}

function buildFacebookMicrolinkImageUrl(sourceUrl) {
  try {
    const url = new URL(String(sourceUrl || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch")) return "";
    return "/api/facebook/thumbnail?url=" + encodeURIComponent(url.toString());
  } catch {
    return "";
  }
}

function applyCachedTikTokPreview(card, preview) {
  if (!card?.isConnected || !preview || card.classList.contains("tiktok-player-active")) return;
  card.dataset.tiktokCacheReady = preview.cache_source === "d1" ? "1" : "0";
  if (preview.author_name) card.dataset.tiktokAuthor = preview.author_name;
  if (preview.caption || preview.title) card.dataset.tiktokCaption = preview.caption || preview.title;
  if (preview.description) card.dataset.tiktokDescription = preview.description;
  if (preview.poster_url) card.dataset.tiktokPoster = preview.poster_url;
  renderTikTokFacade(card);
}

async function loadCachedTikTokFacadePreviews() {
  const pending = [...document.querySelectorAll('.video-tile[data-video-provider="tiktok"]')]
    .map((card) => ({ card, share: parseTikTokShareUrl(card.dataset.videoSource) }))
    .filter(({ card, share }) => share && !previewState.tiktokMetadataRequested.has(share.id) && !card.classList.contains("tiktok-player-active"));
  if (!pending.length) return;

  for (let index = 0; index < pending.length; index += 24) {
    const batch = pending.slice(index, index + 24);
    const params = new URLSearchParams();
    for (const { share } of batch) {
      previewState.tiktokMetadataRequested.add(share.id);
      params.append("url", share.url);
    }

    try {
      const response = await fetch("/api/tiktok/cached-previews?" + params.toString(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const byId = new Map((payload.previews || []).map((preview) => [String(preview.video_id || ""), preview]));
      for (const { card, share } of batch) applyCachedTikTokPreview(card, byId.get(share.id));
    } catch {
      // The existing local facade remains available when cached metadata cannot be read.
    }
  }
}

function renderTikTokFacade(card) {
  const surface = card.querySelector(".preview-surface");
  const status = card.querySelector(".preview-status");
  const share = parseTikTokShareUrl(card.dataset.videoSource);
  if (!surface || !share) return;

  surface.replaceChildren();
  const facade = document.createElement("span");
  facade.className = "tiktok-microlink-preview";

  const imageWrap = document.createElement("span");
  imageWrap.className = "tiktok-microlink-image";
  const placeholder = document.createElement("span");
  placeholder.className = "tiktok-microlink-placeholder";
  placeholder.textContent = "TikTok";
  imageWrap.append(placeholder);
  if (card.dataset.tiktokPoster) {
    const image = document.createElement("img");
    image.src = card.dataset.tiktokPoster;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("load", () => imageWrap.classList.add("has-image"), { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
    imageWrap.append(image);
  }

  const body = document.createElement("span");
  body.className = "tiktok-microlink-body";

  const providerRow = document.createElement("span");
  providerRow.className = "tiktok-microlink-provider";
  providerRow.textContent = card.dataset.tiktokCacheReady === "1"
    ? "TikTok preview · tap to play"
    : "TikTok · tap to play";

  const author = document.createElement("span");
  author.className = "tiktok-microlink-author";
  author.textContent = card.dataset.tiktokAuthor
    || (share.username ? "@" + share.username : "TikTok creator");

  const caption = document.createElement("span");
  caption.className = "tiktok-microlink-caption";
  caption.textContent = card.dataset.tiktokDescription
    || card.dataset.tiktokCaption
    || card.dataset.videoTitle
    || "Play this TikTok video";

  const play = document.createElement("span");
  play.className = "tiktok-facade-play";
  play.setAttribute("aria-hidden", "true");
  play.textContent = "▶";

  body.append(providerRow, author, caption);
  facade.append(imageWrap, play, body);
  surface.append(facade);
  card.classList.add("tiktok-facade-ready");
  if (status) status.textContent = "TikTok · tap to play";
}