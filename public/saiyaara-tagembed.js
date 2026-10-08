// Saiyaara-only, owner-provided Tagembed widget. No TikTok/player/v1 fallback
// or repeated requests: use the published cached poster until the vendor
// actually supplies content. Browser/third-party policy governs sound.
(() => {
  const SLUG = "saiyaara-a-cinematic-romance";
  const SCRIPT_URL = "https://widget.tagembed.com/embed.min.js";
  const WIDGET_ID = "2236794";
  const POST_ID = "5592899";
  const SCRIPT_TIMEOUT = 12000;
  let activeHost = null;
  let activeScript = null;
  let intersectionObserver = null;
  let inspectionObserver = null;
  let readyTimer = null;

  function status(host, message) {
    const label = host.querySelector("[data-saiyaara-tagembed-status]");
    if (label) label.textContent = message;
  }

  function setUi(host, mode, message) {
    host.dataset.tagembedState = mode;
    status(host, message);
    const btn = host.querySelector("[data-saiyaara-tagembed-play]");
    if (btn) {
      btn.disabled = false;
      btn.textContent = mode === "ready" ? "Play with sound" :
        mode === "failed" ? "Preview unavailable" : "Preparing video…";
      btn.hidden = mode === "failed";
    }
  }

  function cleanupObservers() {
    if (readyTimer !== null) window.clearTimeout(readyTimer);
    readyTimer = null;
    inspectionObserver?.disconnect();
    inspectionObserver = null;
  }

  function applyAutoplayPermissions(host) {
    // This permits autoplay only where the embedded provider and browser allow it.
    // We cannot access an external iframe's internal audio/video elements.
    const widget = host.querySelector(".tagembed-widget");
    if (!widget) return false;
    const frames = widget.querySelectorAll("iframe");
    for (const iframe of frames) {
      const previous = iframe.getAttribute("allow") || "";
      const permissions = new Set(previous.split(";").map((v) => v.trim()).filter(Boolean));
      permissions.add("autoplay");
      permissions.add("fullscreen");
      permissions.add("picture-in-picture");
      const allow = [...permissions].join("; ");
      if (previous !== allow) iframe.setAttribute("allow", allow);
    }
    const videos = widget.querySelectorAll("video");
    for (const video of videos) {
      video.playsInline = true;
      video.autoplay = true;
      // Muted autoplay is the mobile-browser-compatible baseline.
      if (!host.dataset.saiyaaraSoundRequested) video.muted = true;
      if (video.paused) {
        try { void video.play()?.catch(() => {}); } catch {}
      }
    }
    return frames.length > 0 || videos.length > 0 ||
      [...widget.children].some((child) => child.matches?.("article, figure, section, a, button"));
  }

  function inspect(host) {
    if (!host.isConnected) return;
    const hasContent = applyAutoplayPermissions(host);
    if (!hasContent) return;
    cleanupObservers();
    setUi(host, "ready", "Widget visible. Tap Play to request sound; embedded playback depends on Tagembed.");
    // Keep the poster until the user decides to reveal the third-party widget;
    // a loaded iframe could still be an upstream Access Denied page.
  }

  function revealAndPlay(host) {
    const widget = host.querySelector(".tagembed-widget");
    if (!widget || !applyAutoplayPermissions(host)) {
      setUi(host, "failed", "Tagembed has not provided playable content. Check widget 2236794 / post 5592899.");
      return;
    }
    host.dataset.saiyaaraSoundRequested = "1";
    host.classList.add("saiyaara-tagembed-revealed");
    host.querySelectorAll(".tagembed-widget video").forEach((video) => {
      try { video.muted = false; void video.play()?.catch(() => {}); } catch {}
    });
    status(host, "Use the embedded player's controls if sound does not start.");
  }

  function start(host) {
    if (!host?.isConnected || host.dataset.tagembedLoading === "1") return;
    if (document.hidden) return;
    if (activeHost?.isConnected && activeHost !== host) {
      setUi(host, "failed", "The Saiyaara widget is already active in another player on this page.");
      return;
    }
    // If the interactive homepage grid was replaced, allow a new single scan.
    if (activeHost && !activeHost.isConnected) {
      activeScript?.remove();
      activeScript = null;
    }
    activeHost = host;
    host.dataset.tagembedLoading = "1";
    const widget = host.querySelector(".tagembed-widget") || document.createElement("div");
    widget.className = "tagembed-widget";
    Object.assign(widget.style, { width: "100%", height: "100%", overflow: "auto" });
    Object.assign(widget.dataset, {
      widgetId: WIDGET_ID, caption: "1", header: "1", postId: POST_ID,
    });
    if (!widget.isConnected) host.prepend(widget);
    setUi(host, "loading", "Loading Saiyaara widget…");

    cleanupObservers();
    if ("MutationObserver" in window) {
      inspectionObserver = new MutationObserver(() => inspect(host));
      inspectionObserver.observe(widget, { childList: true, subtree: true });
    }
    // Count loaded media elements, NOT just the provider SDK onload.
    readyTimer = window.setTimeout(() => {
      if (host.dataset.tagembedState === "ready" || !host.isConnected) return;
      setUi(host, "failed",
        "No video was returned by Tagembed. Check that the widget is published and the post is available.");
      cleanupObservers();
    }, SCRIPT_TIMEOUT);

    // The supplied widget's JS must run after its container exists.
    if (activeScript?.isConnected) return;
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.saiyaaraTagembedScript = "1";
    script.onload = () => {
      inspect(host); // onload alone is NOT evidence of playback readiness
    };
    script.onerror = () => {
      cleanupObservers();
      setUi(host, "failed", "Tagembed could not load on this connection.");
    };
    activeScript = script;
    document.body.append(script);
  }

  function mount(host, mode = "watch") {
    if (!host || host.dataset.saiyaaraTagembedMounted === "1") return false;
    host.dataset.saiyaaraTagembedMounted = "1";
    host.dataset.tagembedState = "waiting";
    host.classList.add("saiyaara-tagembed-host", "saiyaara-tagembed-" + mode);

    const overlay = document.createElement("div");
    overlay.className = "saiyaara-tagembed-overlay";
    overlay.dataset.saiyaaraPosterOverlay = "1";
    const posterSrc = host.dataset.saiyaaraPoster || "";
    if (posterSrc) {
      const img = document.createElement("img");
      img.className = "saiyaara-tagembed-poster";
      img.src = posterSrc;
      img.loading = mode === "watch" ? "eager" : "lazy";
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("error", () => {
        // Retain the gradient fallback when a cached poster is unavailable.
        img.remove();
      }, { once: true });
      overlay.append(img);
    }
    const play = document.createElement("button");
    play.className = "saiyaara-tagembed-play";
    play.type = "button";
    play.dataset.saiyaaraTagembedPlay = "1";
    play.disabled = true;
    play.textContent = "Preparing video…";
    play.addEventListener("click", () => revealAndPlay(host));
    overlay.append(play);
    host.append(overlay);

    const label = document.createElement("p");
    label.className = "saiyaara-tagembed-status";
    label.dataset.saiyaaraTagembedStatus = "1";
    label.setAttribute("role", "status");
    label.textContent = "Saiyaara · loading preview";
    host.append(label);

    if (mode === "tile" && "IntersectionObserver" in window) {
      intersectionObserver?.disconnect();
      intersectionObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        intersectionObserver.disconnect();
        intersectionObserver = null;
        start(host);
      }, { rootMargin: "300px 0px", threshold: 0 });
      intersectionObserver.observe(host);
    } else start(host);
    return true;
  }

  function initWatch() {
    if (document.body.dataset.viewerEmbed === "1") return;
    document.querySelectorAll("[data-saiyaara-tagembed-host]").forEach((host) => mount(host, "watch"));
  }
  window.VidBestSaiyaaraTagembed = Object.freeze({ slug: SLUG, mount });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWatch, { once: true });
  } else initWatch();
  window.addEventListener("pagehide", () => {
    cleanupObservers();
    intersectionObserver?.disconnect();
  });
})();
