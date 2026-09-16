import { readFile, writeFile } from "node:fs/promises";

const path = "public/watch.js";
let source = await readFile(path, "utf8");
const marker = "// VIDBEST PLAYER POLISH v4";
const old = source.indexOf("\n" + marker);
if (old >= 0) source = source.slice(0, old).trimEnd() + "\n";

const initAnchor = "  enhanceCommentForm();\n";
if (!source.includes(initAnchor)) throw new Error("Cannot find watch page initializer");
if (!source.includes("  initializeEmbeddedAudioLab();")) {
  source = source.replace(initAnchor, initAnchor + "  enhanceNativePlayer();\n");
  const audioAnchor = "  initializeAudioLab();\n";
  source = source.replace(audioAnchor, audioAnchor + "  initializeEmbeddedAudioLab();\n  repairNativePlayerControls();\n");
}

const addition = String.raw`

${marker}

/* Native controls: reuse the proven Vid.Best control bar, move it into the player stage,
   and explicitly keep the browser's own controls enabled. This removes the old extra row. */
function repairNativePlayerControls() {
  const player = document.querySelector("#watch-player");
  if (!player) return;
  const stage = player.querySelector(".watch-player-stage");
  const media = stage?.querySelector("video, audio");
  if (media instanceof HTMLMediaElement) {
    media.controls = true;
    media.setAttribute("controls", "");
    media.playsInline = true;
    media.setAttribute("playsinline", "");
    media.setAttribute("webkit-playsinline", "");
  }
  const tools = player.querySelector(".watch-player-stage + .player-tools") || player.querySelector(".player-tools");
  if (stage && tools && tools.parentElement !== stage) stage.append(tools);
  if (stage && tools) {
    tools.classList.add("vidbest-stage-tools");
    tools.setAttribute("aria-label", "Vid.Best advanced playback controls");
  }
}

/* Best-effort Audio Lab for embedded media. Cross-origin frames cannot be equalized by the
   parent page; only APIs exposed by the provider are used there. Same-origin frame media
   gets the same Web Audio EQ/reverb path as native media. */
function initializeEmbeddedAudioLab() {
  const player = document.querySelector("#watch-player");
  if (!player || player.dataset.vidbestEmbeddedAudio === "1") return;
  if (player.querySelector("video, audio")) return;
  const frame = player.querySelector("iframe");
  if (!frame) return;
  player.dataset.vidbestEmbeddedAudio = "1";

  const panel = document.createElement("section");
  panel.className = "vidbest-audio-lab vidbest-embedded-audio-lab";
  panel.innerHTML = [
    '<div class="vidbest-audio-head"><div><p>Audio Lab</p><h2>Sound effects & equalizer</h2><small>Full EQ works for same-origin media. Cross-origin embeds expose only the controls their provider allows.</small></div><button type="button" data-v4-reset>Reset</button></div>',
    '<div class="vidbest-audio-presets" role="group" aria-label="Sound presets">',
    '<button type="button" data-v4-p="normal">Normal</button><button type="button" data-v4-p="bass">Bass Boost</button><button type="button" data-v4-p="voice">Clear Voice</button><button type="button" data-v4-p="warm">Warm</button><button type="button" data-v4-p="movie">Movie</button><button type="button" data-v4-p="space">3D Space</button><button type="button" data-v4-p="wide">Surround Wide</button><button type="button" data-v4-p="mashup">Mashup</button><button type="button" data-v4-p="night">Night</button>',
    '</div><div class="vidbest-audio-sliders">',
    '<label>Master <input data-v4-a="master" type="range" min="0" max="1.25" step="0.01" value="1"></label>',
    '<label>Bass <input data-v4-a="bass" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Mid <input data-v4-a="mid" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Treble <input data-v4-a="treble" type="range" min="-12" max="12" step="0.5" value="0"></label>',
    '<label>Space <input data-v4-a="space" type="range" min="0" max="1" step="0.01" value="0"></label>',
    '<label>3D <input data-v4-a="depth" type="range" min="0" max="1" step="0.01" value="0"></label>',
    '</div><p class="vidbest-audio-status" data-v4-status aria-live="polite">Checking embedded media…</p><p class="vidbest-audio-truth">3D Space and Surround Wide are stereo-space simulations, not true multichannel surround.</p>',
  ].join("");
  player.insertAdjacentElement("afterend", panel);

  const inputs = Object.fromEntries([...panel.querySelectorAll("[data-v4-a]")].map((x) => [x.dataset.v4A, x]));
  const status = panel.querySelector("[data-v4-status]");
  const presets = {
    normal:[1,0,0,0,0,0], bass:[1,6,0,1,.04,0], voice:[1,-2,5,3,.04,0], warm:[1,4,0,-3,.08,0],
    movie:[1,3,2,3,.42,.18], space:[1,1,0,2,.72,.65], wide:[1,1,0,2,.9,.22], mashup:[1.06,5,2,5,.65,.75], night:[.72,-4,2,-4,.12,0]
  };
  let frameMedia = null;
  let graph = null;
  let provider = "external";

  const setStatus = (text, tone = "") => { status.textContent = text; status.dataset.tone = tone; };
  const values = () => ({ master:+inputs.master.value, bass:+inputs.bass.value, mid:+inputs.mid.value, treble:+inputs.treble.value, space:+inputs.space.value, depth:+inputs.depth.value });
  const smooth = (param, value) => { try { param?.setTargetAtTime(Number(value), (graph?.context.currentTime || 0) + .001, .16); } catch {} };
  const setPreset = (v) => { ["master","bass","mid","treble","space","depth"].forEach((k,i)=>inputs[k].value=v[i]); apply(); };

  const providerVolume = (value) => {
    const v = Math.max(0, Math.min(1, value));
    try {
      if (provider === "youtube") {
        const origin = new URL(frame.src, location.href).origin;
        if (v <= 0) frame.contentWindow?.postMessage(JSON.stringify({event:"command",func:"mute",args:[]}), origin);
        else {
          frame.contentWindow?.postMessage(JSON.stringify({event:"command",func:"unMute",args:[]}), origin);
          frame.contentWindow?.postMessage(JSON.stringify({event:"command",func:"setVolume",args:[Math.round(v*100)]}), origin);
        }
      } else if (provider === "vimeo") {
        frame.contentWindow?.postMessage(JSON.stringify({method:"setVolume",value:v}), "https://player.vimeo.com");
      }
    } catch {}
  };

  const apply = () => {
    const v = values();
    if (graph) {
      smooth(graph.bass.gain,v.bass); smooth(graph.mid.gain,v.mid); smooth(graph.treble.gain,v.treble);
      smooth(graph.dry.gain,1-v.space*.62); smooth(graph.wet.gain,v.space*.78); smooth(graph.master.gain,v.master);
      if (graph.panner) smooth(graph.panner.pan,0);
      setStatus("Full embedded Audio Lab active · smooth transition","ok");
    } else if (provider === "youtube" || provider === "vimeo") {
      providerVolume(v.master); setStatus("Embedded "+provider+" · Master volume works; EQ/3D needs direct media access","warn");
    }
  };

  const connect = (media) => {
    const C=window.AudioContext||window.webkitAudioContext;
    if (!(media instanceof HTMLMediaElement) || !C) return false;
    try {
      const context=new C(), source=context.createMediaElementSource(media), bass=context.createBiquadFilter(), mid=context.createBiquadFilter(), treble=context.createBiquadFilter();
      bass.type="lowshelf"; bass.frequency.value=160; mid.type="peaking"; mid.frequency.value=1000; mid.Q.value=.9; treble.type="highshelf"; treble.frequency.value=4200;
      const convolver=context.createConvolver(), dry=context.createGain(), wet=context.createGain(), compressor=context.createDynamicsCompressor(), master=context.createGain(), panner=context.createStereoPanner?context.createStereoPanner():null;
      compressor.threshold.value=-18; compressor.knee.value=18; compressor.ratio.value=3; compressor.attack.value=.01; compressor.release.value=.2;
      const len=Math.floor(context.sampleRate*1.25), ir=context.createBuffer(2,len,context.sampleRate);
      for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,4);} convolver.buffer=ir;
      source.connect(bass).connect(mid).connect(treble); treble.connect(dry).connect(compressor); treble.connect(convolver).connect(wet).connect(compressor); (panner?compressor.connect(panner).connect(master):compressor.connect(master)); master.connect(context.destination);
      graph={context,bass,mid,treble,dry,wet,master,panner};
      panel.addEventListener("pointerdown",()=>void context.resume().catch(()=>{}),{passive:true});
      media.addEventListener("play",()=>void context.resume().catch(()=>{}));
      return true;
    }catch(e){console.warn("Vid.Best Audio Lab:",e?.message||e);return false;}
  };

  const trySameOrigin = () => {
    if (graph) return true;
    try {
      const media = frame.contentDocument?.querySelector("video, audio");
      if (media instanceof HTMLMediaElement) {
        frameMedia=media;
        if (connect(media)) { panel.querySelectorAll("input[data-v4-a]").forEach((x)=>x.disabled=false); setStatus("Same-origin embedded media detected · full Audio Lab active","ok"); apply(); return true; }
      }
    } catch {}
    return false;
  };

  try { provider = vb4Provider(frame); } catch {}
  if (!trySameOrigin()) {
    const disableEq = () => panel.querySelectorAll("input[data-v4-a]").forEach((x)=>{ if(x.dataset.v4A!=="master")x.disabled=true; });
    disableEq();
    if(provider==="youtube"||provider==="vimeo") setStatus("Embedded "+provider+" · Master volume works; EQ/3D needs direct media access","warn");
    else setStatus("Cross-origin embed · EQ/3D cannot be applied by the parent page","warn");
    frame.addEventListener("load",()=>{ if(!trySameOrigin())disableEq(); });
  }

  panel.querySelector("[data-v4-reset]")?.addEventListener("click",()=>setPreset(presets.normal));
  panel.querySelectorAll("[data-v4-p]").forEach((b)=>b.addEventListener("click",()=>setPreset(presets[b.dataset.v4P]||presets.normal)));
  Object.values(inputs).forEach((x)=>x.addEventListener("input",apply));
}

(() => {
  if (document.getElementById("vidbest-player-polish-v4-css")) return;
  const style = document.createElement("style");
  style.id = "vidbest-player-polish-v4-css";
  style.textContent = [
    ".watch-player-stage{position:relative}",
    ".watch-player-stage .player-tools.vidbest-stage-tools{position:absolute!important;left:8px;right:8px;bottom:42px;z-index:30;margin:0!important;width:auto!important;max-width:none!important;display:flex!important;align-items:center;gap:5px;flex-wrap:wrap;padding:7px 8px!important;border-radius:12px;background:linear-gradient(180deg,rgba(4,7,16,.08),rgba(4,7,16,.94));box-sizing:border-box;pointer-events:none}",
    ".watch-player-stage .player-tools.vidbest-stage-tools>*{pointer-events:auto}",
    ".watch-player-stage .player-tools.vidbest-stage-tools button{min-height:30px;white-space:nowrap}",
    ".watch-player-stage .player-tools.vidbest-stage-tools .player-message{width:100%}",
    ".vidbest-embedded-audio-lab{margin-top:0}",
    "@media(max-width:760px){.watch-player-stage .player-tools.vidbest-stage-tools{bottom:40px;left:6px;right:6px;padding:6px!important}.watch-player-stage .player-tools.vidbest-stage-tools button{padding:5px 7px;font-size:11px}.vidbest-embedded-audio-lab{padding:10px!important}}",
  ].join("");
  document.head.append(style);
})();
`;

source += addition;
await writeFile(path, source);
