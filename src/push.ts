import { eq, sql } from "drizzle-orm";
import webpush from "web-push";
import { pushSubscriptions } from "./db/schema.js";
import type { Q } from "./mcp/tx.js";

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

// The browser's PushSubscription.toJSON(); one row per endpoint, so a device that subscribes again updates its row.
export async function subscribe(db: Q, sub: PushSubscriptionInput, userAgent: string | null) {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, keys: sub.keys, userAgent })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { keys: sub.keys, userAgent, failedAt: null } })
    .returning();
  return row!;
}

export async function unsubscribe(db: Q, endpoint: string): Promise<boolean> {
  const rows = await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).returning({ id: pushSubscriptions.id });
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

// One message to every subscription. Returns how many went, failed and were removed.
export async function sendToAll(db: Q, payload: PushPayload, vapid: Vapid, send: Sender = webPushSender) {
  const subs = await db.select().from(pushSubscriptions);
  const body = JSON.stringify(payload);
  const out = { sent: 0, failed: 0, removed: 0 };
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: s.keys }, body, vapid);
      await db.update(pushSubscriptions).set({ lastOkAt: sql`now()`, failedAt: null }).where(eq(pushSubscriptions.id, s.id));
      out.sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status && GONE.includes(status)) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        out.removed += 1;
      } else {
        await db.update(pushSubscriptions).set({ failedAt: sql`now()` }).where(eq(pushSubscriptions.id, s.id));
        out.failed += 1;
      }
    }
  }
  return out;
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
