// Saiyaara-only Tagembed widget. This is intentionally not a global TikTok
// player replacement; it uses the embed code supplied by the site owner.
(() => {
  const SLUG = "saiyaara-a-cinematic-romance";
  const SCRIPT_URL = "https://widget.tagembed.com/embed.min.js";
  const WIDGET_ID = "2236794";
  const POST_ID = "5592899";

  let activeHost = null;
  let activeScript = null;
  let visibilityObserver = null;
  let vendorTimer = null;

  function status(host, message) {
    const label = host.querySelector("[data-saiyaara-tagembed-status]");
    if (label) label.textContent = message;
  }

  function stopMonitoring() {
    if (vendorTimer) window.clearTimeout(vendorTimer);
    vendorTimer = null;
  }

  function start(host) {
    if (!host?.isConnected || host.dataset.tagembedLoading === "1") return;
    if (document.hidden) {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) start(host);
      }, { once: true });
      return;
    }
    if (activeHost?.isConnected && activeHost !== host) {
      // Avoid two copies of the same third-party widget on one document.
      status(host, "The Saiyaara widget is already open on this page.");
      return;
    }
    // A previously removed grid card must not retain the active widget slot.
    if (activeHost && !activeHost.isConnected) {
      activeScript?.remove();
      activeScript = null;
    }
    activeHost = host;
    host.dataset.tagembedLoading = "1";

    const widget = host.querySelector(".tagembed-widget") || document.createElement("div");
    widget.className = "tagembed-widget";
    widget.style.width = "100%";
    widget.style.height = "100%";
    widget.style.overflow = "auto";
    widget.dataset.widgetId = WIDGET_ID;
    widget.dataset.caption = "1";
    widget.dataset.header = "1";
    widget.dataset.postId = POST_ID;
    if (!widget.isConnected) host.prepend(widget);
    status(host, "Loading Saiyaara from Tagembed…");

    // The official vendor runtime scans .tagembed-widget elements on execution.
    // Place the container first, then load the script exactly once.
    if (activeScript?.isConnected) return;
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.saiyaaraTagembedScript = "1";
    script.onerror = () => {
      status(host, "Tagembed is unavailable. The video preview remains on Vid.Best.");
    };
    script.onload = () => {
      // This only establishes that the SDK loaded, not that TikTok can play.
      status(host, "Widget requested · tap the video controls to play.");
      stopMonitoring();
      vendorTimer = window.setTimeout(() => {
        if (!widget.isConnected || !host.isConnected) return;
        if (!widget.childElementCount) {
          status(host, "Tagembed loaded, but no video appeared. Check the widget's source and availability.");
        }
      }, 9000);
    };
    activeScript = script;
    document.body.append(script);
  }

  function mount(host, mode = "watch") {
    if (!host || host.dataset.saiyaaraTagembedMounted === "1") return false;
    host.dataset.saiyaaraTagembedMounted = "1";
    host.classList.add("saiyaara-tagembed-host", "saiyaara-tagembed-" + mode);
    const label = document.createElement("p");
    label.className = "saiyaara-tagembed-status";
    label.dataset.saiyaaraTagembedStatus = "1";
    label.setAttribute("role", "status");
    label.textContent = mode === "tile" ? "Saiyaara · loading preview when visible" : "Saiyaara video · preparing widget";
    host.append(label);

    if (mode === "tile" && "IntersectionObserver" in window) {
      visibilityObserver?.disconnect();
      visibilityObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        visibilityObserver.disconnect();
        visibilityObserver = null;
        start(host);
      }, { rootMargin: "300px 0px", threshold: 0 });
      visibilityObserver.observe(host);
    } else {
      start(host);
    }
    return true;
  }

  function initWatch() {
    if (document.body.dataset.viewerEmbed === "1") return;
    document.querySelectorAll("[data-saiyaara-tagembed-host]").forEach((host) => mount(host, "watch"));
  }

  window.VidBestSaiyaaraTagembed = Object.freeze({ slug: SLUG, mount });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWatch, { once: true });
  } else {
    initWatch();
  }
  window.addEventListener("pagehide", () => {
    stopMonitoring();
    visibilityObserver?.disconnect();
  });
})();