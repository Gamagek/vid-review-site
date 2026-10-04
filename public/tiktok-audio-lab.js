(() => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  function createAudioLab(media) {
    let context = null;
    let source = null;
    let bass = null;
    let mid = null;
    let treble = null;
    let panner = null;
    let master = null;
    let connected = false;

    const values = {
      master: 1,
      bass: 0,
      mid: 0,
      treble: 0,
      space: 0,
    };

    function smooth(param, value) {
      if (!context || !param) return;
      const now = context.currentTime;
      try {
        param.setTargetAtTime(Number(value), now, 0.045);
      } catch {
        try {
          param.value = Number(value);
        } catch {}
      }
    }

    function connect() {
      if (connected) return true;
      if (!(media instanceof HTMLMediaElement) || !AudioContextClass) return false;

      try {
        context = new AudioContextClass();
        source = context.createMediaElementSource(media);

        bass = context.createBiquadFilter();
        bass.type = "lowshelf";
        bass.frequency.value = 160;

        mid = context.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 0.9;

        treble = context.createBiquadFilter();
        treble.type = "highshelf";
        treble.frequency.value = 4200;

        panner = context.createStereoPanner();
        master = context.createGain();
        master.gain.value = values.master;

        source
          .connect(bass)
          .connect(mid)
          .connect(treble)
          .connect(panner)
          .connect(master)
          .connect(context.destination);

        media.volume = 1;
        connected = true;
        return true;
      } catch (error) {
        console.warn("Vid.Best Audio Lab could not attach:", error);
        try { context?.close(); } catch {}
        context = null;
        return false;
      }
    }

    async function resume() {
      if (!connect()) return false;

      try {
        if (context.state === "suspended") {
          await context.resume();
        }
      } catch {
        return false;
      }

      return context.state === "running";
    }

    async function set(name, value) {
      if (!(name in values)) return false;
      values[name] = Number(value);

      const ready = await resume();
      if (!ready) return false;

      if (name === "master") smooth(master?.gain, Math.max(0, Math.min(1.25, values.master)));
      if (name === "bass") smooth(bass?.gain, Math.max(-12, Math.min(12, values.bass)));
      if (name === "mid") smooth(mid?.gain, Math.max(-12, Math.min(12, values.mid)));
      if (name === "treble") smooth(treble?.gain, Math.max(-12, Math.min(12, values.treble)));
      if (name === "space") smooth(panner?.pan, Math.max(-1, Math.min(1, values.space)));

      return true;
    }

    async function setAll(next) {
      Object.keys(values).forEach((key) => {
        if (key in next) values[key] = Number(next[key]);
      });
      const ready = await resume();
      if (!ready) return false;

      smooth(master?.gain, Math.max(0, Math.min(1.25, values.master)));
      smooth(bass?.gain, Math.max(-12, Math.min(12, values.bass)));
      smooth(mid?.gain, Math.max(-12, Math.min(12, values.mid)));
      smooth(treble?.gain, Math.max(-12, Math.min(12, values.treble)));
      smooth(panner?.pan, Math.max(-1, Math.min(1, values.space)));
      return true;
    }

    function getValues() {
      return { ...values };
    }

    function isAvailable() {
      return Boolean(AudioContextClass && media instanceof HTMLMediaElement);
    }

    function destroy() {
      try { source?.disconnect(); } catch {}
      try { bass?.disconnect(); } catch {}
      try { mid?.disconnect(); } catch {}
      try { treble?.disconnect(); } catch {}
      try { panner?.disconnect(); } catch {}
      try { master?.disconnect(); } catch {}
      try { context?.close(); } catch {}
      context = null;
      connected = false;
    }

    media?.addEventListener("play", () => {
      void resume();
    });

    return Object.freeze({
      connect,
      resume,
      set,
      setAll,
      getValues,
      isAvailable,
      destroy,
    });
  }

  window.VidBestAudioLab = Object.freeze({ createAudioLab });
})();