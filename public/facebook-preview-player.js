/* Official public Facebook video plugin, with observable playback and teardown. */
(() => {
  let sdkPromise;
  let serial = 0;

  function loadSdk() {
    if (window.FB?.XFBML?.parse && window.FB?.Event) return Promise.resolve(window.FB);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Facebook player unavailable")), 6500);
      const ready = () => {
        if (!window.FB?.XFBML?.parse || !window.FB?.Event) return;
        window.clearTimeout(timer);
        resolve(window.FB);
      };
      const previousInit = window.fbAsyncInit;
      window.fbAsyncInit = () => {
        try { previousInit?.(); } finally { ready(); }
      };
      let script = document.getElementById("vidbest-facebook-sdk");
      if (!script) {
        script = document.createElement("script");
        script.id = "vidbest-facebook-sdk";
        script.src = "https://connect.facebook.net/en_US/sdk.js#xfbml=0&version=v23.0&autoLogAppEvents=0";
        script.async = true;
        script.defer = true;
        script.addEventListener("load", ready, { once: true });
        script.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error("Facebook player unavailable"));
        }, { once: true });
        document.head.append(script);
      } else ready();
    });
    // Do not poison all future tiles with a permanently rejected SDK promise.
    sdkPromise.catch(() => { sdkPromise = null; });
    return sdkPromise;
  }

  function mount(container, { source, title, autoplay = true, onState = () => {}, onError = () => {} }) {
    const host = document.createElement("div");
    host.id = "vidbest-facebook-video-" + ++serial;
    host.className = "fb-video facebook-sdk-player";
    host.setAttribute("data-href", source);
    host.setAttribute("data-autoplay", String(autoplay));
    host.setAttribute("data-show-text", "false");
    host.setAttribute("data-allowfullscreen", "true");
    host.setAttribute("data-lazy", "false");
    host.setAttribute("data-width", String(Math.max(220, Math.round(container.getBoundingClientRect().width || 384))));
    host.setAttribute("aria-label", title || "Facebook video preview");
    container.append(host);

    let live = true;
    let instance;
    let fb;
    let readyHandler;
    let soundRequested = false;
    let pausedRequested = !autoplay;
    let playbackTimer;
    const subscriptions = [];
    const timeout = window.setTimeout(() => fail(), 15000);

    function state(value) {
      if (!live) return;
      host.dataset.facebookPlayback = value;
      onState(value);
    }
    function framePermissions() {
      const frame = host.querySelector("iframe");
      if (!frame) return;
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.title = title || "Facebook video preview";
    }
    function play({ sound = false } = {}) {
      if (!live) return;
      pausedRequested = false;
      soundRequested ||= sound;
      if (!instance) return;
      window.clearTimeout(playbackTimer);
      playbackTimer = window.setTimeout(() => {
        if (live && !pausedRequested && host.dataset.facebookPlayback !== "playing") state("blocked");
      }, 9000);
      try {
        if (soundRequested) instance.unmute();
        else instance.mute();
        instance.play();
      } catch { state("blocked"); }
    }
    function pause() {
      if (!live) return;
      pausedRequested = true;
      soundRequested = false;
      window.clearTimeout(playbackTimer);
      host.dataset.facebookPlayback = "paused";
      try { instance?.mute(); instance?.pause(); } catch {}
    }
    function destroy() {
      if (!live) return;
      live = false;
      window.clearTimeout(timeout);
      window.clearTimeout(playbackTimer);
      try { instance?.pause(); } catch {}
      for (const [event, handler, subscription] of subscriptions) {
        try {
          if (subscription?.removeListener) subscription.removeListener();
          else instance?.unsubscribe?.(event, handler);
        } catch {}
      }
      if (readyHandler) {
        try { fb?.Event.unsubscribe("xfbml.ready", readyHandler); } catch {}
      }
      host.remove();
    }
    function fail() {
      if (!live) return;
      destroy();
      onError();
    }

    state("loading");
    loadSdk().then((sdk) => {
      if (!live || !container.isConnected) return;
      fb = sdk;
      readyHandler = (message) => {
        if (!live || message.type !== "video" || message.id !== host.id || !message.instance) return;
        window.clearTimeout(timeout);
        instance = message.instance;
        framePermissions();
        for (const [event, value] of [["startedPlaying", "playing"], ["paused", "paused"], ["finishedPlaying", "ended"]]) {
          const handler = () => {
            if (value === "playing") {
              window.clearTimeout(playbackTimer);
              if (pausedRequested) { pause(); return; }
            }
            state(value);
            if (value === "ended" && !pausedRequested) play();
          };
          const subscription = instance.subscribe(event, handler);
          subscriptions.push([event, handler, subscription]);
        }
        state("ready");
        // Autoplay starts muted. Sound is requested only by an explicit tap.
        if (pausedRequested) pause();
        else play();
      };
      fb.Event.subscribe("xfbml.ready", readyHandler);
      fb.XFBML.parse(container, framePermissions);
    }).catch(fail);
    return { play, pause, destroy };
  }

  window.VidBestFacebookPreview = { mount, preload: () => loadSdk().catch(() => {}) };
})();
