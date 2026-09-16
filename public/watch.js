const videoId = Number(document.body.dataset.videoId || 0);
const reactionPanel = document.querySelector(".watch-reactions");
const commentForm = document.querySelector("#watch-comment-form");
const commentList = document.querySelector("#watch-comments");
const persistentPlayer = document.querySelector("#watch-player");
const playerPlaceholder = document.querySelector("#watch-player-anchor");
const relatedList = document.querySelector("#watch-related");
const relatedFilter = document.querySelector("#related-filter");
const interestStatus = document.querySelector("#interest-status");

const watchPlayerState = {
  rates: [0.5, 0.75, 1, 1.25, 1.5, 2],
  zooms: [1, 1.25, 1.5, 2],
  rateIndex: 2,
  zoomIndex: 0,
  miniTimer: null,
  originalBottom: 0,
  dismissed: false,
  focusReturn: null,
};

document.addEventListener("DOMContentLoaded", initializeWatchPage);

function initializeWatchPage() {
  enhanceNativePlayer();
  enhanceCommentForm();
  initializePersistentPlayer();
  initializeDiscovery();
  if (!videoId) return;
  reactionPanel?.querySelectorAll("[data-reaction]").forEach((button) => {
    button.addEventListener("click", () => react(button.dataset.reaction, button));
  });
  commentForm?.addEventListener("submit", submitComment);
  document.querySelectorAll("[data-interest]").forEach((button) => {
    button.addEventListener("click", () => recordInterest(button.dataset.interest, button));
  });
  loadComments();
  loadRecommendations();
}

function initializePersistentPlayer() {
  if (!persistentPlayer || !playerPlaceholder) return;
  const status = persistentPlayer.querySelector("#persistent-player-status");
  const restore = persistentPlayer.querySelector('[data-player-mode="restore"]');
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const rememberPosition = () => {
    if (persistentPlayer.classList.contains("is-mini") || persistentPlayer.classList.contains("is-theater")) return;
    watchPlayerState.originalBottom = persistentPlayer.getBoundingClientRect().bottom + scrollY;
  };
  rememberPosition();

  const leavePersistentMode = ({ restoreFocus = false } = {}) => {
    const wasTheater = persistentPlayer.classList.contains("is-theater");
    clearTimeout(watchPlayerState.miniTimer);
    watchPlayerState.miniTimer = null;
    persistentPlayer.classList.remove("is-mini", "is-theater");
    persistentPlayer.removeAttribute("role");
    persistentPlayer.removeAttribute("aria-modal");
    persistentPlayer.setAttribute("aria-label", "Video player");
    playerPlaceholder.classList.remove("is-active");
    playerPlaceholder.style.height = "";
    document.body.classList.remove("player-theater-open");
    restore.hidden = true;
    status.textContent = "Scroll to keep watching";
    if (wasTheater && restoreFocus && watchPlayerState.focusReturn instanceof HTMLElement) {
      watchPlayerState.focusReturn.focus();
    }
    if (wasTheater) watchPlayerState.focusReturn = null;
  };

  const activateMini = async () => {
    watchPlayerState.miniTimer = null;
    if (watchPlayerState.dismissed || scrollY + 90 < watchPlayerState.originalBottom) return;
    playerPlaceholder.style.height = `${persistentPlayer.offsetHeight}px`;
    playerPlaceholder.classList.add("is-active");
    persistentPlayer.classList.add("is-mini");
    restore.hidden = false;
    const started = !reduceMotion && document.visibilityState === "visible"
      ? await startMutedPlayback()
      : false;
    status.textContent = started ? "Mini-player playing muted" : "Mini-player ready";
  };

  const evaluateScroll = () => {
    if (watchPlayerState.dismissed || persistentPlayer.classList.contains("is-theater")) return;
    const passedPlayer = scrollY + 90 >= watchPlayerState.originalBottom;
    if (!passedPlayer) {
      if (persistentPlayer.classList.contains("is-mini") && !persistentPlayer.dataset.explicitMini) leavePersistentMode();
      if (watchPlayerState.miniTimer) {
        clearTimeout(watchPlayerState.miniTimer);
        watchPlayerState.miniTimer = null;
        status.textContent = "Scroll to keep watching";
      }
      return;
    }
    if (!persistentPlayer.classList.contains("is-mini") && !watchPlayerState.miniTimer && !persistentPlayer.dataset.explicitMini) {
      status.textContent = "Mini-player starts in 3 seconds";
      watchPlayerState.miniTimer = setTimeout(() => { void activateMini(); }, 3000);
    }
  };

  persistentPlayer.addEventListener("click", (event) => {
    const action = event.target.closest("[data-player-mode]")?.dataset.playerMode;
    if (!action) return;
    if (action === "restore") {
      persistentPlayer.removeAttribute("data-explicit-mini");
      leavePersistentMode({ restoreFocus: true });
      persistentPlayer.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    }
    if (action === "theater") {
      watchPlayerState.focusReturn = document.activeElement;
      playerPlaceholder.style.height = `${persistentPlayer.offsetHeight}px`;
      playerPlaceholder.classList.add("is-active");
      persistentPlayer.removeAttribute("data-explicit-mini");
      persistentPlayer.classList.remove("is-mini");
      persistentPlayer.classList.add("is-theater");
      persistentPlayer.setAttribute("role", "dialog");
      persistentPlayer.setAttribute("aria-modal", "true");
      persistentPlayer.setAttribute("aria-label", "Expanded video player");
      document.body.classList.add("player-theater-open");
      restore.hidden = false;
      status.textContent = "Theater player — playback continues";
      persistentPlayer.querySelector('[data-player-mode="close"]')?.focus();
    }
    if (action === "close") {
      persistentPlayer.removeAttribute("data-explicit-mini");
      watchPlayerState.dismissed = true;
      pausePlayback();
      leavePersistentMode({ restoreFocus: true });
      status.textContent = "Persistent playback stopped";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!persistentPlayer.classList.contains("is-theater")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      leavePersistentMode({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...persistentPlayer.querySelectorAll(
      'button:not([hidden]):not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, video[controls]',
    )].filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  addEventListener("scroll", evaluateScroll, { passive: true });
  addEventListener("resize", rememberPosition, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && watchPlayerState.miniTimer) {
      clearTimeout(watchPlayerState.miniTimer);
      watchPlayerState.miniTimer = null;
      status.textContent = "Mini-player timer paused while this tab is hidden";
      return;
    }
    if (document.visibilityState === "visible") evaluateScroll();
  });
}

async function startMutedPlayback() {
  const video = persistentPlayer?.querySelector("video");
  if (video) {
    video.muted = true;
    try {
      await video.play();
      return !video.paused;
    } catch {
      return false;
    }
  }
  const frame = persistentPlayer?.querySelector("iframe");
  const provider = String(document.body.dataset.videoProvider || "").toLowerCase();
  if (frame && ["youtube", "vimeo"].includes(provider)) {
    playerProviderCommand("mute");
    playerProviderCommand("playVideo");
    return true;
  }
  return false;
}

function pausePlayback() {
  const video = persistentPlayer?.querySelector("video");
  if (video) video.pause();
  playerProviderCommand("pauseVideo");
}

function playerProviderCommand(method, args = []) {
  const frame = persistentPlayer?.querySelector("iframe");
  if (!frame) return;
  const provider = String(document.body.dataset.videoProvider || "").toLowerCase();
  try {
    if (provider === "youtube") {
      const targetOrigin = new URL(frame.src).origin;
      frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: method, args }), targetOrigin);
      return;
    }
    if (provider === "vimeo") {
      const payload = method === "playVideo" ? { method: "play" }
        : method === "pauseVideo" ? { method: "pause" }
          : method === "mute" ? { method: "setVolume", value: 0 }
            : method === "unMute" ? { method: "setVolume", value: 1 }
              : method === "setPlaybackRate" ? { method: "setPlaybackRate", value: Number(args[0]) }
                : method === "seekTo" ? { method: "setCurrentTime", value: Number(args[0]) }
                  : { method };
      frame.contentWindow?.postMessage(JSON.stringify(payload), "https://player.vimeo.com");
    }
  } catch {
    // Provider controls remain the fallback when its API rejects a command.
  }
}

function youtubeCommand(func, args = []) {
  playerProviderCommand(func, args);
}

async function initializeDiscovery() {
  if (!relatedFilter) return;
  try {
    const result = await api("/api/categories");
    const select = relatedFilter.elements.category;
    Object.keys(result.categories || {}).forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.append(option);
    });
  } catch {
    // The default personalized list remains usable if categories cannot load.
  }
  relatedFilter.addEventListener("submit", (event) => {
    event.preventDefault();
    loadRecommendations({
      query: relatedFilter.elements.q.value.trim(),
      category: relatedFilter.elements.category.value,
    });
  });
}

async function recordInterest(signal, button) {
  document.querySelectorAll("[data-interest]").forEach((item) => { item.disabled = true; });
  setStatus(interestStatus, "Saving your preference…");
  try {
    const result = await api(`/api/videos/${videoId}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal }),
    });
    button.classList.add("active");
    setStatus(interestStatus, result.message, "success");
    await loadRecommendations();
  } catch (error) {
    setStatus(interestStatus, error.message, "error");
  } finally {
    document.querySelectorAll("[data-interest]").forEach((item) => { item.disabled = false; });
  }
}

async function loadRecommendations(filters = null) {
  if (!relatedList || !videoId) return;
  relatedList.replaceChildren(messageItem("Finding useful videos…"));
  try {
    let endpoint = `/api/videos/${videoId}/recommendations?limit=10`;
    if (filters?.query || filters?.category) {
      const params = new URLSearchParams({ limit: "10", sort: "popular" });
      if (filters.query) params.set("q", filters.query);
      if (filters.category) params.set("category", filters.category);
      endpoint = `/api/videos?${params}`;
    }
    const result = await api(endpoint);
    const videos = (result.videos || []).filter((video) => Number(video.id) !== videoId);
    relatedList.replaceChildren();
    if (!videos.length) {
      relatedList.append(messageItem("No other matching videos yet."));
      return;
    }
    videos.forEach((video) => relatedList.append(buildRelatedVideo(video)));
  } catch (error) {
    relatedList.replaceChildren(messageItem(error.message));
  }
}

function buildRelatedVideo(video) {
  const link = document.createElement("a");
  link.className = "related-video-card";
  link.href = `/watch/${encodeURIComponent(video.slug)}`;
  const media = document.createElement("span");
  media.className = "related-video-media";
  if (video.thumbnail_url) {
    const image = document.createElement("img");
    image.src = video.thumbnail_url;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    media.append(image);
  } else {
    media.textContent = "▶";
  }
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = video.title;
  const detail = document.createElement("small");
  detail.textContent = `${video.subcategory} · ${formatNumber(video.views)} views`;
  copy.append(title, detail);
  link.append(media, copy);
  return link;
}

function enhanceNativePlayer() {
  const video = document.querySelector(".watch-player video");
  if (!video) return;
  const stage = video.closest(".watch-player-stage");
  if (!stage) return;
  stage.style.overflow = "hidden";

  const tools = document.createElement("div");
  tools.className = "watch-reactions player-tools";
  tools.setAttribute("aria-label", "Advanced video playback tools");

  const rewind = playerButton("↶ 10s", "Rewind 10 seconds", () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
  });
  const playPause = playerButton(video.paused ? "▶ Play" : "❚❚ Pause", "Play or pause", async () => {
    if (video.paused) await video.play();
    else video.pause();
  });
  const forward = playerButton("10s ↷", "Forward 10 seconds", () => {
    const end = Number.isFinite(video.duration) ? video.duration : video.currentTime + 10;
    video.currentTime = Math.min(end, video.currentTime + 10);
  });
  const speed = playerButton("1× speed", "Change playback speed", () => {
    watchPlayerState.rateIndex = (watchPlayerState.rateIndex + 1) % watchPlayerState.rates.length;
    const next = watchPlayerState.rates[watchPlayerState.rateIndex];
    video.playbackRate = next;
    speed.textContent = `${next}× speed`;
  });
  const zoom = playerButton("1× zoom", "Zoom video", () => {
    watchPlayerState.zoomIndex = (watchPlayerState.zoomIndex + 1) % watchPlayerState.zooms.length;
    const next = watchPlayerState.zooms[watchPlayerState.zoomIndex];
    video.style.transform = `scale(${next})`;
    video.style.transformOrigin = "center center";
    zoom.textContent = `${next}× zoom`;
  });
  const captions = playerButton("CC", "Toggle captions", () => toggleCaptions(video, captions));
  captions.disabled = !(video.textTracks?.length > 0);
  const translate = playerButton("Translate captions", "Automatic caption translation", () => {
    setPlayerMessage(tools, "Auto-translation will activate when the Teamwork transcription/translation engine supplies caption tracks.");
  });
  translate.disabled = true;
  const share = playerButton("Share", "Share this video", () => shareWatchPage());
  const fullscreen = playerButton("Fullscreen", "Enter fullscreen", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
    } catch (error) {
      console.warn("Fullscreen unavailable", error?.message || error);
    }
  });

  tools.append(rewind, playPause, forward, speed, zoom, captions, translate);

  if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
    const pip = playerButton("▣ PiP", "Picture in picture", async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch (error) {
        console.warn("Picture-in-picture unavailable", error?.message || error);
      }
    });
    tools.append(pip);
  }
  tools.append(fullscreen, share);

  const note = document.createElement("p");
  note.className = "form-status player-tool-note";
  note.textContent = captions.disabled
    ? "No caption track is stored for this video yet. Auto captions and translation will be connected through the Teamwork engine."
    : "Caption track detected. Use CC to show or hide it.";
  tools.append(note);

  video.addEventListener("play", () => { playPause.textContent = "❚❚ Pause"; });
  video.addEventListener("pause", () => { playPause.textContent = "▶ Play"; });
  stage.insertAdjacentElement("afterend", tools);
}

function playerButton(label, ariaLabel, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button ghost";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", handler);
  return button;
}

function toggleCaptions(video, button) {
  const tracks = [...video.textTracks];
  if (!tracks.length) return;
  const showing = tracks.some((track) => track.mode === "showing");
  tracks.forEach((track, index) => { track.mode = !showing && index === 0 ? "showing" : "hidden"; });
  button.textContent = showing ? "CC off" : "CC on";
}

function setPlayerMessage(container, message) {
  const note = container.querySelector(".player-tool-note");
  if (note) note.textContent = message;
}

async function shareWatchPage() {
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title, url: location.href });
      return;
    }
    await navigator.clipboard.writeText(location.href);
  } catch (error) {
    if (error?.name !== "AbortError") console.warn("Share unavailable", error?.message || error);
  }
}

function enhanceCommentForm() {
  if (!commentForm || commentForm.elements.image) return;
  const imageLabel = document.createElement("label");
  imageLabel.className = "comment-image-field";
  imageLabel.innerHTML = '<span>Attach a picture (optional, max 5 MB)</span><input name="image" type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp">';
  const submit = commentForm.querySelector('button[type="submit"]');
  commentForm.insertBefore(imageLabel, submit);

  const preview = document.createElement("img");
  preview.className = "comment-image-preview";
  preview.alt = "Selected comment picture preview";
  preview.hidden = true;
  commentForm.insertBefore(preview, submit);

  imageLabel.querySelector("input").addEventListener("change", (event) => {
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    const file = event.target.files?.[0];
    if (!file) {
      preview.hidden = true;
      preview.removeAttribute("src");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    preview.dataset.objectUrl = objectUrl;
    preview.src = objectUrl;
    preview.hidden = false;
    preview.style.maxWidth = "220px";
    preview.style.maxHeight = "160px";
    preview.style.objectFit = "cover";
    preview.style.borderRadius = "12px";
  });
}

async function react(reaction, button) {
  button.disabled = true;
  try {
    const result = await api(`/api/videos/${videoId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
    reactionPanel.querySelectorAll("[data-reaction]").forEach((item) => {
      item.querySelector("span").textContent = formatNumber(result.reactions?.[item.dataset.reaction] || 0);
    });
    button.classList.toggle("active", Boolean(result.active));
  } catch (error) {
    console.warn(error.message);
  } finally {
    button.disabled = false;
  }
}

async function loadComments() {
  commentList.replaceChildren(messageItem("Loading comments…"));
  try {
    const result = await api(`/api/videos/${videoId}/comments`);
    commentList.replaceChildren();
    if (!result.comments?.length) {
      commentList.append(messageItem("No approved comments yet."));
      return;
    }
    result.comments.forEach((comment) => commentList.append(renderComment(comment)));
  } catch (error) {
    commentList.replaceChildren(messageItem(error.message));
  }
}

function renderComment(comment) {
  const article = document.createElement("article");
  article.className = "comment-item";
  const header = document.createElement("header");
  const author = document.createElement("strong");
  author.textContent = comment.author || "Guest";
  const time = document.createElement("time");
  time.dateTime = comment.created_at || "";
  time.textContent = formatDate(comment.created_at);
  header.append(author, time);
  const body = document.createElement("p");
  body.textContent = comment.body || "";
  article.append(header, body);
  if (comment.image_url) {
    const image = document.createElement("img");
    image.src = comment.image_url;
    image.alt = "Image attached to this approved comment";
    image.loading = "lazy";
    image.style.maxWidth = "min(100%, 520px)";
    image.style.maxHeight = "420px";
    image.style.objectFit = "contain";
    image.style.borderRadius = "14px";
    article.append(image);
  }
  return article;
}

function messageItem(message) {
  const element = document.createElement("div");
  element.className = "admin-list-empty";
  element.textContent = message;
  return element;
}

async function submitComment(event) {
  event.preventDefault();
  const status = commentForm.querySelector(".form-status");
  const submit = commentForm.querySelector('button[type="submit"]');
  const image = commentForm.elements.image?.files?.[0];
  if (image && image.size > 5 * 1024 * 1024) {
    setStatus(status, "Picture must be 5 MB or smaller.", "error");
    return;
  }
  submit.disabled = true;
  setStatus(status, "Sending…");
  try {
    let result;
    if (image) {
      const data = new FormData();
      data.set("author", commentForm.elements.author.value);
      data.set("body", commentForm.elements.body.value);
      data.set("website", commentForm.elements.website.value);
      data.set("image", image, image.name);
      result = await api(`/api/videos/${videoId}/comments`, { method: "POST", body: data });
    } else {
      result = await api(`/api/videos/${videoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: commentForm.elements.author.value,
          body: commentForm.elements.body.value,
          website: commentForm.elements.website.value,
        }),
      });
    }
    commentForm.reset();
    const preview = commentForm.querySelector(".comment-image-preview");
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute("src");
    }
    setStatus(status, result.message || "Comment submitted for moderation.", "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  return payload;
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `form-status${type ? ` ${type}` : ""}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: Number(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

// VIDBEST LINKED PLAYER UPGRADE v1
// Adds a unified control bar for iframe embeds, converts direct linked media to native video,
// keeps the floating player persistent while browsing, and exposes Media Session controls.
(() => {
  const upgrade = () => {
    const player = document.querySelector("#watch-player");
    if (!player || player.dataset.linkedPlayerReady === "1") return;

    const state = window.__vidBestPlayer = window.__vidBestPlayer || {
      remoteCurrentTime: 0,
      remoteDuration: 0,
      remotePlaying: false,
      remoteRate: 1,
      remoteMuted: false,
      provider: "",
    };

    const stage = () => player.querySelector(".watch-player-stage") || player;
    const media = () => player.querySelector("video");
    const frame = () => player.querySelector("iframe");

    const inferProvider = () => {
      const explicit = String(document.body.dataset.videoProvider || "").toLowerCase();
      if (explicit) return explicit;
      try {
        const host = new URL(frame()?.src || "").hostname.toLowerCase();
        if (host.includes("youtube")) return "youtube";
        if (host.includes("vimeo")) return "vimeo";
        if (host.includes("dailymotion")) return "dailymotion";
        if (host.includes("tiktok")) return "tiktok";
        if (host.includes("facebook")) return "facebook";
        if (host.includes("instagram")) return "instagram";
        if (host.includes("twitch")) return "twitch";
      } catch {}
      return "external";
    };

    const isDirectMediaUrl = (value) => /\.(?:mp4|webm|ogg|ogv|m4v|mov)(?:$|[?#])/i.test(String(value || ""));

    const convertDirectMedia = () => {
      const currentFrame = frame();
      if (!currentFrame || !isDirectMediaUrl(currentFrame.src)) return;
      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = currentFrame.src;
      video.setAttribute("aria-label", "Linked video");
      currentFrame.replaceWith(video);
    };

    state.provider = inferProvider();
    convertDirectMedia();

    const currentFrame = frame();
    if (state.provider === "youtube" && currentFrame) {
      try {
        const url = new URL(currentFrame.src);
        url.searchParams.set("enablejsapi", "1");
        url.searchParams.set("playsinline", "1");
        url.searchParams.set("origin", location.origin);
        url.searchParams.set("cc_load_policy", "1");
        if (!url.searchParams.has("rel")) url.searchParams.set("rel", "0");
        currentFrame.src = url.toString();
      } catch {}
    }
    if (currentFrame) {
      currentFrame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; clipboard-write");
      currentFrame.setAttribute("allowfullscreen", "");
      currentFrame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    }

    const sendProvider = (method, args = []) => {
      const activeFrame = frame();
      if (!activeFrame) return;
      try {
        if (state.provider === "youtube") {
          activeFrame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: method, args }), new URL(activeFrame.src).origin);
          return;
        }
        if (state.provider === "vimeo") {
          const payload = method === "playVideo" ? { method: "play" }
            : method === "pauseVideo" ? { method: "pause" }
              : method === "mute" ? { method: "setVolume", value: 0 }
                : method === "unMute" ? { method: "setVolume", value: 1 }
                  : method === "setPlaybackRate" ? { method: "setPlaybackRate", value: Number(args[0]) }
                    : method === "seekTo" ? { method: "setCurrentTime", value: Number(args[0]) }
                      : method === "getCurrentTime" ? { method: "getCurrentTime" }
                        : { method };
          activeFrame.contentWindow?.postMessage(JSON.stringify(payload), "https://player.vimeo.com");
        }
      } catch {}
    };

    const onProviderMessage = (event) => {
      const activeFrame = frame();
      if (!activeFrame || event.source !== activeFrame.contentWindow || typeof event.data !== "string") return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (state.provider === "youtube" && data.event === "infoDelivery" && data.info) {
        if (Number.isFinite(Number(data.info.currentTime))) state.remoteCurrentTime = Number(data.info.currentTime);
        if (Number.isFinite(Number(data.info.duration))) state.remoteDuration = Number(data.info.duration);
        if (Number.isFinite(Number(data.info.playerState))) state.remotePlaying = Number(data.info.playerState) === 1;
      }
      if (state.provider === "vimeo") {
        if (["timeupdate", "playProgress"].includes(data.event)) {
          const seconds = Number(data.data?.seconds);
          const duration = Number(data.data?.duration);
          if (Number.isFinite(seconds)) state.remoteCurrentTime = seconds;
          if (Number.isFinite(duration)) state.remoteDuration = duration;
        }
        if (data.event === "play") state.remotePlaying = true;
        if (data.event === "pause") state.remotePlaying = false;
        if (data.method === "getCurrentTime" && Number.isFinite(Number(data.value))) state.remoteCurrentTime = Number(data.value);
      }
    };
    window.addEventListener("message", onProviderMessage);

    const installCss = () => {
      if (document.querySelector("#vidbest-linked-player-css")) return;
      const style = document.createElement("style");
      style.id = "vidbest-linked-player-css";
      style.textContent = `
        #watch-player .player-tools { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin-top:.75rem; }
        #watch-player .player-tools .button { min-height:40px; }
        #watch-player .player-tool-note { flex-basis:100%; margin:.15rem 0 0; }
      `;
      document.head.append(style);
    };

    const message = (text) => {
      const note = player.querySelector(".player-tool-note");
      if (note) note.textContent = text;
    };

    const makeButton = (label, title, handler, disabled = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button ghost";
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.disabled = disabled;
      button.addEventListener("click", () => void handler());
      return button;
    };

    const seekBy = (delta) => {
      const video = media();
      if (video) {
        const end = Number.isFinite(video.duration) ? video.duration : Infinity;
        video.currentTime = Math.min(end, Math.max(0, video.currentTime + delta));
        return;
      }
      if (!["youtube", "vimeo"].includes(state.provider)) return;
      sendProvider("getCurrentTime");
      const end = Number(state.remoteDuration || 0);
      const target = end > 0 ? Math.min(end, Math.max(0, state.remoteCurrentTime + delta)) : Math.max(0, state.remoteCurrentTime + delta);
      sendProvider("seekTo", [target, true]);
      state.remoteCurrentTime = target;
    };

    const toggleFloating = () => {
      const anchor = document.querySelector("#watch-player-anchor");
      if (!anchor) return false;
      const enabled = !player.classList.contains("is-mini");
      if (enabled) {
        anchor.style.height = `${player.offsetHeight}px`;
        anchor.classList.add("is-active");
        player.classList.add("is-mini");
        player.dataset.explicitMini = "1";
      } else {
        player.classList.remove("is-mini");
        player.removeAttribute("data-explicit-mini");
        anchor.classList.remove("is-active");
        anchor.style.height = "";
      }
      return enabled;
    };

    const setupMediaSession = () => {
      if (!("mediaSession" in navigator)) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: document.title.slice(0, 120),
          artist: "Vid.Best",
          album: "Vid.Best Video Review",
        });
        const action = (name, handler) => {
          try { navigator.mediaSession.setActionHandler(name, handler); } catch {}
        };
        action("play", async () => {
          const video = media();
          if (video) await video.play();
          else { sendProvider("playVideo"); state.remotePlaying = true; }
        });
        action("pause", () => {
          const video = media();
          if (video) video.pause();
          else { sendProvider("pauseVideo"); state.remotePlaying = false; }
        });
        action("seekbackward", () => seekBy(-10));
        action("seekforward", () => seekBy(10));
        action("seekto", (event) => {
          const target = Number(event?.seekTime);
          if (!Number.isFinite(target)) return;
          const video = media();
          if (video) video.currentTime = target;
          else { sendProvider("seekTo", [target, true]); state.remoteCurrentTime = target; }
        });
        action("stop", () => {
          const video = media();
          if (video) video.pause();
          else { sendProvider("pauseVideo"); state.remotePlaying = false; }
        });
        action("enterpictureinpicture", async () => {
          const video = media();
          if (!video || !document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== "function") return;
          try { await video.requestPictureInPicture(); } catch {}
        });
      } catch {}
    };

    const controlsStage = stage();
    const currentMedia = media();
    const currentIframe = frame();
    if (!currentMedia && !currentIframe) return;

    player.querySelector(".player-tools")?.remove();
    const tools = document.createElement("div");
    tools.className = "watch-reactions player-tools";
    tools.setAttribute("aria-label", "Video playback controls");

    const remoteSupported = ["youtube", "vimeo"].includes(state.provider);
    const playPause = makeButton("▶ Play", "Play or pause", async () => {
      const video = media();
      if (video) {
        if (video.paused) await video.play(); else video.pause();
      } else if (remoteSupported) {
        if (state.remotePlaying) { sendProvider("pauseVideo"); state.remotePlaying = false; }
        else { sendProvider("playVideo"); state.remotePlaying = true; }
      }
    });
    const rewind = makeButton("↶ 10s", "Rewind 10 seconds", () => seekBy(-10), !currentMedia && !remoteSupported);
    const forward = makeButton("10s ↷", "Forward 10 seconds", () => seekBy(10), !currentMedia && !remoteSupported);

    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const speed = makeButton("1× speed", "Cycle playback speed", () => {
      const video = media();
      const current = video ? Number(video.playbackRate || 1) : Number(state.remoteRate || 1);
      let index = rates.findIndex((value) => Math.abs(value - current) < 0.01);
      index = (index + 1) % rates.length;
      const next = rates[index];
      if (video) video.playbackRate = next;
      else { state.remoteRate = next; sendProvider("setPlaybackRate", [next]); }
      speed.textContent = `${next}× speed`;
    }, !currentMedia && !remoteSupported);

    const zoom = makeButton("1× zoom", "Cycle video zoom", () => {
      const values = [1, 1.25, 1.5, 2];
      const current = Number(player.dataset.zoom || 1);
      let index = values.findIndex((value) => Math.abs(value - current) < 0.01);
      index = (index + 1) % values.length;
      const next = values[index];
      player.dataset.zoom = String(next);
      const target = media() || frame();
      if (target) target.style.transform = `scale(${next})`;
      zoom.textContent = `${next}× zoom`;
    });

    const captions = makeButton("CC", "Captions", () => {
      const video = media();
      if (video) {
        const tracks = [...video.textTracks];
        if (!tracks.length) { message("No stored caption track is available yet."); return; }
        const showing = tracks.some((track) => track.mode === "showing");
        tracks.forEach((track, index) => { track.mode = !showing && index === 0 ? "showing" : "hidden"; });
        captions.textContent = showing ? "CC off" : "CC on";
        return;
      }
      message(`${state.provider === "youtube" ? "YouTube" : "Linked provider"} captions stay inside the provider player so its language and accessibility controls remain available.`);
    });

    const translate = makeButton("Translate", "Translate captions", () => {
      message("Caption translation will activate when Vid.Best receives a caption track from the Teamwork transcription/translation engine.");
    }, true);

    const mute = makeButton("Mute", "Mute or unmute", () => {
      const video = media();
      if (video) {
        video.muted = !video.muted;
        mute.textContent = video.muted ? "Unmute" : "Mute";
      } else if (remoteSupported) {
        if (state.remoteMuted) { sendProvider("unMute"); state.remoteMuted = false; mute.textContent = "Mute"; }
        else { sendProvider("mute"); state.remoteMuted = true; mute.textContent = "Unmute"; }
      } else message("Mute control is supplied by the linked provider.");
    });

    const popout = makeButton("Pop-out", "Open the video in the floating player", () => {
      popout.textContent = toggleFloating() ? "Return" : "Pop-out";
    });

    const pip = makeButton("▣ PiP", "Picture in picture", async () => {
      const video = media();
      if (!video || !document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== "function") {
        message("Browser Picture-in-Picture is available for native/direct media when supported. Linked providers use Pop-out or their own PiP control.");
        return;
      }
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch { message("Picture-in-Picture was not available in this browser/session."); }
    }, !currentMedia);

    const fullscreen = makeButton("Fullscreen", "Toggle fullscreen", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (controlsStage.requestFullscreen) await controlsStage.requestFullscreen();
      } catch { message("Fullscreen is unavailable for this linked provider."); }
    });
    const share = makeButton("Share", "Share this video", () => {
      if (typeof shareWatchPage === "function") void shareWatchPage();
    });

    tools.append(rewind, playPause, forward, speed, zoom, captions, translate, mute, popout, pip, fullscreen, share);
    const note = document.createElement("p");
    note.className = "form-status player-tool-note";
    note.textContent = currentMedia
      ? "Full native controls enabled. Background/lock-screen playback follows browser and device policy."
      : remoteSupported
        ? `Linked ${state.provider} controls enabled where the provider API allows. Provider policies still apply to background playback and PiP.`
        : "Linked provider controls remain available. Vid.Best supplies Pop-out, fullscreen and sharing; advanced controls depend on provider support.";
    tools.append(note);
    controlsStage.insertAdjacentElement("afterend", tools);

    if (currentMedia) {
      currentMedia.addEventListener("play", () => { playPause.textContent = "❚❚ Pause"; state.remotePlaying = true; });
      currentMedia.addEventListener("pause", () => { playPause.textContent = "▶ Play"; state.remotePlaying = false; });
      currentMedia.addEventListener("ratechange", () => { speed.textContent = `${Number(currentMedia.playbackRate || 1)}× speed`; });
    }

    setupMediaSession();
    if (remoteSupported) {
      const poll = setInterval(() => {
        sendProvider("getCurrentTime");
        if (state.provider === "youtube") sendProvider("getDuration");
      }, 1000);
      setTimeout(() => clearInterval(poll), 120000);
    }

    window.addEventListener("scroll", () => {
      const anchor = document.querySelector("#watch-player-anchor");
      if (!anchor || player.dataset.explicitMini !== "1") return;
      if (!player.classList.contains("is-mini") && !player.classList.contains("is-theater")) {
        anchor.style.height = `${player.offsetHeight}px`;
        anchor.classList.add("is-active");
        player.classList.add("is-mini");
      }
    }, { passive: true });

    player.dataset.linkedPlayerReady = "1";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", upgrade, { once: true });
  else upgrade();
})();
