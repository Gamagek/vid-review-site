(() => {
  const embedded = document.body.dataset.viewerEmbed === "1";
  // Keep native video gestures usable; provider iframes have a separate swipe rail.
  const bindSwipe = (element, action) => {
    let start = null;
    element.addEventListener("touchstart", (event) => {
      if (event.touches.length === 1) start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });
    element.addEventListener("touchend", (event) => {
      if (!start || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      start = null;
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3) action(dy < 0 ? 1 : -1);
    }, { passive: true });
    element.addEventListener("touchcancel", () => { start = null; });
  };
  if (embedded) {
    const startVideo = (video) => {
      if (video.dataset.swipeStarted) return;
      video.dataset.swipeStarted = "1";
      video.playsInline = true; video.muted = true;
      video.play().catch(() => {});
    };
    document.querySelectorAll("video").forEach(startVideo);
    new MutationObserver(() => document.querySelectorAll("video").forEach(startVideo))
      .observe(document.querySelector("#watch-player"), { childList: true, subtree: true });
    bindSwipe(document.querySelector(".watch-player-stage"), (direction) => {
      parent.postMessage({ type: "vidbest-swipe", direction }, new URL(document.baseURI).origin);
    });
    return;
  }
  const original = document.querySelector("#watch-player");
  if (!original) return;
  const first = {
    id: Number(document.body.dataset.videoId), slug: document.body.dataset.videoSlug,
    title: document.querySelector(".watch-copy h1")?.textContent || "Video",
    description: document.querySelector(".watch-copy .lead")?.textContent || "",
    review_text: document.querySelector(".review-copy")?.innerText || "",
    views: Number(document.body.dataset.siteViews || 0),
  };
  const queue = [first], counted = new Set([first.id]), pages = new Map();
  let index = 0, generation = 0, timer, focused, originalOverflow, suspended = [], observer;
  let recommending = null, catalogOffset = 0, catalogEnded = false;
  const dialog = document.createElement("dialog");
  dialog.className = "swipe-viewer";
  dialog.setAttribute("aria-label", "Vid.Best swipe video viewer");
  dialog.innerHTML = `<div class="swipe-layout">
    <header class="swipe-header"><strong>Vid.Best <span>For you</span></strong><button type="button" data-close aria-label="Close swipe viewer">✕</button></header>
    <div class="swipe-body"><div class="swipe-media" aria-label="Current video"></div>
      <nav class="swipe-rail" aria-label="Swipe up for next video, down for previous"><button type="button" data-prev aria-label="Previous video">↑</button><span>Swipe<br>here</span><button type="button" data-next aria-label="Next suggested video">↓</button></nav></div>
    <footer class="swipe-footer"><h2></h2><p class="swipe-count"></p><p class="swipe-status" role="status" aria-live="polite"></p><button type="button" data-review>⌃ Review & details</button></footer>
    <section class="swipe-review" aria-label="Video review" hidden><button type="button" data-review-close>⌄ Back to video</button><h2></h2><p class="swipe-description"></p><div class="swipe-review-text"></div><a class="button" data-permalink>Open full review & comments</a></section>
  </div>`;
  document.body.append(dialog);
  const media = dialog.querySelector(".swipe-media"), status = dialog.querySelector(".swipe-status");
  const review = dialog.querySelector(".swipe-review");
  const previous = dialog.querySelector("[data-prev]"), next = dialog.querySelector("[data-next]");
  const closeButton = dialog.querySelector("[data-close]");
  const reviewButton = dialog.querySelector("[data-review]");
  const format = (value) => new Intl.NumberFormat().format(value || 0);
  const path = (video) => `/watch/${encodeURIComponent(video.slug)}`;
  function prepare(video) {
    if (!pages.has(video.id)) {
      const promise = fetch(`${path(video)}?viewer=1`, { credentials: "same-origin" }).then(async (response) => {
        if (!response.ok) throw new Error("This video is unavailable. Try the next suggestion.");
        return response.text();
      });
      pages.set(video.id, promise);
      promise.catch(() => { if (pages.get(video.id) === promise) pages.delete(video.id); });
      while (pages.size > 4) pages.delete(pages.keys().next().value);
    }
    return pages.get(video.id);
  }
  async function suggest() {
    if (recommending) return recommending;
    const current = queue[index];
    recommending = fetch(`/api/videos/${current.id}/recommendations?limit=16`).then(async (response) => {
      if (!response.ok) throw new Error("Suggestions are temporarily unavailable.");
      const data = await response.json();
      for (const video of data.videos || []) if (!queue.some((item) => item.id === video.id)) queue.push(video);
      // Recommendations are ranked and finite. Continue into the published catalog.
      while (index + 2 >= queue.length && !catalogEnded) {
        const catalog = await fetch(`/api/videos?limit=16&offset=${catalogOffset}`);
        if (!catalog.ok) break;
        const more = (await catalog.json()).videos || [];
        catalogOffset += more.length; catalogEnded = more.length < 16;
        for (const video of more) if (!queue.some((item) => item.id === video.id)) queue.push(video);
      }
    }).catch(() => { if (dialog.open) status.textContent = "Could not load suggestions. Use Next to retry."; })
      .finally(() => { recommending = null; updateNavigation(); });
    return recommending;
  }
  function updateNavigation() {
    previous.disabled = index === 0;
    next.disabled = false;
    next.title = queue[index + 1] ? `Next: ${queue[index + 1].title}` : "Find more suggestions";
    if (queue[index + 1]) prepare(queue[index + 1]).catch(() => {});
  }
  function pauseOriginal() {
    original.querySelectorAll("video,audio").forEach((video) => video.pause());
    original.querySelectorAll("iframe[src]").forEach((frame) => {
      if (frame.getAttribute("src") === "about:blank") return;
      suspended.push([frame, frame.getAttribute("src")]); frame.src = "about:blank";
    });
  }
  original.addEventListener("play", (event) => { if (dialog.open && event.target.pause) event.target.pause(); }, true);
  async function open() {
    if (dialog.open) return;
    focused = document.activeElement;
    originalOverflow = document.documentElement.style.overflow;
    dialog.showModal(); document.documentElement.style.overflow = "hidden";
    // Fullscreen requires the original tap. Unsupported browsers still get a screen-fit dialog.
    dialog.requestFullscreen?.().catch(() => {});
    pauseOriginal();
    observer = new MutationObserver(pauseOriginal);
    observer.observe(original, { childList: true, subtree: true });
    closeButton.focus();
    void show(index); void suggest();
  }
  function cleanup() {
    generation++; clearTimeout(timer); media.replaceChildren(); observer?.disconnect();
    for (const [frame, src] of suspended) if (frame.isConnected) frame.src = src;
    suspended = []; document.documentElement.style.overflow = originalOverflow;
    review.hidden = true;
    if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {});
    focused?.focus();
  }
  dialog.addEventListener("close", cleanup);
  closeButton.onclick = () => dialog.close();
  function setReview(openReview) {
    review.hidden = !openReview;
    (openReview ? review.querySelector("button") : reviewButton).focus();
  }
  reviewButton.onclick = () => setReview(true);
  dialog.querySelector("[data-review-close]").onclick = () => setReview(false);
  bindSwipe(dialog.querySelector(".swipe-footer"), (direction) => { if (direction === 1) setReview(true); });
  bindSwipe(dialog.querySelector(".swipe-rail"), (direction) => void move(direction));
  let lastWheel = 0;
  dialog.querySelector(".swipe-body").addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) < 20 || Date.now() - lastWheel < 650) return;
    event.preventDefault(); lastWheel = Date.now(); void move(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  previous.onclick = () => void move(-1); next.onclick = () => void move(1);
  dialog.addEventListener("keydown", (event) => {
    if (!review.hidden) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); void move(event.key === "ArrowDown" ? 1 : -1);
    }
  });
  window.addEventListener("message", (event) => {
    if (!dialog.open || !review.hidden || event.origin !== location.origin || event.source !== media.querySelector("iframe")?.contentWindow) return;
    if (event.data?.type === "vidbest-swipe" && [-1, 1].includes(event.data.direction)) void move(event.data.direction);
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || dialog.contains(button)) return;
    const label = `${button.textContent} ${button.title} ${button.getAttribute("aria-label")}`;
    if (button.hasAttribute("data-swipe-open") || ((original.contains(button) || button.closest(".vidbest-embed-overlay")) && /fullscreen/i.test(label))) {
      event.preventDefault(); event.stopImmediatePropagation(); void open();
    }
  }, true);
  async function move(direction) {
    if (!dialog.open) return;
    if (direction > 0 && index + 1 >= queue.length) {
      status.textContent = "Finding suggestions…"; await suggest();
      if (!dialog.open) return;
      if (index + 1 >= queue.length) { status.textContent = "You’re all caught up. Swipe down to revisit a video."; return; }
    }
    const target = Math.max(0, Math.min(queue.length - 1, index + direction));
    if (target !== index) await show(target);
  }
  function scheduleCount(video, token) {
    clearTimeout(timer);
    if (counted.has(video.id) || document.hidden) return;
    timer = setTimeout(async () => {
      if (!dialog.open || document.hidden || token !== generation) return;
      try {
        const response = await fetch(`/api/videos/${video.id}/view`, { method: "POST", credentials: "same-origin" });
        if (!response.ok) return;
        const data = await response.json(); video.views = data.views; counted.add(video.id);
        if (token === generation) dialog.querySelector(".swipe-count").textContent = `${format(video.views)} Vid.Best views`;
      } catch { /* Keep the last known site count while offline. */ }
    }, 1500);
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (dialog.open && !document.hidden && media.querySelector("iframe")) scheduleCount(queue[index], generation);
  });
  async function show(target) {
    index = target; const token = ++generation, video = queue[index];
    clearTimeout(timer); review.hidden = true; media.replaceChildren();
    dialog.querySelector(".swipe-footer h2").textContent = video.title;
    dialog.querySelector(".swipe-count").textContent = `${format(video.views)} Vid.Best views`;
    review.querySelector("h2").textContent = video.title;
    review.querySelector(".swipe-description").textContent = video.description || "";
    review.querySelector(".swipe-review-text").textContent = video.review_text || "Read the full review and join the conversation below.";
    review.querySelector("a").href = path(video);
    status.textContent = "Preparing player…"; updateNavigation();
    try {
      const html = await prepare(video);
      if (!dialog.open || token !== generation) return;
      const frame = document.createElement("iframe");
      frame.title = video.title; frame.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
      frame.addEventListener("load", () => {
        if (token !== generation) return;
        status.textContent = "Swipe the side rail for next · Pull up below for review";
        scheduleCount(video, token);
      }, { once: true });
      const prepared = new DOMParser().parseFromString(html, "text/html");
      const providerFrame = prepared.querySelector("#watch-media-frame");
      if (providerFrame) {
        const source = new URL(providerFrame.getAttribute("src"), location.origin);
        if (["www.youtube-nocookie.com", "www.youtube.com", "player.vimeo.com"].includes(source.hostname)) {
          source.searchParams.set("autoplay", "1");
          source.searchParams.set(source.hostname === "player.vimeo.com" ? "muted" : "mute", "1");
          providerFrame.setAttribute("src", source.href);
        }
      }
      frame.srcdoc = "<!doctype html>" + prepared.documentElement.outerHTML;
      media.replaceChildren(frame);
    } catch (error) {
      if (token === generation) {
        status.textContent = error.message;
        const retry = document.createElement("button"); retry.textContent = "Retry player";
        retry.onclick = () => void show(index); media.append(retry);
      }
    }
    if (index >= queue.length - 3) void suggest();
  }
  // Prepare markup only. No player runs and no view is recorded until opened.
  document.querySelector("[data-swipe-open]")?.addEventListener("pointerenter", () => prepare(first).catch(() => {}), { once: true });
})();
