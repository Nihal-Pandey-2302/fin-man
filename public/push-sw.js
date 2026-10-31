// Imported by the generated service worker (vite.config.ts → workbox.importScripts).
self.addEventListener("push", (event) => {
  let note = { title: "fintrack", body: "", url: "/", tag: undefined };
  try {
    note = { ...note, ...event.data.json() };
  } catch {
    if (event.data) note.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(note.title, {
      body: note.body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-64x64.png",
      tag: note.tag,
      data: { url: note.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (!open) return self.clients.openWindow(url);
      // navigate() rejects for a window this worker doesn't control yet; fall back to a new window.
      return open
        .focus()
        .then((w) => w.navigate(url))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
