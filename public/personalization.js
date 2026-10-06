const SMART = {
  root: document.querySelector("#smart-picks"),
  track: document.querySelector("#smart-pick-track"),
  summary: document.querySelector("#smart-picks-summary"),
  tabs: [...document.querySelectorAll("[data-smart-lane]")],
  nav: [...document.querySelectorAll("[data-smart-scroll]")],
  activeLane: "for_you",
  sections: {},
  authenticated: false,
  savedIds: new Set(),
  timer: null,
};

document.addEventListener("DOMContentLoaded", initializeSmartPicks);
document.addEventListener("vidbest:grid-rendered", syncLibrarySaveButtons);
document.addEventListener("vidbest:member-changed", () => {
  void loadSmartPicks();
});
document.addEventListener("click", handleGlobalSaveClick);

async function initializeSmartPicks() {
  if (!SMART.root || !SMART.track) return;

  SMART.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      SMART.activeLane = tab.dataset.smartLane || "for_you";
      SMART.tabs.forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
      renderSmartLane();
      restartAutoScroll();
    });
  });

  SMART.nav.forEach((button) => {
    button.addEventListener("click", () => scrollSmartTrack(Number(button.dataset.smartScroll || 1)));
  });

  SMART.track.addEventListener("pointerenter", stopAutoScroll);
  SMART.track.addEventListener("pointerleave", restartAutoScroll);
  SMART.track.addEventListener("focusin", stopAutoScroll);
  SMART.track.addEventListener("focusout", restartAutoScroll);
  SMART.track.addEventListener("touchstart", stopAutoScroll, { passive: true });
  SMART.track.addEventListener("touchend", restartAutoScroll, { passive: true });

  await loadSmartPicks();
}

async function loadSmartPicks() {
  if (!SMART.root) return;
  try {
    const response = await fetch("/api/home/mini-feed?limit=10", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not load smart picks.");

    SMART.authenticated = Boolean(payload.authenticated);
    SMART.sections = payload.sections || {};
    SMART.savedIds = new Set((payload.saved_ids || []).map(Number));
    updateSavedTab();
    syncLibrarySaveButtons();
    renderSmartLane();

    document.dispatchEvent(new CustomEvent("vidbest:saved-count", {
      detail: { count: Number(payload.saved_count || 0) },
    }));
  } catch (error) {
    SMART.track.replaceChildren(messageCard(error.message || "Recommendations are temporarily unavailable."));
    if (SMART.summary) SMART.summary.textContent = "The main library is still available below.";
  }
  restartAutoScroll();
}

function updateSavedTab() {
  const savedTab = SMART.tabs.find((tab) => tab.dataset.smartLane === "saved");
  if (!savedTab) return;
  savedTab.textContent = SMART.authenticated ? `Saved (${SMART.savedIds.size})` : "Saved";
}

function renderSmartLane() {
  if (!SMART.track) return;
  const videos = Array.isArray(SMART.sections[SMART.activeLane]) ? SMART.sections[SMART.activeLane] : [];
  SMART.track.replaceChildren();

  if (!videos.length) {
    const copy = SMART.activeLane === "saved"
      ? (SMART.authenticated
        ? "Save videos from the library and they will appear here."
        : "Sign in with email to keep a saved-video list across visits.")
      : "More recommendations will appear as the library grows.";
    SMART.track.append(messageCard(copy));
  } else {
    videos.forEach((video) => SMART.track.append(buildSmartCard(video)));
  }

  if (SMART.summary) {
    const descriptions = {
      for_you: SMART.authenticated
        ? "Ranked from your topic choice, saves, popularity and freshness."
        : "A balanced mix of trending, featured and popular videos.",
      most_watched: "The videos visitors have watched most.",
      most_liked: "Videos receiving the strongest like and love signals.",
      saved: SMART.authenticated ? "Your saved videos, newest save first." : "Sign in to save videos.",
    };
    SMART.summary.textContent = descriptions[SMART.activeLane] || "";
  }
}

function buildSmartCard(video) {
  const card = document.createElement("article");
  card.className = "smart-pick-card";
  card.dataset.videoId = String(video.id || "");

  const media = document.createElement("a");
  media.className = "smart-pick-media";
  media.href = "/watch/" + encodeURIComponent(video.slug || "");
  const imageUrl = smartPoster(video);
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => image.remove(), { once: true });
    media.append(image);
  }
  const play = document.createElement("span");
  play.className = "smart-pick-play";
  play.textContent = "▶";
  media.append(play);

  const body = document.createElement("div");
  body.className = "smart-pick-body";
  const badges = document.createElement("div");
  badges.className = "smart-pick-badges";
  const category = document.createElement("span");
  category.textContent = video.primary_category || "Video";
  const subcategory = document.createElement("span");
  subcategory.textContent = video.subcategory || "";
  badges.append(category, subcategory);

  const title = document.createElement("a");
  title.className = "smart-pick-title";
  title.href = media.href;
  title.textContent = video.title || "Vid.Best video";

  const meta = document.createElement("div");
  meta.className = "smart-pick-meta";
  const reactionTotal = Object.values(video.reactions || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  meta.textContent = `${formatCompact(video.views)} views · ${formatCompact(reactionTotal)} reactions`;

  const actions = document.createElement("div");
  actions.className = "smart-pick-actions";
  const watch = document.createElement("a");
  watch.className = "smart-watch-link";
  watch.href = media.href;
  watch.textContent = "Watch";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "smart-save-button";
  save.dataset.saveVideo = String(video.id || "");
  const isSaved = SMART.savedIds.has(Number(video.id));
  save.setAttribute("aria-pressed", String(isSaved));
  save.textContent = isSaved ? "♥ Saved" : "♡ Save";
  actions.append(watch, save);

  body.append(badges, title, meta, actions);
  card.append(media, body);
  return card;
}

function smartPoster(video) {
  if (video.thumbnail_url) return video.thumbnail_url;
  if (String(video.provider || video.media_type || "").toLowerCase() === "tiktok") {
    const id = String(video.source_url || "").match(/\/video\/(\d+)/)?.[1];
    if (id) return "/api/tiktok/cached-poster?id=" + encodeURIComponent(id);
  }
  return "";
}

function messageCard(message) {
  const card = document.createElement("div");
  card.className = "smart-pick-message";
  card.textContent = message;
  return card;
}

function scrollSmartTrack(direction) {
  if (!SMART.track) return;
  const amount = Math.max(260, Math.round(SMART.track.clientWidth * 0.78));
  SMART.track.scrollBy({ left: amount * direction, behavior: "smooth" });
}

function restartAutoScroll() {
  stopAutoScroll();
  SMART.timer = window.setInterval(() => {
    if (document.hidden || !SMART.track || SMART.track.scrollWidth <= SMART.track.clientWidth + 10) return;
    const nearEnd = SMART.track.scrollLeft + SMART.track.clientWidth >= SMART.track.scrollWidth - 20;
    if (nearEnd) SMART.track.scrollTo({ left: 0, behavior: "smooth" });
    else scrollSmartTrack(1);
  }, 5200);
}

function stopAutoScroll() {
  if (SMART.timer) window.clearInterval(SMART.timer);
  SMART.timer = null;
}

async function handleGlobalSaveClick(event) {
  const button = event.target.closest("[data-save-video], .save-video-button");
  if (!button) return;

  const card = button.closest("[data-video-id], .video-tile");
  const videoId = Number(button.dataset.saveVideo || card?.dataset.videoId || 0);
  if (!videoId) return;

  event.preventDefault();
  button.disabled = true;
  const desired = !SMART.savedIds.has(videoId);

  try {
    const response = await fetch(`/api/videos/${videoId}/save`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: desired }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      document.querySelector("#notification-hub")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.querySelector("#member-email")?.focus({ preventScroll: true });
      if (SMART.summary) SMART.summary.textContent = "Sign in with email first, then you can save videos across visits.";
      return;
    }
    if (!response.ok) throw new Error(payload.error || "Could not update saved videos.");

    if (payload.saved) SMART.savedIds.add(videoId);
    else SMART.savedIds.delete(videoId);
    syncLibrarySaveButtons();
    updateSavedTab();

    document.querySelectorAll(`[data-save-video="${videoId}"]`).forEach((item) => {
      item.setAttribute("aria-pressed", String(payload.saved));
      item.textContent = payload.saved ? "♥ Saved" : "♡ Save";
    });

    document.dispatchEvent(new CustomEvent("vidbest:saved-count", {
      detail: { count: Number(payload.saved_count || SMART.savedIds.size) },
    }));
    await loadSmartPicks();
  } catch (error) {
    if (SMART.summary) SMART.summary.textContent = error.message || "Could not update saved videos.";
  } finally {
    button.disabled = false;
  }
}

function syncLibrarySaveButtons() {
  document.querySelectorAll(".video-tile").forEach((card) => {
    const id = Number(card.dataset.videoId || 0);
    const button = card.querySelector(".save-video-button");
    if (!button || !id) return;
    const saved = SMART.savedIds.has(id);
    button.dataset.saveVideo = String(id);
    button.setAttribute("aria-pressed", String(saved));
    button.textContent = saved ? "♥ Saved" : "♡ Save";
  });
}

function formatCompact(value) {
  return new Intl.NumberFormat(undefined, {
    notation: Number(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}
