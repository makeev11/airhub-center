/* Build replaces these markers. Only the public application shell is cached. */
const CACHE = "airhop-chat-shell-__CHAT_BUILD_ID__";
const SHELL = ["/chat", ...__CHAT_ASSETS__];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  // No skipWaiting: a new version must not replace a page with an unsent draft.
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("airhop-chat-shell-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("Authorization")
  )
    return;
  if (
    request.mode === "navigate" &&
    ["/chat", "/chat/"].includes(url.pathname)
  ) {
    event.respondWith(
      // Keep HTML and its hashed assets on the same installed version.
      caches
        .match("/chat", { cacheName: CACHE, ignoreVary: true })
        .then((cached) => cached || fetch(request)),
    );
  } else if (
    url.pathname.startsWith("/chat-assets/") &&
    SHELL.includes(url.pathname)
  ) {
    event.respondWith(
      caches
        // Public content-addressed assets are identical for every Origin header.
        // Vite/CORS adds Vary: Origin; pre-cache and module requests differ here.
        .match(request, { cacheName: CACHE, ignoreVary: true })
        .then((cached) => cached || fetch(request)),
    );
  }
  // Never intercept NIP-11, auth, queries, media, uploads or WebSocket traffic.
});
