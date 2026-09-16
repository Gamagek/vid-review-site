import { readFile, writeFile } from "node:fs/promises";

const path = "public/watch.js";
const marker = "// VIDBEST LINKED PLAYER UPGRADE v1";
const upgrade = String.raw`

${marker}
// Unifies native uploads, direct linked media, and supported external embeds.
(() => {
  const player = document.querySelector("#watch-player");
  if (!player || window.__vidBestEnhancedPlayer) return;

  const state = window.__vidBestPlayer = window.__vidBestPlayer || {
    remoteCurrentTime: 0,
    remoteDuration: 0,
    remotePlaying: false,
    remoteRate: 1,
    remoteMuted: false,
    provider: "",
  };

  const getStage = () => player.querySelector(".watch-player-stage") || player;
  const getVideo = () => player.querySelector("video");

  function inferProvider(frame) {
    const explicit = String(document.body.dataset.videoProvider || "").toLowerCase();
    if (explicit) return explicit;
    try {
      const host = new URL(frame?.src || "").hostname.toLowerCase();
      if (host.includes("youtube")) return "youtube";
      if (host.includes("vimeo")) return "vimeo";
      if (host.includes("dailymotion")) return "dailymotion";
      if (host.includes("tiktok")) return "tiktok";
      if (host.includes("facebook")) return "facebook";
      if (host.includes("instagram")) return "instagram";
      if (host.includes("twitch")) return "twitch";
    } catch {}
    return "external";
  }

  function isDirectMediaUrl(value) {
    return /\.(?:mp4|webm|ogg|ogv|m4v|mov)(?:$|[?#])/i.test(String(value || ""));
  }

  function normalizeYouTubeFrame(frame) {
    if (!frame) return;
    try {
      const url = new URL(frame.src);
      url.searchParams.set("enablejsapi", "1");
      url.searchParams.set("playsinline", "1");
      url.searchParams.set("origin", location.origin);
      if (!url.searchParams.has("rel")) url.searchParams.set("rel", "0");
      if (!url.searchParams.has("cc_load_policy")) url.searchParams.set("cc_load_policy", "1");
      frame.src = url.toString();
    } catch {}
    frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; clipboard-write");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  }

  function maybeConvertDirectLinkedMedia() {
    const frame = player.querySelector("iframe");
    if (!frame || !isDirectMediaUrl(frame.src)) return;
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = frame.src;
    video.setAttribute("aria-label", "Linked video");
    frame.replaceWith(video);
  }

  function providerCommand(method, args = []) {
    const frame = player.querySelector("iframe");
    if (!frame) return;
    try {
      if (state.provider === "youtube") {
        frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: method, args }), "https://www.youtube.com");
        return;
      }
      if (state.provider === "vimeo") {
        const payload = method === "playVideo"
          ? { method: "play" }
          : method === "pauseVideo"
            ? { method: "pause" }
            : method === "mute"
              ? { method: "setVolume", value: 0 }
              : method === "unMute"
                ? { method: "setVolume", value: 1 }
                : method === "setPlaybackRate"
                  ? { method: "setPlaybackRate", value: Number(args[0]) }
                  : method === "seekTo"
                    ? { method: "setCurrentTime", value: Number(args[0]) }
                    : { method };
        frame.contentWindow?.postMessage(JSON.stringify(payload), "https://player.vimeo.com");
      }
    } catch (error) {
      console.debug("Provider command unavailable", error?.message || error);
    }
  }

  function sendProviderCommand(method, args = []) {
    providerCommand(method, args);
  }

  function setPlayerMessage(message) {
    const note = player.querySelector(".player-tool-note");
    if (note) note.textContent = message;
  }

  function currentTime(media) {
    if (media) return Number(media.currentTime) || 0;
    if (state.provider === "youtube") sendProviderCommand("getCurrentTime");
    return Number(state.remoteCurrentTime) || 0;
  }

  function duration(media) {
    if (media && Number.isFinite(media.duration)) return media.duration;
    return Number(state.remoteDuration) || 0;
  }

  function seekBy(delta) {
    const media = getVideo();
    const next = Math.max(0, currentTime(media) + delta);
    const end = duration(media);
    const target = end > 0 ? Math.min(end, next) : next;
    if (media) media.currentTime = target;
    else if (["youtube", "vimeo"].includes(state.provider)) sendProviderCommand("seekTo", [target, true]);
  }

  function toggleFloating() {
    const anchor = document.querySelector("#watch-player-anchor");
    if (!anchor) return false;
    const enabled = !player.classList.contains("is-mini");
    if (enabled) {
      anchor.style.height = `${player.offsetHeight}px`;
      anchor.classList.add("is-active");
      player.classList.add("is-mini");
    } else {
      player.classList.remove("is-mini");
      anchor.classList.remove("is-active");
      anchor.style.height = "";
    }
    return enabled;
  }

  function setupMediaSession(title, media) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: title.slice(0, 120), artist: "Vid.Best", album: "Vid.Best" });
      const action = (name, handler) => {
        try { navigator.mediaSession.setActionHandler(name, handler); } catch {}
      };
      action("play", async () => { if (media) await media.play(); else sendProviderCommand("playVideo"); });
      action("pause", () => { if (media) media.pause(); else sendProviderCommand("pauseVideo"); });
      action("seekbackward", () => seekBy(-10));
      action("seekforward", () => seekBy(10));
      action("seekto", (event) => {
        const target = Number(event?.seekTime);
        if (!Number.isFinite(target)) return;
        if (media) media.currentTime = target;
        else sendProviderCommand("seekTo", [target, true]);
      });
      action("stop", () => { if (media) media.pause(); else sendProviderCommand("pauseVideo"); });
      action("enterpictureinpicture", async () => {
        if (!media || !document.pictureInPictureEnabled || typeof media.requestPictureInPicture !== "function") return;
        try { await media.requestPictureInPicture(); } catch {}
      });
    } catch {}
  }

  function makeButton(label, title, handler, disabled = false) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "button ghost";
    el.textContent = label;
    el.title = title;
    el.setAttribute("aria-label", title);
    el.disabled = disabled;
    el.addEventListener("click", () => void handler());
    return el;
  }

  function installCss() {
    if (document.querySelector("#vidbest-player-upgrade-css")) return;
    const style = document.createElement("style");
    style.id = "vidbest-player-upgrade-css";
    style.textContent = `
      #watch-player .player-tools { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin-top:.75rem; }
      #watch-player .player-tools .button { min-height:40px; }
      #watch-player .player-tool-note { flex-basis:100%; margin:.15rem 0 0; }
    `;
    document.head.append(style);
  }

  function buildTools() {
    player.querySelector(".player-tools")?.remove();
    const media = getVideo();
    const frame = player.querySelector("iframe");
    const stage = getStage();
    if (!media && !frame) return;
    const remoteSupported = ["youtube", "vimeo"].includes(state.provider);
    const tools = document.createElement("div");
    tools.className = "watch-reactions player-tools";
    tools.setAttribute("aria-label", "Video playback controls");

    const playPause = makeButton("▶ Play", "Play or pause", async () => {
      if (media) {
        if (media.paused) await media.play(); else media.pause();
      } else if (remoteSupported) {
        if (state.remotePlaying) sendProviderCommand("pauseVideo"); else sendProviderCommand("playVideo");
        setTimeout(() => { sendProviderCommand("getPlayerState"); }, 100);
      }
    });
    const rewind = makeButton("↶ 10s", "Rewind 10 seconds", () => seekBy(-10), !media && !remoteSupported);
    const forward = makeButton("10s ↷", "Forward 10 seconds", () => seekBy(10), !media && !remoteSupported);

    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const speed = makeButton("1× speed", "Cycle playback speed", () => {
      const current = media ? Number(media.playbackRate || 1) : Number(state.remoteRate || 1);
      let index = rates.findIndex((value) => Math.abs(value - current) < 0.01);
      index = (index + 1) % rates.length;
      const next = rates[index];
      if (media) media.playbackRate = next;
      else { state.remoteRate = next; sendProviderCommand("setPlaybackRate", [next]); }
      speed.textContent = `${next}× speed`;
    }, !media && !remoteSupported);

    const zoom = makeButton("1× zoom", "Cycle video zoom", () => {
      const values = [1, 1.25, 1.5, 2];
      const current = Number(player.dataset.zoom || 1);
      let index = values.findIndex((value) => Math.abs(value - current) < 0.01);
      index = (index + 1) % values.length;
      const next = values[index];
      player.dataset.zoom = String(next);
      const target = media || frame;
      if (target) target.style.transform = `scale(${next})`;
      zoom.textContent = `${next}× zoom`;
    });

    const captions = makeButton("CC", "Captions", () => {
      if (media) {
        const tracks = [...media.textTracks];
        if (!tracks.length) { setPlayerMessage("No stored caption track is available yet."); return; }
        const showing = tracks.some((track) => track.mode === "showing");
        tracks.forEach((track, index) => { track.mode = !showing && index === 0 ? "showing" : "hidden"; });
        captions.textContent = showing ? "CC off" : "CC on";
      } else {
        setPlayerMessage(`${state.provider === "youtube" ? "YouTube" : "Linked provider"} captions are controlled by the provider player.`);
        frame?.focus();
      }
    });

    const translate = makeButton("Translate", "Translate captions", () => {
      setPlayerMessage("Caption translation will activate when Vid.Best receives a caption track from the Teamwork transcription/translation engine.");
    }, true);

    const mute = makeButton(media?.muted || state.remoteMuted ? "Unmute" : "Mute", "Mute or unmute", () => {
      if (media) {
        media.muted = !media.muted;
        mute.textContent = media.muted ? "Unmute" : "Mute";
      } else if (remoteSupported) {
        if (state.remoteMuted) { sendProviderCommand("unMute"); state.remoteMuted = false; mute.textContent = "Mute"; }
        else { sendProviderCommand("mute"); state.remoteMuted = true; mute.textContent = "Unmute"; }
      } else setPlayerMessage("Mute control is supplied by the linked provider.");
    });

    const popout = makeButton("Pop-out", "Open the video in the floating player", () => {
      popout.textContent = toggleFloating() ? "Return" : "Pop-out";
    });

    const pip = makeButton("▣ PiP", "Picture in picture", async () => {
      if (!media || !document.pictureInPictureEnabled || typeof media.requestPictureInPicture !== "function") {
        setPlayerMessage("Browser Picture-in-Picture is available for native/direct media when supported. For linked providers, use Pop-out or the provider's own PiP control.");
        return;
      }
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await media.requestPictureInPicture();
      } catch { setPlayerMessage("Picture-in-Picture was not available in this browser/session."); }
    }, !media);

    const fullscreen = makeButton("Fullscreen", "Toggle fullscreen", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (stage.requestFullscreen) await stage.requestFullscreen();
      } catch { setPlayerMessage("Fullscreen is unavailable for this linked provider."); }
    });
    const share = makeButton("Share", "Share this video", () => {
      if (typeof shareWatchPage === "function") void shareWatchPage();
    });

    tools.append(rewind, playPause, forward, speed, zoom, captions, translate, mute, popout, pip, fullscreen, share);
    const note = document.createElement("p");
    note.className = "form-status player-tool-note";
    note.textContent = media
      ? "Full native controls enabled. Background/lock-screen playback follows browser and device policy."
      : remoteSupported
        ? `Linked ${state.provider} controls enabled where the provider API allows. Provider policies still apply to background playback and PiP.`
        : "Linked provider controls remain available. Vid.Best supplies pop-out, fullscreen and sharing; advanced remote controls depend on provider support.";
    tools.append(note);
    stage.insertAdjacentElement("afterend", tools);

    if (media) {
      media.addEventListener("play", () => { playPause.textContent = "❚❚ Pause"; state.remotePlaying = true; });
      media.addEventListener("pause", () => { playPause.textContent = "▶ Play"; state.remotePlaying = false; });
      media.addEventListener("ratechange", () => { speed.textContent = `${Number(media.playbackRate || 1)}× speed`; });
      setupMediaSession(document.title, media);
    } else {
      setupMediaSession(document.title, null);
      if (state.provider === "youtube") {
        sendProviderCommand("getCurrentTime");
        sendProviderCommand("getDuration");
      }
    }
  }

  maybeConvertDirectLinkedMedia();
  const frame = player.querySelector("iframe");
  state.provider = inferProvider(frame);
  if (state.provider === "youtube") normalizeYouTubeFrame(frame);
  if (frame) frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
  installCss();
  buildTools();
  window.__vidBestEnhancedPlayer = true;

  window.addEventListener("message", (event) => {
    const activeFrame = player.querySelector("iframe");
    if (!activeFrame || event.source !== activeFrame.contentWindow || typeof event.data !== "string") return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (state.provider === "youtube" && data.event === "infoDelivery" && data.info) {
      if (Number.isFinite(Number(data.info.currentTime))) state.remoteCurrentTime = Number(data.info.currentTime);
      if (Number.isFinite(Number(data.info.duration))) state.remoteDuration = Number(data.info.duration);
      if (Number.isFinite(Number(data.info.playerState))) state.remotePlaying = Number(data.info.playerState) === 1;
    }
  });

  const media = getVideo();
  if (media) {
    try {
      const metadata = new MediaMetadata({ title: document.title.slice(0, 120), artist: "Vid.Best" });
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = metadata;
    } catch {}
  }
})();
`;

const existing = await readFile(path, "utf8");
if (!existing.includes(marker)) await writeFile(path, existing.trimEnd() + upgrade, "utf8");
