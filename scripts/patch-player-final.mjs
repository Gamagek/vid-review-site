import { readFile, writeFile } from "node:fs/promises";

const path = "public/watch.js";
const marker = "// VIDBEST FINAL PLAYER + AUDIO LAB v3";
let source = await readFile(path, "utf8");

for (const oldMarker of [
  "\n// VIDBEST LINKED PLAYER UPGRADE v1",
  "\n// VIDBEST FINAL PLAYER + AUDIO LAB v1",
  "\n// VIDBEST FINAL PLAYER + AUDIO LAB v2",
  "\n// VIDBEST FINAL PLAYER + AUDIO LAB v3",
]) {
  const index = source.indexOf(oldMarker);
  if (index >= 0) source = source.slice(0, index).trimEnd() + "\n";
}

source = source.replace(/\n\s*enhanceNativePlayer\(\);/, "");

const init = "  initializePersistentPlayer();\n  initializeDiscovery();";
if (!source.includes(init)) throw new Error("Could not locate watch-page initialization block");
source = source.replace(init, "  initializePersistentPlayer();\n  initializeEmbeddedMediaTools();\n  initializeAudioLab();\n  initializeBackgroundPlayback();\n  initializeDiscovery();");

const addition = String.raw`

${marker}

function initializeEmbeddedMediaTools() {
  const player = document.querySelector("#watch-player");
  if (!player || player.dataset.vidbestEmbeddedTools === "1") return;
  const stage = player.querySelector(".watch-player-stage") || player;
  const frame = stage.querySelector("iframe");
  if (!frame) return;

  const sourceText = (frame.src + " " + (document.body.dataset.videoProvider || "")).toLowerCase();
  if (sourceText.includes("lab-review-1.mp4") || sourceText.includes("lab review 1")) return;
  player.dataset.vidbestEmbeddedTools = "1";

  const provider = String(document.body.dataset.videoProvider || inferProvider(frame)).toLowerCase();
  const remote = provider === "youtube" || provider === "vimeo";
  const state = { playing: false, muted: false, rate: 1, currentTime: 0 };

  function inferProvider(element) {
    try {
      const host = new URL(element.src || "").hostname.toLowerCase();
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

  frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; clipboard-write");
  frame.setAttribute("allowfullscreen", "");

  function command(method, args) {
    args = args || [];
    try {
      if (typeof playerProviderCommand === "function") {
        playerProviderCommand(method, args);
        return;
      }
      const origin = provider === "vimeo" ? "https://player.vimeo.com" : new URL(frame.src).origin;
      const payload = provider === "vimeo"
        ? (method === "playVideo" ? { method: "play" }
          : method === "pauseVideo" ? { method: "pause" }
          : method === "mute" ? { method: "setVolume", value: 0 }
          : method === "unMute" ? { method: "setVolume", value: 1 }
          : method === "setPlaybackRate" ? { method: "setPlaybackRate", value: Number(args[0]) }
          : method === "seekTo" ? { method: "setCurrentTime", value: Number(args[0]) }
          : { method })
        : { event: "command", func: method, args: args };
      frame.contentWindow && frame.contentWindow.postMessage(JSON.stringify(payload), origin);
    } catch {}
  }

  const overlay = document.createElement("div");
  overlay.className = "vidbest-embed-overlay";
  overlay.setAttribute("aria-label", "Vid.Best embedded player controls");

  function message(text) {
    const note = overlay.querySelector(".vidbest-embed-note");
    if (note) note.textContent = text;
  }

  function button(label, title, handler, disabled) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vidbest-embed-button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = Boolean(disabled);
    b.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      void handler();
    });
    return b;
  }

  const play = button("▶", "Play or pause", function() {
    if (!remote) return message("This provider keeps playback controls inside its own embed.");
    state.playing = !state.playing;
    command(state.playing ? "playVideo" : "pauseVideo");
    play.textContent = state.playing ? "❚❚" : "▶";
  }, !remote);
  const back = button("↶10", "Seek back 10 seconds", function() {
    if (!remote) return message("Seek is provider-dependent for this embed.");
    state.currentTime = Math.max(0, state.currentTime - 10);
    command("seekTo", [state.currentTime, true]);
  }, !remote);
  const forward = button("10↷", "Seek forward 10 seconds", function() {
    if (!remote) return message("Seek is provider-dependent for this embed.");
    state.currentTime += 10;
    command("seekTo", [state.currentTime, true]);
  }, !remote);
  const speed = button("1×", "Cycle playback speed", function() {
    if (!remote) return message("Speed is controlled by the embedded provider.");
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(state.rate) + 1) % rates.length];
    state.rate = next;
    speed.textContent = next + "×";
    command("setPlaybackRate", [next]);
  }, !remote);
  const mute = button("🔊", "Mute or unmute", function() {
    if (!remote) return message("Mute is controlled by the embedded provider.");
    state.muted = !state.muted;
    command(state.muted ? "mute" : "unMute");
    mute.textContent = state.muted ? "🔇" : "🔊";
  }, !remote);
  const captions = button("CC", "Caption controls", function() {
    message("Caption languages are controlled by the embedded provider.");
    frame.focus();
  });

  async function embeddedPiP() {
    if (!(window.documentPictureInPicture && window.documentPictureInPicture.requestWindow)) {
      message("Embedded PiP is not supported here. Use the provider's own PiP control.");
      return;
    }
    if (window.documentPictureInPicture.window) {
      window.documentPictureInPicture.window.focus();
      return;
    }
    const parent = frame.parentNode;
    const next = frame.nextSibling;
    try {
      const width = Math.max(320, Math.min(720, stage.clientWidth || 480));
      const height = Math.max(200, Math.min(520, Math.round(width * 0.5625) + 40));
      const pip = await window.documentPictureInPicture.requestWindow({ width: width, height: height });
      const doc = pip.document;
      doc.body.style.cssText = "margin:0;background:#05070d;color:#fff;overflow:hidden;font-family:system-ui,sans-serif";
      const shell = doc.createElement("div");
      shell.style.cssText = "width:100vw;height:100vh;display:grid;grid-template-rows:34px 1fr";
      const bar = doc.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:0 8px;background:#111827;font:12px system-ui";
      const label = doc.createElement("span");
      label.textContent = "Vid.Best · " + provider + " PiP";
      const close = doc.createElement("button");
      close.textContent = "Back to page";
      close.style.cssText = "border:0;border-radius:7px;padding:5px 8px;background:#273449;color:#fff";
      close.onclick = function() { pip.close(); };
      bar.append(label, close);
      const viewport = doc.createElement("div");
      viewport.style.cssText = "min-height:0;background:#000";
      frame.style.cssText = "display:block;width:100%;height:100%;border:0";
      viewport.append(frame);
      shell.append(bar, viewport);
      doc.body.append(shell);
      pip.addEventListener("pagehide", function() {
        if (parent && !parent.contains(frame)) parent.insertBefore(frame, next || null);
        frame.style.cssText = "";
      }, { once: true });
      message("Embedded video is floating in PiP.");
    } catch (error) {
      message(error && error.message ? error.message : "Embedded PiP could not be opened.");
    }
  }

  const pip = button("▣ PiP", "Picture in Picture", embeddedPiP);
  const pop = button("Pop-out", "Float player while scrolling", function() {
    const anchor = document.querySelector("#watch-player-anchor");
    if (!anchor) return;
    const on = !player.classList.contains("is-mini");
    if (on) {
      anchor.style.height = player.offsetHeight + "px";
      anchor.classList.add("is-active");
      player.dataset.explicitMini = "1";
      player.classList.add("is-mini");
      pop.textContent = "Return";
    } else {
      delete player.dataset.explicitMini;
      player.classList.remove("is-mini");
      anchor.classList.remove("is-active");
      anchor.style.height = "";
      pop.textContent = "Pop-out";
    }
  });
  const full = button("⛶", "Fullscreen", async function() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
    } catch { message("Fullscreen is unavailable for this embed."); }
  });
  const note = document.createElement("span");
  note.className = "vidbest-embed-note";
  note.textContent = remote ? "Embedded " + provider + " · enhanced controls" : "Embedded " + provider + " · provider controls remain authoritative";
  overlay.append(play, back, forward, speed, captions, mute, pip, pop, full, note);
  stage.style.position = stage.style.position || "relative";
  stage.append(overlay);

  addEventListener("message", function(event) {
    if (event.source !== frame.contentWindow) return;
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      const info = data && (data.info || data);
      const time = Number(info && (info.currentTime != null ? info.currentTime : data.currentTime));
      if (Number.isFinite(time)) state.currentTime = time;
    } catch {}
  });
}

function initializeBackgroundPlayback() {
  const player = document.querySelector("#watch-player");
  const video = player && player.querySelector("video");
  if (!video || video.dataset.vidbestBackground === "1") return;
  video.dataset.vidbestBackground = "1";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.disablePictureInPicture = false;

  const title = document.querySelector("h1")?.textContent?.trim() || "Vid.Best video";
  if ("mediaSession" in navigator && typeof MediaMetadata === "function") {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: title, artist: "Vid.Best", album: "Vid.Best" });
      function setAction(action, handler) { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} }
      setAction("play", function() { return video.play(); });
      setAction("pause", function() { video.pause(); });
      setAction("seekbackward", function(details) { video.currentTime = Math.max(0, video.currentTime - ((details && details.seekOffset) || 10)); });
      setAction("seekforward", function(details) { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + ((details && details.seekOffset) || 10)); });
      setAction("stop", function() { video.pause(); });
      setAction("enterpictureinpicture", async function() {
        if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
          try { await video.requestPictureInPicture(); } catch {}
        }
      });
      video.addEventListener("play", function() { try { navigator.mediaSession.playbackState = "playing"; } catch {} });
      video.addEventListener("pause", function() { try { navigator.mediaSession.playbackState = "paused"; } catch {} });
      video.addEventListener("ended", function() { try { navigator.mediaSession.playbackState = "none"; } catch {} });
    } catch {}
  }

  function savePosition() {
    try { sessionStorage.setItem("vidbest-position-" + videoId, String(video.currentTime || 0)); } catch {}
  }
  addEventListener("pagehide", savePosition);
  addEventListener("beforeunload", savePosition);
  video.addEventListener("loadedmetadata", function() {
    try {
      const saved = Number(sessionStorage.getItem("vidbest-position-" + videoId));
      if (Number.isFinite(saved) && saved > 0 && saved < (video.duration || Infinity)) video.currentTime = saved;
    } catch {}
  });
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden" && !video.paused) video.dataset.vidbestBackgroundPlaying = "1";
  });
}

function initializeAudioLab() {
  const player = document.querySelector("#watch-player");
  const video = player && player.querySelector("video");
  if (!player || !video || video.dataset.vidbestAudioLab === "1") return;
  video.dataset.vidbestAudioLab = "1";

  const panel = document.createElement("section");
  panel.className = "vidbest-audio-lab";
  panel.innerHTML = [
    '<div class="vidbest-audio-head"><div><p>Audio Lab</p><h2>Sound effects & equalizer</h2><small>Optional local effects for direct/native video.</small></div><button type="button" data-audio-reset>Reset</button></div>',
    '<div class="vidbest-audio-presets" role="group" aria-label="Sound presets">',
    '<button type="button" data-audio-preset="normal">Normal</button><button type="button" data-audio-preset="bass">Bass Boost</button><button type="button" data-audio-preset="voice">Clear Voice</button><button type="button" data-audio-preset="warm">Warm</button><button type="button" data-audio-preset="movie">Movie</button><button type="button" data-audio-preset="space">3D Space</button><button type="button" data-audio-preset="wide">Surround Wide</button><button type="button" data-audio-preset="mashup">Mashup</button><button type="button" data-audio-preset="night">Night</button>',
    '</div>',
    '<div class="vidbest-audio-sliders">',
    '<label>Master <input data-a="master" type="range" min="0" max="1.25" step="0.01" value="1"></label>',
    '<label>Bass <input data-a="bass" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Mid <input data-a="mid" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Treble <input data-a="treble" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Space <input data-a="space" type="range" min="0" max="1" step="0.01" value="0"></label>',
    '<label>3D <input data-a="threeD" type="range" min="-1" max="1" step="0.02" value="0"></label>',
    '</div>',
    '<div class="vidbest-audio-status" data-audio-status>Choose a preset or move a control to enable effects.</div>'
  ].join("");
  (player.querySelector(".watch-player-stage") || player).insertAdjacentElement("afterend", panel);

  const controls = Object.fromEntries(Array.from(panel.querySelectorAll("[data-a]")).map(function(el) { return [el.dataset.a, el]; }));
  const status = panel.querySelector("[data-audio-status]");
  let ctx = null, source = null, master = null, bass = null, mid = null, treble = null, panner = null, compressor = null;

  function ensureAudio() {
    if (ctx) return true;
    try {
      ctx = new AudioContext();
      source = ctx.createMediaElementSource(video);
      master = ctx.createGain();
      bass = ctx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 160;
      mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.9;
      treble = ctx.createBiquadFilter(); treble.type = "highshelf"; treble.frequency.value = 4200;
      panner = ctx.createStereoPanner();
      compressor = ctx.createDynamicsCompressor(); compressor.threshold.value = -18; compressor.knee.value = 20; compressor.ratio.value = 3; compressor.attack.value = 0.003; compressor.release.value = 0.2;
      source.connect(bass).connect(mid).connect(treble).connect(panner).connect(compressor).connect(master).connect(ctx.destination);
      return true;
    } catch {
      status.textContent = "Audio effects unavailable for this media/browser. Normal playback is unchanged.";
      return false;
    }
  }
  function applyAudio() {
    if (!ensureAudio()) return;
    if (ctx.state === "suspended") ctx.resume().catch(function() {});
    const now = ctx.currentTime;
    function smooth(param, value) { param.setTargetAtTime(Number(value), now, 0.045); }
    smooth(master.gain, controls.master.value);
    smooth(bass.gain, controls.bass.value);
    smooth(mid.gain, controls.mid.value);
    smooth(treble.gain, controls.treble.value);
    smooth(panner.pan, Number(controls.threeD.value) * Number(controls.space.value));
    status.textContent = "Effects active · smooth transition";
  }
  const presets = {
    normal: [1, 0, 0, 0, 0, 0], bass: [1.02, 8, 0, 2, 0.12, 0], voice: [1, -2, 4, 3, 0.04, 0], warm: [1, 4, 2, -2, 0.08, 0], movie: [1.02, 5, -1, 4, 0.38, 0], space: [1, 3, 0, 3, 0.72, 0.55], wide: [1, 4, 0, 3, 0.95, 0.9], mashup: [1.05, 6, 3, 5, 0.62, -0.35], night: [0.82, -3, 3, -4, 0.04, 0]
  };
  function preset(name) {
    const values = presets[name] || presets.normal;
    ["master", "bass", "mid", "treble", "space", "threeD"].forEach(function(key, index) { controls[key].value = values[index]; });
    applyAudio();
  }
  panel.querySelectorAll("[data-audio-preset]").forEach(function(b) { b.addEventListener("click", function() { preset(b.dataset.audioPreset); }); });
  panel.querySelector("[data-audio-reset]").addEventListener("click", function() { preset("normal"); });
  Object.values(controls).forEach(function(input) { input.addEventListener("input", applyAudio); });
}

(function injectVidBestPlayerStyles() {
  if (document.getElementById("vidbest-player-upgrade-styles")) return;
  const style = document.createElement("style");
  style.id = "vidbest-player-upgrade-styles";
  style.textContent = [
    ".vidbest-embed-overlay{position:absolute;left:8px;right:8px;bottom:8px;z-index:8;display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:6px;border-radius:11px;background:rgba(5,7,13,.9);backdrop-filter:blur(10px);box-sizing:border-box}",
    ".vidbest-embed-button{border:0;border-radius:8px;padding:6px 8px;background:#202a3b;color:#fff;cursor:pointer;font:600 12px system-ui}",
    ".vidbest-embed-button:disabled{opacity:.42;cursor:not-allowed}",
    ".vidbest-embed-note{flex:1 1 100%;font:11px system-ui;color:#b9c3d4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".vidbest-audio-lab{margin:14px 0;padding:16px;border:1px solid rgba(148,163,184,.22);border-radius:16px;background:linear-gradient(135deg,rgba(15,23,42,.96),rgba(17,24,39,.82));color:#e5e7eb}",
    ".vidbest-audio-head{display:flex;justify-content:space-between;gap:14px;align-items:start}",
    ".vidbest-audio-head p{margin:0 0 3px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;opacity:.7}",
    ".vidbest-audio-head h2{margin:0;font-size:18px}",
    ".vidbest-audio-head small{opacity:.7}",
    ".vidbest-audio-lab button{border:1px solid rgba(148,163,184,.25);background:rgba(30,41,59,.8);color:#fff;border-radius:9px;padding:7px 9px;cursor:pointer}",
    ".vidbest-audio-presets{display:flex;flex-wrap:wrap;gap:7px;margin:13px 0}",
    ".vidbest-audio-sliders{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}",
    ".vidbest-audio-sliders label{display:grid;gap:5px;font-size:12px}",
    ".vidbest-audio-sliders input{width:100%}",
    ".vidbest-audio-status{margin-top:10px;font-size:12px;opacity:.75}",
    "@media(max-width:620px){.vidbest-embed-overlay{left:5px;right:5px;bottom:5px}.vidbest-embed-button{padding:6px 7px}.vidbest-audio-lab{padding:12px}}"
  ].join("");
  document.head.append(style);
})();
`;

source = source.trimEnd() + addition + "\n";
await writeFile(path, source, "utf8");
console.log("Patched " + path + " with final player, PiP, background Media Session and Audio Lab.");
