const videoId = Number(document.body.dataset.videoId || 0);
const reactionPanel = document.querySelector(".watch-reactions");
const commentForm = document.querySelector("#watch-comment-form");
const commentList = document.querySelector("#watch-comments");

const watchPlayerState = {
  rates: [0.5, 0.75, 1, 1.25, 1.5, 2],
  zooms: [1, 1.25, 1.5, 2],
  rateIndex: 2,
  zoomIndex: 0,
};

document.addEventListener("DOMContentLoaded", initializeWatchPage);

function initializeWatchPage() {
  enhanceNativePlayer();
  enhanceCommentForm();
  if (!videoId) return;
  reactionPanel?.querySelectorAll("[data-reaction]").forEach((button) => {
    button.addEventListener("click", () => react(button.dataset.reaction, button));
  });
  commentForm?.addEventListener("submit", submitComment);
  loadComments();
}

function enhanceNativePlayer() {
  const video = document.querySelector(".watch-player video");
  if (!video) return;
  const stage = video.closest(".watch-player");
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
  video.insertAdjacentElement("afterend", tools);
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
