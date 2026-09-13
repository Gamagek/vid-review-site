# Vid.Best Teamwork API

Private Oracle Linux service for administrator-requested media analysis. It runs one job at a time to cap peak memory and provides:

- frame sampling with FFmpeg and OCR with Tesseract;
- captions and transcription through an existing `whisper.cpp` binary/model;
- article extraction through Trafilatura;
- optional 4get JSON search grounding through a configurable URL template;
- optional Ollama evidence summary, never published without administrator review.

Deep video/audio download is accepted only when the administrator marks the media as owned and every redirect stays on `TEAMWORK_MEDIA_HOSTS`. Vid.Best should use this for its own R2 media. Provider embeds stay on the provider and are not copied or downloaded.

The API uses persisted jobs because OCR and transcription can outlast one Cloudflare request. `POST /v1/jobs` starts work and `GET /v1/jobs/{id}` retrieves status/results. Both require `Authorization: Bearer …`.

Copy `.env.example` to `.env`, replace the API key with a random value, mount your existing whisper.cpp binary/model paths, and run `docker compose up -d --build`. Put HTTPS with an allowlisted Cloudflare-to-origin route in front of `127.0.0.1:8090`; never expose the plain port publicly.

No useful reasoning model is guaranteed to stay inside 250 MB total RAM. Keep `OLLAMA_MODEL` empty on a tight service, return OCR/transcript evidence to Gemini, and run Ollama separately only when the server has enough memory.
