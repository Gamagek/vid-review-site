const CACHE_NAME = "vidbest-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", () => {
  // Browser notifications on Vid.Best currently use the page Notification API.
  // A future push transport can be added here without changing the install flow.
});
