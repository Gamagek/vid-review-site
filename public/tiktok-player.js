(() => {
  const MAX_ATTEMPTS = 15;
  const POLL_INTERVAL_MS = 3000;

  function injectStyles() {
    if (document.getElementById("vidbest-tiktok-direct-player-styles")) return;
    const style = document.createElement("style");
    style.id = "vidbest-tiktok-direct-player-styles";
    style.textContent = [
      ".watch-player[data-provider=\"tiktok\"] .watch-player-stage{position:relative;width:min(100%,540px);aspect-ratio:9/16;max-height:78vh;min-height:420px;margin-inline:auto;background:#000;overflow:hidden;border-radius:18px}",
      ".watch-player[data-provider=\"tiktok\"] .vidbest-tiktok-direct-video{display:block;width:100%;height:100%;object-fit:contain;background:#000;border:0}",
      ".watch-player[data-provider=\"tiktok\"] .vidbest-tiktok-fallback-overlay{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;color:#fff;background:radial-gradient(circle at 50% 40%,rgba(30,41,59,.86),rgba(0,0,0,.97) 65%);backdrop-filter:blur(8px);box-sizing:border-box}",
      ".watch-player[data-provider=\"tiktok\"] .vidbest-tiktok-fallback-overlay[hidden]{display:none}",
      ".vidbest-tiktok-spinner{width:44px;height:44px;border:4px solid rgba(255,255,255,.22);border-top-color:#fff;border-radius:50%;animation:vidbestTikTokSpin .8s linear infinite}",
      "@keyframes vidbestTikTokSpin{to{transform:rotate(360deg)}}",
      ".vidbest-tiktok-fallback-overlay strong{font:700 17px/1.3 system-ui,sans-serif}",
      ".vidbest-tiktok-fallback-overlay span{max-width:360px;color:#cbd5e1;font:13px/1.45 system-ui,sans-serif}",
      ".vidbest-tiktok-progress{width:min(300px,82%);height:5px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden}",
      ".vidbest-tiktok-progress span{display:block;width:4%;height:100%;border-radius:inherit;background:#fff;transition:width .25s ease}",
      ".vidbest-tiktok-direct-controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;margin:10px auto 0;width:min(100%,540px);padding:8px;border:1px solid rgba(148,163,184,.18);border-radius:12px;background:rgba(5,7,13,.92);box-sizing:border-box}",
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
      "@media(max-width:640px){.watch-player[data-provider=\"tiktok\"] .watch-player-stage{width:100%;max-height:76vh;min-height:420px;border-radius:12px}.vidbest-tiktok-audio-lab{padding:12px}.vidbest-tiktok-audio-grid{grid-template-columns:1fr 1fr}}"
    ].join("");
    document.head.append(style);
  }

  function boot() {
    const playerShell = document.querySelector("#watch-player");
    const stage = playerShell?.querySelector(".watch-player-stage");
    const host = stage?.querySelector("[data-vidbest-tiktok-player]");
    const provider = String(document.body.dataset.videoProvider || "").toLowerCase();

    if (!playerShell || !stage || !host || provider !== "tiktok") return;
    if (playerShell.dataset.vidbestTikTokArchitecture === "1") return;
    playerShell.dataset.vidbestTikTokArchitecture = "1";
    injectStyles();

    const gatewayUrl = host.dataset.tiktokGatewaySrc || "";
    const shareUrl = host.dataset.tiktokShare || "";

    const overlay = document.createElement("div");
    overlay.className = "vidbest-tiktok-fallback-overlay";
    overlay.innerHTML = [
      '<div class="vidbest-tiktok-spinner" aria-hidden="true"></div>',
      '<strong data-fallback-title>Preparing video…</strong>',
      '<span data-fallback-status>Checking the Vid.Best video cache…</span>',
      '<div class="vidbest-tiktok-progress" aria-hidden="true"><span></span></div>',
      '<button type="button" class="button ghost" data-fallback-retry hidden>Retry</button>',
    ].join("");
    host.replaceWith(overlay);

    const title = overlay.querySelector("[data-fallback-title]");
    const status = overlay.querySelector("[data-fallback-status]");
    const progress = overlay.querySelector(".vidbest-tiktok-progress span");
    const retry = overlay.querySelector("[data-fallback-retry]");

    let abortController = null;
    let audioController = null;
    let directVideo = null;
    let directControls = null;

    function setOverlay(message, titleText = "Preparing video…") {
      overlay.hidden = false;
      if (title) title.textContent = titleText;
      if (status) status.textContent = message;
    }

    function clearDirectUi() {
      try { audioController?.destroy?.(); } catch {}
      audioController = null;
      playerShell.querySelector(".vidbest-tiktok-audio-lab")?.remove();
      directControls?.remove();
      directControls = null;
      directVideo?.remove();
      directVideo = null;
    }

    function makeControls(video) {
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
          try {
            const result = handler();
            if (result?.catch) result.catch(() => {});
          } catch {}
        });
        return button;
      };

      const rewind = makeButton("↶ 10s", "Rewind 10 seconds", () => {
        video.currentTime = Math.max(0, video.currentTime - 10);
      });
      const play = makeButton("▶ Play", "Play or pause", () => {
        if (video.paused) return video.play();
        video.pause();
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
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (stage.requestFullscreen) await stage.requestFullscreen();
      });

      video.addEventListener("play", () => { play.textContent = "❚❚ Pause"; });
      video.addEventListener("pause", () => { play.textContent = "▶ Play"; });
      controls.append(rewind, play, forward, speed, fullscreen);
      return controls;
    }

    async function begin() {
      abortController?.abort();
      clearDirectUi();
      retry.hidden = true;
      abortController = new AbortController();
      progress.style.width = "4%";

      if (!gatewayUrl) {
        setOverlay("This page does not have a signed gateway URL. Reload the page to create a fresh one.", "Player unavailable");
        retry.hidden = false;
        return;
      }

      if (!window.VidBestTikTokVideoService) {
        setOverlay("The TikTok video service did not load. Reload the page and try again.", "Player unavailable");
        retry.hidden = false;
        return;
      }

      try {
        const result = await window.VidBestTikTokVideoService.pollR2Video({
          gatewayUrl,
          signal: abortController.signal,
          maxAttempts: MAX_ATTEMPTS,
          intervalMs: POLL_INTERVAL_MS,
          onStatus(info) {
            const percent = Math.max(
              4,
              Math.min(96, 4 + Math.round((Number(info.attempt) / Number(info.maxAttempts)) * 92))
            );
            progress.style.width = percent + "%";

            if (info.status === "cached") {
              setOverlay("Cached video is ready. Starting the player…", "Video ready");
              return;
            }

            if (info.status === "uploading") {
              setOverlay(
                "Upload to R2 is finishing… " + info.attempt + "/" + info.maxAttempts,
                "Almost ready…"
              );
              return;
            }

            if (info.status === "queued") {
              setOverlay(
                "The cache job is queued… " + info.attempt + "/" + info.maxAttempts,
                "Preparing video…"
              );
              return;
            }

            if (info.status === "transient-error") {
              setOverlay(
                (info.message || "The gateway is temporarily unavailable.") +
                " Retrying… " + info.attempt + "/" + info.maxAttempts,
                "Connecting to video gateway…"
              );
              return;
            }

            setOverlay(
              "Preparing the video in R2… " + info.attempt + "/" + info.maxAttempts,
              "Preparing video…"
            );
          },
        });

        const video = document.createElement("video");
        video.dataset.vidbestTiktokDirect = "1";
        video.className = "vidbest-tiktok-direct-video";
        video.crossOrigin = "anonymous";
        video.setAttribute("crossorigin", "anonymous");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.controls = true;
        video.preload = "auto";
        const swipeMode = document.body.dataset.viewerEmbed === "1";
        video.autoplay = !swipeMode;
        video.src = result.streamUrl;

        video.addEventListener("error", () => {
          if (!video.error) return;
          setOverlay(
            "The cached file could not be played. Retry to request the stream again.",
            "Playback error"
          );
          retry.hidden = false;
        });

        directVideo = video;
        overlay.before(video);
        video.load();

        // The swipe viewer uses the media element's own audio. Its hidden Audio Lab
        // must not route sound through a suspended AudioContext during autoplay.
        if (!swipeMode) {
          audioController = window.VidBestAudioLab?.createAudioLab(video) || null;
          if (audioController && window.VidBestAudioLabUI) {
            window.VidBestAudioLabUI.mountAudioLab(playerShell, audioController);
          }
        }

        directControls = makeControls(video);
        stage.after(directControls);

        progress.style.width = "100%";
        setOverlay("The video is ready. Starting playback…", "Ready");

        if (swipeMode) {
          overlay.hidden = true;
          return; // The swipe bridge activates the visible card; the next card only buffers.
        }
        try {
          await video.play();
          overlay.hidden = true;
        } catch {
          setOverlay("The video is ready. Tap Play to start.", "Ready");
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("Vid.Best TikTok direct player:", error);
        const gatewayProblem = ["GATEWAY_TIMEOUT", "GATEWAY_UNREACHABLE", "GATEWAY_UNAVAILABLE"].includes(error?.code);
        setOverlay(
          error?.message || "The video could not be prepared.",
          gatewayProblem ? "Video gateway unavailable" : "Video unavailable"
        );
        retry.hidden = false;
      }
    }

    retry.addEventListener("click", () => {
      void begin();
    });

    if (shareUrl) {
      overlay.dataset.source = shareUrl;
    }

    window.addEventListener("pagehide", () => {
      abortController?.abort();
      try { audioController?.destroy?.(); } catch {}
    }, { once: true });

    void begin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
