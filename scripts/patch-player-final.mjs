import { readFile, writeFile } from "node:fs/promises";

const path = "public/watch.js";
const marker = "// VIDBEST FINAL PLAYER + AUDIO LAB v2";
let source = await readFile(path, "utf8");

// Remove the earlier experimental linked-player implementation completely.
for (const oldMarker of ["\n// VIDBEST LINKED PLAYER UPGRADE v1", "\n// VIDBEST FINAL PLAYER + AUDIO LAB v1", "\n// VIDBEST FINAL PLAYER + AUDIO LAB v2"]) {
  const index = source.indexOf(oldMarker);
  if (index >= 0) source = source.slice(0, index).trimEnd() + "\n";
}

// Uploaded/native videos must keep their existing browser controls. The old helper
// created a second toolbar underneath the video, so only remove its invocation.
source = source.replace(/\n\s*enhanceNativePlayer\(\);/, "");

const init = "  initializePersistentPlayer();\n  initializeDiscovery();";
if (!source.includes(init)) throw new Error("Could not locate watch-page initialization block");
source = source.replace(init, "  initializePersistentPlayer();\n  initializeEmbeddedMediaTools();\n  initializeAudioLab();\n  initializeBackgroundPlayback();\n  initializeDiscovery();");

const addition = String.raw`

${marker}
// Embedded controls stay inside the player. Native/Lab Review 1 videos retain their
// existing controls. Audio effects are a separate optional layout.
function initializeEmbeddedMediaTools() {
  const player = document.querySelector("#watch-player");
  if (!player || player.dataset.vidbestEmbeddedTools === "1") return;
  player.dataset.vidbestEmbeddedTools = "1";
  const stage = player.querySelector(".watch-player-stage") || player;
  const frame = stage.querySelector("iframe");
  if (!frame) return;

  const sourceText = [frame.src, document.body.dataset.videoProvider || ""].join(" ").toLowerCase();
  if (sourceText.includes("lab-review-1.mp4") || sourceText.includes("lab review 1")) return;

  const provider = String(document.body.dataset.videoProvider || inferProvider(frame)).toLowerCase();
  const remote = provider === "youtube" || provider === "vimeo";
  const state = { playing: false, muted: false, rate: 1, currentTime: 0 };
  frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; clipboard-write");
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

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

  function command(method, args = []) {
    if (typeof playerProviderCommand === "function") {
      playerProviderCommand(method, args);
      return;
    }
    try {
      const origin = provider === "vimeo" ? "https://player.vimeo.com" : new URL(frame.src).origin;
      const payload = provider === "vimeo"
        ? method === "playVideo" ? { method: "play" }
          : method === "pauseVideo" ? { method: "pause" }
            : method === "mute" ? { method: "setVolume", value: 0 }
              : method === "unMute" ? { method: "setVolume", value: 1 }
                : method === "setPlaybackRate" ? { method: "setPlaybackRate", value: Number(args[0]) }
                  : method === "seekTo" ? { method: "setCurrentTime", value: Number(args[0]) }
                    : { method }
        : { event: "command", func: method, args };
      frame.contentWindow?.postMessage(JSON.stringify(payload), origin);
    } catch {}
  }

  function message(text) {
    const note = overlay.querySelector(".vidbest-embed-note");
    if (note) note.textContent = text;
  }

  function button(label, title, handler, disabled = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vidbest-embed-button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = disabled;
    b.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handler();
    });
    return b;
  }

  function toggleMini() {
    const anchor = document.querySelector("#watch-player-anchor");
    if (!anchor) return false;
    const on = !player.classList.contains("is-mini");
    if (on) {
      anchor.style.height = `${player.offsetHeight}px`;
      anchor.classList.add("is-active");
      player.dataset.explicitMini = "1";
      player.classList.add("is-mini");
    } else {
      delete player.dataset.explicitMini;
      player.classList.remove("is-mini");
      anchor.classList.remove("is-active");
      anchor.style.height = "";
    }
    return on;
  }

  async function embeddedPiP() {
    if (!(window.documentPictureInPicture?.requestWindow)) {
      message("Embedded PiP is not supported here. Try the provider's own PiP control.");
      return;
    }
    if (window.documentPictureInPicture.window) {
      window.documentPictureInPicture.window.focus?.();
      return;
    }
    const parent = frame.parentNode;
    const next = frame.nextSibling;
    try {
      const width = Math.max(320, Math.min(720, stage.clientWidth || 480));
      const height = Math.max(200, Math.min(520, Math.round(width * 0.5625) + 42));
      const pip = await window.documentPictureInPicture.requestWindow({ width, height });
      const doc = pip.document;
      doc.body.style.cssText = "margin:0;background:#05070d;color:#fff;overflow:hidden;font-family:system-ui,sans-serif";
      const shell = doc.createElement("div");
      shell.style.cssText = "width:100vw;height:100vh;display:grid;grid-template-rows:34px 1fr;background:#05070d";
      const bar = doc.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:0 8px;background:#111827;font-size:12px";
      const label = doc.createElement("span");
      label.textContent = `Vid.Best · ${provider} PiP`;
      const back = doc.createElement("button");
      back.type = "button";
      back.textContent = "Back to page";
      back.style.cssText = "border:0;border-radius:7px;padding:5px 8px;background:#273449;color:#fff";
      back.onclick = () => pip.close();
      bar.append(label, back);
      const viewport = doc.createElement("div");
      viewport.style.cssText = "min-height:0;background:#000";
      frame.style.cssText = "display:block;width:100%;height:100%;border:0";
      viewport.append(frame);
      shell.append(bar, viewport);
      doc.body.append(shell);
      pip.addEventListener("pagehide", () => {
        if (parent && !parent.contains(frame)) parent.insertBefore(frame, next || null);
        frame.style.cssText = "";
      }, { once: true });
      message("Embedded video is floating in PiP. It can remain visible while you use other apps when the browser/OS permits PiP.");
    } catch (error) {
      message(error?.message || "Embedded PiP could not be opened.");
    }
  }

  const overlay = document.createElement("div");
  overlay.className = "vidbest-embed-overlay";
  overlay.setAttribute("aria-label", "Vid.Best embedded player controls");
  const play = button("▶", "Play or pause", () => {
    if (!remote) return message("This provider keeps playback controls inside its own embed.");
    state.playing = !state.playing;
    command(state.playing ? "playVideo" : "pauseVideo");
    play.textContent = state.playing ? "❚❚" : "▶";
  }, !remote);
  const back = button("↶10", "Seek back 10 seconds", () => {
    if (!remote) return message("Seek is provider-dependent for this embed.");
    state.currentTime = Math.max(0, state.currentTime - 10);
    command("seekTo", [state.currentTime, true]);
  }, !remote);
  const forward = button("10↷", "Seek forward 10 seconds", () => {
    if (!remote) return message("Seek is provider-dependent for this embed.");
    state.currentTime += 10;
    command("seekTo", [state.currentTime, true]);
  }, !remote);
  const speed = button("1×", "Cycle playback speed", () => {
    if (!remote) return message("Speed is controlled by the embedded provider.");
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const index = (rates.indexOf(state.rate) + 1) % rates.length;
    state.rate = rates[index];
    speed.textContent = `${state.rate}×`;
    command("setPlaybackRate", [state.rate]);
  }, !remote);
  const mute = button("🔊", "Mute or unmute", () => {
    if (!remote) return message("Mute is controlled by the embedded provider.");
    state.muted = !state.muted;
    command(state.muted ? "mute" : "unMute");
    mute.textContent = state.muted ? "🔇" : "🔊";
  }, !remote);
  const captions = button("CC", "Open caption controls", () => {
    message("Caption languages and availability are controlled by the embedded provider.");
    frame.focus();
  });
  const pip = button("▣ PiP", "Open embedded video in Picture-in-Picture", embeddedPiP);
  const floating = button("Pop-out", "Float the player while scrolling", () => {
    floating.textContent = toggleMini() ? "Return" : "Pop-out";
  });
  const full = button("⛶", "Fullscreen", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen?.();
    } catch { message("Fullscreen is unavailable for this embed."); }
  });
  const note = document.createElement("span");
  note.className = "vidbest-embed-note";
  note.textContent = remote ? `Embedded ${provider} · enhanced controls` : `Embedded ${provider} · provider controls remain authoritative`;
  overlay.append(play, back, forward, speed, captions, mute, pip, floating, full, note);
  stage.style.position = stage.style.position || "relative";
  stage.append(overlay);

  // Receive YouTube/Vimeo time updates when the provider exposes them so ±10s works.
  addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      const info = data?.info || data;
      const time = Number(info?.currentTime ?? data?.currentTime);
      if (Number.isFinite(time)) state.currentTime = time;
    } catch {}
  });
}

function initializeBackgroundPlayback() {
  const player = document.querySelector("#watch-player");
  const video = player?.querySelector("video");
  if (!video || video.dataset.vidbestBackground === "1") return;
  video.dataset.vidbestBackground = "1";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.disablePictureInPicture = false;

  const title = document.querySelector("h1")?.textContent?.trim() || "Vid.Best video";
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: "Vid.Best",
        album: "Vid.Best",
      });
      const set = (action, handler) => {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
      };
      set("play", () => video.play());
      set("pause", () => video.pause());
      set("seekbackward", (details) => { video.currentTime = Math.max(0, video.currentTime - (details.seekOffset || 10)); });
      set("seekforward", (details) => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + (details.seekOffset || 10)); });
      set("stop", () => video.pause());
      video.addEventListener("play", () => { navigator.mediaSession.playbackState = "playing"; });
      video.addEventListener("pause", () => { navigator.mediaSession.playbackState = "paused"; });
      video.addEventListener("ended", () => { navigator.mediaSession.playbackState = "none"; });
    } catch {}
  }

  // Never pause the media merely because the tab becomes hidden. Whether Android/iOS
  // continues playback is controlled by the browser/OS; PiP/Media Session provide the
  // supported paths for continuing outside the page.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !video.paused) {
      video.dataset.vidbestBackgroundPlaying = "1";
    }
  });
  window.addEventListener("pagehide", () => {
    try { sessionStorage.setItem(`vidbest-position-${videoId}`, String(video.currentTime || 0)); } catch {}
  });
  try {
    const saved = Number(sessionStorage.getItem(`vidbest-position-${videoId}`));
    if (Number.isFinite(saved) && saved > 0 && saved < (video.duration || Infinity)) video.currentTime = saved;
  } catch {}
}

function initializeAudioLab() {
  const player = document.querySelector("#watch-player");
  const video = player?.querySelector("video");
  if (!player || !video || video.dataset.vidbestAudioLab === "1") return;
  video.dataset.vidbestAudioLab = "1";

  const panel = document.createElement("section");
  panel.className = "vidbest-audio-lab";
  panel.innerHTML = `
    <div class="vidbest-audio-head"><div><p>Audio Lab</p><h2>Sound effects & equalizer</h2><small>Optional local effects for direct/native video.</small></div><button type="button" data-audio-reset>Reset</button></div>
    <div class="vidbest-audio-presets" role="group" aria-label="Sound presets">
      <button data-audio-preset="normal">Normal</button><button data-audio-preset="bass">Bass Boost</button><button data-audio-preset="voice">Clear Voice</button><button data-audio-preset="warm">Warm</button><button data-audio-preset="movie">Movie</button><button data-audio-preset="space">3D Space</button><button data-audio-preset="wide">Surround Wide</button><button data-audio-preset="mashup">Mashup</button><button data-audio-preset="night">Night</button>
    </div>
    <div class="vidbest-audio-sliders">
      <label>Master <input data-a="master" type="range" min="0" max="1.25" step="0.01" value="1"></label>
      <label>Bass <input data-a="bass" type="range" min="-12" max="12" step="0.5" value="0"></label>
      <label>Mid <input data-a="mid" type="range" min="-12" max="12" step="0.5" value="0"></label>
      <label>Treble <input data-a="treble" type="range" min="-12" max="12" step="0.5" value="0"></label>
      <label>Space <input data-a="space" type="range" min="0" max="1" step="0.01" value="0"></label>
      <label>3D <input data-a="threeD" type="range" min="-1" max="1" step="0.02" value="0"></label>
    </div>
    <div class="vidbest-audio-status" data-audio-status>Choose a preset or move a control to enable effects.</div>`;
  (player.querySelector(".watch-player-stage") || player).insertAdjacentElement("afterend", panel);

  const c = Object.fromEntries([...panel.querySelectorAll("[data-a]")].map((el) => [el.dataset.a, el]));
  const status = panel.querySelector("[data-audio-status]");
  let ctx, source, master, bass, mid, treble, panner, compressor;

  function ensure() {
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
    } catch (error) {
      status.textContent = "Audio effects are unavailable for this media/browser (often because of cross-origin media). Normal playback is unchanged.";
      return false;
    }
  }
  function apply() {
    if (!ensure()) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const target = (node, param, value) => node[param].setTargetAtTime(Number(value), now, 0.045);
    target(master, "gain", c.master.value);
    target(bass, "gain", c.bass.value);
    target(mid, "gain", c.mid.value);
    target(treble, "gain", c.treble.value);
    target(panner, "pan", c.threeD.value * Number(c.space.value));
    status.textContent = "Effects active · smooth transition";
  }
  const presets = {
    normal: [1,0,0,0,0,0], bass: [1.02,8,0,2,0.12,0], voice: [1, -2,4,3,0.04,0], warm: [1,4,2,-2,0.08,0], movie: [1.02,5,-1,4,0.38,0], space: [1,3,0,3,0.72,0.55], wide: [1,4,0,3,0.95,0.9], mashup: [1.05,6,3,5,0.62,-0.35], night: [0.82,-3,3,-4,0.04,0]
  };
  function preset(name) {
    const values = presets[name] || presets.normal;
    ["master","bass","mid","treble","space","threeD"].forEach((key, i) => { c[key].value = values[i]; });
    apply();
  }
  panel.querySelectorAll("[data-audio-preset]").forEach((b) => b.addEventListener("click", () => preset(b.dataset.audioPreset)));
  panel.querySelector("[data-audio-reset]").addEventListener("click", () => preset("normal"));
  Object.values(c).forEach((input) => input.addEventListener("input", apply));
}

(function injectVidBestPlayerStyles() {
  if (document.getElementById("vidbest-player-upgrade-styles")) return;
  const style = document.createElement("style");
  style.id = "vidbest-player-upgrade-styles";
  style.textContent = `
    .vidbest-embed-overlay{position:absolute;left:10px;right:10px;bottom:10px;z-index:8;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:7px;border-radius:12px;background:rgba(5,7,13,.88);backdrop-filter:blur(10px);box-sizing:border-box}.vidbest-embed-button{border:0;border-radius:8px;padding:7px 9px;background:#202a3b;color:#fff;cursor:pointer;font:600 12px system-ui}.vidbest-embed-button:hover{background:#31405a}.vidbest-embed-button:disabled{opacity:.45;cursor:not-allowed}.vidbest-embed-note{flex:1 1 100%;font:11px system-ui;color:#b9c3d4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vidbest-audio-lab{margin:14px 0;padding:16px;border:1px solid rgba(148,163,184,.22);border-radius:16px;background:linear-gradient(135deg,rgba(15,23,42,.92),rgba(17,24,39,.76));color:#e5e7eb}.vidbest-audio-head{display:flex;justify-content:space-between;gap:14px;align-items:start}.vidbest-audio-head p{margin:0 0 3px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;opacity:.7}.vidbest-audio-head h2{margin:0;font-size:18px}.vidbest-audio-head small{opacity:.7}.vidbest-audio-lab button{border:1px solid rgba(148,163,184,.25);background:rgba(30,41,59,.8);color:#fff;border-radius:9px;padding:7px 9px;cursor:pointer}.vidbest-audio-presets{display:flex;flex-wrap:wrap;gap:7px;margin:13px 0}.vidbest-audio-sliders{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.vidbest-audio-sliders label{display:grid;gap:5px;font-size:12px}.vidbest-audio-sliders input{width:100%}.vidbest-audio-status{margin-top:10px;font-size:12px;opacity:.75}@media(max-width:620px){.vidbest-embed-overlay{left:5px;right:5px;bottom:5px}.vidbest-embed-button{padding:6px 7px}.vidbest-audio-lab{padding:12px}}
  `;
  document.head.append(style);
})();
`;

source = source.trimEnd() + addition + "\n";
await writeFile(path, source, "utf8");
console.log(`Patched ${path}: embedded controls + Document PiP + background Media Session + Audio Lab`);
