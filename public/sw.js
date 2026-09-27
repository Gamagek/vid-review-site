const CACHE_NAME = "vidbest-shell-v2";

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


self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => "focus" in client && new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) await existing.navigate(target);
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
