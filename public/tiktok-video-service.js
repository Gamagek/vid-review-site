(() => {
  const GATEWAY_ORIGIN = "https://video.megasale.win";
  const DEFAULT_INTERVAL_MS = 3000;
  const DEFAULT_MAX_ATTEMPTS = 15;

  class VideoServiceError extends Error {
    constructor(message, code = "VIDEO_SERVICE_ERROR") {
      super(message);
      this.name = "VideoServiceError";
      this.code = code;
    }
  }

  function parseGatewayUrl(value) {
    let url;
    try {
      url = new URL(String(value || ""), window.location.href);
    } catch {
      throw new VideoServiceError("Invalid TikTok gateway URL.", "INVALID_GATEWAY_URL");
    }

    if (url.origin !== GATEWAY_ORIGIN) {
      throw new VideoServiceError("Invalid TikTok gateway origin.", "INVALID_GATEWAY_ORIGIN");
    }

    const sourceUrl = url.searchParams.get("url") || "";
    const exp = url.searchParams.get("exp") || "";
    const sig = url.searchParams.get("sig") || "";

    let source;
    try {
      source = new URL(sourceUrl);
    } catch {
      throw new VideoServiceError("Invalid TikTok source URL.", "INVALID_SOURCE_URL");
    }

    const host = source.hostname.toLowerCase();
    const id = source.pathname.match(/\/video\/(\d+)/)?.[1] || "";

    if (!id || !/^\d{15,25}$/.test(id)) {
      throw new VideoServiceError("Invalid TikTok video ID.", "INVALID_VIDEO_ID");
    }

    if (host !== "www.tiktok.com" && host !== "tiktok.com") {
      throw new VideoServiceError("Invalid TikTok source host.", "INVALID_SOURCE_HOST");
    }

    if (!exp || !sig) {
      throw new VideoServiceError("Signed gateway parameters are missing.", "MISSING_SIGNATURE");
    }

    return {
      gatewayUrl: url,
      sourceUrl: source.toString(),
      id,
      exp,
      sig,
    };
  }

  function buildStatusUrl(parsed) {
    const url = new URL("/status", GATEWAY_ORIGIN);
    url.searchParams.set("id", parsed.id);
    url.searchParams.set("exp", parsed.exp);
    url.searchParams.set("sig", parsed.sig);
    url.searchParams.set("url", parsed.sourceUrl);
    return url.toString();
  }

  function buildStreamUrl(parsed) {
    const url = new URL("/stream", GATEWAY_ORIGIN);
    url.searchParams.set("id", parsed.id);
    url.searchParams.set("exp", parsed.exp);
    url.searchParams.set("sig", parsed.sig);
    return url.toString();
  }

  function normalizeStreamUrl(value, parsed) {
    let url;
    try {
      url = new URL(value || buildStreamUrl(parsed), GATEWAY_ORIGIN);
    } catch {
      throw new VideoServiceError("The gateway returned an invalid stream URL.", "INVALID_STREAM_URL");
    }

    if (url.origin !== GATEWAY_ORIGIN || url.pathname !== "/stream") {
      throw new VideoServiceError("The gateway returned an invalid stream origin.", "INVALID_STREAM_ORIGIN");
    }

    if (
      url.searchParams.get("id") !== parsed.id ||
      url.searchParams.get("exp") !== parsed.exp ||
      url.searchParams.get("sig") !== parsed.sig
    ) {
      throw new VideoServiceError("The gateway returned mismatched stream credentials.", "INVALID_STREAM_SIGNATURE");
    }

    return url.toString();
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      let settled = false;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = window.setTimeout(finish, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function parseJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function requestStatus(parsed, signal, mode) {
    const statusUrl = buildStatusUrl(parsed);

    if (mode === "opaque") {
      try {
        await fetch(statusUrl, {
          method: "GET",
          mode: "no-cors",
          cache: "no-store",
          credentials: "omit",
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
      }
      return { mode: "opaque", payload: null };
    }

    try {
      const response = await fetch(statusUrl, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        signal,
        headers: { Accept: "application/json" },
      });

      if (response.status === 404 || response.status === 425) {
        return { mode: "cors", payload: { status: "scraping" } };
      }

      if (response.status === 429 || response.status >= 500) {
        return { mode: "cors", payload: { status: "transient-error" } };
      }

      const payload = await parseJson(response);
      if (!response.ok) {
        const status = String(payload.status || "").toLowerCase();
        if (status === "forbidden" || response.status === 403) {
          throw new VideoServiceError("The signed video link expired. Reload this page.", "FORBIDDEN");
        }
        throw new VideoServiceError(
          payload.error || payload.message || "Video status request failed.",
          "STATUS_REQUEST_FAILED"
        );
      }

      return { mode: "cors", payload };
    } catch (error) {
      if (signal?.aborted || error instanceof VideoServiceError) throw error;

      try {
        await fetch(statusUrl, {
          method: "GET",
          mode: "no-cors",
          cache: "no-store",
          credentials: "omit",
          signal,
        });
      } catch (opaqueError) {
        if (signal?.aborted) throw opaqueError;
      }

      return { mode: "opaque", payload: null };
    }
  }

  async function probeStream(parsed, signal) {
    const streamUrl = buildStreamUrl(parsed);

    try {
      const response = await fetch(streamUrl, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        signal,
      });

      const type = String(response.headers.get("content-type") || "").toLowerCase();
      const ready = response.ok && type.includes("video/");
      try {
        await response.body?.cancel();
      } catch {}

      return ready ? streamUrl : "";
    } catch (error) {
      if (signal?.aborted) throw error;
      return "";
    }
  }

  async function pollR2Video(options = {}) {
    const parsed = parseGatewayUrl(options.gatewayUrl);
    const maxAttempts = Math.max(1, Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS));
    const intervalMs = Math.max(250, Number(options.intervalMs || DEFAULT_INTERVAL_MS));
    const signal = options.signal;
    let statusMode = "cors";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await requestStatus(parsed, signal, statusMode);
      statusMode = result.mode;
      const payload = result.payload || {};
      const status = String(payload.status || (statusMode === "opaque" ? "scraping" : "")).toLowerCase();

      if (typeof options.onStatus === "function") {
        options.onStatus({
          status: status || "scraping",
          attempt,
          maxAttempts,
          transport: statusMode,
        });
      }

      if (status === "cached") {
        return {
          id: parsed.id,
          streamUrl: normalizeStreamUrl(payload.stream, parsed),
          sourceUrl: parsed.sourceUrl,
          attempt,
        };
      }

      if (status === "error" || status === "forbidden" || status === "invalid_id") {
        throw new VideoServiceError(
          payload.error || payload.message || "The video could not be prepared.",
          "PREPARATION_FAILED"
        );
      }

      if (statusMode === "opaque" || status === "transient-error") {
        const streamUrl = await probeStream(parsed, signal);
        if (streamUrl) {
          if (typeof options.onStatus === "function") {
            options.onStatus({
              status: "cached",
              attempt,
              maxAttempts,
              transport: statusMode,
            });
          }
          return {
            id: parsed.id,
            streamUrl,
            sourceUrl: parsed.sourceUrl,
            attempt,
          };
        }
      }

      if (attempt < maxAttempts) {
        await wait(intervalMs, signal);
      }
    }

    throw new VideoServiceError(
      "The video is still being prepared. Please try again.",
      "POLL_TIMEOUT"
    );
  }

  window.VidBestTikTokVideoService = Object.freeze({
    GATEWAY_ORIGIN,
    VideoServiceError,
    parseGatewayUrl,
    buildStatusUrl,
    buildStreamUrl,
    pollR2Video,
  });
})();