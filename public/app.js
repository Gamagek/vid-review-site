const state = {
  categories: {},
  videos: [],
  featured: [],
  offset: 0,
  limit: 18,
  total: 0,
  carouselIndex: 0,
  carouselTimer: null,
  requestId: 0,
  loading: false,
  retryReset: true,
};

const elements = {
  categorySelect: document.querySelector("#category-select"),
  subcategorySelect: document.querySelector("#subcategory-select"),
  sortSelect: document.querySelector("#sort-select"),
  searchInput: document.querySelector("#search-input"),
  filterForm: document.querySelector("#filter-form"),
  clearFilters: document.querySelector("#clear-filters"),
  categoryChips: document.querySelector("#category-chips"),
  grid: document.querySelector("#video-grid"),
  emptyState: document.querySelector("#empty-state"),
  emptyMessage: document.querySelector("#empty-message"),
  emptyTitle: document.querySelector("#empty-title"),
  retryLibrary: document.querySelector("#retry-library"),
  requestDiscovery: document.querySelector("#request-discovery"),
  requestDiscoveryStatus: document.querySelector("#request-discovery-status"),
  loadMore: document.querySelector("#load-more"),
  resultSummary: document.querySelector("#result-summary"),
  template: document.querySelector("#video-card-template"),
  carousel: document.querySelector("#featured-carousel"),
  carouselDots: document.querySelector("#carousel-dots"),
  carouselPrevious: document.querySelector("#carousel-prev"),
  carouselNext: document.querySelector("#carousel-next"),
  surprise: document.querySelector("#surprise-button"),
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  document.dispatchEvent(new CustomEvent("vidbest:library-started"));
  bindEvents();
  restoreFiltersFromUrl();
  // Optional discovery sections must never gate the main library.
  await Promise.all([
    loadCategories().catch(() => {
      elements.categorySelect.disabled = true;
      elements.subcategorySelect.disabled = true;
      elements.categoryChips.textContent = "Categories are temporarily unavailable. You can still search the library below.";
    }),
    loadFeatured().catch(() => {
      state.featured = [];
      renderCarousel("Featured videos are temporarily unavailable");
    }),
    loadVideos({ reset: true }),
  ]);
}

async function loadCategories() {
  const response = await api("/api/categories?version=14");
  if (!response.categories || typeof response.categories !== "object" || Array.isArray(response.categories)) {
    throw requestError("response", "Category data is temporarily unavailable.");
  }
  state.categories = response.categories;
  if (!Object.prototype.hasOwnProperty.call(state.categories, "Other")) state.categories.Other = ["Other"];
  populateCategoryControls();
}

function replaceContent(element, ...children) {
  if (typeof element.replaceChildren === "function") {
    element.replaceChildren(...children);
    return;
  }
  while (element.firstChild) element.removeChild(element.firstChild);
  children.forEach(child => element.appendChild(child));
}

function requestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateVideoList(result) {
  if (!result || !Array.isArray(result.videos) || !result.pagination ||
      typeof result.pagination.total !== "number" || !Number.isFinite(result.pagination.total) || result.pagination.total < 0 ||
      result.videos.some(video => !video || !Number.isFinite(Number(video.id)) ||
        typeof video.slug !== "string" || typeof video.title !== "string")) {
    throw requestError("response", "The server returned an invalid video response. Please retry.");
  }
  return result;
}

function showLibraryError(error, reset) {
  const code = error.code || "unavailable";
  const network = code === "network" || code === "timeout";
  elements.emptyTitle.textContent = code === "compatibility" ? "Browser support required" : network ? "Connection problem" : "Video library unavailable";
  elements.emptyMessage.textContent = error.message || "The video library is temporarily unavailable. Please retry.";
  elements.emptyState.hidden = false;
  elements.retryLibrary.hidden = code === "compatibility";
  elements.resultSummary.textContent = reset ? (network ? "Could not connect to the video library." : "The video library is temporarily unavailable.") : `${state.videos.length} videos loaded; more could not be loaded.`;
  state.retryReset = reset;
  updateDiscoveryRequestAction(false);
  elements.loadMore.hidden = true;
}

function scrollToLibrary() {
  try {
    document.querySelector("#discover").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    document.querySelector("#discover").scrollIntoView();
  }
}

function bindEvents() {
  elements.filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadVideos({ reset: true });
  });
  elements.categorySelect.addEventListener("change", () => {
    delete elements.categorySelect.dataset.pending;
    delete elements.subcategorySelect.dataset.pending;
    populateSubcategories(elements.categorySelect.value);
  });
  elements.subcategorySelect.addEventListener("change", () => { delete elements.subcategorySelect.dataset.pending; });
  elements.clearFilters.addEventListener("click", () => {
    elements.filterForm.reset();
    delete elements.categorySelect.dataset.pending;
    delete elements.subcategorySelect.dataset.pending;
    elements.subcategorySelect.innerHTML = '<option value="">All subcategories</option>';
    elements.subcategorySelect.disabled = true;
    updateActiveChip("");
    loadVideos({ reset: true });
  });
  elements.loadMore.addEventListener("click", () => loadVideos({ reset: false }));
  elements.retryLibrary.addEventListener("click", () => loadVideos({ reset: state.retryReset }));
  elements.carouselPrevious.addEventListener("click", () => moveCarousel(-1));
  elements.carouselNext.addEventListener("click", () => moveCarousel(1));
  elements.carousel.addEventListener("pointerenter", stopCarouselTimer);
  elements.carousel.addEventListener("pointerleave", startCarouselTimer);
  elements.carousel.addEventListener("focusin", stopCarouselTimer);
  elements.carousel.addEventListener("focusout", startCarouselTimer);
  elements.surprise.addEventListener("click", surpriseMe);
  elements.requestDiscovery.addEventListener("click", submitDiscoveryRequest);
}

function restoreFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  elements.searchInput.value = params.get("q") || "";
  elements.sortSelect.value = params.get("sort") || "newest";
  elements.categorySelect.dataset.pending = params.get("category") || "";
  elements.subcategorySelect.dataset.pending = params.get("subcategory") || "";
}

function populateCategoryControls() {
  const pendingCategory = elements.categorySelect.dataset.pending || "";
  const chipColors = ["#8b6cff", "#35dcff", "#ff6ea9", "#5ee7a4", "#ffc86b", "#4ba8ff"];

  Object.keys(state.categories).filter(category => Array.isArray(state.categories[category])).forEach((category, index) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.categorySelect.append(option);

    const chip = document.createElement("button");
    chip.className = "category-chip";
    chip.type = "button";
    chip.textContent = category;
    chip.style.setProperty("--chip-color", chipColors[index % chipColors.length]);
    chip.addEventListener("click", () => {
      delete elements.categorySelect.dataset.pending;
      delete elements.subcategorySelect.dataset.pending;
      elements.categorySelect.value = category;
      populateSubcategories(category);
      updateActiveChip(category);
      loadVideos({ reset: true });
      scrollToLibrary();
    });
    elements.categoryChips.append(chip);
  });

  if (pendingCategory && Object.prototype.hasOwnProperty.call(state.categories, pendingCategory)) {
    elements.categorySelect.value = pendingCategory;
    populateSubcategories(pendingCategory, elements.subcategorySelect.dataset.pending || "");
    updateActiveChip(pendingCategory);
    delete elements.categorySelect.dataset.pending;
    delete elements.subcategorySelect.dataset.pending;
  }
}

function populateSubcategories(category, selected = "") {
  elements.subcategorySelect.innerHTML = '<option value="">All subcategories</option>';
  const subcategories = state.categories[category] || [];
  elements.subcategorySelect.disabled = subcategories.length === 0;
  subcategories.forEach((subcategory) => {
    const option = document.createElement("option");
    option.value = subcategory;
    option.textContent = subcategory;
    elements.subcategorySelect.append(option);
  });
  if (selected && subcategories.includes(selected)) elements.subcategorySelect.value = selected;
  updateActiveChip(category);
}

function updateActiveChip(category) {
  elements.categoryChips.querySelectorAll(".category-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.textContent === category);
  });
}

async function loadFeatured() {
  let result = validateVideoList(await api("/api/videos?featured=1&sort=trending&limit=7"));
  if (!result.videos.length) result = validateVideoList(await api("/api/videos?sort=trending&limit=7"));
  state.featured = result.videos || [];
  state.carouselIndex = 0;
  renderCarousel();
  startCarouselTimer();
}

function renderCarousel(errorMessage = "") {
  replaceContent(elements.carousel);
  replaceContent(elements.carouselDots);
  if (!state.featured.length) {
    const empty = document.createElement("article");
    empty.className = "featured-card active";
    empty.style.setProperty("--distance", "0");
    empty.style.setProperty("--abs-distance", "0");
    const fallback = document.createElement("div");
    fallback.className = "featured-fallback";
    fallback.textContent = "◇";
    const copy = document.createElement("div");
    copy.className = "featured-card-content";
    const title = document.createElement("h2");
    title.textContent = errorMessage || "Your featured reviews will appear here";
    const text = document.createElement("p");
    text.textContent = errorMessage ? "Explore the video library below." : "Explore the library for published video reviews.";
    copy.append(title, text);
    empty.append(fallback, copy);
    elements.carousel.append(empty);
    elements.carouselPrevious.disabled = true;
    elements.carouselNext.disabled = true;
    return;
  }

  elements.carouselPrevious.disabled = false;
  elements.carouselNext.disabled = false;
  state.featured.forEach((video, index) => {
    const card = document.createElement("article");
    card.className = "featured-card";
    card.dataset.index = String(index);
    if (video.thumbnail_url) {
      const image = document.createElement("img");
      image.alt = "";
      image.loading = index === 0 ? "eager" : "lazy";
      image.decoding = "async";
      image.fetchPriority = index === 0 ? "high" : "low";
      image.src = video.thumbnail_url;
      image.addEventListener("error", () => image.replaceWith(featuredFallback()));
      card.append(image);
    } else {
      card.append(featuredFallback());
    }
    const copy = document.createElement("div");
    copy.className = "featured-card-content";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = video.subcategory;
    const heading = document.createElement("h2");
    heading.textContent = video.title;
    copy.append(badge, heading);
    const link = document.createElement("a");
    link.className = "featured-card-link";
    link.href = `/watch/${encodeURIComponent(video.slug)}`;
    link.setAttribute("aria-label", `Open ${video.title}`);
    card.append(copy, link);
    elements.carousel.append(card);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `Show featured video ${index + 1}`);
    dot.addEventListener("click", () => setCarouselIndex(index));
    elements.carouselDots.append(dot);
  });
  updateCarousel();
}

function featuredFallback() {
  const fallback = document.createElement("div");
  fallback.className = "featured-fallback";
  fallback.textContent = "▶";
  return fallback;
}

function moveCarousel(direction) {
  if (!state.featured.length) return;
  setCarouselIndex((state.carouselIndex + direction + state.featured.length) % state.featured.length);
}

function setCarouselIndex(index) {
  state.carouselIndex = index;
  updateCarousel();
  startCarouselTimer();
}

function updateCarousel() {
  const count = state.featured.length;
  [...elements.carousel.children].forEach((card, index) => {
    let distance = index - state.carouselIndex;
    if (distance > count / 2) distance -= count;
    if (distance < -count / 2) distance += count;
    card.style.setProperty("--distance", String(distance));
    card.style.setProperty("--abs-distance", String(Math.min(Math.abs(distance), 3)));
    card.classList.toggle("active", distance === 0);
    card.style.zIndex = String(10 - Math.abs(distance));
    card.setAttribute("aria-hidden", String(distance !== 0));
  });
  [...elements.carouselDots.children].forEach((dot, index) => dot.classList.toggle("active", index === state.carouselIndex));
}

function startCarouselTimer() {
  stopCarouselTimer();
  if (state.featured.length > 1 && (typeof matchMedia !== "function" || !matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    state.carouselTimer = setInterval(() => moveCarousel(1), 6500);
  }
}

function stopCarouselTimer() {
  clearInterval(state.carouselTimer);
  state.carouselTimer = null;
}

async function loadVideos({ reset }) {
  if (!reset && state.loading) return;
  const requestId = ++state.requestId;
  state.loading = true;
  elements.emptyState.hidden = true;
  elements.retryLibrary.hidden = true;
  elements.retryLibrary.disabled = true;
  if (reset) {
    state.offset = 0;
    state.videos = [];
    replaceContent(elements.grid, videoSkeleton(), videoSkeleton(), videoSkeleton());
    elements.resultSummary.textContent = "Loading video reviews…";
  }
  elements.loadMore.disabled = true;
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
    sort: elements.sortSelect.value,
  });
  if (elements.searchInput.value.trim()) params.set("q", elements.searchInput.value.trim());
  const category = elements.categorySelect.value || elements.categorySelect.dataset.pending || "";
  const subcategory = elements.subcategorySelect.value || elements.subcategorySelect.dataset.pending || "";
  if (category) params.set("category", category);
  if (subcategory) params.set("subcategory", subcategory);

  try {
    const result = validateVideoList(await api(`/api/videos?${params}`));
    if (requestId !== state.requestId) return;
    const incoming = result.videos;
    state.total = Number(result.pagination.total);
    const previousCount = state.videos.length;
    state.videos.push(...incoming);
    state.offset += incoming.length;
    renderVideoGrid({ appendFrom: reset ? 0 : previousCount });
    syncUrl();
  } catch (error) {
    if (requestId !== state.requestId) return;
    if (reset) replaceContent(elements.grid);
    showLibraryError(error, reset);
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      elements.loadMore.disabled = false;
      elements.retryLibrary.disabled = false;
    }
  }
}

function renderVideoGrid({ appendFrom = 0 } = {}) {
  // Keep existing cards, media previews and lazy-load state when loading page 2+.
  // Re-creating every previously loaded tile needlessly refetches thumbnails.
  if (appendFrom === 0) replaceContent(elements.grid);
  state.videos.slice(appendFrom).forEach((video) => elements.grid.append(buildVideoCard(video)));
  document.dispatchEvent(new CustomEvent("vidbest:grid-rendered"));
  const shown = state.videos.length;
  elements.resultSummary.textContent = state.total === 1 ? "1 curated video" : `${state.total.toLocaleString()} curated videos`;
  elements.emptyState.hidden = shown > 0;
  elements.emptyTitle.textContent = "No videos found";
  elements.retryLibrary.hidden = true;
  if (shown === 0) {
    elements.emptyMessage.textContent = elements.searchInput.value.trim()
      ? "This video is not reviewed yet. You can ask the publisher to add it."
      : "No published reviews match these filters yet.";
  }
  updateDiscoveryRequestAction(shown === 0);
  elements.loadMore.hidden = shown === 0 || shown >= state.total;
}

function buildVideoCard(video) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".video-tile");
  const pageUrl = `/watch/${encodeURIComponent(video.slug)}`;
  card.dataset.videoId = String(video.id);
  card.dataset.videoSlug = video.slug || "";
  card.dataset.videoTitle = video.title || "Video";
  card.dataset.videoProvider = video.provider || video.media_type || "direct";
  card.dataset.videoSource = video.source_url || "";
  card.dataset.reviewPreview = video.review_preview_url || "";
  card.dataset.reviewArtworkAlt = video.review_artwork_alt || "";
  card.dataset.tiktokPoster = video.preview_poster_url || "";
  card.dataset.videoEmbed = video.embed_url || "";
  card.dataset.videoThumbnail = video.thumbnail_url || "";
  card.dataset.facebookPreviewTitle = video.facebook_preview_title || "";
  card.dataset.facebookPreviewDescription = video.facebook_preview_description || "";
  card.dataset.facebookPreviewAuthor = video.facebook_preview_author || "";
  card.dataset.videoThumbnail = video.thumbnail_url || "";
  card.querySelector(".tile-media").href = pageUrl;
  card.querySelector(".tile-title").href = pageUrl;
  card.querySelector(".tile-title").textContent = video.title;
  card.querySelector(".category-badge").textContent = video.primary_category;
  card.querySelector(".subcategory-badge").textContent = video.subcategory;
  card.querySelector(".tile-description").textContent = video.description || "Open the review to discover more about this video.";
  card.querySelector(".media-type").textContent = card.dataset.videoProvider === "instagram" ? "Instagram" : video.media_type;
  card.querySelector(".views-count").textContent = `${formatNumber(video.views)} views`;
  const time = card.querySelector("time");
  time.dateTime = video.created_at;
  time.textContent = formatDate(video.created_at);

  const image = card.querySelector(".tile-media img");
  image.loading = "lazy";
  image.decoding = "async";
  image.fetchPriority = "low";
  const fallback = card.querySelector(".media-fallback");
  const listingImage = video.review_preview_url || video.thumbnail_url;
  if (listingImage && card.dataset.videoProvider !== "tiktok") {
    image.src = listingImage;
    image.alt = video.review_preview_url ? video.review_artwork_alt : `${video.title} thumbnail`;
    fallback.hidden = true;
    image.addEventListener("error", () => {
      image.hidden = true;
      fallback.hidden = false;
    });
  } else {
    image.hidden = true;
    fallback.hidden = false;
  }

  card.querySelectorAll("[data-reaction]").forEach((button) => {
    const type = button.dataset.reaction;
    button.querySelector("span").textContent = formatNumber(video.reactions && video.reactions[type] || 0);
    button.addEventListener("click", () => react(video.id, type, card));
  });
  card.querySelector(".interest-button").addEventListener("click", () => saveInterest(video.id, card));
  card.querySelector(".quick-comment-form").addEventListener("submit", (event) => submitQuickComment(event, video.id));
  return fragment;
}

function videoSkeleton() {
  const skeleton = document.createElement("div");
  skeleton.className = "video-tile glass-panel";
  skeleton.style.minHeight = "480px";
  skeleton.style.opacity = ".42";
  skeleton.setAttribute("aria-hidden", "true");
  return skeleton;
}

async function react(videoId, reaction, card) {
  const button = card.querySelector(`[data-reaction="${reaction}"]`);
  button.disabled = true;
  try {
    const result = await api(`/api/videos/${videoId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
    card.querySelectorAll("[data-reaction]").forEach((item) => {
      item.querySelector("span").textContent = formatNumber(result.reactions[item.dataset.reaction] || 0);
    });
    button.classList.toggle("active", result.active);
  } catch (error) {
    console.warn(error.message);
  } finally {
    button.disabled = false;
  }
}

async function submitQuickComment(event, videoId) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const body = form.elements.body.value.trim();
  if (!body) return;
  setStatus(status, "Sending…");
  try {
    const result = await api(`/api/videos/${videoId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, website: form.elements.website.value }),
    });
    form.reset();
    setStatus(status, result.message || "Sent for moderation.", "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  }
}

async function saveInterest(videoId, card) {
  const button = card.querySelector(".interest-button");
  const status = card.querySelector(".interest-status");
  button.disabled = true;
  setStatus(status, "Saving…");
  try {
    await api(`/api/videos/${videoId}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: "more" }),
    });
    button.classList.add("active");
    button.textContent = "✓ More like this";
    setStatus(status, "Preference saved", "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function updateDiscoveryRequestAction(allow) {
  const query = elements.searchInput.value.trim();
  elements.requestDiscovery.hidden = !allow || query.length < 3;
  setStatus(elements.requestDiscoveryStatus, "");
}

async function submitDiscoveryRequest() {
  const query = elements.searchInput.value.trim();
  if (query.length < 3) return;
  elements.requestDiscovery.disabled = true;
  setStatus(elements.requestDiscoveryStatus, "Adding this request for review…");
  try {
    const result = await api("/api/discovery-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    setStatus(elements.requestDiscoveryStatus, result.message || "Request added.", "success");
    elements.requestDiscovery.hidden = true;
  } catch (error) {
    setStatus(elements.requestDiscoveryStatus, error.message, "error");
  } finally {
    elements.requestDiscovery.disabled = false;
  }
}

function syncUrl() {
  const params = new URLSearchParams();
  if (elements.searchInput.value.trim()) params.set("q", elements.searchInput.value.trim());
  const category = elements.categorySelect.value || elements.categorySelect.dataset.pending || "";
  const subcategory = elements.subcategorySelect.value || elements.subcategorySelect.dataset.pending || "";
  if (category) params.set("category", category);
  if (subcategory) params.set("subcategory", subcategory);
  if (elements.sortSelect.value !== "newest") params.set("sort", elements.sortSelect.value);
  const query = params.toString();
  try { history.replaceState(null, "", query ? `?${query}` : location.pathname); } catch (error) { /* Browser privacy restrictions do not hide loaded records. */ }
}

function surpriseMe() {
  const pool = state.videos.length ? state.videos : state.featured;
  if (!pool.length) {
    scrollToLibrary();
    return;
  }
  const video = pool[Math.floor(Math.random() * pool.length)];
  location.href = `/watch/${encodeURIComponent(video.slug)}`;
}

async function api(url, options = {}) {
  if (typeof fetch !== "function") throw requestError("compatibility", "This browser cannot load the interactive library. Use the video directory below or update your browser.");
  const read = !options.method || options.method.toUpperCase() === "GET";
  const requestOptions = Object.assign({}, options);
  if (read) requestOptions.cache = "no-store";
  const controller = read && typeof AbortController === "function" ? new AbortController() : null;
  if (controller) requestOptions.signal = controller.signal;
  let timer;
  const request = (async () => {
    let response;
    try { response = await fetch(url, requestOptions); }
    catch (error) { throw requestError("network", "Could not connect to Vid.Best. Check your connection and retry."); }
    let text;
    try { text = await response.text(); }
    catch (error) { throw requestError("network", "The connection ended before the response arrived. Please retry."); }
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch (error) {
      throw requestError("response", response.ok ? "The server returned an invalid response. Please retry." : `Video request failed (HTTP ${response.status}). Please retry.`);
    }
    if (!response.ok) throw requestError("http", payload && payload.error || `Request failed with HTTP ${response.status}. Please retry.`);
    return payload;
  })();
  try {
    if (!read) return await request;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(requestError("timeout", "The video request timed out. Check your connection and retry."));
        if (controller) controller.abort();
      }, 15000);
    });
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `form-status${type ? ` ${type}` : ""}`;
}

function formatNumber(value) {
  const number = Number(value) || 0;
  try { return new Intl.NumberFormat(undefined, { notation: number >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number); }
  catch (error) { return String(number); }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date); }
  catch (error) { return date.toISOString().slice(0, 10); }
}
