// Registers the service worker that lets Plania open from the home screen without a network.
// Only in a production build, and only where the browser allows it (localhost or HTTPS).
//
// PLA-I46-1: a page left open (the home-screen app, a pinned tab) never asked for a new build, so it
// kept the old bundle in memory after a deploy. It now checks /sw.js when it comes back to the front
// and every 15 minutes; the new worker takes over (skipWaiting + clients.claim in ui/sw.js) and the
// page reloads once onto the new build: at once when it is in the background, else at its next
// visibility change (leaving, or coming back before anything is typed), so a half-written Pedir is
// never wiped under Jorge's fingers.
const CHECK_EVERY_MS = 15 * 60_000;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // Only a worker replacing an earlier one means a new build; the first install must not reload.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let pending = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || pending) return;
      pending = true;
      if (document.visibilityState === "hidden") window.location.reload();
    });
    document.addEventListener("visibilitychange", () => pending && window.location.reload());
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        const check = () => void registration.update().catch(() => undefined);
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
        window.setInterval(check, CHECK_EVERY_MS);
      })
      .catch((error: unknown) => console.warn("Plania: service worker not registered", error));
  });
}
