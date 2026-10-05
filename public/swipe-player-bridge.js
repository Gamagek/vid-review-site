// Playback lifecycle for a prepared swipe card. Hidden cards must stay paused.
(() => {
  if (document.body.dataset.viewerEmbed !== "1") return;
  const origin = new URL(document.baseURI).origin;
  const provider = document.body.dataset.videoProvider;
  const stage = document.querySelector(".watch-player-stage");
  const frame = stage?.querySelector("iframe");
  let active = false, paused = false, muted = true, ready = false, player, native;
  const send = (type, detail = {}) => parent.postMessage({ channel: "vidbest-player", type, ...detail }, origin);
  const state = (playing) => send("state", { playing, muted });
  function apply() {
    const play = active && !paused;
    if (native) {
      native.muted = muted;
      if (play) native.play().catch(() => send("blocked"));
      else native.pause();
    } else if (ready && provider === "youtube") {
      muted ? player.mute() : player.unMute();
      play ? player.playVideo() : player.pauseVideo();
    } else if (ready && provider === "vimeo") {
      player.setMuted(muted).catch(() => {});
      (play ? player.play() : player.pause()).catch(() => { if (play) send("blocked"); });
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== origin || event.data?.channel !== "vidbest-viewer") return;
    if (event.data.type !== "playback") return;
    active = event.data.active === true;
    paused = event.data.paused === true;
    muted = event.data.muted !== false;
    document.body.dataset.viewerActive = active ? "1" : "0";
    apply();
  });
  function watchVideo(video) {
    if (video.dataset.swipeManaged) return;
    video.dataset.swipeManaged = "1";
    native = video; video.autoplay = false; video.preload = "auto";
    video.playsInline = true; video.muted = true;
    const onReady = () => { ready = true; send("ready", { controllable: true }); apply(); };
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("playing", () => {
      if (!active || paused) { video.pause(); return; }
      state(true);
    });
    video.addEventListener("pause", () => state(false));
    video.addEventListener("volumechange", () => { muted = video.muted; state(!video.paused); });
    video.addEventListener("ended", () => { state(false); if (active) send("ended"); });
    video.addEventListener("error", () => send("error", { message: "This video could not load. Retry or swipe to the next video." }));
    if (video.readyState >= 2) onReady();
    else apply();
  }
  stage?.querySelectorAll("video").forEach(watchVideo);
  if (stage) new MutationObserver(() => stage.querySelectorAll("video").forEach(watchVideo))
    .observe(stage, { childList: true, subtree: true });
  function loadScript(src) {
    const script = document.createElement("script"); script.src = src;
    script.onerror = () => send("ready", { controllable: false });
    document.head.append(script); return script;
  }
  if (frame && provider === "youtube") {
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player(frame, { events: {
        onReady() { ready = true; send("ready", { controllable: true }); apply(); },
        onStateChange(event) {
          if (event.data === 1 && (!active || paused)) { player.pauseVideo(); return; }
          if (event.data === 1 || event.data === 2) state(event.data === 1);
          if (event.data === 0 && active) send("ended");
        },
        onAutoplayBlocked() { if (active) send("blocked"); },
        onError() { send("error", { message: "YouTube could not play this video. Try its player controls or swipe to the next video." }); },
      } });
    };
    loadScript("https://www.youtube.com/iframe_api");
  } else if (frame && provider === "vimeo") {
    loadScript("https://player.vimeo.com/api/player.js").onload = () => {
      player = new Vimeo.Player(frame);
      player.ready().then(() => { ready = true; send("ready", { controllable: true }); apply(); }).catch(() => send("ready", { controllable: false }));
      player.on("play", () => { if (!active || paused) { player.pause().catch(() => {}); return; } state(true); });
      player.on("pause", () => state(false));
      player.on("ended", () => { if (active) send("ended"); });
      player.on("error", () => send("error", { message: "Vimeo could not play this video. Try its player controls or swipe to the next video." }));
    };
  } else if (frame) {
    frame.addEventListener("load", () => send("ready", { controllable: false }));
  }
  // Register early so activation never depends on a third-party frame finishing load.
  send("bridge");
})();
