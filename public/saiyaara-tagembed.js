// One click-loaded Tagembed post, with a first-party poster on every surface.
(() => {
  const SLUG = "saiyaara-a-cinematic-romance";
  const IFRAME_URL = "https://widget.tagembed.com/2236794?postId=5592899&caption=0&header=0";
  const POSTER_URL = "/api/tiktok/cached-poster?id=7669587518156705056&v=2";
  // The provider's portrait media (716 x 1166) plus its 52px action row.
  // A stable viewport avoids the provider cropping a tall post into a wide tile.
  const WIDTH = 360, HEIGHT = 650;
  const instances = new WeakMap();
  let active = null;

  function fit(item) {
    const { width, height } = item.viewport.getBoundingClientRect();
    const scale = Math.max(0, Math.min(width / WIDTH, height / HEIGHT));
    item.canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  function state(item, value, message = "") {
    item.host.dataset.tagembedState = value;
    item.label.textContent = message;
    item.label.hidden = !message;
  }
  function stop(host) {
    const item = instances.get(host);
    if (!item) return;
    item.frame?.remove(); item.frame = null;
    item.canvas.hidden = true; item.cover.hidden = false; item.cover.disabled = false;
    item.cover.textContent = "▶ Load video";
    item.back.hidden = true;
    state(item, "preview");
    if (active === item) active = null;
    item.options.onStop?.();
  }
  function start(item) {
    if (item.frame || !item.host.isConnected) return;
    if (active && active !== item) stop(active.host);
    active = item;
    const frame = document.createElement("iframe");
    frame.className = "saiyaara-tagembed-frame";
    frame.title = "Saiyaara video via Tagembed";
    frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("loading", "eager");
    item.frame = frame;
    item.cover.disabled = true;
    item.cover.textContent = "Loading video…";
    item.back.hidden = false;
    state(item, "loading");
    // Register before src/attachment. Never infer failure from elapsed time or
    // claim the video is playing from a cross-origin document's load event.
    frame.addEventListener("load", () => {
      if (item.frame !== frame) return;
      item.canvas.hidden = false; item.cover.hidden = true;
      state(item, "frame-loaded");
      fit(item); item.options.onLoad?.(frame);
    }, { once: true });
    frame.addEventListener("error", () => {
      if (item.frame !== frame) return;
      stop(item.host);
      state(item, "failed", "The player could not load. Your preview is still available.");
    }, { once: true });
    frame.src = IFRAME_URL;
    item.canvas.append(frame);
    item.options.onFrame?.(frame);
  }
  function mount(host, mode = "watch", options = {}) {
    if (!host) return null;
    const existing = instances.get(host);
    if (existing) { existing.options = options; return existing; }
    host.classList.add("saiyaara-tagembed-host");
    host.dataset.saiyaaraMode = mode;
    // SSR supplies a small poster immediately. All JS surfaces use the same
    // URL, so browser/R2 caching coalesces grid, watch, popup and swipe previews.
    const panel = document.createElement("div"); panel.className = "saiyaara-player-panel";
    const viewport = document.createElement("div"); viewport.className = "saiyaara-player-viewport";
    const poster = host.querySelector(".saiyaara-tagembed-poster") || document.createElement("img");
    poster.className = "saiyaara-tagembed-poster"; poster.alt = "";
    poster.decoding = "async"; poster.loading = mode === "tile" ? "lazy" : "eager";
    poster.src = POSTER_URL;
    poster.addEventListener("error", () => { poster.hidden = true; }, { once: true });
    const canvas = document.createElement("div"); canvas.className = "saiyaara-tagembed-canvas"; canvas.hidden = true;
    const cover = document.createElement("button"); cover.type = "button";
    cover.className = "saiyaara-preview-cover"; cover.textContent = "▶ Load video";
    cover.setAttribute("aria-label", "Load Saiyaara video");
    const bar = document.createElement("div"); bar.className = "saiyaara-player-note";
    const credit = document.createElement("span"); credit.textContent = "saiyaara · TikTok via Tagembed";
    const help = document.createElement("span"); help.textContent = "Sound is controlled by Tagembed.";
    const back = document.createElement("button"); back.type = "button";
    back.textContent = "Close video"; back.hidden = true;
    const label = document.createElement("span"); label.className = "saiyaara-tagembed-status";
    label.setAttribute("role", "status"); label.hidden = true;
    viewport.append(poster, canvas, cover, label); bar.append(credit, help, back); panel.append(viewport, bar);
    host.replaceChildren(panel);
    const item = { host, panel, viewport, canvas, cover, back, label, options, frame: null, observer: null };
    instances.set(host, item);
    cover.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); start(item); });
    back.addEventListener("click", () => stop(item.host));
    if ("ResizeObserver" in window) {
      item.observer = new ResizeObserver(() => fit(item));
      item.observer.observe(viewport);
    }
    state(item, "preview"); fit(item);
    return item;
  }
  function unmount(host) {
    const item = instances.get(host);
    if (!item) return;
    stop(host); item.observer?.disconnect(); instances.delete(host);
    host.replaceChildren(); host.classList.remove("saiyaara-tagembed-host");
    delete host.dataset.saiyaaraMode; delete host.dataset.tagembedState;
  }
  function transfer(from, to, mode, options = {}) {
    const item = instances.get(from);
    if (!item?.frame || !to?.isConnected) return false;
    // appendChild would reload the iframe. Older browsers return to the cached
    // poster instead, requiring an intentional tap before another paid load.
    if (typeof to.moveBefore !== "function") { stop(from); return false; }
    unmount(to);
    try { to.moveBefore(item.panel, null); } catch { stop(from); return false; }
    instances.delete(from); instances.set(to, item);
    to.classList.add("saiyaara-tagembed-host"); to.dataset.saiyaaraMode = mode;
    to.dataset.tagembedState = from.dataset.tagembedState;
    item.host = to; item.options = options;
    mount(from, from.dataset.saiyaaraMode || "watch");
    fit(item); options.onFrame?.(item.frame);
    if (to.dataset.tagembedState === "frame-loaded") options.onLoad?.(item.frame);
    return true;
  }
  function initWatch() {
    if (document.body?.dataset.viewerEmbed === "1") return;
    document.querySelectorAll("[data-saiyaara-tagembed-host]").forEach(host => mount(host));
  }
  window.VidBestSaiyaaraTagembed = Object.freeze({ slug: SLUG, iframeUrl: IFRAME_URL,
    posterUrl: POSTER_URL, mount, stop, unmount, transfer });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initWatch, { once: true });
  else initWatch();
  window.addEventListener("pagehide", () => { if (active) stop(active.host); });
})();
