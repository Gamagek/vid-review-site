import { readFile, writeFile } from "node:fs/promises";

const path = "public/watch.js";
const marker = "// VIDBEST FINAL PLAYER + AUDIO LAB v1";

let source = await readFile(path, "utf8");

// Remove the earlier experimental linked-player block so it cannot create duplicate
// controls below the player.
const oldMarker = "\n// VIDBEST LINKED PLAYER UPGRADE v1";
const oldMarkerIndex = source.indexOf(oldMarker);
if (oldMarkerIndex >= 0) {
  source = source.slice(0, oldMarkerIndex).trimEnd() + "\n";
}

// Native uploaded/direct videos already use the browser's in-player controls.
// The previous helper added a second toolbar underneath the video; remove only its
// invocation, leaving the rest of the file stable.
source = source.replace(/\n\s*enhanceNativePlayer\(\);/, "");

const initializationTarget = "  initializePersistentPlayer();\n  initializeDiscovery();";
if (!source.includes(initializationTarget)) {
  throw new Error("Could not locate watch-page initialization block");
}
source = source.replace(
  initializationTarget,
  "  initializePersistentPlayer();\n  initializeEmbeddedMediaTools();\n  initializeAudioLab();\n  initializeDiscovery();",
);

const addition = String.raw`

${marker}
// Linked embeds get an in-player overlay and best-effort Document PiP.
// Native/direct media keep their browser controls; the separate Audio Lab adds
// optional Web Audio effects without creating a duplicate playback toolbar.
function initializeEmbeddedMediaTools() {
  const player = document.querySelector("#watch-player");
  if (!player || player.dataset.vidbestEmbeddedTools === "1") return;
  player.dataset.vidbestEmbeddedTools = "1";

  const stage = player.querySelector(".watch-player-stage") || player;
  const frame = stage.querySelector("iframe");
  if (!frame) return;

  const sourceText = [frame.src, document.body.dataset.videoProvider].join(" ").toLowerCase();
  // Lab Review 1 is a native R2 video with its own established controls.
  if (sourceText.includes("lab-review-1.mp4") || sourceText.includes("lab review 1")) return;

  frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; clipboard-write");
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

  const provider = String(document.body.dataset.videoProvider || inferEmbeddedProvider(frame)).toLowerCase();
  const remoteSupported = provider === "youtube" || provider === "vimeo";
  const state = { playing: false, rate: 1, muted: false, pipWindow: null, placeholder: null, parent: null, nextSibling: null };

  function inferEmbeddedProvider(element) {
    try {
      const host = new URL(element?.src || "").hostname.toLowerCase();
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
      const origin = provider === "vimeo" ? "https://player.vimeo.com" : "https://www.youtube.com";
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

  function setOverlayMessage(message) {
    const note = overlay.querySelector(".embedded-player-note");
    if (note) note.textContent = message;
  }

  function toggleExplicitMini() {
    const anchor = document.querySelector("#watch-player-anchor");
    if (!anchor) return false;
    const enabled = !player.classList.contains("is-mini");
    if (enabled) {
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
    return enabled;
  }

  async function openDocumentPiP() {
    if (!("documentPictureInPicture" in window) || !window.documentPictureInPicture?.requestWindow) {
      setOverlayMessage("Embedded PiP is not supported by this browser. Use the provider's PiP control or Pop-out.");
      return;
    }
    if (state.pipWindow && !state.pipWindow.closed) {
      state.pipWindow.focus?.();
      return;
    }

    try {
      const width = Math.max(300, Math.min(720, stage.clientWidth || 480));
      const height = Math.max(180, Math.min(520, Math.round(width * 0.5625) + 44));
      const pipWindow = await window.documentPictureInPicture.requestWindow({ width, height });
      state.pipWindow = pipWindow;
      state.parent = frame.parentNode;
      state.nextSibling = frame.nextSibling;

      const doc = pipWindow.document;
      doc.documentElement.style.background = "#05070d";
      doc.body.style.margin = "0";
      doc.body.style.background = "#05070d";
      doc.body.style.color = "white";
      doc.body.style.fontFamily = "system-ui, sans-serif";
      doc.body.style.overflow = "hidden";

      const wrapper = doc.createElement("div");
      wrapper.style.cssText = "width:100vw;height:100vh;display:grid;grid-template-rows:32px 1fr;background:#05070d;";
      const top = doc.createElement("div");
      top.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:0 8px;font-size:12px;background:#111827;color:#e5e7eb;";
      top.textContent = "Vid.Best · Embedded PiP";
      const close = doc.createElement("button");
      close.textContent = "Back to page";
      close.style.cssText = "border:0;border-radius:8px;padding:5px 8px;background:#253047;color:#fff;cursor:pointer;";
      close.onclick = () => pipWindow.close();
      top.append(close);
      const viewport = doc.createElement("div");
      viewport.style.cssText = "min-height:0;display:flex;background:#000;";
      frame.style.cssText = "width:100%;height:100%;border:0;display:block;";
      viewport.append(frame);
      wrapper.append(top, viewport);
      doc.body.append(wrapper);

      const restore = () => {
        if (state.parent && !state.parent.contains(frame)) {
          state.parent.insertBefore(frame, state.nextSibling || null);
        }
        frame.style.cssText = "";
        state.pipWindow = null;
      };
      pipWindow.addEventListener("pagehide", restore, { once: true });
      setOverlayMessage(`${provider === "external" ? "Embedded" : provider} video moved to Picture-in-Picture.`);
    } catch (error) {
      setOverlayMessage(error?.message || "Embedded Picture-in-Picture could not be opened.");
    }
  }

  function makeButton(label, title, handler, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "embedded-player-button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.disabled = disabled;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handler();
    });
    return button;
  }

  const overlay = document.createElement("div");
  overlay.className = "embedded-player-overlay";
  overlay.setAttribute("aria-label", "Vid.Best embedded video controls");

  const play = makeButton("▶", "Play or pause embedded video", async () => {
    if (!remoteSupported) {
      setOverlayMessage("This provider does not expose remote play/pause controls to the parent page.");
      return;
    }
    state.playing = !state.playing;
    command(state.playing ? "playVideo" : "pauseVideo");
    play.textContent = state.playing ? "❚❚" : "▶";
  }, !remoteSupported);
  const back = makeButton("↶10", "Seek back 10 seconds", () => {
    if (!remoteSupported) return setOverlayMessage("Seek controls are provider-dependent for embedded media.");
    command("seekTo", [0, true]);
  }, !remoteSupported);
  const forward = makeButton("10↷", "Seek forward 10 seconds", () => {
    if (!remoteSupported) return setOverlayMessage("Seek controls are provider-dependent for embedded media.");
    setOverlayMessage("Use the provider timeline for precise forward seeking; Vid.Best keeps the provider in control of playback state.");
  }, !remoteSupported);

  const speed = makeButton("1×", "Cycle embedded playback speed", () => {
    if (!remoteSupported) return setOverlayMessage("Playback speed is controlled by the embedded provider.");
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    let index = rates.findIndex((value) => Math.abs(value - state.rate) < 0.01);
    index = (index + 1) % rates.length;
    state.rate = rates[index];
    command("setPlaybackRate", [state.rate]);
    speed.textContent = `${state.rate}×`;
  }, !remoteSupported);

  const mute = makeButton("🔊", "Mute or unmute embedded video", () => {
    if (!remoteSupported) return setOverlayMessage("Mute is controlled by the embedded provider.");
    state.muted = !state.muted;
    command(state.muted ? "mute" : "unMute");
    mute.textContent = state.muted ? "🔇" : "🔊";
  }, !remoteSupported);

  const pip = makeButton("▣ PiP", "Open embedded video in Picture-in-Picture", openDocumentPiP);
  const popout = makeButton("Pop-out", "Keep embedded video in a floating player while scrolling", () => {
    popout.textContent = toggleExplicitMini() ? "Return" : "Pop-out";
  });
  const full = makeButton("⛶", "Fullscreen embedded player", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
    } catch {
      setOverlayMessage("Fullscreen is unavailable for this embedded provider.");
    }
  });
  const captions = makeButton("CC", "Open provider caption controls", () => {
    setOverlayMessage("Caption availability and language controls are provided by the embedded video service.");
    frame.focus();
  });

  overlay.append(play, back, forward, speed, captions, mute, pip, popout, full);
  const note = document.createElement("span");
  note.className = "embedded-player-note";
  note.textContent = remoteSupported
    ? `Embedded ${provider} player · provider-compatible controls enabled.`
    : "Embedded provider · provider controls remain authoritative.";
  overlay.append(note);

  stage.style.position = stage.style.position || "relative";
  stage.append(overlay);
}

function initializeAudioLab() {
  const player = document.querySelector("#watch-player");
  const video = player?.querySelector("video");
  if (!player || !video || video.dataset.vidbestAudioLab === "1") return;
  video.dataset.vidbestAudioLab = "1";

  const panel = document.createElement("section");
  panel.className = "audio-lab-panel glass-panel";
  panel.setAttribute("aria-label", "Vid.Best Audio Lab");
  panel.innerHTML = `
    <div class="audio-lab-heading">
      <div>
        <p class="eyebrow">Audio Lab</p>
        <h2>Sound effects & equalizer</h2>
        <p>Optional playback effects for same-origin/direct video. Changes affect only your current browser session.</p>
      </div>
      <button type="button" class="button ghost audio-reset">Reset</button>
    </div>
    <div class="audio-presets" role="group" aria-label="Sound presets">
      <button type="button" class="button ghost" data-audio-preset="normal">Normal</button>
      <button type="button" class="button ghost" data-audio-preset="bass">Bass Boost</button>
      <button type="button" class="button ghost" data-audio-preset="voice">Clear Voice</button>
      <button type="button" class="button ghost" data-audio-preset="warm">Warm</button>
      <button type="button" class="button ghost" data-audio-preset="movie">Movie</button>
      <button type="button" class="button ghost" data-audio-preset="space">3D Space</button>
      <button type="button" class="button ghost" data-audio-preset="wide">Surround Wide</button>
      <button type="button" class="button ghost" data-audio-preset="mashup">Mashup</button>
      <button type="button" class="button ghost" data-audio-preset="night">Night</button>
    </div>
    <div class="audio-lab-sliders">
      <label>Master <input class="audio-master" type="range" min="0" max="1.25" step="0.01" value="1"></label>
      <label>Bass <input class="audio-bass" type="range" min="-12" max="12" step="0.5" value="0"></label>
      <label>Mid <input class="audio-mid" type="range" min="-12" max="12" step="0.5" value="0"></label>
      <label>Treble <input class="audio-treble" type="range" min="-12" max="12" step="0.5" value="0"></label>
      <label>Space <input class="audio-space" type="range" min="0" max="1" step="0.01" value="0"></label>
      <label>3D <input class="audio-3d" type="range" min="-1" max="1" step="0.02" value="0"></label>
    </div>
    <p class="form-status audio-lab-status">Audio effects are off until you choose a preset or move a control.</p>
  `;

  const anchor = player.querySelector(".watch-player-stage") || player;
  anchor.insertAdjacentElement("afterend", panel);

  let context = null;
  let source = null;
  let master = null;
  let bass = null;
  let mid = null;
  let treble = null;
  let panner = null;
  let compressor = null;
  let initialized = false;
  let crossOriginBlocked = false;

  const controls = {
    master: panel.querySelector(".audio-master"),
    bass: panel.querySelector(".audio-bass"),
    mid: panel.querySelector(".audio-mid"),
    treble: panel.querySelector(".audio-treble"),
    space: panel.querySelector(".audio-space"),
    threeD: panel.querySelector(".audio-3d"),
    status: panel.querySelector(".audio-lab-status"),
  };

  function smooth(param, value) {
    if (!param) return;
    const now = context?.currentTime || 0;
    try {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(Number(value), now, 0.035);
    } catch {
      param.value = Number(value);
    }
  }

  function ensureAudio() {
    if (crossOriginBlocked) return false;
    if (initialized) {
      if (context?.state === "suspended") void context.resume();
      return true;
    }
    try {
      context = new AudioContext();
      source = context.createMediaElementSource(video);
      bass = context.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 140;
      mid = context.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 900;
      mid.Q.value = 0.8;
      treble = context.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = 4200;
      panner = context.createStereoPanner();
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.015;
      compressor.release.value = 0.22;
      master = context.createGain();
      source.connect(bass).connect(mid).connect(treble).connect(panner).connect(compressor).connect(master).connect(context.destination);
      initialized = true;
      void context.resume();
      controls.status.textContent = "Audio Lab active — presets transition smoothly.";
      return true;
    } catch (error) {
      crossOriginBlocked = true;
      controls.status.textContent = "Audio effects are unavailable for this media source because the browser blocks Web Audio access to it.";
      return false;
    }
  }

  function setValues(values) {
    if (!ensureAudio()) return;
    const mapping = {
      master: controls.master,
      bass: controls.bass,
      mid: controls.mid,
      treble: controls.treble,
      space: controls.space,
      threeD: controls.threeD,
    };
    Object.entries(values).forEach(([key, value]) => {
      if (mapping[key]) mapping[key].value = String(value);
    });
    smooth(master?.gain, values.master ?? controls.master.value);
    smooth(bass?.gain, values.bass ?? controls.bass.value);
    smooth(mid?.gain, values.mid ?? controls.mid.value);
    smooth(treble?.gain, values.treble ?? controls.treble.value);
    smooth(panner?.pan, values.threeD ?? controls.threeD.value);
    // Space is implemented as a gentle stereo-pan amount plus compressor relief,
    // avoiding unsafe artificial loudness while still creating a wider soundstage.
    const space = Number(values.space ?? controls.space.value);
    smooth(panner?.pan, Number(values.threeD ?? controls.threeD.value) * Math.min(1, 0.3 + space * 0.7));
    if (compressor) smooth(compressor.threshold, -18 + space * 3);
  }

  const presets = {
    normal: { master: 1, bass: 0, mid: 0, treble: 0, space: 0, threeD: 0 },
    bass: { master: 1, bass: 7, mid: 0.5, treble: 1, space: 0.08, threeD: 0 },
    voice: { master: 0.98, bass: -2, mid: 4.5, treble: 2.5, space: 0.05, threeD: 0 },
    warm: { master: 1, bass: 3.5, mid: 1.5, treble: -2, space: 0.12, threeD: 0 },
    movie: { master: 1, bass: 4.5, mid: -1, treble: 2, space: 0.38, threeD: 0.12 },
    space: { master: 1, bass: 2, mid: 0, treble: 2.5, space: 0.7, threeD: 0.45 },
    wide: { master: 1, bass: 2.5, mid: 0, treble: 1.8, space: 0.9, threeD: 0.65 },
    mashup: { master: 0.96, bass: 4, mid: 2.2, treble: 4, space: 0.55, threeD: 0.35 },
    night: { master: 0.82, bass: -1, mid: 1.8, treble: -3.5, space: 0.05, threeD: 0 },
  };

  panel.querySelectorAll("[data-audio-preset]").forEach((button) => {
    button.addEventListener("click", () => setValues(presets[button.dataset.audioPreset] || presets.normal));
  });
  [controls.master, controls.bass, controls.mid, controls.treble, controls.space, controls.threeD].forEach((input) => {
    input.addEventListener("input", () => {
      setValues({
        master: controls.master.value,
        bass: controls.bass.value,
        mid: controls.mid.value,
        treble: controls.treble.value,
        space: controls.space.value,
        threeD: controls.threeD.value,
      });
    });
  });
  panel.querySelector(".audio-reset")?.addEventListener("click", () => setValues(presets.normal));
}
`;

if (!source.includes(marker)) source += addition;
await writeFile(path, source);
console.log(`Updated ${path} with final embedded-player and Audio Lab features.`);
