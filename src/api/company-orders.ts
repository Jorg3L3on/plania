// PLA-I36-3: Tus órdenes. What Jorge asked a project for and what he chose in Te toca, newest first, five at most.
//   order   a ticket with origin jorge (Pedir, a message in the project thread, Dile al PO).
//   choice  a PO proposal Jorge answered in Te toca (action_state elegir or responder on the PO's message).
//           The ticket that answer made is the choice's own state, not a second row.
// State: entregada (Done, Merged or Released; the link is its PR, else its newest doc), en_curso (In progress or
// In review, or a run on it; who names the role), entendida (the PO wrote "Entendí: …" on it), sin_tomar (Ready
// more than 24 h and no run ever took it; age in hours), else enviada. A Won't do order is cancelada.
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, docs, events, tasks, threadMessages, type Actor, type Project, type Task } from "../db/schema.js";
import { agentOfActor } from "../runner/events.js";
import { roleOf } from "../runner/limits.js";

export const ORDERS_MAX = 5;
const UNTAKEN_HOURS = 24;
const HOUR = 3_600_000;
const DELIVERED = ["Done", "Merged", "Released"];
const UNDERSTOOD = /^\s*entend[ií]\s*[:：-]\s*/i;

export type OrderState = "enviada" | "entendida" | "en_curso" | "entregada" | "sin_tomar" | "cancelada";
export type Order = {
  id: string;
  kind: "order" | "choice";
  title: string;
  at: string;
  state: OrderState;
  understood: string | null;
  who: string | null;
  link: { kind: "pr" | "doc"; ref: string; title: string } | null;
  age_h: number | null;
};

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string, n = 140) => cut(s.replace(/\s+/g, " ").trim(), n);

async function understoodOf(db: Db, t: Task): Promise<string | null> {
  const rows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.taskId, t.id), eq(events.type, "note")))
    .orderBy(desc(events.id))
    .limit(20);
  for (const r of rows) {
    const text = String((r.payload as { text?: unknown }).text ?? "");
    if (UNDERSTOOD.test(text)) return oneLine(text.replace(UNDERSTOOD, ""), 160) || null;
  }
  return null;
}

async function whoOf(db: Db, t: Task, running: Map<string, string>): Promise<string | null> {
  const run = running.get(t.key);
  if (run) return run;
  if (!t.owner) return null;
  const a = await agentOfActor(db, t.owner as Actor);
  return a ? (roleOf(a) ?? a.role) : null;
}

async function linkOf(db: Db, t: Task): Promise<Order["link"]> {
  if (t.prUrl) return { kind: "pr", ref: t.prUrl, title: "PR" };
  const [d] = await db.select({ id: docs.id, title: docs.title }).from(docs).where(eq(docs.taskId, t.id)).orderBy(desc(docs.updatedAt)).limit(1);
  return d ? { kind: "doc", ref: d.id, title: d.title } : null;
}

export async function orderState(db: Db, t: Task, now: Date, ctx: { running: Map<string, string>; taken: Set<string> }): Promise<Pick<Order, "state" | "understood" | "who" | "link" | "age_h">> {
  const understood = await understoodOf(db, t);
  const base = { understood, who: null, link: null, age_h: null };
  if (t.status === "Won't do") return { ...base, state: "cancelada" };
  if (DELIVERED.includes(t.status)) return { ...base, state: "entregada", link: await linkOf(db, t) };
  const who = await whoOf(db, t, ctx.running);
  if (t.status === "In progress" || t.status === "In review" || ctx.running.has(t.key)) return { ...base, state: "en_curso", who, link: t.status === "In review" ? await linkOf(db, t) : null };
  const age = now.getTime() - (t.statusChangedAt ?? t.createdAt).getTime();
  if (t.status === "Ready" && age > UNTAKEN_HOURS * HOUR && !ctx.taken.has(t.key)) return { ...base, state: "sin_tomar", age_h: Math.floor(age / HOUR) };
  return { ...base, state: understood ? "entendida" : "enviada" };
}

export async function ordersOf(db: Db, p: Project, threadId: string, now = new Date()): Promise<Order[]> {
  const mine = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "ticket"), eq(tasks.origin, "jorge")))
    .orderBy(desc(tasks.createdAt))
    .limit(20);
  const choices = await db
    .select()
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, threadId), eq(threadMessages.authorRole, "product-owner"), isNotNull(threadMessages.actionState)))
    .orderBy(desc(threadMessages.at))
    .limit(10);
  const keys = [...new Set([...mine.map((t) => t.key), ...choices.map((m) => String(m.actionState?.result?.ticket ?? "")).filter(Boolean)])];
  const runs = keys.length
    ? await db
        .select({ key: agentRuns.taskKey, status: agentRuns.status, role: agentRuns.role, agent: agents.slug })
        .from(agentRuns)
        .innerJoin(agents, eq(agents.id, agentRuns.agentId))
        .where(and(eq(agentRuns.projectId, p.id), inArray(agentRuns.taskKey, keys)))
    : [];
  const running = new Map(runs.filter((r) => r.status === "running").map((r) => [r.key!, r.role]));
  const taken = new Set(runs.filter((r) => r.status !== "queued" && r.status !== "skipped").map((r) => r.key!));
  const ctx = { running, taken };
  const byKey = new Map(mine.map((t) => [t.key, t]));
  const out: Order[] = [];
  const used = new Set<string>();

  for (const m of choices) {
    const s = m.actionState!;
    const action = s.action as string;
    if (action !== "elegir" && action !== "responder") continue;
    const r = s.result ?? {};
    const key = typeof r.ticket === "string" ? r.ticket : null;
    let t = key ? byKey.get(key) : undefined;
    if (key && !t) [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
    if (key) used.add(key);
    const label = String(r.label ?? r.text ?? "").trim();
    const option = Array.isArray(r.option) ? r.option.join(" + ") : r.option != null ? String(r.option) : null;
    const title = action === "responder" ? `Respondiste: ${oneLine(label, 120)}` : `Elegiste${option ? ` ${option}` : ""}: ${oneLine(label, 120)}`;
    const state = t ? await orderState(db, t, now, ctx) : { state: "enviada" as const, understood: null, who: null, link: null, age_h: null };
    out.push({ id: `m-${m.id}`, kind: "choice", title, at: s.at, ...state });
  }
  for (const t of mine) {
    if (used.has(t.key)) continue;
    out.push({ id: `t-${t.id}`, kind: "order", title: t.title, at: t.createdAt.toISOString(), ...(await orderState(db, t, now, ctx)) });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, ORDERS_MAX);
}

