(() => {
  const GATEWAY_ORIGIN = "https://video.megasale.win";
  const DEFAULT_INTERVAL_MS = 3000;
  const DEFAULT_MAX_ATTEMPTS = 15;
  const REQUEST_TIMEOUT_MS = 8000;

  class VideoServiceError extends Error {
    constructor(message, code = "VIDEO_SERVICE_ERROR", details = {}) {
      super(message);
      this.name = "VideoServiceError";
      this.code = code;
      this.details = details;
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

    return { gatewayUrl: url, sourceUrl: source.toString(), id, exp, sig };
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
      const timer = window.setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);
      const abort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async function fetchWithTimeout(url, signal) {
    const controller = new AbortController();
    let externalAbort = null;
    if (signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      externalAbort = () => controller.abort();
      signal.addEventListener("abort", externalAbort, { once: true });
    }

    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (error?.name === "AbortError") {
        throw new VideoServiceError("The video gateway did not respond in time.", "GATEWAY_TIMEOUT");
      }
      throw new VideoServiceError("The video gateway is unreachable right now.", "GATEWAY_UNREACHABLE");
    } finally {
      window.clearTimeout(timer);
      if (signal && externalAbort) signal.removeEventListener("abort", externalAbort);
    }
  }

  async function readPayload(response) {
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("application/json")) return {};
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function fetchStatus(parsed, signal) {
    const response = await fetchWithTimeout(buildStatusUrl(parsed), signal);
    const payload = await readPayload(response);

    if (response.status === 403) {
      throw new VideoServiceError(
        payload.error || "The signed video link expired. Reload this page.",
        "FORBIDDEN"
      );
    }

    if (response.status === 429) {
      return { status: "transient-error", message: "The gateway is busy. Retrying shortly." };
    }

    if (response.status === 404 || response.status === 425) {
      return { status: "scraping" };
    }

    if (response.status >= 500) {
      return {
        status: "transient-error",
        message: "The video gateway is temporarily unavailable."
      };
    }

    if (!response.ok) {
      throw new VideoServiceError(
        payload.error || payload.message || "Video status request failed.",
        "STATUS_REQUEST_FAILED"
      );
    }

    return payload;
  }

  async function pollR2Video(options = {}) {
    const parsed = parseGatewayUrl(options.gatewayUrl);
    const maxAttempts = Math.max(1, Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS));
    const intervalMs = Math.max(500, Number(options.intervalMs || DEFAULT_INTERVAL_MS));
    const signal = options.signal;
    let lastTransient = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let payload;
      try {
        payload = await fetchStatus(parsed, signal);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (["GATEWAY_TIMEOUT", "GATEWAY_UNREACHABLE"].includes(error?.code)) {
          lastTransient = error.message;
          payload = { status: "transient-error", message: error.message };
        } else {
          throw error;
        }
      }

      const status = String(payload?.status || "scraping").toLowerCase();

      if (typeof options.onStatus === "function") {
        options.onStatus({
          status,
          attempt,
          maxAttempts,
          message: payload?.message || payload?.error || "",
          retryAfter: payload?.retryAfter || payload?.retry_after || "",
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

      if (status === "cooldown") {
        throw new VideoServiceError(
          payload.error || payload.message || "This video is temporarily waiting before another source attempt.",
          "COOLDOWN",
          { retryAfter: payload.retryAfter || payload.retry_after || "" }
        );
      }

      if (status === "error" || status === "forbidden" || status === "invalid_id") {
        throw new VideoServiceError(
          payload.error || payload.message || "The video could not be prepared.",
          "PREPARATION_FAILED"
        );
      }

      if (attempt < maxAttempts) await wait(intervalMs, signal);
    }

    throw new VideoServiceError(
      lastTransient || "The video is still being prepared. Please try again.",
      lastTransient ? "GATEWAY_UNAVAILABLE" : "POLL_TIMEOUT"
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