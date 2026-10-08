// TikTok cached metadata and the on-demand Cloudflare R2 player.
(() => {
  const ORIGIN = "https://www.tiktok.com";
  const TTL = 5 * 60 * 1000;
  const pending = new Map();
  const memory = new Map();

  function parse(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const match = url.pathname.match(/^\/@([A-Za-z0-9_.]{1,32})\/video\/(\d{15,25})\/?$/);
      if (url.protocol !== "https:" || url.username || url.password || url.port || host !== "tiktok.com" || !match) return null;
      return {
        id: match[2],
        username: match[1],
        url: `${ORIGIN}/@${match[1]}/video/${match[2]}`,
      };
    } catch {
      return null;
    }
  }

  function read(key) {
    try {
      return memory.get(key) || JSON.parse(sessionStorage.getItem(key));
    } catch {
      return memory.get(key);
    }
  }

  function write(key, value) {
    memory.set(key, value);
    if (memory.size > 50) {
      const oldest = memory.keys().next().value;
      memory.delete(oldest);
      try { sessionStorage.removeItem(oldest); } catch {}
    }
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  async function getMetadata(value) {
    const share = parse(value);
    if (!share) throw new Error("Use the full TikTok video sharing link.");

    const key = "vidbest:tiktok:metadata:v4:" + share.id;
    const cached = read(key);
    if (cached?.until > Date.now()) {
      if (cached.error) throw Object.assign(new Error(cached.error), { retryAfter: Math.ceil((cached.until - Date.now()) / 1000) });
      if (cached.payload?.video_id === share.id) return cached.payload;
    }
    if (pending.has(key)) return pending.get(key);

    const task = (async () => {
      try {
        const endpoint = new URL("/api/tiktok/embed", location.origin);
        endpoint.searchParams.set("url", share.url);
        const response = await fetch(endpoint.pathname + endpoint.search, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(9000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          const rawRetry = response.headers.get("Retry-After");
          const retry = /^\d+$/.test(rawRetry || "") ? Number(rawRetry) : 30;
          throw Object.assign(new Error(payload?.error || "TikTok preview details are temporarily unavailable."), {
            retryAfter: Math.max(10, retry),
          });
        }
        if (String(payload.video_id || "") !== share.id || parse(payload.source_url)?.id !== share.id) {
          throw new Error("The preview returned a different TikTok video.");
        }
        write(key, { payload, until: Date.now() + (String(payload.cache_source || "").includes("stale") ? 30000 : TTL) });
        return payload;
      } catch (error) {
        const retryAfter = Math.min(86400, Math.max(10, Number(error.retryAfter || 30)));
        write(key, { error: error.message, until: Date.now() + retryAfter * 1000 });
        throw error;
      }
    })().finally(() => pending.delete(key));

    pending.set(key, task);
    return task;
  }

  // The Cloudflare player reports cache/preparation/playback separately.
  // The signing secret and optional preparation backend stay server-side.
  const GATEWAY_WATCH = "https://tiktok-oembed-gateway.gkasunc.workers.dev/watch";
  const PLAYER_TIMEOUT = 14000;
  let activePreview = 0;
  let activeFrame = null;
  let readyTimer = null;
  let stopObserving = null;

  function gatewayWatchUrl(value) {
    const share = parse(value);
    if (!share) return null;
    const target = new URL(GATEWAY_WATCH);
    target.searchParams.set("url", share.url);
    return target.href;
  }

  function observeGateway(frame, value, callback) {
    const share = parse(value);
    const origin = new URL(GATEWAY_WATCH).origin;
    const states = new Set(["preparing", "cached", "playing", "paused", "ended", "error"]);
    const listener = (event) => {
      const data = event.data;
      if (!share || !frame.contentWindow || event.source !== frame.contentWindow || event.origin !== origin ||
          data?.channel !== "vidbest-gateway" || data.video_id !== share.id || !states.has(data.state)) return;
      callback({ state: data.state, message: typeof data.message === "string" ? data.message.slice(0, 400) : "" });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }
  function renderUnavailable(dialog, message) {
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    if (!host) return;
    const fallback = document.createElement("div");
    fallback.className = "tiktok-player-fallback";
    const title = document.createElement("strong");
    title.textContent = "TikTok video preview";
    const note = document.createElement("p");
    note.textContent = message;
    fallback.append(title, note);
    host.replaceChildren(fallback);
  }
  function cleanupEmbed(dialog) {
    stopObserving?.(); stopObserving = null;
    if (readyTimer !== null) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    if (host) host.replaceChildren();
    activeFrame = null;
  }
  function ensureDialog() {
    let dialog = document.querySelector("#vidbest-tiktok-preview-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "vidbest-tiktok-preview-dialog";
    dialog.className = "tiktok-preview-dialog";
    dialog.innerHTML = [
      '<div class="tiktok-preview-dialog-card">',
      '  <button type="button" class="tiktok-preview-dialog-close" aria-label="Close TikTok player">×</button>',
      '  <div class="tiktok-preview-dialog-media" data-tiktok-embed-host></div>',
      '  <div class="tiktok-preview-dialog-copy">',
      '    <span class="tiktok-preview-dialog-kicker">TikTok · Vid.Best player</span>',
      '    <strong data-tiktok-dialog-title>TikTok video</strong>',
      '    <span data-tiktok-dialog-author>TikTok creator</span>',
      '    <p data-tiktok-dialog-description>Loading cached TikTok details…</p>',
      '    <p class="tiktok-preview-dialog-status" data-tiktok-dialog-status role="status" aria-live="polite"></p>',
      '    <div class="tiktok-preview-dialog-actions">',
      '      <button type="button" class="button ghost" data-tiktok-dialog-cancel>Close player</button>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("");
    const close = () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else {
        dialog.removeAttribute("open");
        ++activePreview;
        cleanupEmbed(dialog);
      }
    };
    dialog.querySelector(".tiktok-preview-dialog-close").addEventListener("click", close);
    dialog.querySelector("[data-tiktok-dialog-cancel]").addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener("close", () => { ++activePreview; cleanupEmbed(dialog); });
    window.addEventListener("pagehide", () => { ++activePreview; cleanupEmbed(dialog); });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden || !dialog.open || !activeFrame) return;
      ++activePreview;
      cleanupEmbed(dialog);
      renderUnavailable(dialog, "The player was stopped while the tab is in the background.");
    });
    document.body.append(dialog);
    return dialog;
  }

  function mountGatewayPlayer(dialog, share, token) {
    if (!dialog.open || token !== activePreview) return;
    cleanupEmbed(dialog);
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    const status = dialog.querySelector("[data-tiktok-dialog-status]");
    if (document.hidden) {
      renderUnavailable(dialog, "Return to this tab to load the gateway player.");
      status.textContent = "The tab is inactive.";
      return;
    }
    const target = gatewayWatchUrl(share.url);
    if (!target) return;
    const frame = document.createElement("iframe");
    frame.className = "tiktok-official-player-v1";
    frame.title = "TikTok gateway video by @" + share.username;
    frame.loading = "eager";
    frame.referrerPolicy = "no-referrer";
    frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    frame.allowFullscreen = true;
    const active = () => dialog.open && token === activePreview && activeFrame === frame;
    const failed = (text) => {
      if (!active()) return;
      cleanupEmbed(dialog);
      renderUnavailable(dialog, text);
      status.textContent = text;
    };
    frame.addEventListener("load", () => {
      if (!active()) return;
      if (readyTimer !== null) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      // Browser load includes error pages; it is not playback confirmation.
      status.textContent = "Checking video availability…";
    }, { once: true });
    frame.addEventListener("error", () => {
      failed("The signed gateway could not load. No automatic retry was made.");
    }, { once: true });
    status.textContent = "Checking for a playable cached video…";
    activeFrame = frame;
    stopObserving = observeGateway(frame, share.url, (data) => {
      if (!active()) return;
      if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null; }
      status.textContent = data.message;
      // The inner player owns preparation, native controls and deliberate retry.
      // A provider error must not be converted into an unrelated browser lock.
    });
    host.replaceChildren(frame);
    frame.src = target;
    readyTimer = setTimeout(() => {
      readyTimer = null;
      if (active()) status.textContent = "The player is taking longer to load. You can wait or close and reopen it.";
    }, PLAYER_TIMEOUT);
  }

  async function showPreview(value, seed = {}) {
    const share = parse(value);
    if (!share) return false;
    const dialog = ensureDialog();
    ++activePreview;
    cleanupEmbed(dialog);
    const token = activePreview;
    const title = dialog.querySelector("[data-tiktok-dialog-title]");
    const author = dialog.querySelector("[data-tiktok-dialog-author]");
    const description = dialog.querySelector("[data-tiktok-dialog-description]");
    title.textContent = seed.title || "TikTok video";
    author.textContent = seed.author || (share.username ? "@" + share.username : "TikTok creator");
    description.textContent = seed.description || "Video preview from Vid.Best.";
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    requestAnimationFrame(() => {
      if (dialog.open && activePreview === token) mountGatewayPlayer(dialog, share, token);
    });
    void getMetadata(share.url).then((payload) => {
      if (!dialog.open || activePreview !== token) return;
      title.textContent = payload.title || payload.caption || seed.title || "TikTok video";
      author.textContent = payload.author_name || seed.author || (share.username ? "@" + share.username : "TikTok creator");
      description.textContent = payload.description || seed.description || "Vid.Best signed video gateway.";
    }).catch(() => {
      if (dialog.open && activePreview === token) {
        description.textContent = seed.description || "Cached video details are temporarily unavailable.";
      }
    });
    return true;
  }

  window.VidBestTikTok = Object.freeze({ parse, getMetadata, gatewayWatchUrl, observeGateway, showPreview });
})();
