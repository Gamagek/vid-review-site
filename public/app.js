const state = {
  categories: {},
  videos: [],
  featured: [],
  offset: 0,
  limit: 18,
  total: 0,
  carouselIndex: 0,
  carouselTimer: null,
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
  bindEvents();
  restoreFiltersFromUrl();
  try {
    const response = await api("/api/categories");
    state.categories = response.categories || {};
    populateCategoryControls();
    await Promise.all([loadFeatured(), loadVideos({ reset: true })]);
  } catch (error) {
    elements.resultSummary.textContent = error.message;
    showEmpty("The video library is temporarily unavailable.");
  }
}

function bindEvents() {
  elements.filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadVideos({ reset: true });
  });
  elements.categorySelect.addEventListener("change", () => {
    populateSubcategories(elements.categorySelect.value);
  });
  elements.clearFilters.addEventListener("click", () => {
    elements.filterForm.reset();
    elements.subcategorySelect.innerHTML = '<option value="">All subcategories</option>';
    elements.subcategorySelect.disabled = true;
    updateActiveChip("");
    loadVideos({ reset: true });
  });
  elements.loadMore.addEventListener("click", () => loadVideos({ reset: false }));
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

  Object.keys(state.categories).forEach((category, index) => {
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
      elements.categorySelect.value = category;
      populateSubcategories(category);
      updateActiveChip(category);
      loadVideos({ reset: true });
      document.querySelector("#discover").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.categoryChips.append(chip);
  });

  if (pendingCategory && Object.hasOwn(state.categories, pendingCategory)) {
    elements.categorySelect.value = pendingCategory;
    populateSubcategories(pendingCategory, elements.subcategorySelect.dataset.pending || "");
    updateActiveChip(pendingCategory);
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
  let result = await api("/api/videos?featured=1&sort=trending&limit=7");
  if (!result.videos?.length) result = await api("/api/videos?sort=trending&limit=7");
  state.featured = result.videos || [];
  state.carouselIndex = 0;
  renderCarousel();
  startCarouselTimer();
}

function renderCarousel() {
  elements.carousel.replaceChildren();
  elements.carouselDots.replaceChildren();
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
    title.textContent = "Your featured reviews will appear here";
    const text = document.createElement("p");
    text.textContent = "Open the publisher console and mark a video as Featured.";
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
      image.src = video.thumbnail_url;
      image.alt = "";
      image.loading = index === 0 ? "eager" : "lazy";
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
    const description = document.createElement("p");
    description.textContent = video.description || "Open this discovery to read the full review.";
    copy.append(badge, heading, description);
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
  if (state.featured.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.carouselTimer = setInterval(() => moveCarousel(1), 6500);
  }
}

function stopCarouselTimer() {
  clearInterval(state.carouselTimer);
  state.carouselTimer = null;
}

async function loadVideos({ reset }) {
  if (reset) {
    state.offset = 0;
    state.videos = [];
    elements.grid.replaceChildren(videoSkeleton(), videoSkeleton(), videoSkeleton());
  }
  elements.loadMore.disabled = true;
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
    sort: elements.sortSelect.value,
  });
  if (elements.searchInput.value.trim()) params.set("q", elements.searchInput.value.trim());
  if (elements.categorySelect.value) params.set("category", elements.categorySelect.value);
  if (elements.subcategorySelect.value) params.set("subcategory", elements.subcategorySelect.value);

  try {
    const result = await api(`/api/videos?${params}`);
    const incoming = result.videos || [];
    state.total = Number(result.pagination?.total || 0);
    state.videos.push(...incoming);
    state.offset += incoming.length;
    renderVideoGrid();
    syncUrl();
  } catch (error) {
    if (reset) elements.grid.replaceChildren();
    showEmpty(error.message);
  } finally {
    elements.loadMore.disabled = false;
  }
}

function renderVideoGrid() {
  elements.grid.replaceChildren();
  state.videos.forEach((video) => elements.grid.append(buildVideoCard(video)));
  const shown = state.videos.length;
  elements.resultSummary.textContent = state.total === 1 ? "1 curated video" : `${state.total.toLocaleString()} curated videos`;
  elements.emptyState.hidden = shown > 0;
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
  card.querySelector(".tile-media").href = pageUrl;
  card.querySelector(".tile-title").href = pageUrl;
  card.querySelector(".tile-title").textContent = video.title;
  card.querySelector(".category-badge").textContent = video.primary_category;
  card.querySelector(".subcategory-badge").textContent = video.subcategory;
  card.querySelector(".tile-description").textContent = video.description || "Open the review to discover more about this video.";
  card.querySelector(".media-type").textContent = video.media_type;
  card.querySelector(".views-count").textContent = `${formatNumber(video.views)} views`;
  const time = card.querySelector("time");
  time.dateTime = video.created_at;
  time.textContent = formatDate(video.created_at);

  const image = card.querySelector(".tile-media img");
  const fallback = card.querySelector(".media-fallback");
  if (video.thumbnail_url) {
    image.src = video.thumbnail_url;
    image.alt = `${video.title} thumbnail`;
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
    button.querySelector("span").textContent = formatNumber(video.reactions?.[type] || 0);
    button.addEventListener("click", () => react(video.id, type, card));
  });
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

function showEmpty(message, allowDiscoveryRequest = false) {
  elements.grid.replaceChildren();
  elements.emptyState.hidden = false;
  elements.emptyMessage.textContent = message;
  updateDiscoveryRequestAction(allowDiscoveryRequest);
  elements.loadMore.hidden = true;
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
  if (elements.categorySelect.value) params.set("category", elements.categorySelect.value);
  if (elements.subcategorySelect.value) params.set("subcategory", elements.subcategorySelect.value);
  if (elements.sortSelect.value !== "newest") params.set("sort", elements.sortSelect.value);
  history.replaceState(null, "", params.size ? `?${params}` : location.pathname);
}

function surpriseMe() {
  const pool = state.videos.length ? state.videos : state.featured;
  if (!pool.length) {
    document.querySelector("#discover").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const video = pool[Math.floor(Math.random() * pool.length)];
  location.href = `/watch/${encodeURIComponent(video.slug)}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  return payload;
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `form-status${type ? ` ${type}` : ""}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: Number(value) >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
