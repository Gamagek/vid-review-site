import { parseInstagramUrl } from "./instagram-utils.js";

let activePreview = null;

function button(label, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "button ghost";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function mountPlayer(target, source, title, existingFrame = null) {
  let frame = existingFrame;
  let timer;
  const toolbar = document.createElement("div");
  toolbar.className = "instagram-player-actions";
  const status = document.createElement("p");
  status.className = "instagram-player-status";
  status.setAttribute("role", "status");
  const help = document.createElement("p");
  help.className = "instagram-player-help";
  help.textContent = "Instagram controls playback. If this preview offers ‘Watch on Instagram’, open the original post to play. Private or embed-disabled posts may be unavailable.";

  function observeFrame() {
    clearTimeout(timer);
    status.textContent = "Loading Instagram…";
    frame.addEventListener("load", () => {
      clearTimeout(timer);
      // A loaded cross-origin document does not prove that video playback works.
      status.textContent = "Use the controls inside the Instagram preview.";
    }, { once: true });
    frame.addEventListener("error", () => {
      clearTimeout(timer);
      status.textContent = "Instagram could not load. Try Reload or Open on Instagram.";
    }, { once: true });
    timer = setTimeout(() => {
      status.textContent = "If the preview is blank, try Reload or Open on Instagram.";
    }, 12000);
  }

  function load() {
    frame?.remove();
    frame = document.createElement("iframe");
    frame.className = "instagram-official-player";
    frame.title = title || "Instagram video";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    observeFrame();
    frame.src = source.embedUrl;
    target.prepend(frame);
  }

  const reload = button("Reload Instagram", load);
  const open = document.createElement("a");
  open.className = "button ghost";
  open.textContent = "Open on Instagram ↗";
  open.href = source.sourceUrl;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  toolbar.append(reload, open);
  if (document.fullscreenEnabled && target.requestFullscreen) {
    toolbar.append(button("Fullscreen", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await target.requestFullscreen();
      } catch {
        status.textContent = "Fullscreen is unavailable in this browser.";
      }
    }));
  }
  target.append(toolbar, status, help);
  if (frame) observeFrame();
  else load();
  return {
    toolbar,
    destroy() {
      clearTimeout(timer);
      frame?.remove();
      toolbar.remove();
      status.remove();
      help.remove();
    },
  };
}

function decoratePreviews() {
  if (activePreview && !activePreview.target.isConnected) activePreview.close();
  document.querySelectorAll('.video-tile[data-video-provider="instagram"]:not([data-instagram-ready])').forEach((card) => {
    const source = parseInstagramUrl(card.dataset.videoSource);
    const media = card.querySelector(".tile-media");
    if (!source || !media) return;
    card.dataset.instagramReady = "1";
    const preview = document.createElement("section");
    preview.className = "instagram-preview";
    preview.setAttribute("aria-label", `${card.dataset.videoTitle || "Instagram"} preview`);
    const launch = button("Show Instagram preview", () => {
      activePreview?.close();
      launch.hidden = true;
      media.hidden = true;
      const player = mountPlayer(preview, source, card.dataset.videoTitle);
      const close = () => {
        player.destroy();
        media.hidden = false;
        launch.hidden = false;
        if (activePreview?.target === preview) activePreview = null;
      };
      player.toolbar.append(button("Close preview", () => { close(); launch.focus(); }));
      activePreview = { target: preview, close };
    });
    preview.append(launch);
    media.after(preview);
    const note = card.querySelector(".preview-status");
    if (note) note.textContent = "Instagram · preview available below";
  });
}

function boot() {
  if (document.body.dataset.videoProvider === "instagram") {
    const target = document.querySelector(".instagram-player");
    const frame = target?.querySelector("iframe.instagram-official-player");
    const source = parseInstagramUrl(target?.dataset.instagramSource);
    if (target && frame && source) mountPlayer(target, source, frame.title, frame);
  }
  decoratePreviews();
}

document.addEventListener("vidbest:grid-rendered", decoratePreviews);
window.addEventListener("pagehide", () => activePreview?.close());
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
