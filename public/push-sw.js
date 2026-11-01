// Imported by the generated service worker (vite.config.ts → workbox.importScripts).
self.addEventListener("push", (event) => {
  let note = { title: "fintrack", body: "", url: "/", tag: undefined, actions: [], txnId: undefined };
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
      // Category buttons for a new transaction (Android shows up to two).
      actions: (note.actions ?? []).slice(0, 2),
      data: { url: note.url, txnId: note.txnId },
    }),
  );
});

/** Open (or focus) the app at `path`. */
function openApp(path) {
  const url = new URL(path ?? "/", self.location.origin).href;
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((w) => w.url.startsWith(self.location.origin));
    if (!open) return self.clients.openWindow(url);
    // navigate() rejects for a window this worker doesn't control yet; fall back to a new window.
    return open
      .focus()
      .then((w) => w.navigate(url))
      .catch(() => self.clients.openWindow(url));
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, txnId } = event.notification.data ?? {};
  const categoryId = event.action?.startsWith("cat:") ? Number(event.action.slice(4)) : null;
  if (!categoryId || !txnId) {
    event.waitUntil(openApp(url));
    return;
  }
  // A category button: file it without opening the app (same as confirming in the review inbox; the
  // session cookie goes along). Signed out or offline: open the inbox instead.
  event.waitUntil(
    fetch(`/api/transactions/${txnId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId }),
      credentials: "same-origin",
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => openApp(url)),
  );
});
