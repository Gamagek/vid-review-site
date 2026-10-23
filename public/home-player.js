const PREVIEW_DELAY_MS = 450;
const FACEBOOK_PREVIEW_DELAY_MS = 0;
const FACEBOOK_PREVIEW_TURN_MS = 6500;
const FACEBOOK_LOADING_TURN_MS = 16000;
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
  warmObserver: null,
  activeCleanup: null,
  tiktokMetadataRequested: new Set(),
  tiktokHoverCandidate: null,
  tiktokHoverTimer: null,
  tiktokHoverActive: null,
  tiktokHoverVideo: null,
  tiktokHoverStarts: 0,
  facebookControllers: new Map(),
  facebookUnavailable: new Set(),
  facebookRotationTimer: null,
  hoverCard: null,
  focusCard: null,
  soundCard: null,
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
    previewState.warmObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !previewsAllowed()) continue;
        const card = entry.target.closest?.(".video-tile");
        if (card?.dataset.videoProvider === "facebook") void window.VidBestFacebookPreview?.preload?.();
        previewState.warmObserver.unobserve(entry.target);
      }
    }, { rootMargin: "250px 0px", threshold: 0 });
  }
  decorateVideoCards();
  void loadCachedTikTokFacadePreviews();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stopPreview(); stopCachedTikTokHover(); }
    else chooseVisibleCandidate();
  });
  window.addEventListener("pagehide", () => {
    stopCachedTikTokHover();
    stopPreview();
    for (const controller of previewState.facebookControllers.values()) controller.destroy();
    previewState.facebookControllers.clear();
  });
  document.addEventListener("fullscreenchange", chooseVisibleCandidate);
  document.addEventListener("webkitfullscreenchange", chooseVisibleCandidate);
}

function decorateVideoCards() {
  if (previewState.activeCard && !previewState.activeCard.isConnected) stopPreview();
  for (const card of previewState.facebookUnavailable) {
    if (!card.isConnected) previewState.facebookUnavailable.delete(card);
  }
  for (const [card, controller] of previewState.facebookControllers) {
    if (!card.isConnected) { controller.destroy(); previewState.facebookControllers.delete(card); }
  }
  document.querySelectorAll(".video-tile:not([data-preview-ready])").forEach((card) => {
    card.dataset.previewReady = "true";
    const media = card.querySelector(".tile-media");
    if (!media) return;
    const status = card.querySelector(".preview-status");
    if (status) status.textContent = previewAvailabilityMessage(card);

    if (card.dataset.videoProvider === "facebook") {
      mountFacebookFacade(card);
      // Start the shared SDK request as soon as a Facebook tile is rendered.
      // The page still mounts only one official player at a time, but a
      // side-by-side YouTube tile can no longer consume the whole warm-up
      // window before Facebook has even begun loading.
      if (previewsAllowed() && isNearViewport(card)) void window.VidBestFacebookPreview?.preload?.();
      media.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        previewState.hoverCard = card;
        clearFacebookRotation();
        schedulePreview(card);
      });
      media.addEventListener("pointerleave", () => {
        if (previewState.hoverCard === card) previewState.hoverCard = null;
        if ((previewState.visibility.get(card) || 0) < PREVIEW_VISIBILITY) cancelCandidate(card);
        chooseVisibleCandidate();
      });
      media.addEventListener("focusin", () => {
        previewState.focusCard = card;
        clearFacebookRotation();
        schedulePreview(card);
      });
      media.addEventListener("focusout", (event) => {
        if (media.contains?.(event.relatedTarget)) return;
        if (previewState.focusCard === card) previewState.focusCard = null;
        chooseVisibleCandidate();
      });
      // Review text can be taller than the phone viewport. Autoplay follows
      // the actual video rectangle, rather than the whole review card.
      previewState.observer?.observe(media);
      previewState.warmObserver?.observe(media);
      return;
    }

    if (card.dataset.videoProvider === "tiktok") {
      // Tagembed is opt-in for the canonical Saiyaara item only. Unlike
      // regular TikTok cards, this home tile hosts an interactive mini widget.
      if (card.dataset.videoSlug === "saiyaara-a-cinematic-romance" && window.VidBestSaiyaaraTagembed) {
        const replacement = document.createElement("div");
        replacement.className = media.className;
        while (media.firstChild) replacement.append(media.firstChild);
        media.replaceWith(replacement);
        const oldSurface = replacement.querySelector(".preview-surface");
        const surface = document.createElement("div");
        surface.className = oldSurface.className;
        surface.setAttribute("aria-label", "Saiyaara TikTok Tagembed mini preview");
        oldSurface.replaceWith(surface);
        card.classList.add("saiyaara-tagembed-tile");
        const share = parseTikTokShareUrl(card.dataset.videoSource);
        surface.dataset.saiyaaraSource = card.dataset.videoSource || "";
        // Use the first-party fallback immediately. D1 card thumbnails can be
        // signed TikTok CDN URLs that have already expired in the browser.
        surface.dataset.saiyaaraPoster = share ? "/api/tiktok/cached-poster?id=" + encodeURIComponent(share.id) : "";
        window.VidBestSaiyaaraTagembed.mount(surface, "tile");
        return;
      }
      renderTikTokFacade(card);
      // Only an existing, authorized same-origin R2 MP4/WebM may produce a
      // moving mini preview. Normal TikTok cards remain lightweight posters.
      if (safeCachedTikTokHoverSource(card.dataset.tiktokHoverSrc)) {
        media.addEventListener("pointerenter", (event) => {
          if (event.pointerType !== "touch") queueCachedTikTokHover(card, 250);
        });
        media.addEventListener("pointerleave", () => stopCachedTikTokHover(card));
        media.addEventListener("focusin", () => queueCachedTikTokHover(card, 250));
        media.addEventListener("focusout", (event) => {
          if (!media.contains(event.relatedTarget)) stopCachedTikTokHover(card);
        });
      }
      media.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!parseTikTokShareUrl(card.dataset.videoSource)) return;
        event.preventDefault();
        stopCachedTikTokHover(card);
        activateTikTokPreviewCard(card);
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

const MAX_CACHED_TIKTOK_HOVERS = 4; // Per page view, not per-scroll or per-tile.
const CACHED_TIKTOK_HOVER_SECONDS = 5;

function safeCachedTikTokHoverSource(value) {
  try {
    if (!value) return "";
    const url = new URL(value, location.origin);
    return url.origin === location.origin && !url.search && !url.hash &&
      url.pathname.startsWith("/media/uploads/") &&
      !url.pathname.includes("..") && /\\.(?:mp4|webm)$/i.test(url.pathname)
      ? url.pathname : "";
  } catch { return ""; }
}

function stopCachedTikTokHover(card = null) {
  if (previewState.tiktokHoverCandidate && (!card || previewState.tiktokHoverCandidate === card)) {
    clearTimeout(previewState.tiktokHoverTimer);
    previewState.tiktokHoverTimer = null;
    previewState.tiktokHoverCandidate = null;
  }
  if (previewState.tiktokHoverActive && (!card || previewState.tiktokHoverActive === card)) {
    const video = previewState.tiktokHoverVideo;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    }
    previewState.tiktokHoverActive = null;
    previewState.tiktokHoverVideo = null;
  }
}

function queueCachedTikTokHover(card, delay = 650) {
  const source = safeCachedTikTokHoverSource(card?.dataset.tiktokHoverSrc);
  if (!source || !card.isConnected || !previewsAllowed() || document.hidden ||
      !isNearViewport(card) || card.dataset.tiktokHoverAttempted === "1" ||
      previewState.tiktokHoverStarts >= MAX_CACHED_TIKTOK_HOVERS ||
      previewState.tiktokHoverActive === card || previewState.tiktokHoverCandidate === card) return;
  stopCachedTikTokHover();
  previewState.tiktokHoverCandidate = card;
  previewState.tiktokHoverTimer = setTimeout(() => {
    previewState.tiktokHoverTimer = null;
    if (previewState.tiktokHoverCandidate !== card) return;
    previewState.tiktokHoverCandidate = null;
    if (!card.isConnected || document.hidden || !previewsAllowed() || !isNearViewport(card)) return;
    const surface = card.querySelector(".preview-surface");
    if (!surface || previewState.tiktokHoverStarts >= MAX_CACHED_TIKTOK_HOVERS) return;
    card.dataset.tiktokHoverAttempted = "1";
    previewState.tiktokHoverStarts += 1;
    const video = document.createElement("video");
    video.className = "tiktok-cached-muted-hover";
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = false;
    video.playsInline = true;
    video.preload = "none";
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    previewState.tiktokHoverActive = card;
    previewState.tiktokHoverVideo = video;
    video.addEventListener("playing", () => {
      if (previewState.tiktokHoverVideo === video) video.classList.add("is-playing");
    });
    video.addEventListener("timeupdate", () => {
      if (video.currentTime >= CACHED_TIKTOK_HOVER_SECONDS) stopCachedTikTokHover(card);
    });
    video.addEventListener("error", () => stopCachedTikTokHover(card), { once: true });
    surface.append(video);
    // src is assigned only on genuine hover/focus or sustained mobile visibility.
    // No TikTok network request, metadata background job, or cache-fill request.
    video.src = source;
    const playing = video.play();
    if (playing?.catch) playing.catch(() => stopCachedTikTokHover(card));
  }, delay);
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
      ? "TikTok · tap to load one player"
      : "TikTok preview needs a normal sharing link";
  }
  if (card.dataset.videoProvider === "facebook") {
    return "Muted preview loads when visible";
  }
  return canPreview(card) ? "Preview loads automatically" : "Open video to play";
}

function canPreview(card) {
  const provider = card.dataset.videoProvider;
  if (provider === "tiktok") return false;
  if (provider === "facebook") return Boolean(safeFacebookDirectEmbed(card.dataset.videoEmbed, card.dataset.videoSource));
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
    const card = entry.target.closest?.(".video-tile") || entry.target;
    const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
    previewState.visibility.set(card, ratio);
    if (card.dataset.videoProvider === "tiktok" && safeCachedTikTokHoverSource(card.dataset.tiktokHoverSrc)) {
      if (ratio < 0.12) stopCachedTikTokHover(card);
      else if (ratio >= 0.78 && navigator.maxTouchPoints > 0) queueCachedTikTokHover(card, 950);
    }
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

  if (previewState.activeCard?.dataset.videoProvider === "facebook" && activeTikTokIsFullscreen(previewState.activeCard)) return;
  if (previewState.activeCard?.dataset.videoProvider === "tiktok") {
    if (activeTikTokIsFullscreen(previewState.activeCard)) return;
    if (activeRatio < ACTIVE_MIN_VISIBILITY) stopPreview(previewState.activeCard);
    else return;
  }

  if (!previewsAllowed()) return;

  const intent = facebookInteractionCard();
  if (intent && (previewState.visibility.get(intent) || 0) >= ACTIVE_MIN_VISIBILITY) {
    clearFacebookRotation();
    schedulePreview(intent);
    return;
  }

  let bestCard = null;
  let bestScore = 0;
  for (const [card, ratio] of previewState.visibility) {
    if (!card.isConnected) {
      previewState.visibility.delete(card);
      continue;
    }
    if (previewState.facebookUnavailable.has(card)) continue;
    const score = previewScore(card, ratio);
    if (ratio >= PREVIEW_VISIBILITY && canPreview(card) && score > bestScore) {
      bestCard = card;
      bestScore = score;
    }
  }

  const activeScore = previewState.activeCard ? previewScore(previewState.activeCard, activeRatio) : 0;

  if (previewState.activeCard && activeRatio >= ACTIVE_MIN_VISIBILITY) {
    if (bestCard && bestCard !== previewState.activeCard && bestScore > activeScore + ACTIVE_SWITCH_MARGIN) {
      schedulePreview(bestCard);
    } else if (previewState.activeCard.dataset.videoProvider === "facebook" && !previewState.facebookRotationTimer) {
      armFacebookRotation(previewState.activeCard);
    }
    // Equal visibility must not steal a hovered/starting player on every
    // observer notification. Rotation gives neighbouring tiles a turn.
    return;
  }
  if (previewState.activeCard) stopPreview(previewState.activeCard);

  if (bestCard && bestCard !== previewState.activeCard && bestCard !== previewState.candidateCard) {
    schedulePreview(bestCard);
  }
}

function facebookInteractionCard() {
  return [previewState.hoverCard, previewState.focusCard, previewState.soundCard]
    .find(card => card?.isConnected && card.dataset.videoProvider === "facebook") || null;
}

function clearFacebookRotation() {
  window.clearTimeout(previewState.facebookRotationTimer);
  previewState.facebookRotationTimer = null;
}

function visibleFacebookCards() {
  return [...previewState.visibility]
    .filter(([card, ratio]) => card.isConnected && ratio >= PREVIEW_VISIBILITY
      && card.dataset.videoProvider === "facebook" && canPreview(card)
      && !previewState.facebookUnavailable.has(card))
    .map(([card]) => card);
}

function armFacebookRotation(card, delay = FACEBOOK_PREVIEW_TURN_MS) {
  clearFacebookRotation();
  if (previewState.activeCard !== card || document.hidden || !previewsAllowed()
    || facebookInteractionCard() === card || activeTikTokIsFullscreen(card)) return;
  const visible = visibleFacebookCards();
  if (!visible.some(other => other !== card)) return;
  previewState.facebookRotationTimer = window.setTimeout(() => {
    previewState.facebookRotationTimer = null;
    if (previewState.activeCard !== card || document.hidden || !previewsAllowed()
      || facebookInteractionCard() === card || activeTikTokIsFullscreen(card)) return;
    const current = visibleFacebookCards();
    if (!current.some(other => other !== card)) return;
    const next = current[(current.indexOf(card) + 1) % current.length];
    schedulePreview(next);
  }, delay);
}

function warmNextFacebookPlayer(card) {
  if (previewState.activeCard !== card || document.hidden || !previewsAllowed()
    || !window.VidBestFacebookPreview) return;
  const visible = visibleFacebookCards();
  const next = visible[(visible.indexOf(card) + 1) % visible.length];
  if (next && next !== card) prepareFacebookController(next, true);
}

function previewScore(card, ratio) {
  // Facebook needs a shared SDK bootstrap while YouTube embeds can begin in a
  // single iframe. Give a visible Facebook tile priority so a neighbouring
  // YouTube tile does not leave it on the facade indefinitely.
  return ratio + (card?.dataset?.videoProvider === "facebook" ? 1 : 0);
}

function schedulePreview(card) {
  if (!card?.isConnected || !previewsAllowed() || !canPreview(card)) return;
  if (previewState.activeCard === card || previewState.candidateCard === card) return;
  cancelCandidate();
  previewState.candidateCard = card;
  card.classList.add("preview-pending");
  card.querySelector(".preview-status").textContent = "Preview loading…";
  if (card.dataset.videoProvider === "facebook") void window.VidBestFacebookPreview?.preload?.();
  previewState.timer = window.setTimeout(
    () => startPreview(card),
    card.dataset.videoProvider === "facebook" ? FACEBOOK_PREVIEW_DELAY_MS : PREVIEW_DELAY_MS,
  );
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
  if (card.dataset.videoProvider === "facebook") {
    card.classList.remove("preview-pending");
    mountFacebookDirectPlayer(card);
    return;
  }
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
  clearFacebookRotation();
  if (!card) cancelCandidate();
  const active = previewState.activeCard;
  if (!active) return;
  if (previewState.soundCard === active) previewState.soundCard = null;
  const provider = active.dataset.videoProvider;
  const facebook = provider === "facebook" && previewState.facebookControllers.get(active);
  if (facebook?.pause && active.isConnected) {
    facebook.pause();
    active.querySelector(".facebook-sdk-player")?.setAttribute("hidden", "");
    const poster = active.querySelector(".facebook-facade-poster");
    if (poster) poster.hidden = false;
    const play = active.querySelector(".facebook-facade-play");
    if (play) { play.classList.remove("facebook-sound-toggle"); play.textContent = "▶"; play.setAttribute("aria-label", "Play Facebook video"); }
    active.classList.remove("preview-playing");
    active.dataset.facebookPlayback = "paused";
    delete active.dataset.facebookPlayerMounted;
    previewState.activeCard = null;
    previewState.activeCleanup = null;
    const status = active.querySelector(".preview-status");
    if (status) status.textContent = "Muted preview when visible · Tap for sound";
    return;
  }
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

  if (provider === "facebook") {
    delete active.dataset.facebookPlayerMounted;
    delete active.dataset.facebookPlayback;
    previewState.facebookControllers.delete(active);
    mountFacebookFacade(active);
    return;
  }

  if (provider === "tiktok") {
    renderTikTokFacade(active);
    const status = active.querySelector(".preview-status");
    if (status && statusMessage) status.textContent = statusMessage;
    return;
  }

  const status = active.querySelector(".preview-status");
  if (status) status.textContent = statusMessage || previewAvailabilityMessage(active);
}

function mountFacebookFacade(card) {
  if (!card?.isConnected || card.dataset.facebookPlayerMounted === "1") return;
  const surface = card.querySelector(".preview-surface");
  if (!surface) return;
  const source = card.dataset.videoSource || "";
  const embedUrl = safeFacebookDirectEmbed(card.dataset.videoEmbed, source);
  if (!embedUrl) {
    const status = card.querySelector(".preview-status");
    if (status) status.textContent = "Open video to play";
    return;
  }

  // Small local covers appear without a provider request. Signed CDN covers
  // use the durable server poster instead of resolving the share link again.
  const poster = document.createElement("img");
  poster.className = "facebook-facade-poster";
  poster.alt = "";
  poster.loading = isNearViewport(card) ? "eager" : "lazy";
  poster.decoding = "async";
  poster.referrerPolicy = "no-referrer";
  poster.width = 384;
  poster.height = 216;
  const savedPoster = card.dataset.videoThumbnail || "";
  poster.src = card.dataset.reviewPreview || savedPoster || "/api/facebook/thumbnail?id=" + encodeURIComponent(card.dataset.videoId || "");
  if (card.dataset.reviewPreview) poster.alt = card.dataset.reviewArtworkAlt || "Conceptual review artwork, not a video frame";
  const fallback = card.querySelector(".media-fallback");
  poster.addEventListener("load", () => {
    if (fallback) fallback.hidden = true;
  }, { once: true });
  poster.addEventListener("error", () => {
    poster.hidden = true;
    if (fallback) fallback.hidden = false;
    surface.style.background = "transparent";
  }, { once: true });

  const play = document.createElement("button");
  play.type = "button";
  play.className = "facebook-facade-play";
  play.setAttribute("aria-label", "Play Facebook video");
  play.textContent = "▶";

  if (fallback) {
    fallback.hidden = Boolean(card.querySelector(".tile-media > img")?.complete && card.querySelector(".tile-media > img")?.naturalWidth);
    fallback.textContent = "Facebook";
  }
  surface.replaceChildren(poster, play);
  surface.removeAttribute("aria-hidden");
  surface.style.opacity = "1";
  card.classList.add("facebook-facade-ready");
  const status = card.querySelector(".preview-status");
  if (status) status.textContent = previewsAllowed()
    ? "Muted preview loads when visible · Tap for sound"
    : "Tap to play · Open the title for the review";

  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    previewState.soundCard = card;
    clearFacebookRotation();
    const controller = previewState.facebookControllers.get(card);
    if (controller && previewState.activeCard === card) controller.play({ sound: true });
    else mountFacebookDirectPlayer(card, true);
  };
  play.addEventListener("click", activate);
  // Bind once: restoring a poster after scrolling must not accumulate handlers.
  if (card.dataset.facebookSurfaceBound !== "1") {
    surface.addEventListener("click", activate);
    card.dataset.facebookSurfaceBound = "1";
  }
}

function mountFacebookDirectPlayer(card, sound = false) {
  if (!card?.isConnected || card.dataset.facebookPlayerMounted === "1") return;
  const surface = card.querySelector(".preview-surface");
  if (!surface) return;

  const embedUrl = safeFacebookDirectEmbed(card.dataset.videoEmbed, card.dataset.videoSource);
  if (!embedUrl) {
    const status = card.querySelector(".preview-status");
    if (status) status.textContent = "Open video to play";
    return;
  }

  cancelCandidate();
  stopPreview();
  previewState.activeCard = card;
  if (sound) previewState.soundCard = card;
  card.dataset.facebookPlayerMounted = "1";
  card.classList.add("preview-playing");
  const status = card.querySelector(".preview-status");
  const cached = previewState.facebookControllers.get(card);
  if (cached) {
    previewState.facebookControllers.delete(card);
    previewState.facebookControllers.set(card, cached);
    surface.querySelector(".facebook-sdk-player")?.removeAttribute("hidden");
    if (status) status.textContent = "Loading muted Facebook preview…";
    cached.play({ sound });
    armFacebookRotation(card, FACEBOOK_LOADING_TURN_MS);
    return;
  }
  const controller = prepareFacebookController(card, false);
  if (controller) {
    if (sound) controller.play({ sound: true });
    armFacebookRotation(card, FACEBOOK_LOADING_TURN_MS);
    return;
  }
  mountFacebookIframeFallback(card, surface, embedUrl);
  armFacebookRotation(card, FACEBOOK_LOADING_TURN_MS);
}

function prepareFacebookController(card, paused) {
  if (!card?.isConnected || !window.VidBestFacebookPreview) return null;
  const existing = previewState.facebookControllers.get(card);
  if (existing) return existing;
  const surface = card.querySelector(".preview-surface");
  const embedUrl = safeFacebookDirectEmbed(card.dataset.videoEmbed, card.dataset.videoSource);
  if (!surface || !embedUrl) return null;
  const poster = surface.querySelector(".facebook-facade-poster");
  const play = surface.querySelector(".facebook-facade-play");
  const status = card.querySelector(".preview-status");
  // Keep the active and at most one warm/reusable player.
  while (previewState.facebookControllers.size >= 2) {
    const entry = [...previewState.facebookControllers].find(([oldCard]) => oldCard !== previewState.activeCard);
    if (!entry) return null;
    const [oldCard, oldController] = entry;
    oldController.destroy();
    previewState.facebookControllers.delete(oldCard);
    delete oldCard.dataset.facebookPlayback;
  }
  const source = new URL(embedUrl).searchParams.get("href");
  const controller = window.VidBestFacebookPreview.mount(surface, {
      source,
      title: card.dataset.videoTitle,
      autoplay: !paused,
      onState(value) {
        card.dataset.facebookPlayback = value;
        if (value === "blocked") previewState.facebookUnavailable.add(card);
        else if (value === "playing") previewState.facebookUnavailable.delete(card);
        if (previewState.activeCard !== card && value === "ready") {
          surface.querySelector(".facebook-sdk-player")?.setAttribute("hidden", "");
        }
        if (previewState.activeCard !== card) return;
        if (value === "playing" || value === "paused" || value === "ended") {
          if (poster && value === "playing") poster.hidden = true;
          if (play) {
            play.classList.add("facebook-sound-toggle");
            play.textContent = value === "playing" ? "♫" : "▶";
            play.setAttribute("aria-label", value === "playing" ? "Enable Facebook preview sound" : "Play Facebook video");
          }
        }
        if (status) status.textContent = value === "playing" ? "Facebook preview · Tap for sound"
          : value === "loading" || value === "ready" ? "Loading muted Facebook preview…" : "Tap to play on Facebook player";
        if (value === "ready" || value === "playing") warmNextFacebookPlayer(card);
        if (value === "playing") armFacebookRotation(card);
        if (value === "blocked") armFacebookRotation(card, 1000);
      },
      onError() {
        previewState.facebookControllers.delete(card);
        previewState.facebookUnavailable.add(card);
        card.dataset.facebookPlayback = "unavailable";
        if (previewState.activeCard !== card) return;
        previewState.activeCleanup = null;
        mountFacebookIframeFallback(card, surface, embedUrl);
        armFacebookRotation(card, 1000);
      },
    });
  previewState.facebookControllers.set(card, controller);
  return controller;
}

function mountFacebookIframeFallback(card, surface, embedUrl) {
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
  if (status) status.textContent = "Tap the Facebook player to play";
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
      const canonical = new URL(href);
      cleanFacebookTracking(canonical);
      embed.searchParams.set("href", canonical.toString());
      embed.searchParams.set("show_text", "false");
      embed.searchParams.set("autoplay", "true");
      embed.searchParams.set("muted", "true");
      return embed.toString();
    }
  } catch {}

  try {
    const source = new URL(String(sourceValue || ""));
    const host = source.hostname.toLowerCase().replace(/^www\./, "");
    if (source.protocol !== "https:" || !(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch")) return "";
    cleanFacebookTracking(source);
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
    return url.protocol === "https:" && (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch");
  } catch {
    return false;
  }
}

function cleanFacebookTracking(url) {
  // watch/?v=... and permalink.php identify their content in the query.
  // Remove tracking without discarding the actual video/post identity.
  const identity = new Set(["v", "id", "story_fbid", "video_id"]);
  for (const key of [...url.searchParams.keys()]) {
    if (!identity.has(key)) url.searchParams.delete(key);
  }
  url.hash = "";
}

async function activateTikTokPreviewCard(card) {
  const api = window.VidBestTikTok;
  if (!card?.isConnected || card.dataset.videoProvider !== "tiktok" || !api) return;
  const share = api.parse(card.dataset.videoSource);
  if (!share) return;

  cancelCandidate();
  const status = card.querySelector(".preview-status");
  if (status) status.textContent = "Opening TikTok preview…";

  await api.showPreview(share.url, {
    title: card.dataset.tiktokCaption || card.dataset.videoTitle || "TikTok video",
    author: card.dataset.tiktokAuthor || (share.username ? "@" + share.username : "TikTok creator"),
    description: card.dataset.tiktokDescription || "Preview details are cached by Vid.Best.",
    thumbnail: card.dataset.tiktokThumbnail || card.dataset.tiktokPoster || "",
  });

  if (status) status.textContent = "TikTok · tap to load one player";
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
  if (preview.thumbnail_url) card.dataset.tiktokThumbnail = preview.thumbnail_url;
  if (preview.poster_url) card.dataset.tiktokPoster = preview.poster_url;
  // Cached metadata may arrive after Tagembed mounts. Updating the facade
  // would otherwise erase the live mini widget and leave a black tile.
  if (card.classList.contains("saiyaara-tagembed-tile")) {
    // Prefer a *verified loaded* fresh provider thumbnail, but retain the
    // local SVG cover when an expiring TikTok CDN URL cannot be displayed.
    const host = card.querySelector(".preview-surface.saiyaara-tagembed-host");
    if (preview.thumbnail_url && host) window.VidBestSaiyaaraTagembed?.updatePoster?.(host, preview.thumbnail_url);
    return;
  }
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

function ownedTikTokCover(card) {
  // Do not let late provider metadata erase a deliberately selected local cover.
  // Protected media and comedy keep their existing presentation path.
  const slug = card.dataset.videoSlug;
  const category = card.querySelector(".category-badge");
  if (slug === "saiyaara-a-cinematic-romance" || slug === "summer-inverted-7332342275151760642"
    || category && category.textContent.trim() === "Funny & Comedy") return "";
  const value = card.dataset.videoThumbnail || "";
  if (!value) return "";
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin && !url.username && !url.password && !url.search && !url.hash
      && /^\/review-covers\/[a-z0-9_-]+\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname)
      ? url.href : "";
  } catch { return ""; }
}

function renderTikTokFacade(card) {
  stopCachedTikTokHover(card);
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
  const ownedCover = ownedTikTokCover(card);
  // Use the permanent same-origin R2/SVG image before expiring TikTok CDN links.
  const previewImage = card.dataset.reviewPreview || ownedCover || card.dataset.tiktokPoster ||
    (share.id ? "/api/tiktok/cached-poster?id=" + encodeURIComponent(share.id) : card.dataset.tiktokThumbnail);
  if (previewImage) {
    const image = document.createElement("img");
    image.src = previewImage;
    image.alt = card.dataset.reviewPreview ? "Conceptual review artwork, not a source video frame" : "";
    image.loading = ownedCover && isNearViewport(card) ? "eager" : "lazy";
    image.decoding = "async";
    image.addEventListener("load", () => imageWrap.classList.add("has-image"), { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
    imageWrap.append(image);
  }

  const body = document.createElement("span");
  body.className = "tiktok-microlink-body";

  const providerRow = document.createElement("span");
  providerRow.className = "tiktok-microlink-provider";
  providerRow.textContent = card.dataset.reviewPreview || ownedCover && /-illustrated-v\d+\.(?:jpe?g|png|webp|avif)$/i.test(ownedCover)
    ? "Illustrated cover · not a video frame"
    : card.dataset.tiktokCacheReady === "1"
      ? "TikTok preview · tap for details"
      : "TikTok · tap to load one player";

  const author = document.createElement("span");
  author.className = "tiktok-microlink-author";
  author.textContent = card.dataset.tiktokAuthor
    || (share.username ? "@" + share.username : "TikTok creator");

  const caption = document.createElement("span");
  caption.className = "tiktok-microlink-caption";
  caption.textContent = card.dataset.tiktokDescription
    || card.dataset.tiktokCaption
    || card.dataset.videoTitle
    || "Open TikTok preview details";

  const play = document.createElement("span");
  play.className = "tiktok-facade-play";
  play.setAttribute("aria-hidden", "true");
  play.textContent = "↗";

  body.append(providerRow, author, caption);
  facade.append(imageWrap, play, body);
  surface.append(facade);
  card.classList.add("tiktok-facade-ready");
  if (status) status.textContent = "TikTok · tap to load one player";
}
