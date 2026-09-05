const videoId = Number(document.body.dataset.videoId || 0);
const reactionPanel = document.querySelector(".watch-reactions");
const commentForm = document.querySelector("#watch-comment-form");
const commentList = document.querySelector("#watch-comments");

document.addEventListener("DOMContentLoaded", initializeWatchPage);

function initializeWatchPage() {
  enhanceNativePlayer();
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

  const tools = document.createElement("div");
  tools.className = "watch-reactions player-tools";
  tools.setAttribute("aria-label", "Video playback tools");

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

  const rates = [0.75, 1, 1.25, 1.5, 2];
  const speed = playerButton("1×", "Change playback speed", () => {
    const current = rates.findIndex((rate) => Math.abs(rate - video.playbackRate) < 0.01);
    const next = rates[(current + 1 + rates.length) % rates.length];
    video.playbackRate = next;
    speed.textContent = `${next}×`;
  });

  tools.append(rewind, playPause, forward, speed);

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
  submit.disabled = true;
  setStatus(status, "Sending…");
  try {
    const result = await api(`/api/videos/${videoId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        author: commentForm.elements.author.value,
        body: commentForm.elements.body.value,
        website: commentForm.elements.website.value,
      }),
    });
    commentForm.reset();
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
