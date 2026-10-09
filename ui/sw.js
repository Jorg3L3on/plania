// Plania's service worker: keeps the app shell so the home-screen app opens without a network.
// Data never goes through here: /api (with the live stream), /mcp, /hooks and /health pass straight to the server.
// vite.config.ts fills in VERSION and PRECACHE at build time and writes this file to dist/ui/sw.js.

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `plania-${VERSION}`;
const PASS_THROUGH = ["/api/", "/mcp", "/hooks/", "/health"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("plania-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (PASS_THROUGH.some((p) => url.pathname.startsWith(p))) return;

  // Pages: the network first, so an online open always gets the latest build; the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) void caches.open(CACHE).then((cache) => cache.put("/index.html", response.clone()));
        return response;
      }).catch(() => caches.match("/index.html").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Hashed assets and icons never change under the same name: the cache first.
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && url.pathname.startsWith("/assets/")) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
