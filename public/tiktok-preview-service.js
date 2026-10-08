// TikTok metadata-only client. It only renders cached preview information and original-post links.
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
  let activePreview = 0;
  let activeFrame = null;
  let readyTimer = null;
  let playerMessageListener = null;

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
    document.body.append(dialog);
    return dialog;
  }

  function mountOfficialPlayer(dialog, share, token) {
    if (!dialog.open || activePreview !== token) return;

    cleanupEmbed(dialog);
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    const status = dialog.querySelector("[data-tiktok-dialog-status]");
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
        status.textContent = errorCode === 1001
          ? "TikTok says this video is unavailable."
          : errorCode === 3002
            ? "Autoplay was blocked. Tap the player's Play button."
            : "TikTok reported a player error. This connection may not allow embedded playback.";
      }
    };
    window.addEventListener("message", playerMessageListener);
    iframe.addEventListener("error", () => {
      if (active()) {
        stopTimer();
        status.textContent = "The TikTok player could not load. Embedded playback may be restricted.";
      }
    });
    // A normal iframe 'load' event is NOT proof of playback readiness. A 429
    // or WAF error page can also trigger load; wait for TikTok's ready message.
    status.textContent = "Connecting to the official TikTok player…";
    activeFrame = iframe;
    host.replaceChildren(iframe);
    iframe.src = playerUrl.href;
    readyTimer = setTimeout(() => {
      if (active()) {
        status.textContent = "TikTok has not confirmed player readiness. It may be blocked by TikTok or the network.";
      }
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
