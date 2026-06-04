/* Primordia Web Push service worker. */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Primordia notification";
  const options = {
    body: payload.body || "A test push notification was received.",
    icon: "./primordia-logo.png",
    badge: "./primordia-logo.png",
    tag: payload.tag || "primordia-web-push-test",
    data: {
      url: payload.url || self.registration.scope,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url === targetUrl && "focus" in client) {
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
    return undefined;
  })());
});
