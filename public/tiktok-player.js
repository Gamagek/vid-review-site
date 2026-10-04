(() => {
  const OFFICIAL_GRACE_MS = 8000;
  const MAX_ATTEMPTS = 15;
  const POLL_INTERVAL_MS = 3000;

  function boot() {
    const playerShell = document.querySelector("#watch-player");
    const stage = playerShell?.querySelector(".watch-player-stage");
    const frame = stage?.querySelector("iframe.tiktok-official-player");
    const provider = String(document.body.dataset.videoProvider || "").toLowerCase();

    if (!playerShell || !stage || !frame || provider !== "tiktok") return;
    if (playerShell.dataset.vidbestTikTokArchitecture === "1") return;
    playerShell.dataset.vidbestTikTokArchitecture = "1";

    const gatewayUrl = frame.dataset.tiktokGatewaySrc || "";
    const shareUrl = frame.dataset.tiktokShare || "";

    const overlay = document.createElement("div");
    overlay.className = "vidbest-tiktok-fallback-overlay";
    overlay.hidden = true;
    overlay.innerHTML = [
      '<div class="vidbest-tiktok-spinner" aria-hidden="true"></div>',
      '<strong data-fallback-title>Preparing video…</strong>',
      '<span data-fallback-status>Checking R2 cache…</span>',
      '<div class="vidbest-tiktok-progress" aria-hidden="true"><span></span></div>',
      '<button type="button" class="button ghost" data-fallback-retry hidden>Retry</button>',
    ].join("");

    stage.append(overlay);

    const title = overlay.querySelector("[data-fallback-title]");
    const status = overlay.querySelector("[data-fallback-status]");
    const progress = overlay.querySelector(".vidbest-tiktok-progress span");
    const retry = overlay.querySelector("[data-fallback-retry]");

    let officialReady = false;
    let fallbackStarted = false;
    let fallbackTimer = null;
    let abortController = null;

    function setOverlay(message, titleText) {
      overlay.hidden = false;
      if (title) title.textContent = titleText || "Preparing video…";
      if (status) status.textContent = message || "Working…";
    }

    function hideOverlay() {
      overlay.hidden = true;
    }

    function onOfficialReady() {
      officialReady = true;
      if (!fallbackStarted) {
        window.clearTimeout(fallbackTimer);
        hideOverlay();
      }
    }

    function addDirectControls(video) {
      const controls = document.createElement("div");
      controls.className = "vidbest-tiktok-direct-controls";
      controls.setAttribute("aria-label", "Vid.Best TikTok playback controls");

      const makeButton = (label, aria, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button ghost";
        button.textContent = label;
        button.setAttribute("aria-label", aria);
        button.addEventListener("click", () => {
          try { handler(); } catch {}
        });
        return button;
      };

      const rewind = makeButton("↶ 10s", "Rewind 10 seconds", () => {
        video.currentTime = Math.max(0, video.currentTime - 10);
      });

      const play = makeButton("▶ Play", "Play or pause", () => {
        if (video.paused) void video.play().catch(() => {});
        else video.pause();
      });

      const forward = makeButton("10s ↷", "Forward 10 seconds", () => {
        const duration = Number.isFinite(video.duration) ? video.duration : video.currentTime + 10;
        video.currentTime = Math.min(duration, video.currentTime + 10);
      });

      const speed = makeButton("1×", "Change playback speed", () => {
        const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const currentIndex = Math.max(0, rates.indexOf(video.playbackRate));
        const next = rates[(currentIndex + 1) % rates.length];
        video.playbackRate = next;
        speed.textContent = next + "×";
      });

      const fullscreen = makeButton("Fullscreen", "Toggle fullscreen", async () => {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          return;
        }
        if (stage.requestFullscreen) await stage.requestFullscreen();
      });

      play.addEventListener("click", () => {
        window.setTimeout(() => {
          play.textContent = video.paused ? "▶ Play" : "❚❚ Pause";
        }, 0);
      });

      video.addEventListener("play", () => { play.textContent = "❚❚ Pause"; });
      video.addEventListener("pause", () => { play.textContent = "▶ Play"; });
      controls.append(rewind, play, forward, speed, fullscreen);
      return controls;
    }

    async function startFallback(reason) {
      if (fallbackStarted || officialReady) return;
      fallbackStarted = true;
      window.clearTimeout(fallbackTimer);

      setOverlay("Starting R2 preparation…", reason || "Loading cached media");
      progress.style.width = "5%";

      frame.hidden = true;

      const existing = stage.querySelector("video[data-vidbest-tiktok-direct]");
      const video = existing || document.createElement("video");

      video.dataset.vidbestTiktokDirect = "1";
      video.className = "vidbest-tiktok-direct-video";
      video.setAttribute("crossorigin", "anonymous");
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("controls", "");
      video.preload = "auto";
      video.autoplay = false;

      if (!existing) {
        stage.insertBefore(video, overlay);
      }

      retry.hidden = true;

      if (!gatewayUrl) {
        setOverlay("The signed video gateway is unavailable.", "Fallback unavailable");
        retry.hidden = false;
        return;
      }

      if (!window.VidBestTikTokVideoService) {
        setOverlay("The video service module could not load.", "Player error");
        retry.hidden = false;
        return;
      }

      abortController?.abort();
      abortController = new AbortController();

      try {
        const result = await window.VidBestTikTokVideoService.pollR2Video({
          gatewayUrl,
          signal: abortController.signal,
          maxAttempts: MAX_ATTEMPTS,
          intervalMs: POLL_INTERVAL_MS,
          onStatus(info) {
            const percent = Math.max(
              5,
              Math.min(
                96,
                5 + Math.round((Number(info.attempt) / Number(info.maxAttempts)) * 91)
              )
            );
            progress.style.width = percent + "%";

            if (info.status === "cached") {
              setOverlay("R2 video is ready. Starting playback…", "Video ready");
              return;
            }

            if (info.status === "transient-error") {
              setOverlay(
                "The gateway is busy. Retrying in 3 seconds… (" +
                info.attempt +
                "/" +
                info.maxAttempts +
                ")",
                "Preparing video…"
              );
              return;
            }

            setOverlay(
              "Downloading to R2… retry " +
              info.attempt +
              "/" +
              info.maxAttempts +
              " · this can take a few seconds",
              "Preparing video…"
            );
          },
        });

        video.src = result.streamUrl;
        video.load();

        const audioController = window.VidBestAudioLab?.createAudioLab(video);
        if (audioController && window.VidBestAudioLabUI) {
          window.VidBestAudioLabUI.mountAudioLab(playerShell, audioController);
        }

        const controls = addDirectControls(video);
        const oldControls = playerShell.querySelector(".vidbest-tiktok-direct-controls");
        oldControls?.remove();
        stage.append(controls);

        video.hidden = false;
        progress.style.width = "100%";
        setOverlay("Video loaded. Playback is ready.", "Ready");

        try {
          await video.play();
          hideOverlay();
        } catch {
          setOverlay("The video is ready. Tap Play to start.", "Ready");
          retry.hidden = true;
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("Vid.Best TikTok fallback:", error);
        setOverlay(
          error?.message || "The video could not be prepared.",
          "Video unavailable"
        );
        retry.hidden = false;
      }
    }

    retry.addEventListener("click", () => {
      fallbackStarted = false;
      officialReady = false;
      if (abortController) {
        abortController.abort();
        abortController = null;
      }

      const oldVideo = stage.querySelector("video[data-vidbest-tiktok-direct]");
      oldVideo?.remove();

      const oldAudio = playerShell.querySelector(".vidbest-tiktok-audio-lab");
      oldAudio?.remove();

      const oldControls = stage.querySelector(".vidbest-tiktok-direct-controls");
      oldControls?.remove();

      frame.hidden = false;
      retry.hidden = true;
      setOverlay("Checking the video gateway…", "Trying again");
      void startFallback("Retrying video preparation");
    });

    const onMessage = (event) => {
      if (event.source !== frame.contentWindow) return;

      let data = event.data;
      try {
        if (typeof data === "string") data = JSON.parse(data);
      } catch {
        return;
      }

      if (!data?.["x-tiktok-player"]) return;

      if (data.type === "onPlayerReady") {
        onOfficialReady();
        return;
      }

      if (data.type === "onPlayerError") {
        if (!officialReady) {
          void startFallback("TikTok reported a playback error");
        }
      }
    };

    window.addEventListener("message", onMessage);

    frame.addEventListener("error", () => {
      if (!officialReady) void startFallback("TikTok official player failed to load");
    });

    frame.addEventListener("load", () => {
      if (!officialReady && !fallbackStarted) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = window.setTimeout(() => {
          if (!officialReady && !fallbackStarted) {
            void startFallback("TikTok official player did not become ready");
          }
        }, OFFICIAL_GRACE_MS);
      }
    });

    fallbackTimer = window.setTimeout(() => {
      if (!officialReady && !fallbackStarted) {
        void startFallback("TikTok official player did not become ready");
      }
    }, OFFICIAL_GRACE_MS);

    if (frame.contentWindow) {
      try {
        frame.focus();
      } catch {}
    }

    window.addEventListener("pagehide", () => {
      window.clearTimeout(fallbackTimer);
      abortController?.abort();
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();