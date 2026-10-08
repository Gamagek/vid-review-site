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

  // Only a deliberate user action mounts the TikTok SDK. Fewer eager requests
  // do not override TikTok's own rate limits or WAF policies.
  const EMBED_SCRIPT_URL = "https://www.tiktok.com/embed.js";
  let embedScript = null;
  let activePreview = 0;

  function cleanupEmbed(dialog) {
    if (embedScript) {
      embedScript.onload = null;
      embedScript.onerror = null;
      embedScript.remove();
      embedScript = null;
    }
    // Removing the generated iframe stops playback in this dialog. Removing the
    // script cannot undo upstream requests already made by the third-party SDK.
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    if (host) host.innerHTML = "";
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
    // Native Escape closes a <dialog> and triggers this event as well.
    dialog.addEventListener("close", () => {
      ++activePreview;
      cleanupEmbed(dialog);
    });
    window.addEventListener("pagehide", () => cleanupEmbed(dialog));
    document.body.append(dialog);
    return dialog;
  }

  function injectOfficialEmbed(dialog, share, seed, token) {
    if (!dialog.open || activePreview !== token) return;

    cleanupEmbed(dialog);
    const host = dialog.querySelector("[data-tiktok-embed-host]");
    const status = dialog.querySelector("[data-tiktok-dialog-status]");

    // Build the official blockquote from a validated URL; never inject raw
    // oEmbed HTML or user-provided text via innerHTML.
    const embed = document.createElement("blockquote");
    embed.className = "tiktok-embed";
    embed.setAttribute("cite", share.url);
    embed.dataset.videoId = share.id;
    embed.style.maxWidth = "450px";
    embed.style.minWidth = "0";
    const section = document.createElement("section");
    const caption = document.createElement("p");
    caption.textContent = seed.title || "TikTok video";
    section.append(caption);
    embed.append(section);
    host.replaceChildren(embed);

    const script = document.createElement("script");
    script.src = EMBED_SCRIPT_URL;
    script.async = true;
    script.dataset.vidbestTikTokEmbed = "1";
    script.onerror = () => {
      if (activePreview === token && dialog.open) {
        status.textContent = "TikTok's embed script could not load. Close the player and try again later.";
      }
    };
    script.onload = () => {
      if (activePreview === token && dialog.open) {
        // A loaded SDK does not prove the subsequent iframe can play.
        status.textContent = "Player requested. TikTok may still restrict embedded playback on this connection.";
      }
    };
    embedScript = script;
    status.textContent = "Loading official TikTok player…";
    document.body.append(script);
  }

  async function showPreview(value, seed = {}) {
    const share = parse(value);
    if (!share) return false;

    const dialog = ensureDialog();
    // At most one script/blockquote at a time, across homepage and watch cards.
    ++activePreview;
    cleanupEmbed(dialog);
    const token = activePreview;

    const title = dialog.querySelector("[data-tiktok-dialog-title]");
    const author = dialog.querySelector("[data-tiktok-dialog-author]");
    const description = dialog.querySelector("[data-tiktok-dialog-description]");
    title.textContent = seed.title || "TikTok video";
    author.textContent = seed.author || (share.username ? "@" + share.username : "TikTok creator");
    description.textContent = seed.description || "TikTok playback stays in this Vid.Best popup.";

    // Open first; only the next animation frame can mount provider markup.
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    requestAnimationFrame(() => {
      if (activePreview === token && dialog.open) injectOfficialEmbed(dialog, share, seed, token);
    });

    // Cached metadata is optional and never delays the attempted player load.
    void getMetadata(share.url).then((payload) => {
      if (activePreview !== token || !dialog.open) return;
      title.textContent = payload.title || payload.caption || seed.title || "TikTok video";
      author.textContent = payload.author_name || seed.author || (share.username ? "@" + share.username : "TikTok creator");
      description.textContent = payload.description || seed.description || "TikTok playback stays inside this popup.";
    }).catch(() => {
      if (activePreview === token && dialog.open) {
        description.textContent = seed.description || "Cached video details are temporarily unavailable.";
      }
    });
    return true;
  }

  window.VidBestTikTok = Object.freeze({ parse, getMetadata, showPreview });
})();
