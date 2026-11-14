# Thunder, Again — VidBest Midnight Shorts
A 14-second, 960×540 illustrated short based on the supplied bedroom artwork. The original illustration is texture-mapped onto a Blender mesh. Independent jaw, head and breathing keys plus camera animation preserve both characters. Revideo 0.11 renders timed titles and caption plates. FFmpeg composites the Blender frames and Revideo pass and muxes stereo sound.

## Run
On Linux with Node 22.12+ or 24, Blender, Python 3 with numpy, Chromium headless shell and FFmpeg installed, run `sh run.sh`. Set CHROME_PATH to an existing headless shell executable or let Puppeteer install one. Outputs are build/Thunder_Again.mp4 and build/Thunder_Again.blend. Working frames can use hundreds of MB. Use a development machine or Codespace with enough space. The demo was rendered on the development worker with Blender 4.3.2. Oracle synthesized the two dialogue lines using its installed Piper model.

## Audio and repeatability
Bundled audio/lead.wav and reply.wav are generated English Piper dialogue. audio/bark.wav is a real waveform generated with bark.cpp, the small F16 model, seed 43 and prompt [sighs]. The mix uses a short excerpt. Snoring, stereo positioning and the opening/closing notes are synthesized in mix.py. Reusing bundled WAVs avoids model downloads and keeps rerenders consistent. To regenerate the Bark cue with a built bark.cpp executable and weights:
    /path/to/main -m /path/to/bark-small_weights-f16.bin -s 43 -t 3 -p '[sighs]' -o audio/bark.wav
Implementation tested: https://github.com/PABannier/bark.cpp/tree/5d5be84f089ab9ea53b7a793f088d3fbf7247495
Weights: https://huggingface.co/Green-Sky/bark-ggml
On the Oracle AI host, to regenerate the dialogue from the project root:
    printf '%s' 'Is that thunder?' | .voice-venv/bin/python neural_voice.py /path/to/audio/lead.wav
    printf '%s' 'Five more minutes.' | .voice-venv/bin/python neural_voice.py /path/to/audio/reply.wav

## Edit
The .blend file packs the illustration. Edit the shape keys and camera curves directly or change blender_scene.py to rebuild. scene.json contains the dialogue/caption timing; match WAVs when changing dialogue. This preset has a 14-second timeline; new scene lengths and new poses require corresponding edits. It does not automatically unflatten arbitrary paintings or generate new limbs. For a later shot, retain the mesh, texture and keyframes. The Studio's existing MP4 importer accepts the final output.
