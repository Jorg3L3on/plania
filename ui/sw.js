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

// 2.12 push: the server sends {title, body, url, tag} when something new waits on Jorge (src/jobs/push.ts).
// One tag, so a newer message replaces the older one instead of stacking.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Plania";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Algo te espera en la Bandeja.",
      tag: data.tag || "plania-te-toca",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: sameOriginPath(data.url) },
    }),
  );
});

// Opens the Bandeja on the tab the message names: an open Plania window navigates there, else a new one opens.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(sameOriginPath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      // navigate() only works on a window this worker controls; otherwise open a fresh one.
      if (open) return open.focus().then((w) => (w || open).navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});

// Only paths on this origin, and /inbox when the message has none.
function sameOriginPath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/inbox";
}
