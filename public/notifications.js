const HUB = {
  root: document.querySelector("#notification-hub"),
  loginForm: document.querySelector("#member-login-form"),
  emailInput: document.querySelector("#member-email"),
  loginButton: document.querySelector("#member-login-button"),
  accountView: document.querySelector("#member-account-view"),
  accountEmail: document.querySelector("#member-account-email"),
  category: document.querySelector("#notification-category"),
  emailEnabled: document.querySelector("#email-notifications-enabled"),
  browserButton: document.querySelector("#browser-alert-button"),
  shortcutButton: document.querySelector("#shortcut-button"),
  logoutButton: document.querySelector("#member-logout-button"),
  status: document.querySelector("#notification-status"),
};

const NOTIFY_KEY = "vidbest-notify-last-id";
const CATEGORY_KEY = "vidbest-notify-category";
let installPrompt = null;
let currentMember = null;
let pollTimer = null;

document.addEventListener("DOMContentLoaded", initNotificationHub);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  HUB.shortcutButton?.removeAttribute("hidden");
});

async function initNotificationHub() {
  if (!HUB.root) return;

  HUB.loginForm?.addEventListener("submit", requestLogin);
  HUB.browserButton?.addEventListener("click", enableBrowserAlerts);
  HUB.shortcutButton?.addEventListener("click", installShortcut);
  HUB.logoutButton?.addEventListener("click", logout);
  HUB.emailEnabled?.addEventListener("change", savePreferences);
  HUB.category?.addEventListener("change", savePreferences);

  try {
    await registerServiceWorker();
  } catch {}

  try {
    const params = new URLSearchParams(location.search);
    const loginToken = params.get("login_token");
    if (loginToken) {
      await verifyLogin(loginToken);
      params.delete("login_token");
      const clean = params.toString();
      history.replaceState(null, "", location.pathname + (clean ? "?" + clean : "") + location.hash);
    }
  } catch (error) {
    setStatus(error.message, "error");
  }

  await loadMember();
  restoreCategory();
  updateBrowserButton();
  startSmartPolling();
}

async function loadMember() {
  try {
    const response = await fetch("/api/account/me", { credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Account request failed.");
    currentMember = payload.member || null;
  } catch {
    currentMember = null;
  }
  renderMember();
}

function renderMember() {
  if (!HUB.root) return;
  const signedIn = Boolean(currentMember);
  HUB.loginForm?.toggleAttribute("hidden", signedIn);
  HUB.accountView?.toggleAttribute("hidden", !signedIn);
  if (signedIn) {
    HUB.accountEmail.textContent = currentMember.email;
    HUB.emailEnabled.checked = Boolean(currentMember.email_notifications);
    const filters = currentMember.category_filter || [];
    HUB.category.value = filters[0] || "";
    setStatus("Email alerts are ready.", "success");
  }
}

async function requestLogin(event) {
  event.preventDefault();
  const email = HUB.emailInput.value.trim();
  if (!email) return;
  HUB.loginButton.disabled = true;
  setStatus("Sending your one-time sign-in link…");
  try {
    const response = await fetch("/api/account/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not send the sign-in link.");
    HUB.loginForm.reset();
    setStatus(payload.message || "Check your email for the sign-in link.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    HUB.loginButton.disabled = false;
  }
}

async function verifyLogin(token) {
  const response = await fetch("/api/account/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The sign-in link could not be verified.");
  currentMember = payload.member;
  renderMember();
  setStatus("Signed in successfully.", "success");
}

async function savePreferences() {
  if (!currentMember) return;
  try {
    const category = HUB.category.value;
    const response = await fetch("/api/account/preferences", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_notifications: HUB.emailEnabled.checked,
        category_filter: category ? [category] : [],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not save notification preferences.");
    currentMember = payload.member;
    setStatus("Notification preferences saved.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function logout() {
  try {
    await fetch("/api/account/session", { method: "DELETE", credentials: "same-origin" });
  } finally {
    currentMember = null;
    renderMember();
    setStatus("Signed out.", "success");
  }
}

async function enableBrowserAlerts() {
  if (!("Notification" in window)) {
    setStatus("This browser does not support web notifications.", "error");
    return;
  }
  if (Notification.permission === "denied") {
    setStatus("Browser notifications are blocked in this browser. Re-enable them in site permissions.", "error");
    return;
  }
  const permission = await Notification.requestPermission();
  updateBrowserButton();
  if (permission !== "granted") {
    setStatus("Browser alerts were not enabled.", "error");
    return;
  }
  setStatus("Browser alerts enabled. New published videos can appear while this page is open.", "success");
  primeLatestNotificationId(true);
}

function updateBrowserButton() {
  if (!HUB.browserButton) return;
  if (!("Notification" in window)) {
    HUB.browserButton.textContent = "Browser alerts unavailable";
    HUB.browserButton.disabled = true;
    return;
  }
  HUB.browserButton.textContent = Notification.permission === "granted" ? "Browser alerts enabled" : "Enable browser alerts";
}

async function installShortcut() {
  if (installPrompt) {
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch {}
    installPrompt = null;
    HUB.shortcutButton?.setAttribute("hidden", "");
    return;
  }
  setStatus("Use your browser menu and choose Add to Home screen or Install app.", "success");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

function restoreCategory() {
  const saved = localStorage.getItem(CATEGORY_KEY) || "";
  if (HUB.category && saved) HUB.category.value = saved;
  HUB.category?.addEventListener("change", () => {
    localStorage.setItem(CATEGORY_KEY, HUB.category.value);
  });
}

function startSmartPolling() {
  void primeLatestNotificationId(false);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!document.hidden) void checkForNewVideos();
  }, 300000);
}

async function primeLatestNotificationId(force) {
  const videos = await fetchLatestVideos();
  if (!videos.length) return;
  const newest = Number(videos[0].id);
  const existing = Number(localStorage.getItem(NOTIFY_KEY) || 0);
  if (force || !existing) localStorage.setItem(NOTIFY_KEY, String(newest));
}

async function checkForNewVideos() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const videos = await fetchLatestVideos();
  if (!videos.length) return;

  const lastId = Number(localStorage.getItem(NOTIFY_KEY) || 0);
  const eligible = videos
    .filter((video) => Number(video.id) > lastId)
    .filter(matchesCategory)
    .slice(0, 2)
    .reverse();

  if (!lastId) {
    localStorage.setItem(NOTIFY_KEY, String(videos[0].id));
    return;
  }

  for (const video of eligible) {
    const notification = new Notification("New on Vid.Best", {
      body: video.title,
      icon: "/favicon.svg",
      tag: "vidbest-video-" + video.id,
    });
    notification.onclick = () => {
      window.focus();
      location.href = "/watch/" + encodeURIComponent(video.slug);
    };
  }
  localStorage.setItem(NOTIFY_KEY, String(videos[0].id));
}

async function fetchLatestVideos() {
  try {
    const response = await fetch("/api/notifications/latest", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return [];
    return Array.isArray(payload.videos) ? payload.videos : [];
  } catch {
    return [];
  }
}

function matchesCategory(video) {
  const selected = HUB.category?.value || localStorage.getItem(CATEGORY_KEY) || "";
  return !selected || selected === video.primary_category;
}

function setStatus(message, type = "") {
  if (!HUB.status) return;
  HUB.status.textContent = message;
  HUB.status.dataset.state = type;
}
