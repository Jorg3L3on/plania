// Registers the service worker that lets Plania open from the home screen without a network.
// Only in a production build, and only where the browser allows it (localhost or HTTPS).
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => console.warn("Plania: service worker not registered", error));
  });
}
