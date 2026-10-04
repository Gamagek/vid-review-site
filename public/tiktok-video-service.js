(() => {
  const GATEWAY_ORIGIN = "https://video.megasale.win";
  const DEFAULT_INTERVAL_MS = 3000;
  const DEFAULT_MAX_ATTEMPTS = 15;

  function parseGatewayUrl(value) {
    const url = new URL(String(value || ""), window.location.href);
    if (url.origin !== GATEWAY_ORIGIN) {
      throw new Error("Invalid TikTok gateway origin.");
    }

    const sourceUrl = url.searchParams.get("url") || "";
    const exp = url.searchParams.get("exp") || "";
    const sig = url.searchParams.get("sig") || "";

    let source;
    try {
      source = new URL(sourceUrl);
    } catch {
      throw new Error("Invalid TikTok source URL.");
    }

    const host = source.hostname.toLowerCase();
    const id = source.pathname.match(/\/video\/(\d+)/)?.[1] || "";

    if (!id || !/^\d{15,25}$/.test(id)) {
      throw new Error("Invalid TikTok video ID.");
    }

    if (host !== "www.tiktok.com" && host !== "tiktok.com") {
      throw new Error("Invalid TikTok source host.");
    }

    if (!exp || !sig) {
      throw new Error("Signed gateway parameters are missing.");
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

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const timer = window.setTimeout(resolve, ms);
      const abort = () => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new DOMException("Aborted", "AbortError"));
      };

      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async function fetchStatus(parsed, signal) {
    const response = await fetch(buildStatusUrl(parsed), {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal,
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) {
      return { status: "scraping" };
    }

    if (response.status === 429 || response.status >= 500) {
      return { status: "transient-error" };
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(payload.error || "Video status request failed.");
    }

    return payload;
  }

  async function pollR2Video(options = {}) {
    const parsed = parseGatewayUrl(options.gatewayUrl);
    const maxAttempts = Math.max(1, Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS));
    const intervalMs = Math.max(250, Number(options.intervalMs || DEFAULT_INTERVAL_MS));
    const signal = options.signal;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const payload = await fetchStatus(parsed, signal);
      const status = String(payload.status || "").toLowerCase();

      if (typeof options.onStatus === "function") {
        options.onStatus({
          status: status || "scraping",
          attempt,
          maxAttempts,
        });
      }

      if (status === "cached") {
        return {
          id: parsed.id,
          streamUrl: buildStreamUrl(parsed),
          sourceUrl: parsed.sourceUrl,
          attempt,
        };
      }

      if (status === "error" || status === "forbidden" || status === "invalid_id") {
        throw new Error(
          payload.error ||
          payload.message ||
          "The video could not be prepared."
        );
      }

      if (attempt < maxAttempts) {
        await wait(intervalMs, signal);
      }
    }

    throw new Error("The video is still being prepared. Please try again.");
  }

  window.VidBestTikTokVideoService = Object.freeze({
    parseGatewayUrl,
    buildStatusUrl,
    buildStreamUrl,
    pollR2Video,
  });
})();