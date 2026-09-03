const adminState = {
  categories: {},
  videos: [],
  sourceMode: "link",
  activeDiscoveryRequestId: null,
};

const ui = {
  loginPanel: document.querySelector("#login-panel"),
  loginForm: document.querySelector("#login-form"),
  secretInput: document.querySelector("#admin-secret"),
  loginStatus: document.querySelector("#login-status"),
  workspace: document.querySelector("#admin-workspace"),
  logout: document.querySelector("#logout-button"),
  videoForm: document.querySelector("#video-form"),
  editingId: document.querySelector("#editing-id"),
  activeDiscoveryRequest: document.querySelector("#active-discovery-request"),
  videoSearch: document.querySelector("#video-search"),
  videoSearchButton: document.querySelector("#video-search-button"),
  videoSearchStatus: document.querySelector("#video-search-status"),
  videoSearchResults: document.querySelector("#video-search-results"),
  sourceUrl: document.querySelector("#source-url"),
  r2Key: document.querySelector("#r2-key"),
  linkPanel: document.querySelector("#link-source-panel"),
  uploadPanel: document.querySelector("#upload-source-panel"),
  sourceTabs: document.querySelectorAll(".source-tab"),
  file: document.querySelector("#asset-file"),
  uploadButton: document.querySelector("#upload-button"),
  uploadProgress: document.querySelector("#upload-progress"),
  uploadStatus: document.querySelector("#upload-status"),
  preview: document.querySelector("#media-preview"),
  category: document.querySelector("#admin-category"),
  subcategory: document.querySelector("#admin-subcategory"),
  title: document.querySelector("#video-title"),
  thumbnail: document.querySelector("#thumbnail-url"),
  notes: document.querySelector("#ai-notes"),
  aiButton: document.querySelector("#ai-generate"),
  aiStatus: document.querySelector("#ai-status"),
  seoTitle: document.querySelector("#seo-title"),
  seoDescription: document.querySelector("#seo-description"),
  description: document.querySelector("#description"),
  reviewText: document.querySelector("#review-text"),
  tags: document.querySelector("#seo-tags"),
  featured: document.querySelector("#featured"),
  trending: document.querySelector("#trending"),
  published: document.querySelector("#published"),
  saveStatus: document.querySelector("#save-status"),
  reset: document.querySelector("#reset-form"),
  videoList: document.querySelector("#admin-video-list"),
  moderationList: document.querySelector("#moderation-list"),
  discoveryList: document.querySelector("#discovery-request-list"),
  refreshVideos: document.querySelector("#refresh-videos"),
  refreshComments: document.querySelector("#refresh-comments"),
  refreshDiscoveries: document.querySelector("#refresh-discoveries"),
};

document.addEventListener("DOMContentLoaded", initializeAdmin);

async function initializeAdmin() {
  bindAdminEvents();
  try {
    const result = await publicApi("/api/categories");
    adminState.categories = result.categories || {};
    fillCategories();
  } catch (error) {
    setStatus(ui.loginStatus, error.message, "error");
  }
  await verifySavedSession();
}

function bindAdminEvents() {
  ui.loginForm.addEventListener("submit", login);
  ui.logout.addEventListener("click", lockAdmin);
  ui.category.addEventListener("change", () => fillSubcategories(ui.category.value));
  ui.sourceTabs.forEach((tab) => tab.addEventListener("click", () => setSourceMode(tab.dataset.mode)));
  ui.sourceUrl.addEventListener("change", updatePreview);
  ui.sourceUrl.addEventListener("paste", () => setTimeout(updatePreview, 0));
  ui.videoSearchButton.addEventListener("click", searchPublicVideos);
  ui.videoSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPublicVideos();
    }
  });
  ui.thumbnail.addEventListener("change", updatePreview);
  ui.file.addEventListener("change", () => {
    const file = ui.file.files[0];
    setStatus(ui.uploadStatus, file ? `${file.name} · ${formatBytes(file.size)}` : "");
  });
  ui.uploadButton.addEventListener("click", uploadFile);
  ui.aiButton.addEventListener("click", generateCopy);
  ui.videoForm.addEventListener("submit", saveVideo);
  ui.reset.addEventListener("click", resetEditor);
  ui.refreshVideos.addEventListener("click", loadAdminVideos);
  ui.refreshComments.addEventListener("click", loadPendingComments);
  ui.refreshDiscoveries.addEventListener("click", loadDiscoveryRequests);
}

async function verifySavedSession() {
  try {
    await adminApi("/api/admin/session", { method: "POST" });
    await unlockAdmin();
  } catch {
    lockAdmin();
  }
}

async function login(event) {
  event.preventDefault();
  setStatus(ui.loginStatus, "Checking…");
  try {
    await requestJson("/api/admin/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${ui.secretInput.value}` },
    });
    ui.secretInput.value = "";
    setStatus(ui.loginStatus, "Access granted.", "success");
    await unlockAdmin();
  } catch (error) {
    ui.secretInput.value = "";
    setStatus(ui.loginStatus, error.message, "error");
  }
}

async function unlockAdmin() {
  ui.loginPanel.hidden = true;
  ui.workspace.hidden = false;
  await Promise.all([loadAdminVideos(), loadPendingComments(), loadDiscoveryRequests()]);
}

async function lockAdmin() {
  try { await adminApi("/api/admin/session", { method: "DELETE" }); } catch { /* Clear the local UI even if logout fails. */ }
  ui.workspace.hidden = true;
  ui.loginPanel.hidden = false;
  ui.secretInput.focus();
}

function fillCategories() {
  Object.keys(adminState.categories).forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category === "Social Media & Trending" ? `${category} (Public Category)` : category;
    ui.category.append(option);
  });
}

function fillSubcategories(category, selected = "") {
  ui.subcategory.innerHTML = '<option value="">Choose subcategory</option>';
  const list = adminState.categories[category] || [];
  ui.subcategory.disabled = list.length === 0;
  list.forEach((subcategory) => {
    const option = document.createElement("option");
    option.value = subcategory;
    option.textContent = subcategory;
    ui.subcategory.append(option);
  });
  if (selected && list.includes(selected)) ui.subcategory.value = selected;
}

function setSourceMode(mode) {
  adminState.sourceMode = mode;
  ui.linkPanel.hidden = mode !== "link";
  ui.uploadPanel.hidden = mode !== "upload";
  ui.sourceTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  updatePreview();
}

async function searchPublicVideos() {
  const query = ui.videoSearch.value.trim();
  if (query.length < 3) {
    setStatus(ui.videoSearchStatus, "Enter a search phrase or full video URL.", "error");
    return;
  }
  ui.videoSearchButton.disabled = true;
  ui.videoSearchResults.replaceChildren();
  setStatus(ui.videoSearchStatus, "Searching verified public sources…");
  try {
    const result = await adminApi(`/api/admin/discover?q=${encodeURIComponent(query)}`);
    const videos = result.results || [];
    if (!videos.length) {
      setStatus(ui.videoSearchStatus, "No matching public videos found.");
      return;
    }
    videos.forEach((video) => ui.videoSearchResults.append(renderSearchResult(video)));
    setStatus(ui.videoSearchStatus, `${videos.length} result${videos.length === 1 ? "" : "s"}. Select one to continue.`, "success");
  } catch (error) {
    setStatus(ui.videoSearchStatus, error.message, "error");
  } finally {
    ui.videoSearchButton.disabled = false;
  }
}

function renderSearchResult(video) {
  const item = document.createElement("article");
  item.className = "video-search-result";
  if (video.thumbnail_url) {
    const image = document.createElement("img");
    image.src = video.thumbnail_url;
    image.alt = "";
    image.loading = "lazy";
    item.append(image);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "video-search-thumb";
    fallback.textContent = "▶";
    item.append(fallback);
  }
  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = video.title || "Public video";
  const detail = document.createElement("p");
  detail.textContent = [video.provider, video.channel].filter(Boolean).join(" · ");
  copy.append(heading, detail);
  const select = document.createElement("button");
  select.type = "button";
  select.className = "button ghost";
  select.textContent = "Use video";
  select.addEventListener("click", () => selectDiscoveredVideo(video));
  item.append(copy, select);
  return item;
}

function selectDiscoveredVideo(video) {
  ui.editingId.value = "";
  ui.r2Key.value = "";
  ui.r2Key.dataset.url = "";
  ui.seoTitle.value = "";
  ui.seoDescription.value = "";
  ui.description.value = "";
  ui.reviewText.value = "";
  ui.tags.value = "";
  ui.featured.checked = false;
  ui.trending.checked = false;
  ui.published.checked = true;
  setSourceMode("link");
  ui.sourceUrl.value = video.source_url || "";
  ui.title.value = video.title || "";
  ui.thumbnail.value = video.thumbnail_url || "";
  ui.notes.value = [
    video.channel ? `Verified public channel: ${video.channel}` : "",
    video.published_at ? `Original publish date: ${video.published_at}` : "",
    video.description || "",
  ].filter(Boolean).join("\n").slice(0, 1500);
  updatePreview();
  setStatus(ui.videoSearchStatus, "Video selected. Choose a category, generate the draft, verify it, then save.", "success");
  ui.category.focus();
}

function updatePreview() {
  ui.preview.replaceChildren();
  const source = ui.sourceUrl.value.trim();
  const thumbnail = ui.thumbnail.value.trim();
  const r2Source = ui.r2Key.dataset.url || "";
  const target = adminState.sourceMode === "upload" ? r2Source : source;
  if (!target) {
    const text = document.createElement("span");
    text.textContent = "Secure media preview appears here";
    ui.preview.append(text);
    return;
  }
  const parsed = parseEmbed(target);
  if (parsed.embed) {
    const iframe = document.createElement("iframe");
    iframe.src = parsed.embed;
    iframe.title = "Media preview";
    iframe.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.sandbox = "allow-scripts allow-same-origin allow-presentation allow-popups allow-forms";
    ui.preview.append(iframe);
  } else if (parsed.image || target.match(/\.(?:jpe?g|png|webp|gif|avif)(?:\?|$)/i)) {
    const image = document.createElement("img");
    image.src = target;
    image.alt = "Uploaded media preview";
    ui.preview.append(image);
  } else {
    const video = document.createElement("video");
    video.src = target;
    video.controls = true;
    video.preload = "metadata";
    if (thumbnail) video.poster = thumbnail;
    ui.preview.append(video);
  }
}

function parseEmbed(value) {
  try {
    const url = new URL(value, location.origin);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let youtubeId = null;
    if (host === "youtu.be") youtubeId = url.pathname.split("/").filter(Boolean)[0];
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") {
      youtubeId = url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
    }
    if (youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
      return { embed: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&playsinline=1` };
    }
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      const id = url.pathname.match(/\/video\/(\d+)/)?.[1] || url.pathname.match(/\/player\/v1\/(\d+)/)?.[1];
      return id ? { embed: `https://www.tiktok.com/player/v1/${id}?description=1&music_info=1` } : {};
    }
    if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") {
      return { embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url.toString())}&show_text=false&width=1280` };
    }
    return { image: url.pathname.match(/\.(?:jpe?g|png|webp|gif|avif)$/i) };
  } catch {
    return {};
  }
}

function uploadFile() {
  const file = ui.file.files[0];
  if (!file) {
    setStatus(ui.uploadStatus, "Choose a video or image first.", "error");
    return;
  }
  ui.uploadButton.disabled = true;
  ui.uploadProgress.style.width = "0%";
  setStatus(ui.uploadStatus, "Uploading securely…");
  const request = new XMLHttpRequest();
  request.open("PUT", `/api/assets?filename=${encodeURIComponent(file.name)}`);
  request.withCredentials = true;
  request.setRequestHeader("X-File-Name", file.name);
  request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
  request.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) ui.uploadProgress.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
  });
  request.addEventListener("load", () => {
    ui.uploadButton.disabled = false;
    let result = {};
    try { result = JSON.parse(request.responseText || "{}"); } catch { /* Ignore malformed error payload. */ }
    if (request.status >= 200 && request.status < 300) {
      ui.r2Key.value = result.key;
      ui.r2Key.dataset.url = result.url;
      ui.sourceUrl.value = result.url;
      ui.uploadProgress.style.width = "100%";
      setStatus(ui.uploadStatus, "Upload complete.", "success");
      updatePreview();
    } else {
      setStatus(ui.uploadStatus, result.error || `Upload failed with HTTP ${request.status}`, "error");
    }
  });
  request.addEventListener("error", () => {
    ui.uploadButton.disabled = false;
    setStatus(ui.uploadStatus, "Network error during upload.", "error");
  });
  request.send(file);
}

async function generateCopy() {
  ui.aiButton.disabled = true;
  setStatus(ui.aiStatus, "Gemini is drafting careful editorial copy…");
  try {
    const result = await adminApi("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ui.title.value,
        source_url: ui.sourceUrl.value,
        primary_category: ui.category.value,
        subcategory: ui.subcategory.value,
        notes: ui.notes.value,
      }),
    });
    const generated = result.generated;
    ui.seoTitle.value = generated.seo_title || "";
    ui.seoDescription.value = generated.seo_description || "";
    ui.description.value = generated.description || "";
    ui.reviewText.value = generated.review_text || "";
    ui.tags.value = (generated.seo_tags || []).join(", ");
    setStatus(ui.aiStatus, "Draft generated. Review facts before saving.", "success");
  } catch (error) {
    setStatus(ui.aiStatus, error.message, "error");
  } finally {
    ui.aiButton.disabled = false;
  }
}

async function saveVideo(event) {
  event.preventDefault();
  const id = ui.editingId.value;
  const r2Key = adminState.sourceMode === "upload" ? ui.r2Key.value : "";
  const payload = {
    title: ui.title.value,
    source_url: ui.sourceUrl.value,
    r2_key: r2Key,
    primary_category: ui.category.value,
    subcategory: ui.subcategory.value,
    thumbnail_url: ui.thumbnail.value,
    seo_title: ui.seoTitle.value,
    seo_description: ui.seoDescription.value,
    description: ui.description.value,
    review_text: ui.reviewText.value,
    seo_tags: ui.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    featured: ui.featured.checked,
    trending: ui.trending.checked,
    published: ui.published.checked,
  };
  setStatus(ui.saveStatus, id ? "Updating record…" : "Saving record…");
  const submit = ui.videoForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await adminApi(id ? `/api/videos/${id}` : "/api/videos", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const discoveryRequestId = Number(ui.activeDiscoveryRequest.value || adminState.activeDiscoveryRequestId || 0);
    let queueWarning = "";
    if (discoveryRequestId) {
      try {
        await adminApi(`/api/admin/discovery-requests/${discoveryRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "resolved", resolved_video_id: result.video.id }),
        });
      } catch (error) {
        queueWarning = ` The discovery queue was not updated: ${error.message}`;
      }
    }
    setStatus(ui.saveStatus, `Saved: ${result.video.title}.${queueWarning}`, queueWarning ? "error" : "success");
    resetEditor(false);
    await Promise.all([loadAdminVideos(), loadDiscoveryRequests()]);
  } catch (error) {
    setStatus(ui.saveStatus, error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

async function loadAdminVideos() {
  ui.videoList.replaceChildren(adminListMessage("Loading records…"));
  try {
    const result = await adminApi("/api/admin/videos?limit=48&sort=newest");
    adminState.videos = result.videos || [];
    ui.videoList.replaceChildren();
    if (!adminState.videos.length) {
      ui.videoList.append(adminListMessage("No records yet."));
      return;
    }
    adminState.videos.forEach((video) => ui.videoList.append(renderAdminVideo(video)));
  } catch (error) {
    ui.videoList.replaceChildren(adminListMessage(error.message));
  }
}

function renderAdminVideo(video) {
  const item = document.createElement("article");
  item.className = "admin-list-item";
  const heading = document.createElement("h3");
  heading.textContent = video.title;
  const detail = document.createElement("p");
  detail.textContent = `${video.primary_category} · ${video.subcategory}`;
  const meta = document.createElement("div");
  meta.className = "admin-list-meta";
  meta.textContent = `${video.published ? "Published" : "Draft"} · ${formatDate(video.created_at)}`;
  const actions = document.createElement("div");
  actions.className = "admin-item-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => editVideo(video));
  const view = document.createElement("button");
  view.type = "button";
  view.textContent = "View";
  view.addEventListener("click", () => window.open(`/watch/${encodeURIComponent(video.slug)}`, "_blank", "noopener"));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => deleteVideo(video));
  actions.append(edit, view, remove);
  item.append(heading, detail, meta, actions);
  return item;
}

function editVideo(video) {
  adminState.activeDiscoveryRequestId = null;
  ui.activeDiscoveryRequest.value = "";
  ui.editingId.value = video.id;
  ui.title.value = video.title || "";
  ui.sourceUrl.value = video.source_url || "";
  ui.r2Key.value = video.r2_key || "";
  ui.r2Key.dataset.url = video.media_type === "r2" ? video.source_url : "";
  ui.category.value = video.primary_category;
  fillSubcategories(video.primary_category, video.subcategory);
  ui.thumbnail.value = video.thumbnail_url || "";
  ui.seoTitle.value = video.seo_title || "";
  ui.seoDescription.value = video.seo_description || "";
  ui.description.value = video.description || "";
  ui.reviewText.value = video.review_text || "";
  ui.tags.value = (video.seo_tags || []).join(", ");
  ui.featured.checked = Boolean(video.featured);
  ui.trending.checked = Boolean(video.trending);
  ui.published.checked = Boolean(video.published);
  setSourceMode(video.media_type === "r2" ? "upload" : "link");
  updatePreview();
  setStatus(ui.saveStatus, `Editing “${video.title}”`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteVideo(video) {
  if (!confirm(`Delete “${video.title}”? Comments and reactions will also be removed.`)) return;
  try {
    await adminApi(`/api/videos/${video.id}`, { method: "DELETE" });
    if (String(video.id) === ui.editingId.value) resetEditor();
    await loadAdminVideos();
  } catch (error) {
    setStatus(ui.saveStatus, error.message, "error");
  }
}

async function loadPendingComments() {
  ui.moderationList.replaceChildren(adminListMessage("Loading comments…"));
  try {
    const result = await adminApi("/api/admin/comments?status=pending");
    ui.moderationList.replaceChildren();
    if (!result.comments?.length) {
      ui.moderationList.append(adminListMessage("Moderation queue is clear."));
      return;
    }
    result.comments.forEach((comment) => ui.moderationList.append(renderModerationItem(comment)));
  } catch (error) {
    ui.moderationList.replaceChildren(adminListMessage(error.message));
  }
}

async function loadDiscoveryRequests() {
  ui.discoveryList.replaceChildren(adminListMessage("Loading requests…"));
  try {
    const result = await adminApi("/api/admin/discovery-requests?status=pending");
    ui.discoveryList.replaceChildren();
    if (!result.requests?.length) {
      ui.discoveryList.append(adminListMessage("No pending discovery requests."));
      return;
    }
    result.requests.forEach((request) => ui.discoveryList.append(renderDiscoveryRequest(request)));
  } catch (error) {
    ui.discoveryList.replaceChildren(adminListMessage(error.message));
  }
}

function renderDiscoveryRequest(request) {
  const item = document.createElement("article");
  item.className = "admin-list-item";
  const heading = document.createElement("h3");
  heading.textContent = request.query;
  const detail = document.createElement("p");
  detail.textContent = request.source_url || "Public search phrase";
  const meta = document.createElement("div");
  meta.className = "admin-list-meta";
  meta.textContent = `${request.request_count} request${Number(request.request_count) === 1 ? "" : "s"} · ${formatDate(request.updated_at)}`;
  const actions = document.createElement("div");
  actions.className = "admin-item-actions";
  const search = document.createElement("button");
  search.type = "button";
  search.className = "approve";
  search.textContent = "Find video";
  search.addEventListener("click", () => {
    adminState.activeDiscoveryRequestId = request.id;
    ui.activeDiscoveryRequest.value = request.id;
    ui.videoSearch.value = request.source_url || request.query;
    searchPublicVideos();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "reject";
  reject.textContent = "Reject";
  reject.addEventListener("click", () => updateDiscoveryStatus(request.id, "rejected"));
  actions.append(search, reject);
  item.append(heading, detail, meta, actions);
  return item;
}

async function updateDiscoveryStatus(id, status) {
  try {
    await adminApi(`/api/admin/discovery-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadDiscoveryRequests();
  } catch (error) {
    alert(error.message);
  }
}

function renderModerationItem(comment) {
  const item = document.createElement("article");
  item.className = "admin-list-item";
  const heading = document.createElement("h3");
  heading.textContent = `${comment.author} on ${comment.video_title}`;
  const body = document.createElement("p");
  body.textContent = comment.body;
  const meta = document.createElement("div");
  meta.className = "admin-list-meta";
  meta.textContent = formatDate(comment.created_at);
  const actions = document.createElement("div");
  actions.className = "admin-item-actions";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "approve";
  approve.textContent = "Approve";
  approve.addEventListener("click", () => moderateComment(comment.id, "approved"));
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "reject";
  reject.textContent = "Reject";
  reject.addEventListener("click", () => moderateComment(comment.id, "rejected"));
  actions.append(approve, reject);
  item.append(heading, body, meta, actions);
  return item;
}

async function moderateComment(id, status) {
  try {
    await adminApi(`/api/admin/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadPendingComments();
  } catch (error) {
    alert(error.message);
  }
}

function resetEditor(clearStatus = true) {
  ui.videoForm.reset();
  ui.editingId.value = "";
  ui.activeDiscoveryRequest.value = "";
  adminState.activeDiscoveryRequestId = null;
  ui.r2Key.value = "";
  ui.r2Key.dataset.url = "";
  ui.subcategory.innerHTML = '<option value="">Choose subcategory</option>';
  ui.subcategory.disabled = true;
  ui.published.checked = true;
  ui.preview.innerHTML = "<span>Secure media preview appears here</span>";
  ui.uploadProgress.style.width = "0%";
  setSourceMode("link");
  setStatus(ui.uploadStatus, "");
  setStatus(ui.aiStatus, "");
  setStatus(ui.videoSearchStatus, "");
  ui.videoSearchResults.replaceChildren();
  if (clearStatus) setStatus(ui.saveStatus, "");
}

function adminListMessage(message) {
  const element = document.createElement("div");
  element.className = "admin-list-empty";
  element.textContent = message;
  return element;
}

async function publicApi(url, options = {}) {
  return requestJson(url, options);
}

async function adminApi(url, options = {}) {
  return requestJson(url, options);
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = url.startsWith("/api/ai/generate") ? 35000 : 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...options, signal: controller.signal });
  } catch (error) {
    throw new Error(error.name === "AbortError" ? "Request timed out. Please try again." : "Network request failed. Please try again.");
  } finally {
    clearTimeout(timeout);
  }
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

function formatBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
