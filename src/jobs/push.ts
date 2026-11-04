import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { machineState, projects, pushSubscriptions } from "../db/schema.js";
import { inbox, type InboxItem } from "../mcp/inbox.js";
import { sendToAll, vapidConfig, webPushSender, type PushPayload, type Sender } from "../push.js";
import type { Job } from "./index.js";

// 2.12 push: once a minute, what is new in Jorge's inbox (decisiones and pasos: a question,
// a human_action created or parsed from a Jorge: line, a release that became ready)
// goes to every subscribed phone as one notification, so a burst is one message. The inbox is the
// source rather than the event feed because it already says what waits on him, whatever wrote it,
// and drops what was answered in the same minute. What was seen lives in machine_state (key "push"):
// the first run only takes the bookmark, so turning push on never replays the backlog.

export const PUSH_EVERY_MS = 60_000;
const STATE_KEY = "push";

type PushState = { seen: string[]; at: string; sent?: number };

// Ids are only unique per kind (a release is release:<slug>).
const itemId = (i: InboxItem) => `${i.kind}:${i.id}`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One notification for everything new this minute. A tap opens the Bandeja on Decisiones when one
// of them is a decision, else on Pasos. One item says what it is; several say how many and the first.
export function messageFor(items: InboxItem[], names: Map<string, string>): PushPayload {
  const decisiones = items.filter((i) => i.group === "decisiones");
  const pasos = items.filter((i) => i.group === "pasos");
  const tab = decisiones.length ? "decisiones" : "pasos";
  const first = decisiones[0] ?? pasos[0]!;
  const where = names.get(first.project) ?? first.project;
  const line = `${where}${first.key ? ` · ${first.key}` : ""}: ${first.why || first.title || ""}`.trim();
  if (items.length === 1) {
    const title = first.kind === "question" ? "Te preguntan" : first.kind === "release" ? "Listo para lanzar" : "Te toca";
    return { title, body: line, url: `/inbox?tab=${tab}`, tag: "plania-te-toca" };
  }
  const parts = [decisiones.length ? count(decisiones.length, "decisión", "decisiones") : "", pasos.length ? count(pasos.length, "paso", "pasos") : ""].filter(Boolean);
  return { title: `Te toca: ${parts.join(" y ")}`, body: line, url: `/inbox?tab=${tab}`, tag: "plania-te-toca" };
}

async function readState(db: Db): Promise<PushState | null> {
  const [row] = await db.select().from(machineState).where(eq(machineState.key, STATE_KEY)).limit(1);
  return row ? (row.value as unknown as PushState) : null;
}

async function writeState(db: Db, state: PushState) {
  const value = state as unknown as Record<string, unknown>;
  await db
    .insert(machineState)
    .values({ key: STATE_KEY, value })
    .onConflictDoUpdate({ target: machineState.key, set: { value, updatedAt: sql`now()` } });
}

export async function runPush(db: Db, now = new Date(), send: Sender = webPushSender) {
  const box = await inbox(db, "all");
  const current = (box.items as InboxItem[]).filter((i) => i.group !== "limpieza");
  const prev = await readState(db);
  const seen = new Set(prev?.seen ?? []);
  const fresh = prev ? current.filter((i) => !seen.has(itemId(i))) : [];
  const summary = { new: fresh.length, sent: 0, failed: 0, removed: 0 };
  const vapid = vapidConfig();
  if (fresh.length && vapid) {
    const [subs] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions);
    if (subs?.n) {
      const names = new Map((await db.select({ slug: projects.slug, title: projects.title }).from(projects)).map((p) => [p.slug, p.title]));
      Object.assign(summary, await sendToAll(db, messageFor(fresh, names), vapid, send));
    }
  }
  // What is no longer waiting drops out of seen, so if it comes back it is news again.
  await writeState(db, { seen: current.map(itemId), at: now.toISOString(), sent: summary.sent });
  return summary;
}

export const pushJob: Job = { name: "push", intervalMs: PUSH_EVERY_MS, runOnce: (db, now) => runPush(db, now) };
