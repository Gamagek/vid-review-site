const adminState = {
  categories: {},
  videos: [],
  sourceMode: "link",
  activeDiscoveryRequestId: null,
  analysisDraft: null,
  analysisSource: "",
  analysisPollTimer: null,
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
  hlsFolderInput: document.querySelector("#hls-folder-input"),
  uploadHlsButton: document.querySelector("#upload-hls-button"),
  mediaRightsConfirmed: document.querySelector("#media-rights-confirmed"),
  uploadProgress: document.querySelector("#upload-progress"),
  uploadStatus: document.querySelector("#upload-status"),
  preview: document.querySelector("#media-preview"),
  category: document.querySelector("#admin-category"),
  subcategory: document.querySelector("#admin-subcategory"),
  otherSubcategory: document.querySelector("#admin-other-subcategory"),
  title: document.querySelector("#video-title"),
  thumbnail: document.querySelector("#thumbnail-url"),
  thumbnailFile: document.querySelector("#thumbnail-file"),
  thumbnailUploadButton: document.querySelector("#thumbnail-upload-button"),
  thumbnailUploadStatus: document.querySelector("#thumbnail-upload-status"),
  sourcePublishedAt: document.querySelector("#source-published-at"),
  sourceDurationSeconds: document.querySelector("#source-duration-seconds"),
  notes: document.querySelector("#ai-notes"),
  scanMedia: document.querySelector("#scan-media"),
  analysisGroundSearch: document.querySelector("#analysis-ground-search"),
  analysisStatus: document.querySelector("#analysis-status"),
  analysisTranscript: document.querySelector("#analysis-transcript"),
  analysisOcr: document.querySelector("#analysis-ocr"),
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
  cacheTikTokButton: document.querySelector("#cache-tiktok-button"),
  cacheTikTokStatus: document.querySelector("#cache-tiktok-status"),
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
  ui.otherSubcategory.addEventListener("input", syncOtherSubcategory);
  ui.sourceTabs.forEach((tab) => tab.addEventListener("click", () => setSourceMode(tab.dataset.mode)));
  ui.sourceUrl.addEventListener("change", updatePreview);
  ui.sourceUrl.addEventListener("input", clearAnalysisIfSourceChanged);
  ui.sourceUrl.addEventListener("paste", () => setTimeout(updatePreview, 0));
  ui.videoSearchButton.addEventListener("click", searchPublicVideos);
  ui.videoSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPublicVideos();
    }
  });
  ui.thumbnail.addEventListener("change", updatePreview);
  ui.thumbnailUploadButton.addEventListener("click", uploadThumbnail);
  ui.file.addEventListener("change", () => {
    const file = ui.file.files[0];
    setStatus(ui.uploadStatus, file ? `${file.name} · ${formatBytes(file.size)}` : "");
  });
  ui.hlsFolderInput.addEventListener("change", () => {
    const files = [...(ui.hlsFolderInput.files || [])];
    const manifest = files.find((file) => /\.m3u8$/i.test(file.name));
    setStatus(ui.uploadStatus, files.length
      ? `HLS folder: ${files.length} files · ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))}${manifest ? ` · manifest: ${manifest.name}` : " · manifest missing"}`
      : "");
  });
  ui.uploadButton.addEventListener("click", uploadFile);
  ui.uploadHlsButton.addEventListener("click", uploadHlsFolder);
  ui.aiButton.addEventListener("click", generateCopy);
  ui.scanMedia.addEventListener("click", startMediaAnalysis);
  ui.videoForm.addEventListener("submit", saveVideo);
  ui.reset.addEventListener("click", resetEditor);
  ui.refreshVideos.addEventListener("click", loadAdminVideos);
  ui.cacheTikTokButton.addEventListener("click", cacheTikTokPreviews);
  ui.refreshComments.addEventListener("click", loadPendingComments);
  ui.refreshDiscoveries.addEventListener("click", loadDiscoveryRequests);
}

async function cacheTikTokPreviews() {
  ui.cacheTikTokButton.disabled = true;
  let offset = 0;
  let cachedTotal = 0;
  let processedTotal = 0;
  let failedTotal = 0;
  try {
    while (true) {
      const result = await adminApi(`/api/admin/tiktok/cache?limit=4&offset=${offset}`, { method: "POST" });
      cachedTotal += Number(result.cached || 0);
      processedTotal += Number(result.processed || 0);
      failedTotal += Array.isArray(result.failed) ? result.failed.length : 0;
      setStatus(
        ui.cacheTikTokStatus,
        result.complete
          ? `Finished: ${cachedTotal} cached, ${failedTotal} failed, ${processedTotal} processed.`
          : `Caching TikTok previews… ${processedTotal} processed, ${cachedTotal} saved to R2.`,
        result.complete && failedTotal ? "error" : result.complete ? "success" : "",
      );
      if (result.complete || !Number.isInteger(result.next_offset) || Number(result.next_offset) <= offset) break;
      offset = Number(result.next_offset);
    }
  } catch (error) {
    setStatus(ui.cacheTikTokStatus, error.message, "error");
  } finally {
    ui.cacheTikTokButton.disabled = false;
  }
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
  ui.otherSubcategory.hidden = category !== "Other";
  ui.otherSubcategory.required = category === "Other";
  ui.otherSubcategory.value = category === "Other" && selected && selected !== "Other" ? selected : "";
  list.forEach((subcategory) => {
    const option = document.createElement("option");
    option.value = subcategory;
    option.textContent = subcategory;
    ui.subcategory.append(option);
  });
  if (selected && list.includes(selected)) ui.subcategory.value = selected;
}

function syncOtherSubcategory() {
  if (ui.category.value !== "Other") return;
  const value = ui.otherSubcategory.value.trim();
  const existing = [...ui.subcategory.options].find((option) => option.dataset.custom === "1");
  if (existing) existing.remove();
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value || "Type your subcategory";
  option.dataset.custom = "1";
  option.hidden = !value;
  ui.subcategory.append(option);
  ui.subcategory.value = value;
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
  ui.thumbnail.value = isTikTokThumbnailProxy(video.thumbnail_url) ? "" : (video.thumbnail_url || "");
  ui.sourcePublishedAt.value = dateInputValue(video.published_at);
  ui.sourceDurationSeconds.value = "";
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
    const empty = document.createElement("span");
    empty.textContent = "Secure media preview appears here";
    ui.preview.append(empty);
    return;
  }

  const parsed = parseEmbed(target);
  if (adminState.sourceMode === "link" && /https?:\/\/[^/]*tiktok\.com\//i.test(target) && parsed.provider !== "tiktok") {
    const notice = document.createElement("p");
    notice.className = "form-status error";
    notice.textContent = "TikTok preview needs the normal full sharing link: https://www.tiktok.com/@username/video/VIDEO_ID";
    ui.preview.append(notice);
    return;
  }

  if (parsed.provider === "tiktok") {
    renderTikTokPreview(target, parsed.id);
    return;
  }

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

function renderTikTokPreview(sourceUrl, videoId) {
  const shell = document.createElement("div");
  shell.className = "admin-tiktok-preview";
  shell.dataset.tiktokPreview = "1";

  const parsed = parseTikTokShareUrl(sourceUrl);
  if (!parsed) {
    const message = document.createElement("p");
    message.className = "form-status error";
    message.textContent = "TikTok preview needs the normal sharing link: https://www.tiktok.com/@username/video/VIDEO_ID";
    shell.append(message);
    ui.preview.append(shell);
    return;
  }

  const blockquote = document.createElement("blockquote");
  blockquote.className = "tiktok-embed";
  blockquote.setAttribute("cite", parsed.url);
  blockquote.dataset.videoId = parsed.id;
  blockquote.dataset.embedFrom = "vidbest-admin-preview";
  blockquote.style.maxWidth = "605px";
  blockquote.style.minWidth = "0";
  blockquote.style.width = "100%";

  const section = document.createElement("section");
  blockquote.append(section);
  shell.append(blockquote);
  ui.preview.append(shell);
  ensureTikTokAdminEmbedScript();
}

function parseTikTokShareUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const match = host === "tiktok.com" ? url.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/) : null;
    return match ? { url: url.toString(), id: match[1] } : null;
  } catch {
    return null;
  }
}

let tiktokAdminEmbedScriptPromise = null;
function ensureTikTokAdminEmbedScript() {
  if (document.querySelector('script[data-vidbest-tiktok-admin-embed]')) {
    return tiktokAdminEmbedScriptPromise || Promise.resolve();
  }
  tiktokAdminEmbedScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.tiktok.com/embed.js";
    script.dataset.vidbestTiktokAdminEmbed = "1";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("TikTok admin preview script failed to load")), { once: true });
    document.head.append(script);
  });
  return tiktokAdminEmbedScriptPromise;
}
function buildTikTokPlayerUrl(videoId) {
  const params = new URLSearchParams({
    controls: "1",
    progress_bar: "1",
    play_button: "1",
    volume_control: "1",
    fullscreen_button: "1",
    timestamp: "1",
    loop: "0",
    autoplay: "0",
    music_info: "1",
    description: "1",
    rel: "1",
    native_context_menu: "1",
    closed_caption: "1",
    muted: "0",
  });
  return `https://www.tiktok.com/player/v1/${encodeURIComponent(videoId)}?${params.toString()}`;
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
      const origin = encodeURIComponent(location.origin);
      return { embed: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&playsinline=1&enablejsapi=1&origin=${origin}` };
    }
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      const id = url.pathname.match(/\/video\/(\d+)/)?.[1];
      return id ? { provider: "tiktok", id, source: url.toString() } : {};
    }
    if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") {
      return { embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url.toString())}&show_text=false&width=1280` };
    }
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
      const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
      const pathParts = url.pathname.split("/").filter(Boolean);
      const privacyHash = url.searchParams.get("h") || pathParts[pathParts.indexOf(id) + 1];
      const privacyQuery = privacyHash && /^[A-Za-z0-9]+$/.test(privacyHash)
        ? `&h=${encodeURIComponent(privacyHash)}`
        : "";
      return id ? { embed: `https://player.vimeo.com/video/${id}?dnt=1${privacyQuery}` } : {};
    }
    if (host === "dailymotion.com" || host.endsWith(".dailymotion.com") || host === "dai.ly") {
      const id = host === "dai.ly"
        ? url.pathname.split("/").filter(Boolean)[0]
        : url.pathname.match(/\/(?:embed\/)?video\/([A-Za-z0-9]+)/)?.[1];
      return id && /^[A-Za-z0-9]+$/.test(id)
        ? { embed: `https://www.dailymotion.com/embed/video/${id}` }
        : {};
    }
    if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
      const videoId = url.pathname.match(/\/videos\/(\d+)/)?.[1];
      const clipId = host === "clips.twitch.tv"
        ? url.pathname.split("/").filter(Boolean)[0]
        : url.pathname.match(/\/clip\/([A-Za-z0-9_-]+)/)?.[1];
      if (videoId) return { embed: `https://player.twitch.tv/?video=v${videoId}&parent=${encodeURIComponent(location.hostname)}&autoplay=false` };
      if (clipId) return { embed: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipId)}&parent=${encodeURIComponent(location.hostname)}&autoplay=false` };
      return {};
    }
    if (host === "instagram.com" || host.endsWith(".instagram.com")) {
      const match = url.pathname.match(/^\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      const kind = match?.[1] === "p" ? "p" : "reel";
      return match ? { embed: `https://www.instagram.com/${kind}/${match[2]}/embed` } : {};
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
      clearAnalysisDraft();
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

function uploadThumbnail() {
  const file = ui.thumbnailFile.files[0];
  const allowed = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
  if (!file) {
    setStatus(ui.thumbnailUploadStatus, "Choose a thumbnail image first.", "error");
    return;
  }
  if (!allowed.has(file.type)) {
    setStatus(ui.thumbnailUploadStatus, "Use PNG, JPEG, WebP, AVIF or GIF.", "error");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setStatus(ui.thumbnailUploadStatus, "Thumbnail must be 10 MB or smaller.", "error");
    return;
  }

  ui.thumbnailUploadButton.disabled = true;
  setStatus(ui.thumbnailUploadStatus, "Uploading thumbnail…");
  const request = new XMLHttpRequest();
  request.open("PUT", `/api/assets?filename=${encodeURIComponent(file.name)}`);
  request.withCredentials = true;
  request.setRequestHeader("X-File-Name", file.name);
  request.setRequestHeader("Content-Type", file.type);
  request.addEventListener("load", () => {
    ui.thumbnailUploadButton.disabled = false;
    let result = {};
    try { result = JSON.parse(request.responseText || "{}"); } catch { /* Ignore malformed error payload. */ }
    if (request.status >= 200 && request.status < 300 && result.url) {
      ui.thumbnail.value = result.url;
      setStatus(ui.thumbnailUploadStatus, "Thumbnail uploaded and selected.", "success");
      updatePreview();
    } else {
      setStatus(ui.thumbnailUploadStatus, result.error || `Upload failed with HTTP ${request.status}`, "error");
    }
  });
  request.addEventListener("error", () => {
    ui.thumbnailUploadButton.disabled = false;
    setStatus(ui.thumbnailUploadStatus, "Network error during thumbnail upload.", "error");
  });
  request.send(file);
}

async function uploadHlsFolder() {
  const files = [...(ui.hlsFolderInput?.files || [])];
  if (!files.length) {
    if (!ui.mediaRightsConfirmed.checked) {
      setStatus(ui.uploadStatus, "Confirm that you have permission to store and serve this media first.", "error");
      return;
    }
    setStatus(ui.uploadStatus, "Choose an HLS folder first.", "error");
    return;
  }
  if (!ui.mediaRightsConfirmed.checked) {
    setStatus(ui.uploadStatus, "Confirm that you have permission to store and serve this media first.", "error");
    return;
  }
  const manifest = files.find((file) => /\.m3u8$/i.test(file.name));
  if (!manifest) {
    setStatus(ui.uploadStatus, "The selected folder must contain an .m3u8 manifest.", "error");
    return;
  }
  const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (totalBytes > 500 * 1024 * 1024) {
    setStatus(ui.uploadStatus, "Keep each HLS folder at 500 MB or less for this browser upload flow.", "error");
    return;
  }
  const folder = `uploads/hls/${crypto.randomUUID()}`;
  ui.uploadHlsButton.disabled = true;
  ui.uploadButton.disabled = true;
  ui.uploadProgress.style.width = "0%";
  let uploadedBytes = 0;
  try {
    for (const file of files) {
      const relative = String(file.webkitRelativePath || file.name).split("/").slice(1).join("/");
      if (!relative || relative.includes("..")) throw new Error(`Invalid HLS path: ${relative || file.name}`);
      if (!/\.(m3u8|ts|m4s|aac|m4a|mp4)$/i.test(relative)) throw new Error(`Unsupported HLS file: ${relative}`);
      const key = `${folder}/${relative.split("/").map((part) => part.replace(/[^A-Za-z0-9._-]+/g, "-")).filter(Boolean).join("/")}`;
      await uploadAssetFile(file, key, (loaded) => {
        ui.uploadProgress.style.width = `${Math.round(((uploadedBytes + loaded) / totalBytes) * 100)}%`;
      });
      uploadedBytes += file.size;
    }
    const manifestRelative = String(manifest.webkitRelativePath || manifest.name).split("/").slice(1).join("/");
    const manifestKey = `${folder}/${manifestRelative.split("/").map((part) => part.replace(/[^A-Za-z0-9._-]+/g, "-")).filter(Boolean).join("/")}`;
    ui.r2Key.value = manifestKey;
    ui.r2Key.dataset.url = `/media/${encodeURIComponent(manifestKey).replace(/%2F/g, "/")}`;
    ui.sourceUrl.value = ui.r2Key.dataset.url;
    ui.uploadProgress.style.width = "100%";
    adminState.sourceMode = "upload";
    setStatus(ui.uploadStatus, `HLS package uploaded: ${files.length} files. Manifest selected.`, "success");
    clearAnalysisDraft();
    updatePreview();
  } catch (error) {
    setStatus(ui.uploadStatus, error.message || "HLS upload failed.", "error");
  } finally {
    ui.uploadHlsButton.disabled = false;
    ui.uploadButton.disabled = false;
  }
}

function uploadAssetFile(file, key, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/assets?filename=${encodeURIComponent(file.name)}`);
    request.withCredentials = true;
    request.setRequestHeader("X-File-Name", file.name);
    request.setRequestHeader("X-Asset-Key", key);
    request.setRequestHeader("X-Media-Rights-Confirmed", "1");
    request.setRequestHeader("Content-Type", file.type || "");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded);
    });
    request.addEventListener("load", () => {
      let result = {};
      try { result = JSON.parse(request.responseText || "{}"); } catch {}
      if (request.status >= 200 && request.status < 300) resolve(result);
      else reject(new Error(result.error || `Upload failed with HTTP ${request.status}`));
    });
    request.addEventListener("error", () => reject(new Error("Network error during HLS upload.")));
    request.send(file);
  });
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
        subcategory: ui.category.value === "Other" ? ui.otherSubcategory.value.trim() : ui.subcategory.value,
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

function currentAnalysisSource() {
  return adminState.sourceMode === "upload"
    ? ui.r2Key.dataset.url || ui.sourceUrl.value.trim()
    : ui.sourceUrl.value.trim();
}

function clearAnalysisIfSourceChanged() {
  if (adminState.analysisSource && currentAnalysisSource() !== adminState.analysisSource) clearAnalysisDraft();
}

function clearAnalysisDraft() {
  window.clearTimeout(adminState.analysisPollTimer);
  adminState.analysisPollTimer = null;
  adminState.analysisDraft = null;
  adminState.analysisSource = "";
  ui.analysisTranscript.value = "";
  ui.analysisOcr.value = "";
  setStatus(ui.analysisStatus, "");
}

async function startMediaAnalysis() {
  const source = currentAnalysisSource();
  if (!source) {
    setStatus(ui.analysisStatus, "Paste a media link or finish the R2 upload first.", "error");
    return;
  }
  ui.scanMedia.disabled = true;
  setStatus(ui.analysisStatus, adminState.sourceMode === "upload"
    ? "Starting private OCR and transcription job…"
    : "Starting public page analysis without downloading the embedded video…");
  try {
    const result = await adminApi("/api/ai/analyze-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_url: source,
        r2_key: adminState.sourceMode === "upload" ? ui.r2Key.value : "",
        title: ui.title.value,
        ground_search: ui.analysisGroundSearch.checked,
        search_query: ui.title.value || ui.videoSearch.value,
      }),
    });
    adminState.analysisSource = source;
    await pollMediaAnalysis(result.job.id);
  } catch (error) {
    setStatus(ui.analysisStatus, error.message, "error");
    ui.scanMedia.disabled = false;
  }
}

async function pollMediaAnalysis(jobId) {
  try {
    const result = await adminApi(`/api/ai/analyze-media/${jobId}`);
    const job = result.job;
    if (job.status === "failed") throw new Error(job.error || "Media analysis failed");
    if (job.status !== "complete") {
      setStatus(ui.analysisStatus, job.status === "running" ? "Scanning media evidence…" : "Analysis queued…");
      adminState.analysisPollTimer = window.setTimeout(() => pollMediaAnalysis(jobId), 2500);
      return;
    }
    applyMediaAnalysis(job.result || {});
  } catch (error) {
    setStatus(ui.analysisStatus, error.message, "error");
  } finally {
    if (!adminState.analysisPollTimer) ui.scanMedia.disabled = false;
  }
}

function applyMediaAnalysis(analysis) {
  window.clearTimeout(adminState.analysisPollTimer);
  adminState.analysisPollTimer = null;
  adminState.analysisDraft = {
    transcript: analysis.transcript || "",
    ocr_text: analysis.ocr_text || "",
    captions_vtt: analysis.captions_vtt || "",
    language: analysis.language || "",
    analysis_provider: "teamwork",
    warnings: analysis.warnings || [],
  };
  ui.analysisTranscript.value = adminState.analysisDraft.transcript;
  ui.analysisOcr.value = adminState.analysisDraft.ocr_text;
  if (analysis.duration_seconds && !ui.sourceDurationSeconds.value) {
    ui.sourceDurationSeconds.value = String(Math.round(analysis.duration_seconds));
  }
  const localSummary = analysis.local_summary?.summary || "";
  const evidenceNotes = [
    localSummary ? `Local evidence summary: ${localSummary}` : "",
    analysis.ocr_text ? `Visible text: ${analysis.ocr_text}` : "",
    analysis.transcript ? `Transcript excerpt: ${analysis.transcript}` : "",
    analysis.page_text ? `Source page: ${analysis.page_text}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 1500);
  if (evidenceNotes) ui.notes.value = evidenceNotes;
  const warningCount = adminState.analysisDraft.warnings.length;
  setStatus(
    ui.analysisStatus,
    `Analysis complete${warningCount ? ` with ${warningCount} note${warningCount === 1 ? "" : "s"}` : ""}. Review the evidence, then use AI Generate.`,
    warningCount ? "" : "success",
  );
}

async function saveAnalysis(video) {
  const draft = adminState.analysisDraft || {};
  const source = currentAnalysisSource();
  const transcript = ui.analysisTranscript.value.trim();
  const ocrText = ui.analysisOcr.value.trim();
  if (!transcript && !ocrText && !draft.captions_vtt) return;
  if (!source || source !== adminState.analysisSource) throw new Error("The analysis belongs to a different media source. Scan this source again.");
  await adminApi(`/api/admin/videos/${video.id}/analysis`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_url: video.source_url,
      transcript,
      ocr_text: ocrText,
      captions_vtt: draft.captions_vtt || "",
      language: draft.language || "",
      analysis_provider: draft.analysis_provider || "teamwork",
      warnings: draft.warnings || [],
    }),
  });
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
    subcategory: ui.category.value === "Other" ? ui.otherSubcategory.value.trim() : ui.subcategory.value,
    thumbnail_url: ui.thumbnail.value,
    source_published_at: ui.sourcePublishedAt.value,
    source_duration_seconds: ui.sourceDurationSeconds.value,
    seo_title: ui.seoTitle.value,
    seo_description: ui.seoDescription.value,
    description: ui.description.value,
    review_text: ui.reviewText.value,
    seo_tags: ui.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    featured: ui.featured.checked,
    trending: ui.trending.checked,
    published: ui.published.checked,
    media_rights_confirmed: ui.mediaRightsConfirmed?.checked || false,
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
    let analysisWarning = "";
    try {
      await saveAnalysis(result.video);
    } catch (error) {
      analysisWarning = ` Analysis was not saved: ${error.message}`;
    }
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
    setStatus(ui.saveStatus, `Saved: ${result.video.title}.${queueWarning}${analysisWarning}`, queueWarning || analysisWarning ? "error" : "success");
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

async function editVideo(video) {
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
  ui.sourcePublishedAt.value = dateInputValue(video.source_published_at);
  ui.sourceDurationSeconds.value = isoDurationToSeconds(video.source_duration);
  ui.seoTitle.value = video.seo_title || "";
  ui.seoDescription.value = video.seo_description || "";
  ui.description.value = video.description || "";
  ui.reviewText.value = video.review_text || "";
  ui.tags.value = (video.seo_tags || []).join(", ");
  ui.featured.checked = Boolean(video.featured);
  ui.trending.checked = Boolean(video.trending);
  ui.published.checked = Boolean(video.published);
  setSourceMode(["r2", "hls"].includes(video.media_type) ? "upload" : "link");
  adminState.analysisSource = video.source_url || "";
  adminState.analysisDraft = null;
  ui.analysisTranscript.value = "";
  ui.analysisOcr.value = "";
  try {
    const result = await adminApi(`/api/admin/videos/${video.id}/analysis`);
    if (result.analysis) {
      adminState.analysisDraft = result.analysis;
      adminState.analysisSource = result.analysis.source_url || video.source_url || "";
      ui.analysisTranscript.value = result.analysis.transcript || "";
      ui.analysisOcr.value = result.analysis.ocr_text || "";
      setStatus(ui.analysisStatus, "Saved analysis loaded.", "success");
    } else {
      setStatus(ui.analysisStatus, "No saved analysis for this video.");
    }
  } catch (error) {
    setStatus(ui.analysisStatus, error.message, "error");
  }
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

function dateInputValue(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function isoDurationToSeconds(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return "";
  return String((Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0));
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
  clearAnalysisDraft();
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
  setStatus(ui.thumbnailUploadStatus, "");
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
