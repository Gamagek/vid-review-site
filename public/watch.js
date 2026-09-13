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
      if (persistentPlayer.classList.contains("is-mini")) leavePersistentMode();
      if (watchPlayerState.miniTimer) {
        clearTimeout(watchPlayerState.miniTimer);
        watchPlayerState.miniTimer = null;
        status.textContent = "Scroll to keep watching";
      }
      return;
    }
    if (!persistentPlayer.classList.contains("is-mini") && !watchPlayerState.miniTimer) {
      status.textContent = "Mini-player starts in 3 seconds";
      watchPlayerState.miniTimer = setTimeout(() => { void activateMini(); }, 3000);
    }
  };

  persistentPlayer.addEventListener("click", (event) => {
    const action = event.target.closest("[data-player-mode]")?.dataset.playerMode;
    if (!action) return;
    if (action === "restore") {
      leavePersistentMode({ restoreFocus: true });
      persistentPlayer.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    }
    if (action === "theater") {
      watchPlayerState.focusReturn = document.activeElement;
      playerPlaceholder.style.height = `${persistentPlayer.offsetHeight}px`;
      playerPlaceholder.classList.add("is-active");
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
      status.textContent = "Mini-player paused while this tab is hidden";
      return;
    }
    if (document.visibilityState === "visible") evaluateScroll();
  });
}

async function startMutedPlayback() {
  const video = persistentPlayer.querySelector("video");
  if (video) {
    video.muted = true;
    try {
      await video.play();
      return !video.paused;
    } catch {
      return false;
    }
  }
  if (document.body.dataset.videoProvider === "youtube") {
    youtubeCommand("mute");
    youtubeCommand("playVideo");
    return true;
  }
  return false;
}

function pausePlayback() {
  const video = persistentPlayer?.querySelector("video");
  if (video) video.pause();
  youtubeCommand("pauseVideo");
}

function youtubeCommand(func, args = []) {
  const frame = persistentPlayer?.querySelector("iframe");
  if (!frame || document.body.dataset.videoProvider !== "youtube") return;
  try {
    const targetOrigin = new URL(frame.src).origin;
    frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), targetOrigin);
  } catch {
    // The provider's built-in controls remain available if its API is unavailable.
  }
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
