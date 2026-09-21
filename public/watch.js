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
  enhanceCommentForm();
  enhanceNativePlayer();
  initializePersistentPlayer();
  initializeTikTokEmbedScript();
  initializeTikTokPopupFallback();
  initializeEmbeddedMediaTools();
  initializeAudioLab();
  initializeEmbeddedAudioLab();
  repairNativePlayerControls();
  initializeBackgroundPlayback();
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
  if (frame && ["youtube", "vimeo", "tiktok"].includes(provider)) {
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
    if (provider === "tiktok") {
      const targetOrigin = new URL(frame.src).origin;
      const type = method === "playVideo" ? "play"
        : method === "pauseVideo" ? "pause"
          : method === "mute" ? "mute"
            : method === "unMute" ? "unMute"
              : method === "seekTo" ? "seekTo"
                : "";
      if (!type) return;
      const message = {
        "x-tiktok-player": true,
        type,
        ...(type === "seekTo" ? { value: Number(args[0]) } : {}),
      };
      frame.contentWindow?.postMessage(message, targetOrigin);
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

// VIDBEST FINAL PLAYER + AUDIO LAB v3

function initializeEmbeddedMediaTools() {
  const player = document.querySelector("#watch-player");
  if (!player || player.dataset.vidbestEmbeddedTools === "1") return;
  const stage = player.querySelector(".watch-player-stage") || player;
  const frame = stage.querySelector("iframe");
  if (!frame) return;

  const sourceText = (frame.src + " " + (document.body.dataset.videoProvider || "")).toLowerCase();
  if (sourceText.includes("lab-review-1.mp4") || sourceText.includes("lab review 1")) return;
  player.dataset.vidbestEmbeddedTools = "1";

  const provider = String(document.body.dataset.videoProvider || inferProvider(frame)).toLowerCase();

  // TikTok supplies its own responsive touch controls inside the official
  // iframe. Do not place the Vid.Best overlay on top of them.
  if (provider === "tiktok") {
    player.dataset.vidbestTikTokNativeControls = "1";
    frame.setAttribute("allow", "fullscreen; autoplay; encrypted-media; picture-in-picture; web-share");
    frame.setAttribute("allowfullscreen", "");
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    initializeTikTokReliability(player, stage, frame);
    return;
  }

  const remote = provider === "youtube" || provider === "vimeo";
  const state = { playing: false, muted: false, rate: 1, currentTime: 0 };

  function inferProvider(element) {
    try {
      const host = new URL(element.src || "").hostname.toLowerCase();
      if (host.includes("youtube")) return "youtube";
      if (host.includes("vimeo")) return "vimeo";
      if (host.includes("dailymotion")) return "dailymotion";
      if (host.includes("tiktok")) return "tiktok";
      if (host.includes("facebook")) return "facebook";
      if (host.includes("instagram")) return "instagram";
      if (host.includes("twitch")) return "twitch";
    } catch {}
    return "external";
  }

  frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; clipboard-write");
  frame.setAttribute("allowfullscreen", "");

  function command(method, args) {
    args = args || [];
    try {
      if (typeof playerProviderCommand === "function") {
        playerProviderCommand(method, args);
        return;
      }
      const origin = provider === "vimeo" ? "https://player.vimeo.com" : new URL(frame.src).origin;
      const payload = provider === "vimeo"
        ? (method === "playVideo" ? { method: "play" }
          : method === "pauseVideo" ? { method: "pause" }
          : method === "mute" ? { method: "setVolume", value: 0 }
          : method === "unMute" ? { method: "setVolume", value: 1 }
          : method === "setPlaybackRate" ? { method: "setPlaybackRate", value: Number(args[0]) }
          : method === "seekTo" ? { method: "setCurrentTime", value: Number(args[0]) }
          : { method })
        : { event: "command", func: method, args: args };
      frame.contentWindow && frame.contentWindow.postMessage(JSON.stringify(payload), origin);
    } catch {}
  }

  const overlay = document.createElement("div");
  overlay.className = "vidbest-embed-overlay";
  overlay.setAttribute("aria-label", "Vid.Best embedded player controls");

  function message(text) {
    const note = overlay.querySelector(".vidbest-embed-note");
    if (note) note.textContent = text;
  }

  function button(label, title, handler, disabled) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vidbest-embed-button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = Boolean(disabled);
    b.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      void handler();
    });
    return b;
  }

  const play = button("▶", "Play or pause", function() {
    if (!remote) return message("This provider keeps playback controls inside its own embed.");
    state.playing = !state.playing;
    command(state.playing ? "playVideo" : "pauseVideo");
    play.textContent = state.playing ? "❚❚" : "▶";
  }, !remote);
  const back = button("↶10", "Seek back 10 seconds", function() {
    if (!remote) return message("Seek is provider-dependent for this embed.");
    state.currentTime = Math.max(0, state.currentTime - 10);
    command("seekTo", [state.currentTime, true]);
  }, !remote);
  const forward = button("10↷", "Seek forward 10 seconds", function() {
    if (!remote) return message("Seek is provider-dependent for this embed.");
    state.currentTime += 10;
    command("seekTo", [state.currentTime, true]);
  }, !remote);
  const speed = button("1×", "Cycle playback speed", function() {
    if (!remote) return message("Speed is controlled by the embedded provider.");
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(state.rate) + 1) % rates.length];
    state.rate = next;
    speed.textContent = next + "×";
    command("setPlaybackRate", [next]);
  }, !remote);
  const mute = button("🔊", "Mute or unmute", function() {
    if (!remote) return message("Mute is controlled by the embedded provider.");
    state.muted = !state.muted;
    command(state.muted ? "mute" : "unMute");
    mute.textContent = state.muted ? "🔇" : "🔊";
  }, !remote);
  const captions = button("CC", "Caption controls", function() {
    message("Caption languages are controlled by the embedded provider.");
    frame.focus();
  });

  async function embeddedPiP() {
    if (!(window.documentPictureInPicture && window.documentPictureInPicture.requestWindow)) {
      message("Embedded PiP is not supported here. Use the provider's own PiP control.");
      return;
    }
    if (window.documentPictureInPicture.window) {
      window.documentPictureInPicture.window.focus();
      return;
    }
    const parent = frame.parentNode;
    const next = frame.nextSibling;
    try {
      const width = Math.max(320, Math.min(720, stage.clientWidth || 480));
      const height = Math.max(200, Math.min(520, Math.round(width * 0.5625) + 40));
      const pip = await window.documentPictureInPicture.requestWindow({ width: width, height: height });
      const doc = pip.document;
      doc.body.style.cssText = "margin:0;background:#05070d;color:#fff;overflow:hidden;font-family:system-ui,sans-serif";
      const shell = doc.createElement("div");
      shell.style.cssText = "width:100vw;height:100vh;display:grid;grid-template-rows:34px 1fr";
      const bar = doc.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:0 8px;background:#111827;font:12px system-ui";
      const label = doc.createElement("span");
      label.textContent = "Vid.Best · " + provider + " PiP";
      const close = doc.createElement("button");
      close.textContent = "Back to page";
      close.style.cssText = "border:0;border-radius:7px;padding:5px 8px;background:#273449;color:#fff";
      close.onclick = function() { pip.close(); };
      bar.append(label, close);
      const viewport = doc.createElement("div");
      viewport.style.cssText = "min-height:0;background:#000";
      frame.style.cssText = "display:block;width:100%;height:100%;border:0";
      viewport.append(frame);
      shell.append(bar, viewport);
      doc.body.append(shell);
      pip.addEventListener("pagehide", function() {
        if (parent && !parent.contains(frame)) parent.insertBefore(frame, next || null);
        frame.style.cssText = "";
      }, { once: true });
      message("Embedded video is floating in PiP.");
    } catch (error) {
      message(error && error.message ? error.message : "Embedded PiP could not be opened.");
    }
  }

  const pip = button("▣ PiP", "Picture in Picture", embeddedPiP);
  const share = button("Share", "Share this Vid.Best page", function() { shareWatchPage(); });
  const pop = button("Pop-out", "Float player while scrolling", function() {
    const anchor = document.querySelector("#watch-player-anchor");
    if (!anchor) return;
    const on = !player.classList.contains("is-mini");
    if (on) {
      anchor.style.height = player.offsetHeight + "px";
      anchor.classList.add("is-active");
      player.dataset.explicitMini = "1";
      player.classList.add("is-mini");
      pop.textContent = "Return";
    } else {
      delete player.dataset.explicitMini;
      player.classList.remove("is-mini");
      anchor.classList.remove("is-active");
      anchor.style.height = "";
      pop.textContent = "Pop-out";
    }
  });
  const full = button("⛶", "Fullscreen", async function() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
    } catch { message("Fullscreen is unavailable for this embed."); }
  });
  const note = document.createElement("span");
  note.className = "vidbest-embed-note";
  note.textContent = remote ? "Embedded " + provider + " · enhanced controls" : "Embedded " + provider + " · provider controls remain authoritative";
  overlay.append(play, back, forward, speed, captions, mute, pip, share, pop, full, note);
  stage.style.position = stage.style.position || "relative";
  stage.append(overlay);

  addEventListener("message", function(event) {
    if (event.source !== frame.contentWindow) return;
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      const info = data && (data.info || data);
      const time = Number(info && (info.currentTime != null ? info.currentTime : data.currentTime));
      if (Number.isFinite(time)) state.currentTime = time;
    } catch {}
  });
}

function initializeTikTokPopupFallback() {
  const wrap = document.querySelector("[data-tiktok-embed]");
  if (!wrap || wrap.dataset.vidbestPopupFallback === "1") return;
  wrap.dataset.vidbestPopupFallback = "1";

  const source = wrap.dataset.tiktokSource || "";
  if (!source) return;

  const fallback = document.createElement("div");
  fallback.className = "vidbest-tiktok-fallback";
  fallback.hidden = true;
  fallback.innerHTML = "<strong>TikTok player is unavailable here.</strong><span>We could not load TikTok's official player on this browser or network.</span>";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button ghost";
  button.textContent = "Play TikTok in popup";
  button.setAttribute("aria-label", "Open this TikTok video in a popup");
  button.addEventListener("click", () => {
    const popup = window.open(source, "vidbest-tiktok-player", "popup,width=430,height=760,resizable=yes,scrollbars=yes");
    if (!popup) {
      window.location.href = source;
      return;
    }
    try { popup.focus(); } catch {}
  });
  fallback.append(button);
  wrap.insertAdjacentElement("afterend", fallback);
}

function initializeTikTokEmbedScript() {
  const embeds = [...document.querySelectorAll(".tiktok-embed")];
  if (!embeds.length) return;

  const player = document.querySelector("#watch-player");
  const stage = player?.querySelector(".watch-player-stage");
  if (!player || !stage) return;

  const enhanceAfterIframeRender = () => {
    const iframe = stage.querySelector("[data-tiktok-embed] iframe, .tiktok-embed iframe");
    if (!iframe) return false;
    initializeEmbeddedMediaTools();
    return true;
  };

  const observe = () => {
    if (enhanceAfterIframeRender()) return;
    const observer = new MutationObserver(() => {
      if (enhanceAfterIframeRender()) observer.disconnect();
    });
    observer.observe(stage, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  };

  let script = document.querySelector('script[data-vidbest-tiktok-embed], script[src="https://www.tiktok.com/embed.js"]');
  if (!script) {
    script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    script.dataset.vidbestTikTokEmbed = "1";
    script.addEventListener("load", observe, { once: true });
    script.addEventListener("error", () => {
      const status = player.querySelector(".vidbest-tiktok-load-status") || document.createElement("div");
      if (!status.parentNode) {
        status.className = "vidbest-tiktok-load-status";
        stage.insertAdjacentElement("afterend", status);
      }
      status.textContent = "TikTok's official embed service could not load in this browser or network.";
      const fallback = stage.querySelector(".vidbest-tiktok-fallback");
      if (fallback) fallback.hidden = false;
    }, { once: true });
    document.head.appendChild(script);
  } else {
    observe();
  }
}

function initializeTikTokReliability(player, stage, frame) {
  if (!player || !stage || !frame || frame.dataset.vidbestTikTokReliability === "1") return;
  frame.dataset.vidbestTikTokReliability = "1";

  const sourceUrl = document.querySelector(".source-link")?.href || "";
  const sourceText = sourceUrl ? "Open on TikTok" : "Open original source";
  const status = document.createElement("div");
  status.className = "vidbest-tiktok-status";
  status.hidden = false;

  const message = document.createElement("span");
  message.className = "vidbest-tiktok-status-message";
  message.textContent = "Connecting to TikTok's official player…";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "button ghost";
  retry.textContent = "Retry player";

  const open = document.createElement("a");
  open.className = "button ghost";
  open.textContent = sourceText;
  open.target = "_blank";
  open.rel = "noopener noreferrer nofollow";
  if (sourceUrl) open.href = sourceUrl;

  status.append(message, retry, open);
  stage.insertAdjacentElement("afterend", status);

  let ready = false;
  let attempts = 0;
  let watchdog = null;
  let retryTimer = null;

  function setEmbedState(state) {
    stage.classList.toggle("is-tiktok-pending", state === "pending");
    stage.classList.toggle("is-tiktok-failed", state === "failed");
    const fallback = stage.querySelector(".vidbest-tiktok-fallback");
    if (fallback) fallback.hidden = state !== "failed";
  }

  function clearWatchdog() {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function showStatus(text, failed = false) {
    message.textContent = text;
    status.hidden = false;
    setEmbedState(failed ? "failed" : "pending");
  }

  function hideStatus() {
    status.hidden = true;
    message.textContent = "";
    setEmbedState("ready");
  }

  function addCacheBust() {
    try {
      const url = new URL(frame.src);
      url.searchParams.set("_vidbest_retry", String(Date.now()));
      frame.src = url.toString();
    } catch {
      frame.src = frame.src;
    }
  }

  function beginWatchdog() {
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (!ready) handleFailure("TikTok did not finish loading the official player.");
    }, 7000);
  }

  function restartPlayer() {
    clearWatchdog();
    ready = false;
    retry.disabled = true;
    status.hidden = false;
    message.textContent = "Retrying TikTok's official player…";
    setEmbedState("pending");
    addCacheBust();
    beginWatchdog();
  }

  function handleFailure(reason) {
    clearWatchdog();
    if (attempts < 1) {
      attempts += 1;
      message.textContent = "TikTok did not start. Retrying once…";
      status.hidden = false;
      setEmbedState("pending");
      retryTimer = setTimeout(restartPlayer, 600);
      return;
    }
    showStatus(reason + " TikTok or its CDN may be restricting this embed here.", true);
    retry.disabled = false;
  }

  retry.addEventListener("click", () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    attempts = 0;
    restartPlayer();
  });

  frame.addEventListener("load", () => {
    if (!ready) beginWatchdog();
  });

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    if (event.origin !== "https://www.tiktok.com") return;

    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      const type = data?.type || "";
      const value = data?.value;

      if (type === "onPlayerReady") {
        ready = true;
        attempts = 0;
        clearWatchdog();
        retry.disabled = false;
        hideStatus();
        return;
      }

      if (type === "onStateChange") {
        const state = Number(value);
        if (state === 1 || state === 3) {
          ready = true;
          clearWatchdog();
          retry.disabled = false;
          hideStatus();
        }
        return;
      }

      if (type === "onPlayerError") {
        const code = Number(value?.errorCode ?? value);
        if (code === 1001) {
          handleFailure("TikTok reports this video is unavailable.");
        } else if (code === 2001) {
          handleFailure("TikTok's server could not serve this video.");
        } else if (code === 3001) {
          handleFailure("TikTok reported a playback error.");
        } else if (code === 3002) {
          showStatus("Browser autoplay was blocked. Tap TikTok's Play button.");
        } else {
          handleFailure("The TikTok player returned an error.");
        }
      }
    } catch {
      // Ignore unrelated cross-origin messages.
    }
  });

  setEmbedState("pending");
  beginWatchdog();
}
function initializeBackgroundPlayback() {
  const player = document.querySelector("#watch-player");
  const video = player && player.querySelector("video");
  if (!video || video.dataset.vidbestBackground === "1") return;
  video.dataset.vidbestBackground = "1";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.disablePictureInPicture = false;

  const title = document.querySelector("h1")?.textContent?.trim() || "Vid.Best video";
  if ("mediaSession" in navigator && typeof MediaMetadata === "function") {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: title, artist: "Vid.Best", album: "Vid.Best" });
      function setAction(action, handler) { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} }
      setAction("play", function() { return video.play(); });
      setAction("pause", function() { video.pause(); });
      setAction("seekbackward", function(details) { video.currentTime = Math.max(0, video.currentTime - ((details && details.seekOffset) || 10)); });
      setAction("seekforward", function(details) { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + ((details && details.seekOffset) || 10)); });
      setAction("stop", function() { video.pause(); });
      setAction("enterpictureinpicture", async function() {
        if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
          try { await video.requestPictureInPicture(); } catch {}
        }
      });
      video.addEventListener("play", function() { try { navigator.mediaSession.playbackState = "playing"; } catch {} });
      video.addEventListener("pause", function() { try { navigator.mediaSession.playbackState = "paused"; } catch {} });
      video.addEventListener("ended", function() { try { navigator.mediaSession.playbackState = "none"; } catch {} });
    } catch {}
  }

  function savePosition() {
    try { sessionStorage.setItem("vidbest-position-" + videoId, String(video.currentTime || 0)); } catch {}
  }
  addEventListener("pagehide", savePosition);
  addEventListener("beforeunload", savePosition);
  video.addEventListener("loadedmetadata", function() {
    try {
      const saved = Number(sessionStorage.getItem("vidbest-position-" + videoId));
      if (Number.isFinite(saved) && saved > 0 && saved < (video.duration || Infinity)) video.currentTime = saved;
    } catch {}
  });
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden" && !video.paused) video.dataset.vidbestBackgroundPlaying = "1";
  });
}

function initializeAudioLab() {
  const player = document.querySelector("#watch-player");
  const video = player && player.querySelector("video");
  if (!player || !video || video.dataset.vidbestAudioLab === "1") return;
  video.dataset.vidbestAudioLab = "1";

  const panel = document.createElement("section");
  panel.className = "vidbest-audio-lab";
  panel.innerHTML = [
    '<div class="vidbest-audio-head"><div><p>Audio Lab</p><h2>Sound effects & equalizer</h2><small>Optional local effects for direct/native video.</small></div><button type="button" data-audio-reset>Reset</button></div>',
    '<div class="vidbest-audio-presets" role="group" aria-label="Sound presets">',
    '<button type="button" data-audio-preset="normal">Normal</button><button type="button" data-audio-preset="bass">Bass Boost</button><button type="button" data-audio-preset="voice">Clear Voice</button><button type="button" data-audio-preset="warm">Warm</button><button type="button" data-audio-preset="movie">Movie</button><button type="button" data-audio-preset="space">3D Space</button><button type="button" data-audio-preset="wide">Surround Wide</button><button type="button" data-audio-preset="mashup">Mashup</button><button type="button" data-audio-preset="night">Night</button>',
    '</div>',
    '<div class="vidbest-audio-sliders">',
    '<label>Master <input data-a="master" type="range" min="0" max="1.25" step="0.01" value="1"></label>',
    '<label>Bass <input data-a="bass" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Mid <input data-a="mid" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Treble <input data-a="treble" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Space <input data-a="space" type="range" min="0" max="1" step="0.01" value="0"></label>',
    '<label>3D <input data-a="threeD" type="range" min="-1" max="1" step="0.02" value="0"></label>',
    '</div>',
    '<div class="vidbest-audio-status" data-audio-status>Choose a preset or move a control to enable effects.</div>'
  ].join("");
  (player.querySelector(".watch-player-stage") || player).insertAdjacentElement("afterend", panel);

  const controls = Object.fromEntries(Array.from(panel.querySelectorAll("[data-a]")).map(function(el) { return [el.dataset.a, el]; }));
  const status = panel.querySelector("[data-audio-status]");
  let ctx = null, source = null, master = null, bass = null, mid = null, treble = null, panner = null, compressor = null;

  function ensureAudio() {
    if (ctx) return true;
    try {
      ctx = new AudioContext();
      source = ctx.createMediaElementSource(video);
      master = ctx.createGain();
      bass = ctx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 160;
      mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.9;
      treble = ctx.createBiquadFilter(); treble.type = "highshelf"; treble.frequency.value = 4200;
      panner = ctx.createStereoPanner();
      compressor = ctx.createDynamicsCompressor(); compressor.threshold.value = -18; compressor.knee.value = 20; compressor.ratio.value = 3; compressor.attack.value = 0.003; compressor.release.value = 0.2;
      source.connect(bass).connect(mid).connect(treble).connect(panner).connect(compressor).connect(master).connect(ctx.destination);
      return true;
    } catch {
      status.textContent = "Audio effects unavailable for this media/browser. Normal playback is unchanged.";
      return false;
    }
  }
  function applyAudio() {
    if (!ensureAudio()) return;
    if (ctx.state === "suspended") ctx.resume().catch(function() {});
    const now = ctx.currentTime;
    function smooth(param, value) { param.setTargetAtTime(Number(value), now, 0.045); }
    smooth(master.gain, controls.master.value);
    smooth(bass.gain, controls.bass.value);
    smooth(mid.gain, controls.mid.value);
    smooth(treble.gain, controls.treble.value);
    smooth(panner.pan, Number(controls.threeD.value) * Number(controls.space.value));
    status.textContent = "Effects active · smooth transition";
  }
  const presets = {
    normal: [1, 0, 0, 0, 0, 0], bass: [1.02, 8, 0, 2, 0.12, 0], voice: [1, -2, 4, 3, 0.04, 0], warm: [1, 4, 2, -2, 0.08, 0], movie: [1.02, 5, -1, 4, 0.38, 0], space: [1, 3, 0, 3, 0.72, 0.55], wide: [1, 4, 0, 3, 0.95, 0.9], mashup: [1.05, 6, 3, 5, 0.62, -0.35], night: [0.82, -3, 3, -4, 0.04, 0]
  };
  function preset(name) {
    const values = presets[name] || presets.normal;
    ["master", "bass", "mid", "treble", "space", "threeD"].forEach(function(key, index) { controls[key].value = values[index]; });
    applyAudio();
  }
  panel.querySelectorAll("[data-audio-preset]").forEach(function(b) { b.addEventListener("click", function() { preset(b.dataset.audioPreset); }); });
  panel.querySelector("[data-audio-reset]").addEventListener("click", function() { preset("normal"); });
  Object.values(controls).forEach(function(input) { input.addEventListener("input", applyAudio); });
}

(function injectVidBestPlayerStyles() {
  if (document.getElementById("vidbest-player-upgrade-styles")) return;
  const style = document.createElement("style");
  style.id = "vidbest-player-upgrade-styles";
  style.textContent = [
    ".vidbest-embed-overlay{position:absolute;left:8px;right:8px;bottom:8px;z-index:8;display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:6px;border-radius:11px;background:rgba(5,7,13,.9);backdrop-filter:blur(10px);box-sizing:border-box}",
    ".vidbest-embed-button{border:0;border-radius:8px;padding:6px 8px;background:#202a3b;color:#fff;cursor:pointer;font:600 12px system-ui}",
    ".vidbest-embed-button:disabled{opacity:.42;cursor:not-allowed}",
    ".vidbest-embed-note{flex:1 1 100%;font:11px system-ui;color:#b9c3d4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".vidbest-audio-lab{margin:14px 0;padding:16px;border:1px solid rgba(148,163,184,.22);border-radius:16px;background:linear-gradient(135deg,rgba(15,23,42,.96),rgba(17,24,39,.82));color:#e5e7eb}",
    ".vidbest-audio-head{display:flex;justify-content:space-between;gap:14px;align-items:start}",
    ".vidbest-audio-head p{margin:0 0 3px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;opacity:.7}",
    ".vidbest-audio-head h2{margin:0;font-size:18px}",
    ".vidbest-audio-head small{opacity:.7}",
    ".vidbest-audio-lab button{border:1px solid rgba(148,163,184,.25);background:rgba(30,41,59,.8);color:#fff;border-radius:9px;padding:7px 9px;cursor:pointer}",
    ".vidbest-audio-presets{display:flex;flex-wrap:wrap;gap:7px;margin:13px 0}",
    ".vidbest-audio-sliders{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}",
    ".vidbest-audio-sliders label{display:grid;gap:5px;font-size:12px}",
    ".vidbest-audio-sliders input{width:100%}",
    ".vidbest-audio-status{margin-top:10px;font-size:12px;opacity:.75}",
    "@media(max-width:620px){.vidbest-embed-overlay{left:5px;right:5px;bottom:5px}.vidbest-embed-button{padding:6px 7px}.vidbest-audio-lab{padding:12px}}"
  ].join("");
  document.head.append(style);
})();



// VIDBEST PLAYER POLISH v4

/* Native controls: reuse the proven Vid.Best control bar, move it into the player stage,
   and explicitly keep the browser's own controls enabled. This removes the old extra row. */
function repairNativePlayerControls() {
  const player = document.querySelector("#watch-player");
  if (!player) return;
  const stage = player.querySelector(".watch-player-stage");
  const media = stage?.querySelector("video, audio");
  if (media instanceof HTMLMediaElement) {
    media.controls = true;
    media.setAttribute("controls", "");
    media.playsInline = true;
    media.setAttribute("playsinline", "");
    media.setAttribute("webkit-playsinline", "");
  }
  const tools = player.querySelector(".watch-player-stage + .player-tools") || player.querySelector(".player-tools");
  if (stage && tools && tools.parentElement !== stage) stage.append(tools);
  if (stage && tools) {
    tools.classList.add("vidbest-stage-tools");
    tools.setAttribute("aria-label", "Vid.Best advanced playback controls");
  }
}

/* Best-effort Audio Lab for embedded media. Cross-origin frames cannot be equalized by the
   parent page; only APIs exposed by the provider are used there. Same-origin frame media
   gets the same Web Audio EQ/reverb path as native media. */
function initializeEmbeddedAudioLab() {
  const player = document.querySelector("#watch-player");
  if (!player || player.dataset.vidbestEmbeddedAudio === "1") return;
  if (player.querySelector("video, audio")) return;
  const frame = player.querySelector("iframe");
  if (!frame) return;
  player.dataset.vidbestEmbeddedAudio = "1";

  const panel = document.createElement("section");
  panel.className = "vidbest-audio-lab vidbest-embedded-audio-lab";
  panel.innerHTML = [
    '<div class="vidbest-audio-head"><div><p>Audio Lab</p><h2>Sound effects & equalizer</h2><small>Full EQ works for same-origin media. Cross-origin embeds expose only the controls their provider allows.</small></div><button type="button" data-v4-reset>Reset</button></div>',
    '<div class="vidbest-audio-presets" role="group" aria-label="Sound presets">',
    '<button type="button" data-v4-p="normal">Normal</button><button type="button" data-v4-p="bass">Bass Boost</button><button type="button" data-v4-p="voice">Clear Voice</button><button type="button" data-v4-p="warm">Warm</button><button type="button" data-v4-p="movie">Movie</button><button type="button" data-v4-p="space">3D Space</button><button type="button" data-v4-p="wide">Surround Wide</button><button type="button" data-v4-p="mashup">Mashup</button><button type="button" data-v4-p="night">Night</button>',
    '</div><div class="vidbest-audio-sliders">',
    '<label>Master <input data-v4-a="master" type="range" min="0" max="1.25" step="0.01" value="1"></label>',
    '<label>Bass <input data-v4-a="bass" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Mid <input data-v4-a="mid" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Treble <input data-v4-a="treble" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Space <input data-v4-a="space" type="range" min="0" max="1" step="0.01" value="0"></label>',
    '<label>3D <input data-v4-a="depth" type="range" min="0" max="1" step="0.01" value="0"></label>',
    '</div><p class="vidbest-audio-status" data-v4-status aria-live="polite">Checking embedded media…</p><p class="vidbest-audio-truth">3D Space and Surround Wide are stereo-space simulations, not true multichannel surround.</p>',
  ].join("");
  player.insertAdjacentElement("afterend", panel);

  const inputs = Object.fromEntries([...panel.querySelectorAll("[data-v4-a]")].map((x) => [x.dataset.v4A, x]));
  const status = panel.querySelector("[data-v4-status]");
  const presets = {
    normal:[1,0,0,0,0,0], bass:[1,6,0,1,.04,0], voice:[1,-2,5,3,.04,0], warm:[1,4,0,-3,.08,0],
    movie:[1,3,2,3,.42,.18], space:[1,1,0,2,.72,.65], wide:[1,1,0,2,.9,.22], mashup:[1.06,5,2,5,.65,.75], night:[.72,-4,2,-4,.12,0]
  };
  let frameMedia = null;
  let graph = null;
  let provider = "external";

  const setStatus = (text, tone = "") => { status.textContent = text; status.dataset.tone = tone; };
  const values = () => ({ master:+inputs.master.value, bass:+inputs.bass.value, mid:+inputs.mid.value, treble:+inputs.treble.value, space:+inputs.space.value, depth:+inputs.depth.value });
  const smooth = (param, value) => { try { param?.setTargetAtTime(Number(value), (graph?.context.currentTime || 0) + .001, .16); } catch {} };
  const setPreset = (v) => { ["master","bass","mid","treble","space","depth"].forEach((k,i)=>inputs[k].value=v[i]); apply(); };

  const providerVolume = (value) => {
    const v = Math.max(0, Math.min(1, value));
    try {
      if (provider === "youtube") {
        const origin = new URL(frame.src, location.href).origin;
        if (v <= 0) frame.contentWindow?.postMessage(JSON.stringify({event:"command",func:"mute",args:[]}), origin);
        else {
          frame.contentWindow?.postMessage(JSON.stringify({event:"command",func:"unMute",args:[]}), origin);
          frame.contentWindow?.postMessage(JSON.stringify({event:"command",func:"setVolume",args:[Math.round(v*100)]}), origin);
        }
      } else if (provider === "vimeo") {
        frame.contentWindow?.postMessage(JSON.stringify({method:"setVolume",value:v}), "https://player.vimeo.com");
      }
    } catch {}
  };

  const apply = () => {
    const v = values();
    if (graph) {
      smooth(graph.bass.gain,v.bass); smooth(graph.mid.gain,v.mid); smooth(graph.treble.gain,v.treble);
      smooth(graph.dry.gain,1-v.space*.62); smooth(graph.wet.gain,v.space*.78); smooth(graph.master.gain,v.master);
      if (graph.panner) smooth(graph.panner.pan,0);
      setStatus("Full embedded Audio Lab active · smooth transition","ok");
    } else if (provider === "youtube" || provider === "vimeo") {
      providerVolume(v.master); setStatus("Embedded "+provider+" · Master volume works; EQ/3D needs direct media access","warn");
    }
  };

  const connect = (media) => {
    const C=window.AudioContext||window.webkitAudioContext;
    if (!(media instanceof HTMLMediaElement) || !C) return false;
    try {
      const context=new C(), source=context.createMediaElementSource(media), bass=context.createBiquadFilter(), mid=context.createBiquadFilter(), treble=context.createBiquadFilter();
      bass.type="lowshelf"; bass.frequency.value=160; mid.type="peaking"; mid.frequency.value=1000; mid.Q.value=.9; treble.type="highshelf"; treble.frequency.value=4200;
      const convolver=context.createConvolver(), dry=context.createGain(), wet=context.createGain(), compressor=context.createDynamicsCompressor(), master=context.createGain(), panner=context.createStereoPanner?context.createStereoPanner():null;
      compressor.threshold.value=-18; compressor.knee.value=18; compressor.ratio.value=3; compressor.attack.value=.01; compressor.release.value=.2;
      const len=Math.floor(context.sampleRate*1.25), ir=context.createBuffer(2,len,context.sampleRate);
      for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,4);} convolver.buffer=ir;
      source.connect(bass).connect(mid).connect(treble); treble.connect(dry).connect(compressor); treble.connect(convolver).connect(wet).connect(compressor); (panner?compressor.connect(panner).connect(master):compressor.connect(master)); master.connect(context.destination);
      graph={context,bass,mid,treble,dry,wet,master,panner};
      panel.addEventListener("pointerdown",()=>void context.resume().catch(()=>{}),{passive:true});
      media.addEventListener("play",()=>void context.resume().catch(()=>{}));
      return true;
    }catch(e){console.warn("Vid.Best Audio Lab:",e?.message||e);return false;}
  };

  const trySameOrigin = () => {
    if (graph) return true;
    try {
      const media = frame.contentDocument?.querySelector("video, audio");
      if (media instanceof HTMLMediaElement) {
        frameMedia=media;
        if (connect(media)) { panel.querySelectorAll("input[data-v4-a]").forEach((x)=>x.disabled=false); setStatus("Same-origin embedded media detected · full Audio Lab active","ok"); apply(); return true; }
      }
    } catch {}
    return false;
  };

  try { provider = vb4Provider(frame); } catch {}
  if (!trySameOrigin()) {
    const disableEq = () => panel.querySelectorAll("input[data-v4-a]").forEach((x)=>{ if(x.dataset.v4A!=="master")x.disabled=true; });
    disableEq();
    if(provider==="youtube"||provider==="vimeo") setStatus("Embedded "+provider+" · Master volume works; EQ/3D needs direct media access","warn");
    else setStatus("Cross-origin embed · EQ/3D cannot be applied by the parent page","warn");
    frame.addEventListener("load",()=>{ if(!trySameOrigin())disableEq(); });
  }

  panel.querySelector("[data-v4-reset]")?.addEventListener("click",()=>setPreset(presets.normal));
  panel.querySelectorAll("[data-v4-p]").forEach((b)=>b.addEventListener("click",()=>setPreset(presets[b.dataset.v4P]||presets.normal)));
  Object.values(inputs).forEach((x)=>x.addEventListener("input",apply));
}

(() => {
  if (document.getElementById("vidbest-player-polish-v4-css")) return;
  const style = document.createElement("style");
  style.id = "vidbest-player-polish-v4-css";
  style.textContent = [
    ".watch-player-stage{position:relative}",
    ".tiktok-embed-wrap{width:100%;display:flex;justify-content:center;align-items:flex-start;overflow:hidden;background:#000;min-height:0;border-radius:0 0 14px 14px}",
    ".tiktok-embed-wrap .tiktok-embed{width:100%!important;max-width:605px!important;min-width:325px!important;margin:0 auto!important}",
    ".tiktok-embed-wrap iframe{width:100%!important;max-width:605px!important;min-width:325px!important;border:0!important}",
    ".vidbest-tiktok-load-status{padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);background:#080a12;color:#9aa3ba;font-size:12px;line-height:1.5}",
    ".vidbest-tiktok-fallback{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);background:#080a12;color:#9aa3ba;font-size:12px;line-height:1.45}",
    ".vidbest-tiktok-fallback[hidden]{display:none!important}",
    ".watch-player[data-provider=\"tiktok\"] .watch-player-stage{height:auto;min-height:0;aspect-ratio:auto}",
    ".watch-player[data-provider=\"tiktok\"] .tiktok-embed-wrap{height:auto;min-height:0}",

    ".watch-player[data-provider=\"tiktok\"] .watch-player-stage{width:min(100%,540px);height:min(78vh,760px);min-height:0;aspect-ratio:9/16;margin-inline:auto;background:#000}",
    ".watch-player[data-provider=\"tiktok\"] .watch-player-stage iframe{width:100%;height:100%;min-height:0;display:block;border:0;object-fit:contain;background:#000}",
    ".watch-player.is-mini[data-provider=\"tiktok\"]{width:min(430px,calc(100vw - 36px))}",
    ".watch-player.is-mini[data-provider=\"tiktok\"] .watch-player-stage{width:100%;height:min(70vh,calc((100vw - 36px) * 1.7778));min-height:0;aspect-ratio:9/16}",
    ".watch-player.is-mini[data-provider=\"tiktok\"] .watch-player-stage iframe{min-height:0}",
    ".watch-player.is-theater[data-provider=\"tiktok\"] .watch-player-stage{width:100%;max-width:none;height:calc(100vh - 90px);min-height:0;aspect-ratio:auto}",
    "@media(max-width:760px){.watch-player[data-provider=\"tiktok\"] .watch-player-stage{width:100%;height:min(78vh,calc((100vw - 40px) * 1.7778));max-height:78vh}.watch-player[data-provider=\"tiktok\"] .watch-player-stage iframe{min-height:0}}",
    ".watch-player-stage .player-tools.vidbest-stage-tools{position:absolute!important;left:8px;right:8px;bottom:42px;z-index:30;margin:0!important;width:auto!important;max-width:none!important;display:flex!important;align-items:center;gap:5px;flex-wrap:wrap;padding:7px 8px!important;border-radius:12px;background:linear-gradient(180deg,rgba(4,7,16,.08),rgba(4,7,16,.94));box-sizing:border-box;pointer-events:none}",
    ".watch-player-stage .player-tools.vidbest-stage-tools>*{pointer-events:auto}",
    ".watch-player-stage .player-tools.vidbest-stage-tools button{min-height:30px;white-space:nowrap}",
    ".watch-player-stage .player-tools.vidbest-stage-tools .player-message{width:100%}",
    ".vidbest-embedded-audio-lab{margin-top:0}",
    "@media(max-width:760px){.watch-player-stage .player-tools.vidbest-stage-tools{bottom:40px;left:6px;right:6px;padding:6px!important}.watch-player-stage .player-tools.vidbest-stage-tools button{padding:5px 7px;font-size:11px}.vidbest-embedded-audio-lab{padding:10px!important}}",
  ].join("");
  document.head.append(style);
})();
