import webpush from "web-push";
import type { Db } from "./db/client.js";
import { pgStore, readerOf } from "./store/pg.js";
import type { UnitOfWork } from "./store/types.js";

// 2.12: web push to the phones that turned on "Avisarme cuando me toque". VAPID keys come from .env
// (PLANIA_VAPID_PUBLIC / PLANIA_VAPID_PRIVATE / PLANIA_VAPID_SUBJECT; `pnpm vapid` prints a pair).
// Without them push is off: the public-key route says so and the job only keeps its bookmark.

export type Vapid = { publicKey: string; privateKey: string; subject: string };

export function vapidConfig(env: NodeJS.ProcessEnv = process.env): Vapid | null {
  const publicKey = env.PLANIA_VAPID_PUBLIC?.trim();
  const privateKey = env.PLANIA_VAPID_PRIVATE?.trim();
  const subject = env.PLANIA_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

// What a notification carries to ui/sw.js: url is where a tap opens (/inbox?tab=...).
export type PushPayload = { title: string; body: string; url: string; tag: string };

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

// A store write belongs to a project; subscriptions belong to the phone, so their writes belong to none.
const NO_PROJECT = "";
const write = <T>(db: Db, fn: (uow: UnitOfWork) => Promise<T>) => pgStore(db).write(NO_PROJECT, {}, fn);

// The browser's PushSubscription.toJSON(); one row per endpoint, so a device that subscribes again updates its row.
export async function subscribe(db: Db, sub: PushSubscriptionInput, userAgent: string | null) {
  return write(db, async (uow) => {
    const known = await uow.get("pushSubscriptions", { endpoint: sub.endpoint });
    if (!known) return uow.insert("pushSubscriptions", { endpoint: sub.endpoint, keys: sub.keys, userAgent });
    const [row] = await uow.update("pushSubscriptions", { id: known.id }, { keys: sub.keys, userAgent, failedAt: null });
    return row!;
  });
}

export async function unsubscribe(db: Db, endpoint: string): Promise<boolean> {
  const rows = await write(db, (uow) => uow.delete("pushSubscriptions", { endpoint }));
  return rows.length > 0;
}

// The one network call, swappable in tests. It rejects with a statusCode on an HTTP error (web-push's WebPushError).
export type Sender = (sub: PushSubscriptionInput, body: string, vapid: Vapid) => Promise<unknown>;

export const webPushSender: Sender = (sub, body, vapid) =>
  webpush.sendNotification(sub, body, {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    // An hour on the push service at most: a stale "te toca" is noise.
    TTL: 3600,
    urgency: "high",
    topic: "te-toca",
  });

// The push service answers 404 or 410 for a subscription that is gone for good: drop it.
const GONE = [404, 410];

// One message to every subscription. Returns how many went, failed and were removed. Each outcome is its
// own short write after the send, so the write lock is never held across a network call.
export async function sendToAll(db: Db, payload: PushPayload, vapid: Vapid, send: Sender = webPushSender) {
  const subs = await readerOf(db).find("pushSubscriptions");
  const body = JSON.stringify(payload);
  const out = { sent: 0, failed: 0, removed: 0 };
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: s.keys }, body, vapid);
      await write(db, (uow) => uow.update("pushSubscriptions", { id: s.id }, { lastOkAt: uow.now, failedAt: null }));
      out.sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status && GONE.includes(status)) {
        await write(db, (uow) => uow.delete("pushSubscriptions", { id: s.id }));
        out.removed += 1;
      } else {
        await write(db, (uow) => uow.update("pushSubscriptions", { id: s.id }, { failedAt: uow.now }));
        out.failed += 1;
      }
    }
  }
  return out;
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
