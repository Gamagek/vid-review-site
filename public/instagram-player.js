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

function boot() {
  if (document.body.dataset.videoProvider === "instagram") {
    const target = document.querySelector(".instagram-player");
    const frame = target?.querySelector("iframe.instagram-official-player");
    const source = parseInstagramUrl(target?.dataset.instagramSource);
    if (target && frame && source) mountPlayer(target, source, frame.title, frame);
  }
  decoratePreviews();
}

window.addEventListener("pagehide", () => activePreview?.close());
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
