(() => {
  if (document.body.dataset.viewerEmbed === "1") return;
  const original = document.querySelector("#watch-player");
  if (!original) return;
  const first = {
    id: Number(document.body.dataset.videoId), slug: document.body.dataset.videoSlug,
    provider: document.body.dataset.videoProvider,
    title: document.querySelector(".watch-copy h1")?.textContent || "Video",
    description: document.querySelector(".watch-copy .lead")?.textContent || "",
    review_text: document.querySelector(".review-copy")?.innerText || "",
    views: Number(document.body.dataset.siteViews || 0),
    reactions: JSON.parse(document.querySelector(".watch-reactions")?.dataset.reactions || "{}"),
  };
  const queue = [first], cards = [], pages = new Map(), counted = new Set([first.id]), counting = new Set();
  const warmProviders = new Set(["youtube", "vimeo", "raw", "r2", "hls"]);
  const symbols = { like: "👍", love: "♥", useful: "💡" };
  let index = 0, opened = false, muted = false, focusReturn, overflow, suspension, savedInert = [];
  let timer, scrollTask = 0, suggesting = null, recommendationVersion = 0, catalogOffset = 0, catalogEnded = false;
  const viewer = document.createElement("section");
  viewer.className = "swipe-viewer"; viewer.hidden = true;
  viewer.setAttribute("role", "dialog"); viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", "Vid.Best swipe video viewer");
  viewer.innerHTML = `<header class="swipe-header"><strong>Vid.Best <span>For you</span></strong><div><button type="button" data-screen aria-label="Toggle browser fullscreen">⛶</button><button type="button" data-close aria-label="Close swipe viewer">✕</button></div></header>
    <div class="swipe-feed" tabindex="0" aria-label="Video feed. Scroll or swipe up for the next video."></div>
    <nav class="swipe-navigation" aria-label="Video navigation"><button type="button" data-prev aria-label="Previous video">↑</button><button type="button" data-next aria-label="Next suggested video">↓</button></nav>
    <section class="swipe-review" aria-label="Video review" hidden><button type="button" data-review-close>⌄ Collapse review</button><h2></h2><p class="swipe-description"></p><div class="swipe-review-text"></div><a class="button" data-permalink>Open full review & comments</a></section>
    <p class="swipe-announcement sr-only" role="status" aria-live="polite"></p>`;
  document.body.append(viewer);
  const feed = viewer.querySelector(".swipe-feed"), review = viewer.querySelector(".swipe-review");
  const previous = viewer.querySelector("[data-prev]"), next = viewer.querySelector("[data-next]");
  const closeButton = viewer.querySelector("[data-close]");
  const format = (value) => new Intl.NumberFormat().format(value || 0);
  const clock = (seconds) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const path = (video) => `/watch/${encodeURIComponent(video.slug)}`;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const announce = (text) => { viewer.querySelector(".swipe-announcement").textContent = text; };
  const message = (card, text) => { card.el.querySelector(".swipe-status").textContent = text; };
  async function api(url, body) {
    const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save. Please try again.");
    return result;
  }
  function makeCard(video) {
    const el = document.createElement("article"); el.className = "swipe-card";
    el.setAttribute("aria-label", video.title); el.dataset.videoId = video.id;
    el.innerHTML = `<div class="swipe-media"><div class="swipe-frame-host"></div><button type="button" class="swipe-gesture" data-play aria-label="Play or pause. Swipe vertically for another video."><span class="swipe-play-hint">Tap to play · Swipe for next</span></button></div>
      <footer class="swipe-footer"><div class="swipe-player-actions"><button type="button" data-play aria-label="Play video">▶ Play</button><button type="button" data-sound aria-label="Unmute video">🔇 Sound</button><button type="button" data-controls aria-expanded="false" aria-controls="swipe-controls-${video.id}">Player controls</button></div>
      <section class="swipe-mini-controls" id="swipe-controls-${video.id}" aria-label="Compact player controls" hidden><div class="swipe-timeline"><span data-time>0:00 / 0:00</span><span data-quality>Preparing…</span><input type="range" data-seek aria-label="Video position" min="0" max="1" step="1" value="0" disabled></div><div class="swipe-control-options"><button type="button" data-skip="-10" aria-label="Back 10 seconds" disabled>↶ 10s</button><button type="button" data-skip="10" aria-label="Forward 10 seconds" disabled>10s ↷</button><button type="button" data-original aria-pressed="false">Original controls</button></div><p class="swipe-controls-help">Swipe on the video for next. Original controls include captions and settings.</p></section>
      <h2></h2><p class="swipe-count"></p><div class="swipe-engagement" aria-label="Video reactions"><button type="button" data-reaction="like" aria-label="Like video" aria-pressed="false"></button><button type="button" data-reaction="love" aria-label="Love video" aria-pressed="false"></button><button type="button" data-reaction="useful" aria-label="Mark video useful" aria-pressed="false"></button><button type="button" data-review aria-expanded="false">⌃ Review</button></div><div class="swipe-interests"><button type="button" data-interest="more">＋ More like this</button><button type="button" data-interest="less">− Fewer like this</button></div><p class="swipe-status" role="status">Preparing video…</p></footer>`;
    el.querySelector("h2").textContent = video.title;
    const card = { video, el, host: el.querySelector(".swipe-frame-host"), frame: null, loading: null, ready: false, bridge: false, paused: false, playing: false, actualMuted: true, seconds: 0, duration: 0, controllable: warmProviders.has(video.provider), suspended: null };
    refreshCounts(card); el.inert = true; el.setAttribute("aria-hidden", "true");
    cards.push(card); feed.append(el); return card;
  }
  function refreshCounts(card) {
    card.el.querySelector(".swipe-count").textContent = `${format(card.video.views)} Vid.Best views`;
    for (const [key, symbol] of Object.entries(symbols)) card.el.querySelector(`[data-reaction="${key}"]`).textContent = `${symbol} ${format(card.video.reactions?.[key])}`;
  }
  function prepareMarkup(video) {
    if (!pages.has(video.id)) {
      const promise = fetch(`${path(video)}?viewer=1`, { credentials: "same-origin" }).then(async (response) => {
        if (!response.ok) throw new Error("This video is unavailable. Swipe to the next video or retry.");
        return response.text();
      });
      pages.set(video.id, promise);
      promise.catch(() => { if (pages.get(video.id) === promise) pages.delete(video.id); });
      while (pages.size > 5) pages.delete(pages.keys().next().value);
    }
    return pages.get(video.id);
  }
  function desired(card) { return opened && card === cards[index] && !document.hidden; }
  function sendCommand(card, data, gesture = false) {
    const target = card.frame?.contentWindow;
    if (!target) return;
    const payload = { channel: "vidbest-viewer", ...data, gesture };
    // Keep native playback inside a real click's user activation when available.
    if (gesture && typeof target.vidbestPlayback === "function") target.vidbestPlayback(payload);
    else target.postMessage(payload, location.origin);
  }
  function command(card, gesture = false) {
    sendCommand(card, { type: "playback", active: desired(card), paused: card.paused, muted }, gesture);
  }
  function destroyPlayer(card) {
    card.loadToken = null; card.host.replaceChildren(); card.frame = null; card.ready = false; card.bridge = false;
    card.loading = null; card.suspended = null; card.playing = false; card.actualMuted = true; card.soundBlocked = false;
    card.seconds = 0; card.duration = 0; card.el.classList.remove("is-playing", "is-interactive");
    card.el.querySelector("[data-controls]").setAttribute("aria-expanded", "false");
    card.el.querySelector(".swipe-mini-controls").hidden = true;
    card.el.querySelector("[data-original]").setAttribute("aria-pressed", "false");
    refreshPlayback(card); refreshTimeline(card);
  }
  async function prepareCard(card) {
    if (card.frame || card.loading || !opened) return;
    const token = {}; card.loadToken = token;
    card.loading = (async () => {
      try {
        const html = await prepareMarkup(card.video);
        if (card.loadToken !== token || !opened || Math.abs(cards.indexOf(card) - index) > 1) return;
        // Unknown provider embeds may not expose a pause API. Prepare their HTML only.
        if (!warmProviders.has(card.video.provider) && card !== cards[index]) return;
        const doc = new DOMParser().parseFromString(html, "text/html");
        const providerFrame = doc.querySelector("#watch-media-frame");
        if (providerFrame) {
          const url = new URL(providerFrame.getAttribute("src"), location.origin);
          url.searchParams.set("autoplay", "0");
          if (card.video.provider === "youtube") { url.searchParams.set("mute", "1"); url.searchParams.set("enablejsapi", "1"); }
          if (card.video.provider === "vimeo") url.searchParams.set("muted", "1");
          providerFrame.src = url.href;
        }
        const frame = document.createElement("iframe");
        frame.title = card.video.title; frame.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
        frame.loading = "eager"; frame.setAttribute("allowfullscreen", "");
        frame.addEventListener("load", () => {
          if (card.frame !== frame) return;
          command(card);
          if (!warmProviders.has(card.video.provider)) { card.ready = true; card.controllable = false; }
          if (desired(card)) { scheduleCount(card); updateHint(card); }
          updatePreparation();
        });
        card.frame = frame; frame.srcdoc = "<!doctype html>" + doc.documentElement.outerHTML;
        card.host.replaceChildren(frame);
      } catch (error) {
        if (card.loadToken !== token) return;
        message(card, error.message);
        const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry video"; retry.dataset.retry = "1";
        card.host.replaceChildren(retry);
      } finally { if (card.loadToken === token) card.loading = null; }
    })();
    return card.loading;
  }
  function updateHint(card) {
    card.el.querySelector(".swipe-play-hint").textContent = card.controllable
      ? "Tap to play · Swipe for next"
      : card.video.provider === "tiktok"
        ? "Tap preview details · Swipe for next"
        : "Tap for player controls · Swipe for next";
    card.el.querySelector(".swipe-player-actions [data-play]").disabled = !card.controllable;
    card.el.querySelector("[data-sound]").disabled = !card.controllable;
    card.el.querySelector(".swipe-timeline").hidden = !card.controllable;
    refreshTimeline(card);
  }
  function refreshPlayback(card) {
    card.el.classList.toggle("is-playing", card.playing);
    const play = card.el.querySelector(".swipe-player-actions [data-play]"), sound = card.el.querySelector("[data-sound]");
    play.textContent = card.playing ? "Ⅱ Pause" : "▶ Play";
    play.setAttribute("aria-label", card.playing ? "Pause video" : "Play video");
    sound.textContent = card.actualMuted ? card.soundBlocked ? "🔇 Tap for sound" : "🔇 Sound" : "🔊 Sound";
    sound.setAttribute("aria-label", card.actualMuted ? "Unmute video" : "Mute video");
  }
  function refreshTimeline(card) {
    const input = card.el.querySelector("[data-seek]");
    input.disabled = !card.controllable || card.duration <= 0;
    input.max = String(Math.max(1, card.duration));
    if (document.activeElement !== input) input.value = String(card.seconds);
    input.setAttribute("aria-valuetext", `${clock(card.seconds)} of ${clock(card.duration)}`);
    card.el.querySelector("[data-time]").textContent = `${clock(card.seconds)} / ${clock(card.duration)}`;
    card.el.querySelectorAll("[data-skip]").forEach((button) => { button.disabled = input.disabled; });
  }
  function updatePreparation() {
    if (!opened) return;
    const card = cards[index], upcoming = cards[index + 1];
    if (!card || card.el.dataset.feedback === "1" || card.soundBlocked) return;
    const preparation = upcoming?.ready ? "Next player ready" : upcoming ? "Preparing next video" : catalogEnded ? "End of suggestions" : "Finding suggestions";
    message(card, `Swipe up for next · ${preparation}`);
  }
  async function suggest(refresh = false) {
    if (suggesting && !refresh) return suggesting;
    if (refresh) recommendationVersion++;
    const version = recommendationVersion, current = queue[index];
    const task = (async () => {
      try {
        const response = await fetch(`/api/videos/${current.id}/recommendations?limit=16`, { cache: "no-store" });
        if (!response.ok) throw new Error("Suggestions are unavailable. Press Next to retry.");
        const data = await response.json();
        if (version !== recommendationVersion) return;
        if (refresh) {
          for (const card of cards.splice(index + 1)) { destroyPlayer(card); card.el.remove(); }
          queue.splice(index + 1); catalogEnded = false; catalogOffset = 0;
        }
        function append(videos) {
          for (const video of videos) if (!queue.some((item) => item.id === video.id)) { queue.push(video); makeCard(video); }
        }
        append(data.videos || []);
        // The ranked list is finite; continue with published videos when it runs out.
        for (let attempts = 0; index + 2 >= queue.length && !catalogEnded && attempts < 4; attempts++) {
          const response = await fetch(`/api/videos?limit=16&offset=${catalogOffset}`);
          if (!response.ok) break;
          const more = (await response.json()).videos || [];
          if (version !== recommendationVersion) return;
          catalogOffset += more.length; catalogEnded = more.length < 16; append(more);
        }
        if (opened) maintainPlayers();
      } catch (error) { if (opened && version === recommendationVersion) message(cards[index], error.message); }
      finally { if (version === recommendationVersion) { suggesting = null; updateNavigation(); } }
    })();
    suggesting = task; return task;
  }
  function updateNavigation() {
    previous.disabled = index === 0;
    next.disabled = false;
    next.title = queue[index + 1] ? `Next: ${queue[index + 1].title}` : "Find more suggestions";
  }
  function maintainPlayers() {
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (i < index - 1 || i > index + 1 || (i !== index && (!warmProviders.has(card.video.provider) || (card.ready && !card.controllable)))) {
        if (card.frame || card.loading) destroyPlayer(card);
      }
    }
    void prepareCard(cards[index]);
    // TikTok stays metadata-only until it becomes active, so fullscreen/swipe never warms a second TikTok iframe.
    if (cards[index + 1]) void prepareCard(cards[index + 1]);
    updatePreparation();
  }
  function activate(target) {
    if (!opened || !cards[target]) return;
    clearTimeout(timer); closeReview(false);
    const old = cards[index];
    if (target !== index && old) { old.paused = true; commandInactive(old); }
    index = target;
    cards.forEach((card, i) => { card.el.inert = i !== index; card.el.setAttribute("aria-hidden", String(i !== index)); card.el.classList.toggle("is-active", i === index); });
    const card = cards[index]; card.paused = false;
    command(card); maintainPlayers(); updateNavigation(); scheduleCount(card);
    announce(card.video.title);
    if (index >= queue.length - 3) void suggest();
  }
  function commandInactive(card) {
    card.frame?.contentWindow?.postMessage({ channel: "vidbest-viewer", type: "playback", active: false, paused: true, muted: true }, location.origin);
  }
  function scheduleCount(card) {
    clearTimeout(timer);
    if (!desired(card) || !card.ready || counted.has(card.video.id) || counting.has(card.video.id)) return;
    timer = setTimeout(async () => {
      if (!desired(card) || !card.ready) return;
      counting.add(card.video.id);
      try {
        const result = await api(`/api/videos/${card.video.id}/view`);
        card.video.views = result.views; counted.add(card.video.id); refreshCounts(card);
      } catch { /* Preserve the last known site count while offline. */ }
      finally { counting.delete(card.video.id); }
    }, 1500);
  }
  feed.addEventListener("scroll", () => {
    if (scrollTask || !opened || !feed.clientHeight) return;
    scrollTask = requestAnimationFrame(() => {
      scrollTask = 0;
      const target = Math.max(0, Math.min(cards.length - 1, Math.round(feed.scrollTop / feed.clientHeight)));
      if (target !== index) activate(target);
    });
  }, { passive: true });
  async function move(direction) {
    if (direction > 0 && index + 1 >= queue.length) {
      await suggest();
      if (!opened) return;
      if (index + 1 >= queue.length) { message(cards[index], "You’re all caught up. Swipe down to revisit a video."); return; }
    }
    const target = Math.max(0, Math.min(queue.length - 1, index + direction));
    feed.scrollTo({ top: target * feed.clientHeight, behavior: reducedMotion.matches ? "instant" : "smooth" });
  }
  function openReview(card) {
    review.querySelector("h2").textContent = card.video.title;
    review.querySelector(".swipe-description").textContent = card.video.description || "";
    review.querySelector(".swipe-review-text").textContent = card.video.review_text || "Read the full review and join the conversation below.";
    review.querySelector("a").href = path(card.video); review.hidden = false;
    card.el.querySelector("[data-review]").setAttribute("aria-expanded", "true");
    review.querySelector("button").focus();
  }
  function closeReview(returnFocus = true) {
    if (review.hidden) return;
    review.hidden = true;
    cards[index]?.el.querySelector("[data-review]").setAttribute("aria-expanded", "false");
    if (returnFocus) cards[index]?.el.querySelector("[data-review]").focus();
  }
  function toggleControls(card) {
    const panel = card.el.querySelector(".swipe-mini-controls");
    panel.hidden = !panel.hidden;
    card.el.querySelector("[data-controls]").setAttribute("aria-expanded", String(!panel.hidden));
    if (panel.hidden || !card.controllable) setOriginalControls(card, !panel.hidden && !card.controllable);
  }
  function setOriginalControls(card, interactive) {
    card.el.classList.toggle("is-interactive", interactive);
    card.el.querySelector("[data-original]").setAttribute("aria-pressed", String(interactive));
    card.el.querySelector(".swipe-controls-help").textContent = interactive ? "Original controls enabled. Swipe on the details below for next." : "Swipe on the video for next. Original controls include captions and settings.";
  }
  viewer.addEventListener("click", async (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.hasAttribute("data-close")) { close(); return; }
    if (button.hasAttribute("data-screen")) { toggleFullscreen(); return; }
    if (button.hasAttribute("data-prev")) { void move(-1); return; }
    if (button.hasAttribute("data-next")) { void move(1); return; }
    if (button.hasAttribute("data-review-close")) { closeReview(); return; }
    const card = cards.find((item) => item.el.contains(button)); if (!card || card !== cards[index]) return;
    if (button.hasAttribute("data-review")) { openReview(card); return; }
    if (button.hasAttribute("data-controls")) { toggleControls(card); return; }
    if (button.hasAttribute("data-original")) { setOriginalControls(card, !card.el.classList.contains("is-interactive")); return; }
    if (button.hasAttribute("data-skip")) { sendCommand(card, { type: "seek", seconds: card.seconds + Number(button.dataset.skip) }, true); return; }
    if (button.hasAttribute("data-retry")) { destroyPlayer(card); void prepareCard(card); return; }
    if (button.hasAttribute("data-play")) {
      if (!card.controllable) { toggleControls(card); return; }
      card.paused = card.playing; card.soundBlocked = false; command(card, true); return;
    }
    if (button.hasAttribute("data-sound")) {
      if (!card.controllable) { toggleControls(card); return; }
      muted = !card.actualMuted; card.soundBlocked = false; command(card, true); return;
    }
    const reaction = button.dataset.reaction, signal = button.dataset.interest;
    if (!reaction && !signal) return;
    button.disabled = true;
    try {
      const result = await api(`/api/videos/${card.video.id}/${reaction ? "reactions" : "interest"}`, reaction ? { reaction } : { signal });
      if (reaction) {
        card.video.reactions = result.reactions; refreshCounts(card); button.setAttribute("aria-pressed", String(result.active));
        message(card, result.active ? "Reaction saved." : "Reaction removed.");
      } else {
        card.el.querySelectorAll("[data-interest]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        message(card, result.message); card.el.dataset.feedback = "1"; void suggest(true);
      }
    } catch (error) { message(card, error.message); }
    finally { button.disabled = false; }
  });
  viewer.addEventListener("input", (event) => {
    if (!event.target.matches("[data-seek]")) return;
    const card = cards[index];
    if (!card?.el.contains(event.target)) return;
    card.el.querySelector("[data-time]").textContent = `${clock(Number(event.target.value))} / ${clock(card.duration)}`;
  });
  viewer.addEventListener("change", (event) => {
    if (!event.target.matches("[data-seek]")) return;
    const card = cards[index];
    if (card?.el.contains(event.target)) sendCommand(card, { type: "seek", seconds: Number(event.target.value) }, true);
  });
  window.addEventListener("message", (event) => {
    if (!opened || event.origin !== location.origin || event.data?.channel !== "vidbest-player") return;
    const card = cards.find((item) => item.frame?.contentWindow === event.source); if (!card) return;
    const data = event.data;
    if (data.type === "bridge") { card.bridge = true; command(card); }
    if (data.type === "ready") {
      card.ready = true; card.controllable = data.controllable === true; updateHint(card); command(card);
      if (desired(card)) scheduleCount(card); updatePreparation();
    }
    if (data.type === "state") {
      card.playing = data.playing === true; card.actualMuted = data.muted === true || data.soundBlocked === true;
      card.soundBlocked = data.soundBlocked === true;
      refreshPlayback(card);
    }
    if (data.type === "progress") { card.seconds = Math.max(0, Number(data.seconds) || 0); card.duration = Math.max(0, Number(data.duration) || 0); refreshTimeline(card); }
    if (data.type === "quality") card.el.querySelector("[data-quality]").textContent = data.label;
    if (data.type === "soundblocked" && desired(card)) { card.soundBlocked = true; message(card, "Tap Sound to enable audio · Swipe for next"); refreshPlayback(card); }
    if (data.type === "blocked" && desired(card)) message(card, "Tap Play to start · Swipe up for next");
    if (data.type === "error") {
      card.el.dataset.feedback = "1"; message(card, data.message);
    }
    if (data.type === "ended" && desired(card)) void move(1);
  });
  function pauseOriginal() {
    original.querySelectorAll("video,audio").forEach((video) => video.pause());
    original.querySelectorAll("iframe[src]").forEach((frame) => {
      if (frame.getAttribute("src") === "about:blank") return;
      if (!frame.dataset.swipeOriginalSrc) frame.dataset.swipeOriginalSrc = frame.getAttribute("src");
      frame.src = "about:blank";
    });
  }
  original.addEventListener("play", (event) => { if (opened && event.target.pause) event.target.pause(); }, true);
  function toggleFullscreen() {
    if (document.fullscreenElement === viewer) { document.exitFullscreen().catch(() => {}); return; }
    // Fullscreen the viewer itself. A fullscreen document can cover a modal dialog on Android.
    viewer.requestFullscreen?.().catch(() => { announce("Using screen-fit mode. Browser fullscreen is unavailable."); });
  }
  function open() {
    if (opened) return;
    opened = true; viewer.hidden = false; focusReturn = document.activeElement;
    overflow = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    savedInert = [...document.body.children].filter((el) => el !== viewer).map((el) => [el, el.inert]);
    savedInert.forEach(([el]) => { el.inert = true; });
    pauseOriginal(); suspension = new MutationObserver(pauseOriginal); suspension.observe(original, { subtree: true, childList: true });
    history.pushState({ ...history.state, vidbestSwipe: true }, "", location.href);
    toggleFullscreen(); closeButton.focus();
    activate(index); requestAnimationFrame(() => { feed.scrollTop = index * feed.clientHeight; });
    void suggest();
  }
  function close(fromHistory = false) {
    if (!opened) return;
    opened = false; clearTimeout(timer); suspension?.disconnect();
    cards.forEach(destroyPlayer); closeReview(false);
    if (document.fullscreenElement === viewer) document.exitFullscreen().catch(() => {});
    viewer.hidden = true; document.documentElement.style.overflow = overflow;
    savedInert.forEach(([el, inert]) => { el.inert = inert; }); savedInert = [];
    original.querySelectorAll("iframe[data-swipe-original-src]").forEach((frame) => { frame.src = frame.dataset.swipeOriginalSrc; delete frame.dataset.swipeOriginalSrc; });
    focusReturn?.focus();
    if (!fromHistory && history.state?.vidbestSwipe) history.back();
  }
  window.addEventListener("popstate", () => { if (opened) close(true); });
  window.addEventListener("pagehide", () => { if (opened) close(true); });
  new ResizeObserver(() => { if (opened) feed.scrollTop = index * feed.clientHeight; }).observe(feed);
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer); if (!opened) return;
    cards.forEach((card) => command(card));
    if (!document.hidden) scheduleCount(cards[index]);
  });
  viewer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); review.hidden ? close() : closeReview(); return; }
    if (review.hidden && !event.target.matches("input,select,textarea") && ["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) {
      event.preventDefault(); void move(["ArrowDown", "PageDown"].includes(event.key) ? 1 : -1);
    }
    if (event.key === "Tab") {
      const items = [...viewer.querySelectorAll("button:not(:disabled),input:not(:disabled),a[href],iframe,[tabindex='0']")].filter((el) => !el.closest("[inert]") && el.getClientRects().length);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  });
  // The review handle has a separate gesture so reading does not fight feed scrolling.
  let reviewTouch;
  viewer.addEventListener("touchstart", (event) => {
    if (event.target.closest("[data-review],[data-review-close]")) reviewTouch = event.touches[0]?.clientY;
  }, { passive: true });
  viewer.addEventListener("touchend", (event) => {
    if (reviewTouch === undefined) return;
    const dy = event.changedTouches[0].clientY - reviewTouch; reviewTouch = undefined;
    if (dy < -40) openReview(cards[index]); else if (dy > 40) closeReview();
  }, { passive: true });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button || viewer.contains(button)) return;
    const label = `${button.textContent} ${button.title} ${button.getAttribute("aria-label")}`;
    if (button.hasAttribute("data-swipe-open") || ((original.contains(button) || button.closest(".vidbest-embed-overlay")) && /fullscreen/i.test(label))) {
      event.preventDefault(); event.stopImmediatePropagation(); open();
    }
  }, true);
  makeCard(first);
})();
