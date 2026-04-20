/* Minimal installable PWA service worker — network-first, no offline cache. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      // fallback: just fail silently instead of crashing
      return new Response(null, { status: 204 });
    })
  );
});