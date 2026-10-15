// 2.12: "Avisarme cuando me toque". Subscribes this device to web push through the service worker
// (ui/sw.js shows the message and opens the Bandeja) and tells the server (POST /api/push/subscribe).
// Push needs a secure origin (the tailnet's HTTPS, or localhost), the production service worker, and on
// iPhone the app opened from the home-screen icon (iOS 16.4+).
import { api, ApiError } from "./api";

export type PushStatus =
  | { state: "unsupported"; reason: "insecure" | "ios-tab" | "browser" | "dev" }
  | { state: "denied" }
  | { state: "off" }
  | { state: "on"; endpoint: string };

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

function unsupported(): PushStatus | null {
  if (!window.isSecureContext) return { state: "unsupported", reason: "insecure" };
  if (!import.meta.env.PROD) return { state: "unsupported", reason: "dev" };
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return { state: "unsupported", reason: isIos() && !isStandalone() ? "ios-tab" : "browser" };
  return null;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushStatus(): Promise<PushStatus> {
  const no = unsupported();
  if (no) return no;
  if (Notification.permission === "denied") return { state: "denied" };
  const sub = await (await registration())?.pushManager.getSubscription();
  return sub ? { state: "on", endpoint: sub.endpoint } : { state: "off" };
}

// The VAPID key arrives base64url; PushManager wants the bytes.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export class PushError extends Error {}

// Call from the tap itself: iOS only shows the permission prompt for a user gesture.
export async function enablePush(): Promise<PushStatus> {
  const no = unsupported();
  if (no) return no;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? { state: "denied" } : { state: "off" };
  let key: string;
  try {
    key = (await api.pushPublicKey()).public_key;
  } catch (e) {
    throw new PushError(e instanceof ApiError && e.code === "PUSH_NOT_CONFIGURED" ? "Push no está configurado en el servidor." : "No se pudo leer la clave del servidor.");
  }
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready);
  // A subscription made with another key (the pair changed) cannot be reused.
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  try {
    await api.pushSubscribe({ endpoint: json.endpoint, keys: json.keys });
  } catch {
    await sub.unsubscribe();
    throw new PushError("El servidor no guardó la suscripción.");
  }
  return { state: "on", endpoint: sub.endpoint };
}

export async function disablePush(): Promise<PushStatus> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
  return { state: "off" };
}

export function pushHint(s: PushStatus): string | null {
  if (s.state === "denied") return "Bloqueaste los avisos; actívalos en los ajustes del teléfono.";
  if (s.state !== "unsupported") return null;
  return {
    insecure: "Abre Plania por su dirección https del tailnet.",
    "ios-tab": "Abre Plania desde el icono de la pantalla de inicio.",
    browser: "Este navegador no admite avisos.",
    dev: "Solo en la app instalada (build de producción).",
  }[s.reason];
}
