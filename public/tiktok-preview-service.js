// TikTok cached-metadata client and on-demand official Player v1 popup.
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

  // Official TikTok Player v1: only user action mounts a single iframe.
  // This avoids embed.js entirely; TikTok can still restrict iframe playback.
  const PLAYER_ORIGIN = "https://www.tiktok.com";
  const PLAYER_READY_TIMEOUT = 10000;
  // Avoid repeated provider requests after an error. These are safeguards, not
  // a workaround for TikTok/Akamai restrictions.
  const MIN_PLAYER_REQUEST_INTERVAL = 30000;
  const FAILED_VIDEO_COOLDOWN = 15 * 60 * 1000;
  const FAILED_SITE_COOLDOWN = 2 * 60 * 1000;
  const REQUEST_GATE_KEY = "vidbest:tiktok:player:last-request:v1";
  const FAILURE_GATE_KEY = "vidbest:tiktok:player:site-cooldown:v1";
  const VIDEO_FAILURE_PREFIX = "vidbest:tiktok:player:video-cooldown:v1:";
  let activePreview = 0;
  let activeFrame = null;
  let readyTimer = null;
  let playerMessageListener = null;

  function nextAllowedAt(share) {
    const last = read(REQUEST_GATE_KEY)?.until || 0;
    const site = read(FAILURE_GATE_KEY)?.until || 0;
    const video = read(VIDEO_FAILURE_PREFIX + share.id)?.until || 0;
    return Math.max(last, site, video);
  }

  function markProviderUnavailable(share) {
    const now = Date.now();
    write(FAILURE_GATE_KEY, { until: now + FAILED_SITE_COOLDOWN });
    write(VIDEO_FAILURE_PREFIX + share.id, { until: now + FAILED_VIDEO_COOLDOWN });
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
    if (readyTimer !== null) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (playerMessageListener) {
      window.removeEventListener("message", playerMessageListener);
      playerMessageListener = null;
    }
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    // Detaching the iframe ends the embedded playback on modal close.
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
    dialog.addEventListener("close", () => {
      ++activePreview;
      cleanupEmbed(dialog);
    });
    window.addEventListener("pagehide", () => {
      ++activePreview;
      cleanupEmbed(dialog);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden || !dialog.open || !activeFrame) return;
      ++activePreview;
      cleanupEmbed(dialog);
      renderUnavailable(dialog, "The player was stopped because this tab is in the background.");
      dialog.querySelector("[data-tiktok-dialog-status]").textContent =
        "TikTok is not loaded while this tab is inactive.";
    });
    document.body.append(dialog);
    return dialog;
  }

  function mountOfficialPlayer(dialog, share, token) {
    if (!dialog.open || activePreview !== token) return;

    cleanupEmbed(dialog);
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    const status = dialog.querySelector("[data-tiktok-dialog-status]");
    const remaining = nextAllowedAt(share) - Date.now();
    if (remaining > 0) {
      renderUnavailable(dialog, "Playback was not requested again to avoid repeated blocked loads.");
      status.textContent = "Please wait " + Math.ceil(remaining / 1000) +
        " seconds before making another TikTok playback request.";
      return;
    }
    if (document.hidden) {
      renderUnavailable(dialog, "The TikTok player only loads when the tab is visible.");
      status.textContent = "Switch back to this tab before opening the player.";
      return;
    }
    // This is the only place the TikTok playback request begins.
    // Metadata previews, recommendations and offscreen cards do not mount it.
    write(REQUEST_GATE_KEY, { until: Date.now() + MIN_PLAYER_REQUEST_INTERVAL });
    const iframe = document.createElement("iframe");
    iframe.className = "tiktok-official-player-v1";
    iframe.title = "TikTok video by @" + share.username;
    iframe.loading = "eager";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    iframe.allowFullscreen = true;
    // Only the numeric ID from an already validated TikTok URL reaches src.
    const playerUrl = new URL("/player/v1/" + share.id, PLAYER_ORIGIN);
    playerUrl.searchParams.set("autoplay", "0");
    playerUrl.searchParams.set("controls", "1");
    playerUrl.searchParams.set("description", "0");
    playerUrl.searchParams.set("music_info", "0");

    const active = () => dialog.open && activePreview === token && activeFrame === iframe;
    const stopTimer = () => {
      if (readyTimer !== null) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
    };
    const failed = (message) => {
      if (!active()) return;
      markProviderUnavailable(share);
      cleanupEmbed(dialog); // Do not leave an Akamai error page occupying the modal.
      renderUnavailable(dialog, "TikTok did not provide a playable embedded video.");
      status.textContent = message;
    };
    playerMessageListener = (event) => {
      if (!active() || event.origin !== PLAYER_ORIGIN || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data["x-tiktok-player"] !== true) return;
      if (data.type === "onPlayerReady") {
        stopTimer();
        status.textContent = "Player ready · tap Play inside the video.";
      } else if (data.type === "onStateChange" && data.value === 1) {
        stopTimer();
        status.textContent = "Playing on Vid.Best.";
      } else if (data.type === "onPlayerError") {
        stopTimer();
        const errorCode = Number(data.value?.errorCode);
        if (errorCode === 3002) {
          status.textContent = "Autoplay was blocked. Tap the player's Play button.";
        } else {
          failed(errorCode === 1001
            ? "TikTok says this video is unavailable. Automatic retries are disabled."
            : "TikTok rejected or could not play this embed. Requests are paused temporarily.");
        }
      }
    };
    window.addEventListener("message", playerMessageListener);
    iframe.addEventListener("error", () => {
      failed("TikTok's player failed to load. Automatic retries are disabled for this session.");
    });
    // A normal iframe 'load' event is NOT proof of playback readiness. A 429
    // or WAF error page can also trigger load; wait for TikTok's ready message.
    status.textContent = "Connecting to the official TikTok player…";
    activeFrame = iframe;
    host.replaceChildren(iframe);
    iframe.src = playerUrl.href;
    readyTimer = setTimeout(() => {
      failed("TikTok did not confirm player readiness. The embed was removed and retries are paused.");
    }, PLAYER_READY_TIMEOUT);
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
    description.textContent = seed.description || "TikTok playback stays in this Vid.Best popup.";

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }

    // The iframe is not present until after the popup is visibly opened.
    requestAnimationFrame(() => {
      if (dialog.open && activePreview === token) mountOfficialPlayer(dialog, share, token);
    });

    // Metadata refresh cannot prevent an attempted, user-initiated player load.
    void getMetadata(share.url).then((payload) => {
      if (!dialog.open || activePreview !== token) return;
      title.textContent = payload.title || payload.caption || seed.title || "TikTok video";
      author.textContent = payload.author_name || seed.author || (share.username ? "@" + share.username : "TikTok creator");
      description.textContent = payload.description || seed.description || "TikTok playback stays inside this popup.";
    }).catch(() => {
      if (dialog.open && activePreview === token) {
        description.textContent = seed.description || "Cached video details are temporarily unavailable.";
      }
    });
    return true;
  }

  window.VidBestTikTok = Object.freeze({ parse, getMetadata, showPreview });
})();
