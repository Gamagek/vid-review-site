(() => {
  function mountAudioLab(target, controller) {
    if (!target || !controller) return null;
    if (target.querySelector("[data-vidbest-tiktok-audio-lab]")) return target.querySelector("[data-vidbest-tiktok-audio-lab]");

    const panel = document.createElement("section");
    panel.className = "vidbest-tiktok-audio-lab";
    panel.dataset.vidbestTiktokAudioLab = "1";
    panel.innerHTML = [
      '<div class="vidbest-tiktok-audio-head">',
      '<div><p>Audio Lab</p><h2>EQ & Spatial Audio</h2><small>Local audio effects for the direct R2 video.</small></div>',
      '<button type="button" data-audio-enable>Enable</button>',
      '</div>',
      '<div class="vidbest-tiktok-audio-grid">',
      '<label>Bass <output data-value="bass">0 dB</output><input data-control="bass" type="range" min="-12" max="12" step="0.5" value="0"></label>',
      '<label>Mid <output data-value="mid">0 dB</output><input data-control="mid" type="range" min="-12" max="12" step="0.5" value="0"></label>',
      '<label>Treble <output data-value="treble">0 dB</output><input data-control="treble" type="range" min="-12" max="12" step="0.5" value="0"></label>',
      '<label>Space <output data-value="space">Center</output><input data-control="space" type="range" min="-1" max="1" step="0.02" value="0"></label>',
      '<label>Master <output data-value="master">100%</output><input data-control="master" type="range" min="0" max="1.25" step="0.01" value="1"></label>',
      '</div>',
      '<p class="vidbest-tiktok-audio-status" data-audio-status role="status">Audio Lab is ready when you interact with the player.</p>',
    ].join("");

    const updateLabel = (name, value) => {
      const output = panel.querySelector('[data-value="' + name + '"]');
      if (!output) return;

      const number = Number(value);
      if (name === "master") {
        output.textContent = Math.round(number * 100) + "%";
      } else if (name === "space") {
        if (Math.abs(number) < 0.01) output.textContent = "Center";
        else output.textContent = number < 0 ? "Left " + Math.round(Math.abs(number) * 100) + "%" : "Right " + Math.round(number * 100) + "%";
      } else {
        output.textContent = number > 0 ? "+" + number + " dB" : number + " dB";
      }
    };

    const setStatus = (message, tone = "") => {
      const status = panel.querySelector("[data-audio-status]");
      if (status) {
        status.textContent = message;
        status.dataset.tone = tone;
      }
    };

    const controls = [...panel.querySelectorAll("[data-control]")];

    controls.forEach((input) => {
      const name = input.dataset.control;
      updateLabel(name, input.value);

      input.addEventListener("pointerdown", () => {
        void controller.resume().then((ok) => {
          if (ok) setStatus("Audio Lab active · smooth local processing", "ok");
          else setStatus("Your browser did not allow Web Audio yet. Press Enable or Play the video.", "warn");
        });
      });

      input.addEventListener("input", () => {
        const value = Number(input.value);
        updateLabel(name, value);
        void controller.set(name, value).then((ok) => {
          if (ok) setStatus("Audio Lab active · smooth local processing", "ok");
          else setStatus("Audio effects are unavailable in this browser.", "warn");
        });
      });
    });

    panel.querySelector("[data-audio-enable]")?.addEventListener("click", () => {
      void controller.resume().then((ok) => {
        setStatus(
          ok ? "Audio Lab active · smooth local processing" : "Audio effects are unavailable in this browser.",
          ok ? "ok" : "warn"
        );
      });
    });

    target.append(panel);
    return panel;
  }

  window.VidBestAudioLabUI = Object.freeze({ mountAudioLab });
})();