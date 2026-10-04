(() => {
  const OFFICIAL_GRACE_MS = 8000;
  const MAX_ATTEMPTS = 15;
  const POLL_INTERVAL_MS = 3000;

  function injectStyles() {
    if (document.getElementById("vidbest-tiktok-direct-player-styles")) return;
    const style = document.createElement("style");
    style.id = "vidbest-tiktok-direct-player-styles";
    style.textContent = [
      ".watch-player[data-provider=\"tiktok\"] .watch-player-stage{position:relative;width:min(100%,540px);height:min(78vh,760px);min-height:480px;margin-inline:auto;background:#000;overflow:hidden}",
      ".watch-player[data-provider=\"tiktok\"] .tiktok-official-player{display:block;width:100%;height:100%;border:0;background:#000}",
      ".watch-player[data-provider=\"tiktok\"] .vidbest-tiktok-direct-video{display:block;width:100%;height:100%;object-fit:contain;background:#000;border:0}",
      ".watch-player[data-provider=\"tiktok\"] .vidbest-tiktok-fallback-overlay{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;color:#fff;background:rgba(0,0,0,.82);backdrop-filter:blur(8px);box-sizing:border-box}",
      ".watch-player[data-provider=\"tiktok\"] .vidbest-tiktok-fallback-overlay[hidden]{display:none}",
      ".vidbest-tiktok-spinner{width:42px;height:42px;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:vidbestTikTokSpin .8s linear infinite}",
      "@keyframes vidbestTikTokSpin{to{transform:rotate(360deg)}}",
      ".vidbest-tiktok-fallback-overlay strong{font:700 16px/1.3 system-ui,sans-serif}",
      ".vidbest-tiktok-fallback-overlay span{max-width:340px;color:#cbd5e1;font:13px/1.45 system-ui,sans-serif}",
      ".vidbest-tiktok-progress{width:min(280px,80%);height:4px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden}",
      ".vidbest-tiktok-progress span{display:block;width:0;height:100%;border-radius:inherit;background:#fff;transition:width .25s ease}",
      ".vidbest-tiktok-direct-controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;padding:8px;border:1px solid rgba(148,163,184,.18);border-radius:12px;background:rgba(5,7,13,.92)}",
      ".vidbest-tiktok-direct-controls .button{min-height:32px}",
      ".vidbest-tiktok-audio-lab{width:min(100%,760px);margin:12px auto 0;padding:16px;border:1px solid rgba(148,163,184,.2);border-radius:16px;background:linear-gradient(135deg,rgba(8,12,22,.98),rgba(18,25,40,.92));color:#eef2ff;box-sizing:border-box}",
      ".vidbest-tiktok-audio-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px}",
      ".vidbest-tiktok-audio-head p{margin:0 0 3px;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8}",
      ".vidbest-tiktok-audio-head h2{margin:0;font:700 18px/1.2 system-ui,sans-serif}",
      ".vidbest-tiktok-audio-head small{display:block;margin-top:5px;color:#94a3b8;font:12px/1.35 system-ui,sans-serif}",
      ".vidbest-tiktok-audio-head button,.vidbest-tiktok-audio-lab button{border:1px solid rgba(148,163,184,.25);border-radius:9px;background:rgba(30,41,59,.85);color:#fff;padding:7px 10px;cursor:pointer}",
      ".vidbest-tiktok-audio-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}",
      ".vidbest-tiktok-audio-grid label{display:grid;gap:6px;color:#cbd5e1;font:12px/1.2 system-ui,sans-serif}",
      ".vidbest-tiktok-audio-grid output{font-weight:700;color:#fff}",
      ".vidbest-tiktok-audio-grid input{width:100%;accent-color:#fff}",
      ".vidbest-tiktok-audio-status{margin:12px 0 0;color:#94a3b8;font:12px/1.4 system-ui,sans-serif}",
      ".vidbest-tiktok-audio-status[data-tone=\"ok\"]{color:#bbf7d0}",
      ".vidbest-tiktok-audio-status[data-tone=\"warn\"]{color:#fde68a}",
      "@media(max-width:640px){.watch-player[data-provider=\"tiktok\"] .watch-player-stage{width:100%;height:min(78vh,calc((100vw - 24px)*1.7778));min-height:420px}.vidbest-tiktok-direct-controls{justify-content:center}.vidbest-tiktok-audio-lab{padding:12px}.vidbest-tiktok-audio-grid{grid-template-columns:1fr 1fr}}"
    ].join("");
    document.head.append(style);
  }

  function boot() {
    const playerShell = document.querySelector("#watch-player");
    const stage = playerShell?.querySelector(".watch-player-stage");
    const frame = stage?.querySelector("iframe.tiktok-official-player");
    const provider = String(document.body.dataset.videoProvider || "").toLowerCase();

    if (!playerShell || !stage || !frame || provider !== "tiktok") return;
    if (playerShell.dataset.vidbestTikTokArchitecture === "1") return;
    playerShell.dataset.vidbestTikTokArchitecture = "1";
    injectStyles();

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
    let audioController = null;

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
      video.hidden = true;

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

        audioController?.destroy?.();
        audioController = window.VidBestAudioLab?.createAudioLab(video) || null;
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
      audioController?.destroy?.();
      audioController = null;
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
        void startFallback("TikTok reported a playback error");
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