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

  function ensureDialog() {
    let dialog = document.querySelector("#vidbest-tiktok-preview-dialog");
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "vidbest-tiktok-preview-dialog";
    dialog.className = "tiktok-preview-dialog";
    dialog.innerHTML = `
      <div class="tiktok-preview-dialog-card">
        <button type="button" class="tiktok-preview-dialog-close" aria-label="Close TikTok preview">×</button>
        <div class="tiktok-preview-dialog-media">
          <img alt="" decoding="async">
          <span class="tiktok-preview-dialog-placeholder">TikTok</span>
        </div>
        <div class="tiktok-preview-dialog-copy">
          <span class="tiktok-preview-dialog-kicker">TikTok preview</span>
          <strong data-tiktok-dialog-title>TikTok video</strong>
          <span data-tiktok-dialog-author>TikTok creator</span>
          <p data-tiktok-dialog-description>Preview details are provided by the Vid.Best oEmbed cache.</p>
          <div class="tiktok-preview-dialog-actions">
            <a class="button primary" data-tiktok-dialog-open target="_blank" rel="noopener noreferrer">Open on TikTok</a>
            <button type="button" class="button ghost" data-tiktok-dialog-cancel>Close</button>
          </div>
        </div>
      </div>`;

    const close = () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
    dialog.querySelector(".tiktok-preview-dialog-close").addEventListener("click", close);
    dialog.querySelector("[data-tiktok-dialog-cancel]").addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    document.body.append(dialog);
    return dialog;
  }

  async function showPreview(value, seed = {}) {
    const share = parse(value);
    if (!share) return false;

    const dialog = ensureDialog();
    const image = dialog.querySelector("img");
    const placeholder = dialog.querySelector(".tiktok-preview-dialog-placeholder");
    const title = dialog.querySelector("[data-tiktok-dialog-title]");
    const author = dialog.querySelector("[data-tiktok-dialog-author]");
    const description = dialog.querySelector("[data-tiktok-dialog-description]");
    const open = dialog.querySelector("[data-tiktok-dialog-open]");

    title.textContent = seed.title || "TikTok video";
    author.textContent = seed.author || (share.username ? "@" + share.username : "TikTok creator");
    description.textContent = seed.description || "Loading cached preview details…";
    open.href = share.url;

    const seedImage = seed.thumbnail || seed.poster || "";
    if (seedImage) {
      image.src = seedImage;
      image.hidden = false;
      placeholder.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      placeholder.hidden = false;
    }

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }

    try {
      const payload = await getMetadata(share.url);
      if (!dialog.open && !dialog.hasAttribute("open")) return true;
      title.textContent = payload.title || payload.caption || seed.title || "TikTok video";
      author.textContent = payload.author_name || seed.author || (share.username ? "@" + share.username : "TikTok creator");
      description.textContent = payload.description || "Open the original TikTok post to watch the video.";
      open.href = payload.open_url || payload.source_url || share.url;
      const previewImage = payload.thumbnail_url || payload.poster_url || seedImage;
      if (previewImage) {
        image.src = previewImage;
        image.hidden = false;
        placeholder.hidden = true;
      }
    } catch (error) {
      description.textContent = "Cached preview details are temporarily unavailable. You can still open the original TikTok post.";
    }
    return true;
  }

  window.VidBestTikTok = Object.freeze({ parse, getMetadata, showPreview });
})();
