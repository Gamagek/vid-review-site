const VB_TEST_SLUG = "lab-review-1-player-test";
const VB_TEST_MEDIA = "/lab-media/lab-review-1.mp4";

const vbPlayerState = {
  video: null,
  mini: null,
  master: null,
  zoomIndex: 0,
  speedIndex: 2,
  speeds: [0.5, 0.75, 1, 1.25, 1.5, 2],
  zooms: [1, 1.25, 1.5, 2],
};

document.addEventListener("DOMContentLoaded", initializeHomePlayer);

function initializeHomePlayer() {
  injectHomePlayerUi();
  bindHomePlayerEvents();
  decorateLabReviewPreviews();
  const observer = new MutationObserver(decorateLabReviewPreviews);
  observer.observe(document.body, { childList: true, subtree: true });
}

function injectHomePlayerUi() {
  const mini = document.createElement("section");
  mini.id = "vb-mini-player";
  mini.className = "vb-mini-player";
  mini.hidden = true;
  mini.setAttribute("aria-label", "Mini video player");
  mini.innerHTML = `
    <div class="vb-mini-video-wrap"><video id="vb-mini-video" playsinline preload="metadata" controls></video></div>
    <div class="vb-mini-copy"><strong id="vb-mini-title">Video</strong><small>Mini player · keeps browsing visible</small></div>
    <div class="vb-mini-actions">
      <button type="button" data-vb-action="like">👍 <span>0</span></button>
      <button type="button" data-vb-action="share">Share</button>
      <button type="button" data-vb-action="comment">Comment + photo</button>
      <button type="button" data-vb-action="expand">Pop-up</button>
      <button type="button" data-vb-action="close" aria-label="Close mini player">✕</button>
    </div>
    <form id="vb-mini-comment" class="vb-comment-panel" hidden>
      <input name="author" maxlength="50" placeholder="Your name (optional)">
      <textarea name="body" maxlength="800" required placeholder="Add a helpful comment…"></textarea>
      <label><span class="sr-only">Attach picture</span><input name="image" type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp"></label>
      <input class="honeypot" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <img class="vb-comment-image" alt="Selected comment image preview">
      <button type="submit">Send for review</button>
      <p class="vb-comment-status" role="status"></p>
    </form>`;

  const dialog = document.createElement("dialog");
  dialog.id = "vb-master-dialog";
  dialog.className = "vb-master-dialog";
  dialog.innerHTML = `
    <div class="vb-master-shell">
      <div class="vb-master-title"><h2 id="vb-master-title">Video</h2><button type="button" class="button ghost" data-vb-master="close">Close</button></div>
      <div class="vb-master-stage" id="vb-master-stage"><video id="vb-master-video" controls playsinline preload="metadata"></video></div>
      <div class="vb-master-tools" aria-label="Advanced player controls">
        <button type="button" data-vb-master="rewind">↶ 10s</button>
        <button type="button" data-vb-master="play">▶ Play</button>
        <button type="button" data-vb-master="forward">10s ↷</button>
        <button type="button" data-vb-master="speed">1× speed</button>
        <button type="button" data-vb-master="zoom">1× zoom</button>
        <button type="button" data-vb-master="captions">CC</button>
        <select data-vb-master="translate" aria-label="Caption translation" disabled><option>Auto-translate captions</option></select>
        <button type="button" data-vb-master="pip">PiP</button>
        <button type="button" data-vb-master="fullscreen">Fullscreen</button>
        <button type="button" data-vb-master="share">Share</button>
        <p class="vb-player-note" id="vb-player-note">Automatic captions and translation activate when a caption track is available. The planned Teamwork API will generate those tracks later.</p>
      </div>
      <form id="vb-master-comment" class="vb-comment-panel vb-master-comment">
        <input name="author" maxlength="50" placeholder="Your name (optional)">
        <textarea name="body" maxlength="800" required placeholder="Comment while watching…"></textarea>
        <label><span class="sr-only">Attach picture</span><input name="image" type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp"></label>
        <input class="honeypot" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <img class="vb-comment-image" alt="Selected comment image preview">
        <button type="submit">Send for review</button>
        <p class="vb-comment-status" role="status"></p>
      </form>
    </div>`;

  document.body.append(mini, dialog);
  vbPlayerState.mini = mini.querySelector("#vb-mini-video");
  vbPlayerState.master = dialog.querySelector("#vb-master-video");
}

function bindHomePlayerEvents() {
  document.addEventListener("click", async (event) => {
    const anchor = event.target.closest(".featured-card-link, .tile-media, .tile-title");
    if (!anchor) return;
    const slug = slugFromWatchHref(anchor.getAttribute("href"));
    if (slug !== VB_TEST_SLUG) return;
    event.preventDefault();
    await openLabReviewPlayer();
  });

  const mini = document.querySelector("#vb-mini-player");
  mini.addEventListener("click", (event) => {
    const action = event.target.closest("[data-vb-action]")?.dataset.vbAction;
    if (!action) return;
    if (action === "like") reactToCurrentVideo(event.target.closest("button"));
    if (action === "share") shareCurrentVideo();
    if (action === "comment") mini.querySelector("#vb-mini-comment").hidden = !mini.querySelector("#vb-mini-comment").hidden;
    if (action === "expand") openMasterPlayer();
    if (action === "close") closeMiniPlayer();
  });

  bindCommentForm(mini.querySelector("#vb-mini-comment"));
  bindCommentForm(document.querySelector("#vb-master-comment"));

  const dialog = document.querySelector("#vb-master-dialog");
  dialog.addEventListener("click", handleMasterControl);
  dialog.addEventListener("close", syncMasterBackToMini);
  vbPlayerState.master.addEventListener("play", updateMasterPlayLabel);
  vbPlayerState.master.addEventListener("pause", updateMasterPlayLabel);
}

function slugFromWatchHref(value) {
  if (!value) return "";
  try {
    const url = new URL(value, location.origin);
    const match = url.pathname.match(/^\/watch\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

async function openLabReviewPlayer() {
  let video;
  try {
    const result = await vbApi(`/api/videos/${encodeURIComponent(VB_TEST_SLUG)}`);
    video = result.video;
  } catch (error) {
    console.warn(error.message);
    location.href = `/watch/${encodeURIComponent(VB_TEST_SLUG)}`;
    return;
  }
  vbPlayerState.video = video;
  const mini = document.querySelector("#vb-mini-player");
  mini.hidden = false;
  mini.querySelector("#vb-mini-title").textContent = video.title || "Lab Review 1";
  mini.querySelector('[data-vb-action="like"] span').textContent = formatCompact(video.reactions?.like || 0);
  vbPlayerState.mini.src = video.source_url || VB_TEST_MEDIA;
  try { await vbPlayerState.mini.play(); } catch { /* Browser may require a second user gesture. */ }
}

function closeMiniPlayer() {
  vbPlayerState.mini.pause();
  document.querySelector("#vb-mini-player").hidden = true;
}

function openMasterPlayer() {
  if (!vbPlayerState.video) return;
  const dialog = document.querySelector("#vb-master-dialog");
  const master = vbPlayerState.master;
  master.src = vbPlayerState.video.source_url || VB_TEST_MEDIA;
  master.currentTime = Number.isFinite(vbPlayerState.mini.currentTime) ? vbPlayerState.mini.currentTime : 0;
  master.playbackRate = vbPlayerState.mini.playbackRate || 1;
  document.querySelector("#vb-master-title").textContent = vbPlayerState.video.title || "Lab Review 1";
  vbPlayerState.mini.pause();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  refreshCaptionControls();
  master.play().catch(() => {});
}

function syncMasterBackToMini() {
  if (!vbPlayerState.video) return;
  vbPlayerState.mini.currentTime = Number.isFinite(vbPlayerState.master.currentTime) ? vbPlayerState.master.currentTime : 0;
  vbPlayerState.mini.playbackRate = vbPlayerState.master.playbackRate || 1;
  vbPlayerState.master.pause();
}

function handleMasterControl(event) {
  const button = event.target.closest("[data-vb-master]");
  if (!button) return;
  const action = button.dataset.vbMaster;
  const video = vbPlayerState.master;
  if (action === "close") document.querySelector("#vb-master-dialog").close();
  if (action === "rewind") video.currentTime = Math.max(0, video.currentTime - 10);
  if (action === "forward") video.currentTime = Math.min(Number.isFinite(video.duration) ? video.duration : video.currentTime + 10, video.currentTime + 10);
  if (action === "play") video.paused ? video.play().catch(() => {}) : video.pause();
  if (action === "speed") cycleSpeed(button);
  if (action === "zoom") cycleZoom(button);
  if (action === "captions") toggleCaptions(button);
  if (action === "pip") togglePictureInPicture();
  if (action === "fullscreen") toggleFullscreen();
  if (action === "share") shareCurrentVideo();
}

function cycleSpeed(button) {
  vbPlayerState.speedIndex = (vbPlayerState.speedIndex + 1) % vbPlayerState.speeds.length;
  const speed = vbPlayerState.speeds[vbPlayerState.speedIndex];
  vbPlayerState.master.playbackRate = speed;
  button.textContent = `${speed}× speed`;
}

function cycleZoom(button) {
  vbPlayerState.zoomIndex = (vbPlayerState.zoomIndex + 1) % vbPlayerState.zooms.length;
  const zoom = vbPlayerState.zooms[vbPlayerState.zoomIndex];
  vbPlayerState.master.style.transform = `scale(${zoom})`;
  button.textContent = `${zoom}× zoom`;
}

function updateMasterPlayLabel() {
  const button = document.querySelector('[data-vb-master="play"]');
  if (button) button.textContent = vbPlayerState.master.paused ? "▶ Play" : "❚❚ Pause";
}

function refreshCaptionControls() {
  const button = document.querySelector('[data-vb-master="captions"]');
  const translate = document.querySelector('[data-vb-master="translate"]');
  const hasTracks = vbPlayerState.master.textTracks && vbPlayerState.master.textTracks.length > 0;
  button.disabled = !hasTracks;
  translate.disabled = true;
  document.querySelector("#vb-player-note").textContent = hasTracks
    ? "Caption track detected. CC can be toggled here. Automatic translation will be connected to the Teamwork API."
    : "No caption track is stored for this test video yet. Automatic captions and translation will activate after the Teamwork transcription pipeline is connected.";
}

function toggleCaptions(button) {
  const tracks = [...vbPlayerState.master.textTracks];
  if (!tracks.length) return;
  const showing = tracks.some((track) => track.mode === "showing");
  tracks.forEach((track, index) => { track.mode = !showing && index === 0 ? "showing" : "hidden"; });
  button.textContent = showing ? "CC off" : "CC on";
}

async function togglePictureInPicture() {
  try {
    if (!document.pictureInPictureEnabled || typeof vbPlayerState.master.requestPictureInPicture !== "function") return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await vbPlayerState.master.requestPictureInPicture();
  } catch (error) {
    console.warn("PiP unavailable", error?.message || error);
  }
}

async function toggleFullscreen() {
  const stage = document.querySelector("#vb-master-stage");
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (stage.requestFullscreen) await stage.requestFullscreen();
  } catch (error) {
    console.warn("Fullscreen unavailable", error?.message || error);
  }
}

async function reactToCurrentVideo(button) {
  if (!vbPlayerState.video?.id) return;
  button.disabled = true;
  try {
    const result = await vbApi(`/api/videos/${vbPlayerState.video.id}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction: "like" }),
    });
    button.querySelector("span").textContent = formatCompact(result.reactions?.like || 0);
    button.classList.toggle("active", Boolean(result.active));
  } catch (error) {
    console.warn(error.message);
  } finally {
    button.disabled = false;
  }
}

async function shareCurrentVideo() {
  if (!vbPlayerState.video) return;
  const url = `${location.origin}/watch/${encodeURIComponent(vbPlayerState.video.slug)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: vbPlayerState.video.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showPlayerNote("Link copied to clipboard.");
  } catch (error) {
    if (error?.name !== "AbortError") showPlayerNote("Sharing is unavailable in this browser.");
  }
}

function bindCommentForm(form) {
  if (!form) return;
  const image = form.elements.image;
  const preview = form.querySelector(".vb-comment-image");
  image.addEventListener("change", () => {
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    const file = image.files?.[0];
    if (!file) {
      preview.style.display = "none";
      preview.removeAttribute("src");
      return;
    }
    const url = URL.createObjectURL(file);
    preview.dataset.objectUrl = url;
    preview.src = url;
    preview.style.display = "block";
  });
  form.addEventListener("submit", submitPictureComment);
}

async function submitPictureComment(event) {
  event.preventDefault();
  if (!vbPlayerState.video?.id) return;
  const form = event.currentTarget;
  const status = form.querySelector(".vb-comment-status");
  const submit = form.querySelector('button[type="submit"]');
  const file = form.elements.image.files?.[0];
  if (file && file.size > 5 * 1024 * 1024) {
    status.textContent = "Picture must be 5 MB or smaller.";
    return;
  }
  submit.disabled = true;
  status.textContent = "Sending for moderation…";
  const data = new FormData();
  data.set("author", form.elements.author.value || "");
  data.set("body", form.elements.body.value || "");
  data.set("website", form.elements.website.value || "");
  if (file) data.set("image", file, file.name);
  try {
    const result = await vbApi(`/api/videos/${vbPlayerState.video.id}/comments`, {
      method: "POST",
      body: data,
    });
    form.reset();
    const preview = form.querySelector(".vb-comment-image");
    preview.style.display = "none";
    preview.removeAttribute("src");
    status.textContent = result.message || "Comment sent for moderation.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function showPlayerNote(message) {
  const note = document.querySelector("#vb-player-note");
  if (note) note.textContent = message;
}

function decorateLabReviewPreviews() {
  const featuredLink = [...document.querySelectorAll(".featured-card-link")]
    .find((link) => slugFromWatchHref(link.getAttribute("href")) === VB_TEST_SLUG);
  const featuredCard = featuredLink?.closest(".featured-card");
  if (featuredCard && !featuredCard.querySelector(".vb-lab-preview")) {
    featuredCard.querySelector(".featured-fallback")?.remove();
    const video = document.createElement("video");
    video.className = "vb-lab-preview";
    video.src = VB_TEST_MEDIA;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.autoplay = true;
    featuredCard.prepend(video);
    video.play().catch(() => {});
  }

  [...document.querySelectorAll(".tile-media")].forEach((link) => {
    if (slugFromWatchHref(link.getAttribute("href")) !== VB_TEST_SLUG || link.querySelector(".vb-lab-preview")) return;
    link.querySelector("img")?.setAttribute("hidden", "");
    link.querySelector(".media-fallback")?.setAttribute("hidden", "");
    const video = document.createElement("video");
    video.className = "vb-lab-preview";
    video.src = VB_TEST_MEDIA;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    link.prepend(video);
  });
}

async function vbApi(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* Non-JSON error. */ }
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  return payload;
}

function formatCompact(value) {
  return new Intl.NumberFormat(undefined, {
    notation: Number(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}
