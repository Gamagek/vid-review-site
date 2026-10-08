// Saiyaara-only direct Tagembed iframe. The user's iframe URL is the source
// of truth; no embed.min.js scanner, TikTok/player/v1, or video-file proxy.
// External video playback, autoplay and sound are controlled by the provider
// and the visitor's browser.
(() => {
  const SLUG = "saiyaara-a-cinematic-romance";
  const IFRAME_URL = "https://widget.tagembed.com/2236794?postId=5592899&caption=1&header=1";
  const LOAD_TIMEOUT = 14000;
  let observer = null;

  function state(host, kind, message) {
    if (!host?.isConnected) return;
    host.dataset.tagembedState = kind;
    const label = host.querySelector("[data-saiyaara-tagembed-status]");
    if (label) {
      label.textContent = message || "";
      label.hidden = !message;
    }
  }

  function connect(host, iframe) {
    if (!iframe || iframe.dataset.tagembedTracked === "1") return;
    iframe.dataset.tagembedTracked = "1";
    let loaded = false;
    const timeout = window.setTimeout(() => {
      if (loaded || !host.isConnected) return;
      // Do not tear down a potentially slow player or auto-retry the provider.
      state(host, "slow", "Tagembed has not finished loading. Its video may be unavailable.");
    }, LOAD_TIMEOUT);

    iframe.addEventListener("load", () => {
      loaded = true;
      window.clearTimeout(timeout);
      // An iframe load can also be an upstream access-error page. Do not
      // report playback success merely because this event fired.
      state(host, "frame-loaded", "");
    }, { once: true });
    iframe.addEventListener("error", () => {
      loaded = true;
      window.clearTimeout(timeout);
      state(host, "failed", "Tagembed could not load the video on this connection.");
    }, { once: true });
    // For main watch-page iframe, src is present from the server markup.
    // The iframe itself stays clickable and no poster overlay blocks it.
  }

  function prepareHost(host, mode) {
    host.classList.add("saiyaara-tagembed-host", "saiyaara-tagembed-" + mode);
    if (!host.querySelector(".saiyaara-tagembed-poster") && host.dataset.saiyaaraPoster) {
      const poster = document.createElement("img");
      poster.className = "saiyaara-tagembed-poster";
      poster.src = host.dataset.saiyaaraPoster;
      poster.alt = "";
      poster.decoding = "async";
      poster.loading = mode === "watch" ? "eager" : "lazy";
      host.prepend(poster);
    }
    if (!host.querySelector("[data-saiyaara-tagembed-status]")) {
      const label = document.createElement("span");
      label.className = "saiyaara-tagembed-status";
      label.dataset.saiyaaraTagembedStatus = "1";
      label.setAttribute("role", "status");
      label.textContent = "";
      label.hidden = true;
      host.append(label);
    }
  }

  function mount(host, mode = "watch") {
    if (!host || host.dataset.saiyaaraTagembedMounted === "1") return false;
    host.dataset.saiyaaraTagembedMounted = "1";
    prepareHost(host, mode);

    const iframe = host.querySelector("iframe.saiyaara-tagembed-frame") ||
      document.createElement("iframe");
    iframe.className = "saiyaara-tagembed-frame";
    iframe.title = "Saiyaara video via Tagembed";
    iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.setAttribute("loading", "eager");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.overflow = "auto";
    iframe.style.border = "none";

    // Always attach lifecycle monitoring before adding src on dynamically
    // mounted tiles. The watch iframe may already have started loading.
    if (!iframe.isConnected) host.append(iframe);
    connect(host, iframe);
    const current = iframe.getAttribute("src");
    if (!current) iframe.setAttribute("src", IFRAME_URL);
    return true;
  }

  function initWatch() {
    if (document.body?.dataset.viewerEmbed === "1") return;
    document.querySelectorAll("[data-saiyaara-tagembed-host]").forEach(
      (host) => mount(host, "watch"));
  }

  function mountTileWhenVisible(host) {
    if (!host || host.dataset.saiyaaraTagembedMounted === "1") return;
    prepareHost(host, "tile");
    if (!("IntersectionObserver" in window)) {
      mount(host, "tile");
      return;
    }
    const localObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      localObserver.disconnect();
      mount(host, "tile");
    }, { rootMargin: "300px 0px", threshold: 0 });
    // Each tile owns its observer; no other TikTok tiles are scanned.
    localObserver.observe(host);
    observer = localObserver;
  }

  window.VidBestSaiyaaraTagembed = Object.freeze({
    slug: SLUG, iframeUrl: IFRAME_URL,
    mount: (host, mode = "watch") => mode === "tile"
      ? mountTileWhenVisible(host)
      : mount(host, mode),
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWatch, { once: true });
  } else initWatch();
  window.addEventListener("pagehide", () => observer?.disconnect());
})();
