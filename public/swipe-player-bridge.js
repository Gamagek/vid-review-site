// Playback lifecycle for a prepared swipe card. Hidden cards must stay paused.
(() => {
  if (document.body.dataset.viewerEmbed !== "1") return;
  const origin = new URL(document.baseURI).origin;
  const provider = document.body.dataset.videoProvider;
  const stage = document.querySelector(".watch-player-stage");
  let frame = stage?.querySelector("iframe");
  const connection = navigator.connection;
  const saveData = () => connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType || "");
  let active = false, paused = false, requestedMuted = true, fallbackMuted = false;
  let ready = false, playing = false, player, native, revision = 0, actualMuted = true;
  let hls, hlsAuto = false, hlsStopped = false;
  const send = (type, detail = {}) => parent.postMessage({ channel: "vidbest-player", type, ...detail }, origin);
  const shouldMute = () => !active || requestedMuted || fallbackMuted;
  const wanted = () => active && !paused;
  function state(value = playing) {
    playing = value;
    if (native) actualMuted = native.muted || native.volume === 0;
    else if (ready && provider === "youtube") actualMuted = player.isMuted() || player.getVolume() === 0;
    send("state", { playing, muted: actualMuted, soundBlocked: fallbackMuted && !requestedMuted });
  }
  function progress(seconds, duration, buffered = 0) {
    send("progress", { seconds: Number.isFinite(seconds) ? seconds : 0, duration: Number.isFinite(duration) ? duration : 0, buffered });
  }
  function bufferedAhead() {
    if (!native) return 0;
    for (let i = 0; i < native.buffered.length; i++) {
      if (native.buffered.start(i) <= native.currentTime && native.buffered.end(i) > native.currentTime) return native.buffered.end(i) - native.currentTime;
    }
    return 0;
  }
  function quality() {
    const level = hls?.levels[hls.currentLevel];
    send("quality", { label: hls ? `${saveData() ? "Data saver" : hlsAuto ? "Auto quality" : "Fast start"}${level?.height ? ` · ${level.height}p` : ""}` : provider === "hls" ? "Auto quality · browser" : "Source quality" });
  }
  function updateHls() {
    if (!hls || !native) return;
    // Prepare a short low-quality buffer, then give the active stream bandwidth priority.
    const ahead = bufferedAhead();
    if (wanted() && native.currentTime >= 2 && ahead >= 4 && !saveData()) hlsAuto = true;
    hls.autoLevelCapping = saveData() || !hlsAuto ? 0 : -1;
    const max = active ? 12 : saveData() ? 2 : 6;
    hls.config.maxBufferLength = max;
    hls.config.maxMaxBufferLength = active ? 20 : max;
    const stop = (!active || paused) && ahead >= max;
    if (stop && !hlsStopped) { hls.stopLoad(); hlsStopped = true; }
    else if (!stop && hlsStopped) { hls.startLoad(-1); hlsStopped = false; }
    quality();
  }
  function blocked(error, attempt) {
    if (attempt !== revision || !wanted() || error?.name === "AbortError") return;
    // A blocked audible start must not freeze the feed or falsely report sound on.
    if (!shouldMute() && (!error || error.name === "NotAllowedError")) {
      fallbackMuted = true; send("soundblocked"); apply();
    } else send("blocked");
  }
  function apply() {
    const play = wanted(), attempt = revision;
    if (native) {
      native.muted = shouldMute();
      if (!shouldMute() && native.volume === 0) native.volume = 1;
      updateHls();
      if (play) native.play().catch((error) => blocked(error, attempt));
      else native.pause();
      state();
    } else if (ready && provider === "youtube") {
      shouldMute() ? player.mute() : player.unMute();
      if (!shouldMute() && player.getVolume() === 0) player.setVolume(100);
      play ? player.playVideo() : player.pauseVideo();
      state();
    } else if (ready && provider === "vimeo") {
      const mute = shouldMute();
      // Vimeo methods are asynchronous: never play a card after a later swipe.
      player.setMuted(mute).catch(() => {}).then(() => {
        if (attempt !== revision) return;
        Promise.all([player.getMuted(), player.getVolume()]).then(([isMuted, volume]) => {
          if (attempt !== revision) return;
          actualMuted = isMuted || volume === 0; state();
        }).catch(() => {});
        return (play ? player.play() : player.pause()).catch((error) => blocked(error, attempt));
      });
    }
  }
  function seek(seconds) {
    if (!active || !ready || !Number.isFinite(seconds)) return;
    if (native && Number.isFinite(native.duration)) native.currentTime = Math.min(Math.max(0, seconds), native.duration);
    else if (provider === "youtube") player.seekTo(Math.min(Math.max(0, seconds), player.getDuration()), true);
    else if (provider === "vimeo") player.getDuration().then((duration) => {
      if (active) return player.setCurrentTime(Math.min(Math.max(0, seconds), duration));
    }).catch(() => {});
  }
  function receive(data) {
    if (data?.channel !== "vidbest-viewer") return;
    if (data.type === "seek") { seek(data.seconds); return; }
    if (data.type !== "playback") return;
    revision++;
    active = data.active === true; paused = data.paused === true;
    requestedMuted = data.muted !== false;
    if (data.gesture) fallbackMuted = false;
    document.body.dataset.viewerActive = active ? "1" : "0";
    apply();
  }
  window.addEventListener("message", (event) => {
    if (event.source === parent && event.origin === origin) receive(event.data);
  });
  // A synchronous call from a real same-origin tap preserves browser user activation.
  // Embedded providers still enforce their own autoplay policies.
  window.vidbestPlayback = receive;
  if (provider === "tiktok") {
    ready = true;
    send("ready", { controllable: false });
    send("quality", { label: "Preview card · TikTok" });
  }
  function watchVideo(video) {
    if (video.dataset.swipeManaged) return;
    video.dataset.swipeManaged = "1";
    native = video; video.autoplay = false; video.preload = saveData() && provider !== "hls" ? "metadata" : "auto";
    video.playsInline = true; video.muted = true;
    const reportProgress = () => { progress(video.currentTime, video.duration, bufferedAhead()); updateHls(); };
    const onReady = () => { ready = true; send("ready", { controllable: true }); quality(); reportProgress(); apply(); };
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("loadedmetadata", reportProgress);
    video.addEventListener("timeupdate", reportProgress);
    video.addEventListener("progress", reportProgress);
    video.addEventListener("playing", () => {
      if (!wanted()) { video.pause(); return; }
      state(true);
    });
    video.addEventListener("pause", () => state(false));
    video.addEventListener("volumechange", () => state());
    video.addEventListener("ended", () => { state(false); if (active) send("ended"); });
    video.addEventListener("error", () => send("error", { message: "This video could not load. Retry or swipe to the next video." }));
    video.addEventListener("vidbest:hls-ready", (event) => {
      hls = event.detail.hls;
      hls.autoLevelCapping = 0;
      hls.on(event.detail.events.FRAG_BUFFERED, updateHls);
      hls.on(event.detail.events.LEVEL_SWITCHED, quality);
      updateHls();
    });
    if (video.readyState >= 2) onReady();
    else apply();
  }
  stage?.querySelectorAll("video").forEach(watchVideo);
  if (stage) new MutationObserver(() => stage.querySelectorAll("video").forEach(watchVideo))
    .observe(stage, { childList: true, subtree: true });
  connection?.addEventListener?.("change", updateHls);
  function loadScript(src) {
    const script = document.createElement("script"); script.src = src;
    script.onerror = () => send("ready", { controllable: false });
    document.head.append(script); return script;
  }
  if (frame && provider === "youtube") {
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player(frame, { events: {
        onReady() {
          ready = true; send("ready", { controllable: true });
          // YouTube removed its quality-selection API; let its own ABR adapt.
          send("quality", { label: "Auto quality · YouTube" }); apply();
        },
        onStateChange(event) {
          if (event.data === 1 && !wanted()) { player.pauseVideo(); return; }
          if (event.data === 1 || event.data === 2) state(event.data === 1);
          if (event.data === 0 && active) send("ended");
        },
        onAutoplayBlocked() { blocked(null, revision); },
        onError() { send("error", { message: "YouTube could not play this video. Try Original controls or swipe to the next video." }); },
      } });
    };
    loadScript("https://www.youtube.com/iframe_api");
    setInterval(() => {
      if (!ready || !active) return;
      progress(player.getCurrentTime(), player.getDuration()); state();
    }, 750);
  } else if (frame && provider === "vimeo") {
    loadScript("https://player.vimeo.com/api/player.js").onload = () => {
      player = new Vimeo.Player(frame);
      player.ready().then(() => {
        ready = true; send("ready", { controllable: true });
        send("quality", { label: "Auto quality · Vimeo" }); apply();
        player.getDuration().then((duration) => progress(0, duration)).catch(() => {});
      }).catch(() => send("ready", { controllable: false }));
      player.on("play", () => { if (!wanted()) { player.pause().catch(() => {}); return; } state(true); });
      player.on("pause", () => state(false));
      player.on("volumechange", (event) => { actualMuted = event.muted === true || event.volume === 0; state(); });
      player.on("timeupdate", (event) => progress(event.seconds, event.duration));
      player.on("ended", () => { if (active) send("ended"); });
      player.on("error", () => send("error", { message: "Vimeo could not play this video. Try Original controls or swipe to the next video." }));
    };
  } else if (frame) {
    frame.addEventListener("load", () => send("ready", { controllable: false }));
  }
  // Register early so activation never depends on a third-party frame finishing load.
  send("bridge");
})();
