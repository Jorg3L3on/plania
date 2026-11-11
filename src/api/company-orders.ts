// PLA-I36-3: Tus órdenes. What Jorge asked a project for and what he chose in Te toca, newest first, five at most.
//   order   a ticket with origin jorge (Pedir, a message in the project thread, Dile al PO).
//   choice  a PO proposal Jorge answered in Te toca (action_state elegir or responder on the PO's message).
//           The ticket that answer made is the choice's own state, not a second row.
// State: entregada (Done, Merged or Released; the link is its PR, else its newest doc), en_curso (In progress or
// In review, or a run on it; who names the role), entendida (the PO wrote "Entendí: …" on it), sin_tomar (Ready
// more than 24 h and no run ever took it; age in hours), else enviada. A Won't do order is cancelada.
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, docs, events, projects, taskAliases, tasks, threadMessages, type Actor, type Project, type Task } from "../db/schema.js";
import { agentOfActor } from "../runner/events.js";
import { orderText } from "./company-decisions.js";
import { runView, type RunLine } from "./company-runs.js";
import { claim, setTask } from "../mcp/writes.js";
import { ToolError } from "../mcp/errors.js";
import { webCtx } from "../mcp/tx.js";
import { stopRun } from "../runner/runner.js";
import { roleOf } from "../runner/limits.js";

export const ORDERS_MAX = 5;
const UNTAKEN_HOURS = 24;
const HOUR = 3_600_000;
const DELIVERED = ["Done", "Merged", "Released"];
const UNDERSTOOD = /^\s*entend[ií]\s*[:：-]\s*/i;

export type OrderState = "enviada" | "entendida" | "en_curso" | "entregada" | "sin_tomar" | "cancelada";
// PLA-I36-8: the request as one object with four stages: Lo entendí, Trabajando, Pruébalo, Listo.
export type OrderStage = "enviada" | "entendido" | "trabajando" | "pruebalo" | "listo" | "cancelada";
export type OrderPlan = { needs_approval: boolean; approved: boolean; steps: number; done: number; decision: string };
export type Order = {
  id: string;
  kind: "order" | "choice";
  key: string | null;
  title: string;
  text: string | null;
  at: string;
  state: OrderState;
  stage: OrderStage;
  understood: string | null;
  who: string | null;
  link: { kind: "pr" | "doc"; ref: string; title: string } | null;
  age_h: number | null;
  plan: OrderPlan | null;
  // PLA-I36-9: the run working on it now (or stopped), on the order or one of its plan's tickets.
  run: RunLine | null;
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
  // PLA-I36-8: each order's newest plan (a PO proposal of kind plan naming it).
  const plans = new Map<string, { id: string; data: NonNullable<(typeof choices)[number]["proposal"]>; acted: string | null }>();
  const planRows = await db
    .select({ id: threadMessages.id, proposal: threadMessages.proposal, actionState: threadMessages.actionState })
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, threadId), isNotNull(threadMessages.proposal)))
    .orderBy(desc(threadMessages.at))
    .limit(40);
  for (const r of planRows) if (r.proposal?.kind === "plan" && r.proposal.order && !plans.has(r.proposal.order)) plans.set(r.proposal.order, { id: r.id, data: r.proposal, acted: r.actionState?.action ?? null });

  const stageOf = async (t: Task | undefined, st: OrderState): Promise<{ stage: OrderStage; plan: OrderPlan | null; run: RunLine | null }> => {
    if (!t) return { stage: "enviada", plan: null, run: null };
    const pl = plans.get(t.key);
    // PLA-I36-12: the keys Plania gave the steps; a PO may have moved them since (the old key is an alias).
    const created = await currentKeys(db, p.id, pl?.data.created ?? []);
    const steps = created.length ? await db.select({ key: tasks.key, status: tasks.status }).from(tasks).where(and(eq(tasks.projectId, p.id), inArray(tasks.key, created))) : [];
    const done = steps.filter((x) => DELIVERED.includes(x.status)).length;
    const plan = pl ? { needs_approval: pl.data.needs_approval, approved: (pl.data.created ?? []).length > 0, steps: pl.data.steps.length, done, decision: `m-${pl.id}` } : null;
    const run = await runView(db, p.id, [t.key, ...created]);
    const open = steps.filter((x) => x.status !== "Won't do");
    let stage: OrderStage;
    if (st === "cancelada" || pl?.acted === "cancelar" || pl?.acted === "cambiar") stage = "cancelada";
    else if (open.length && open.every((x) => DELIVERED.includes(x.status))) stage = "listo";
    else if (open.length && open.every((x) => DELIVERED.includes(x.status) || x.status === "In review")) stage = "pruebalo";
    else if (open.length || run?.status === "running" || st === "en_curso") stage = !open.length && t.status === "In review" ? "pruebalo" : "trabajando";
    else if (!open.length && st === "entregada") stage = "listo";
    else if (pl || st === "entendida") stage = "entendido";
    else stage = "enviada";
    return { stage, plan, run };
  };

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
    out.push({ id: `m-${m.id}`, kind: "choice", key: t?.key ?? null, title, text: null, at: s.at, ...state, ...(await stageOf(t, state.state)) });
  }
  for (const t of mine) {
    if (used.has(t.key)) continue;
    const state = await orderState(db, t, now, ctx);
    out.push({ id: `t-${t.id}`, kind: "order", key: t.key, title: t.title, text: orderText(t), at: t.createdAt.toISOString(), ...state, ...(await stageOf(t, state.state)) });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, ORDERS_MAX);
}


// PLA-I36-8: Cancelar closes the order and the tickets its plan made (live runs on them stop).
export async function cancelOrder(db: Db, slug: string, key: string): Promise<{ cancelled: string[] } | { error: string; status: 404 | 409; hint: string }> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [order] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!order || order.origin !== "jorge") return { error: "ORDER_NOT_FOUND", status: 404, hint: "Ese pedido no está." };
  const [thread] = await db.execute<{ id: string }>(sql`select id from threads where project_id = ${p.id} and kind = 'project' limit 1`).then((r) => r.rows);
  const plans = thread
    ? await db.select({ proposal: threadMessages.proposal }).from(threadMessages).where(and(eq(threadMessages.threadId, thread.id), isNotNull(threadMessages.proposal)))
    : [];
  const created = await currentKeys(db, p.id, plans.flatMap((r) => (r.proposal?.kind === "plan" && r.proposal.order === key ? r.proposal.created : [])));
  const ctx = { ...webCtx, tool: "screen.order_cancel" };
  const live = await db.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.projectId, p.id), eq(agentRuns.status, "running"), inArray(agentRuns.taskKey, [key, ...created])));
  for (const r of live) stopRun(r.id, "pedido cancelado desde Compañía");
  const closed: string[] = [];
  for (const k of [key, ...created]) {
    const [t] = await db.select({ status: tasks.status, version: tasks.version, owner: tasks.owner }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, k))).limit(1);
    if (!t || ["Done", "Merged", "Released", "Won't do"].includes(t.status)) continue;
    if (t.owner) {
      try {
        await claim(db, { project: slug, key: k, action: "release" } as never, ctx);
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
      }
    }
    const [fresh] = await db.select({ version: tasks.version }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, k))).limit(1);
    await setTask(db, { project: slug, key: k, status: "Won't do", version: fresh!.version, reason: "Jorge canceló el pedido desde Compañía." } as never, ctx);
    closed.push(k);
  }
  return { cancelled: closed };
}

// PLA-I36-12: a ticket's key today, from the key it had or any of its aliases (a ticket moved under an initiative
// gets a new key; the old one stays in task_aliases). Unknown keys drop out.
export async function currentKeys(db: Db, projectId: string, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const direct = await db.select({ key: tasks.key }).from(tasks).where(and(eq(tasks.projectId, projectId), inArray(tasks.key, keys)));
  const moved = await db
    .select({ key: tasks.key })
    .from(taskAliases)
    .innerJoin(tasks, eq(tasks.id, taskAliases.taskId))
    .where(and(eq(taskAliases.projectId, projectId), inArray(taskAliases.alias, keys)));
  return [...new Set([...direct, ...moved].map((r) => r.key))];
}
