// Saiyaara-only direct Tagembed iframe. The user's iframe URL is the source
// of truth; this integration does not require a vendor SDK or proxy.
// External video playback, autoplay and sound are controlled by the provider
// and the visitor's browser.
(() => {
  const SLUG = "saiyaara-a-cinematic-romance";
  const IFRAME_URL = "https://widget.tagembed.com/2236794?postId=5592899&caption=1&header=1";
  const LOAD_TIMEOUT = 6000;
  const WATCH_TIMEOUT = 14000;

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
    const tile = host.dataset.saiyaaraMode === "tile";
    let loaded = false;
    const timeout = window.setTimeout(() => {
      if (!host.isConnected || !iframe.isConnected || (!tile && loaded)) return;
      // A cross-origin frame load is NOT a video-playing event. Keep a working
      // player intact and reveal a user-selected backup, never auto-switch.
      state(host, "slow", tile ? "Not playing? You can try the backup player." : "Tagembed is taking longer than usual.");
      if (tile) {
        const backup = host.querySelector("[data-saiyaara-backup]");
        if (backup) backup.hidden = false;
      }
    }, tile ? LOAD_TIMEOUT : WATCH_TIMEOUT);

    iframe.addEventListener("load", () => {
      loaded = true;
      if (!tile) window.clearTimeout(timeout);
      // Do not infer playback success; keep the six-second opt-in backup timer
      // for the mini tile even when iframe HTML loads successfully.
      state(host, "frame-loaded", "");
    }, { once: true });
    iframe.addEventListener("error", () => {
      loaded = true;
      window.clearTimeout(timeout);
      state(host, "failed", "Tagembed could not load the video on this connection.");
      if (tile) {
        const backup = host.querySelector("[data-saiyaara-backup]");
        if (backup) backup.hidden = false;
      }
    }, { once: true });
    // For main watch-page iframe, src is present from the server markup.
    // The iframe itself stays clickable and no poster overlay blocks it.
  }

  function prepareHost(host, mode) {
    host.classList.add("saiyaara-tagembed-host", "saiyaara-tagembed-" + mode);
    // Mini tiles have only ~230px of vertical room for a tall social post.
    // Show a correctly fitted poster until the visitor reveals the embedded
    // player. A tap provides a genuine gesture, but cross-origin sound still
    // depends on the browser/provider controls.
    if (mode === "tile" && !host.querySelector(".saiyaara-preview-cover")) {
      const cover = document.createElement("button");
      cover.type = "button";
      cover.className = "saiyaara-preview-cover";
      cover.setAttribute("aria-label", "Show Saiyaara video player and sound controls");
      if (host.dataset.saiyaaraPoster) {
        const img = document.createElement("img");
        img.className = "saiyaara-tile-cover-poster";
        img.src = host.dataset.saiyaaraPoster;
        img.alt = "";
        img.loading = "lazy";
        cover.append(img);
      }
      const icon = document.createElement("span");
      icon.textContent = "▶";
      icon.setAttribute("aria-hidden", "true");
      cover.append(icon);
      cover.addEventListener("click", () => {
        cover.hidden = true;
        mountTilePlayer(host);
        const iframe = host.querySelector(".saiyaara-tagembed-frame");
        // Browsers do not expose a third-party video's audio controls to us.
        // The visitor can now tap the embedded player's controls directly.
        iframe?.focus();
      });
      host.append(cover);
    }
    if (mode === "tile" && !host.querySelector("[data-saiyaara-backup]")) {
      const backup = document.createElement("button");
      backup.type = "button";
      backup.className = "saiyaara-tagembed-backup";
      backup.dataset.saiyaaraBackup = "1";
      backup.textContent = "Try backup player";
      backup.hidden = true;
      backup.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const source = host.dataset.saiyaaraSource;
        const player = window.VidBestTikTok;
        if (!source || !player?.parse?.(source) || typeof player.showPreview !== "function") {
          state(host, "failed", "Backup is unavailable. Open the video review for the source link.");
          return;
        }
        // Do not keep Tagembed running behind the gateway popup.
        host.querySelector("iframe.saiyaara-tagembed-frame")?.remove();
        const cover = host.querySelector(".saiyaara-preview-cover");
        if (cover) cover.hidden = false;
        backup.hidden = true;
        void player.showPreview(source, { title: "Saiyaara", author: "TikTok creator" });
      });
      host.append(backup);
    }
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

  function mountTilePlayer(host) {
    if (!host?.isConnected) return false;
    if (host.querySelector("iframe.saiyaara-tagembed-frame")) return true;
    const iframe = document.createElement("iframe");
    iframe.className = "saiyaara-tagembed-frame";
    iframe.title = "Saiyaara video via Tagembed";
    iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.setAttribute("loading", "eager");
    host.append(iframe);
    connect(host, iframe);
    iframe.setAttribute("src", IFRAME_URL);
    state(host, "loading", "Loading TikTok video…");
    return true;
  }

  function mountTileWhenVisible(host) {
    if (!host || host.dataset.saiyaaraTagembedMounted === "1") return false;
    host.dataset.saiyaaraTagembedMounted = "1";
    host.dataset.saiyaaraMode = "tile";
    prepareHost(host, "tile");
    // No observer: scrolling, hovering, and thumbnail rendering MUST NOT
    // create a Tagembed iframe or consume widget loads.
    return true;
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
  // The watch player is retained; mini tiles never background-load a widget.
})();
