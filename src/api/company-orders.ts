// PLA-I36-3: Tus órdenes. What Jorge asked a project for and what he chose in Te toca, newest first, five at most.
//   order   a ticket with origin jorge (Pedir, a message in the project thread, Dile al PO).
//   choice  a PO proposal Jorge answered in Te toca (action_state elegir or responder on the PO's message).
//           The ticket that answer made is the choice's own state, not a second row.
// State: entregada (Done, Merged or Released; the link is its PR, else its newest doc), en_curso (In progress or
// In review, or a run on it; who names the role), entendida (the PO wrote "Entendí: …" on it), sin_tomar (Ready
// more than 24 h and no run ever took it; age in hours), else enviada. A Won't do order is cancelada.
import type { Db } from "../db/client.js";
import type { Actor, Project, Task } from "../db/schema.js";
import { agentOfActor } from "../runner/events.js";
import { readerOf } from "../store/pg.js";
import { notNull } from "../store/types.js";
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
  const rows = await readerOf(db).find("events", { taskId: t.id, type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 20 });
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
  const [d] = await readerOf(db).find("docs", { taskId: t.id }, { orderBy: [{ column: "updatedAt", desc: true }], limit: 1 });
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
  const store = readerOf(db);
  const mine = await store.find("tasks", { projectId: p.id, kind: "ticket", origin: "jorge" }, { orderBy: [{ column: "createdAt", desc: true }], limit: 20 });
  const choices = await store.find(
    "threadMessages",
    { threadId, authorRole: "product-owner", actionState: notNull() },
    { orderBy: [{ column: "at", desc: true }], limit: 10 },
  );
  const keys = [...new Set([...mine.map((t) => t.key), ...choices.map((m) => String(m.actionState?.result?.ticket ?? "")).filter(Boolean)])];
  // Every run has its agent (the foreign key), so no run drops out for want of one.
  const runs = keys.length ? await store.find("agentRuns", { projectId: p.id, taskKey: keys }) : [];
  const running = new Map(runs.filter((x) => x.status === "running").map((x) => [x.taskKey!, x.role]));
  const taken = new Set(runs.filter((x) => x.status !== "queued" && x.status !== "skipped").map((x) => x.taskKey!));
  const ctx = { running, taken };
  const byKey = new Map(mine.map((t) => [t.key, t]));
  const out: Order[] = [];
  const used = new Set<string>();
  // PLA-I36-8: each order's newest plan (a PO proposal of kind plan naming it).
  const plans = new Map<string, { id: string; data: NonNullable<(typeof choices)[number]["proposal"]>; acted: string | null }>();
  const planRows = await store.find("threadMessages", { threadId, proposal: notNull() }, { orderBy: [{ column: "at", desc: true }], limit: 40 });
  for (const m of planRows) if (m.proposal?.kind === "plan" && m.proposal.order && !plans.has(m.proposal.order)) plans.set(m.proposal.order, { id: m.id, data: m.proposal, acted: m.actionState?.action ?? null });

  const stageOf = async (t: Task | undefined, st: OrderState): Promise<{ stage: OrderStage; plan: OrderPlan | null; run: RunLine | null }> => {
    if (!t) return { stage: "enviada", plan: null, run: null };
    const pl = plans.get(t.key);
    // PLA-I36-12: the keys Plania gave the steps; a PO may have moved them since (the old key is an alias).
    const created = await currentKeys(db, p.id, pl?.data.created ?? []);
    const steps = created.length ? await store.find("tasks", { projectId: p.id, key: created }) : [];
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
    if (key && !t) t = await store.get("tasks", { projectId: p.id, key });
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
  const r = readerOf(db);
  const p = await r.get("projects", { slug });
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const order = await r.get("tasks", { projectId: p.id, key });
  if (!order || order.origin !== "jorge") return { error: "ORDER_NOT_FOUND", status: 404, hint: "Ese pedido no está." };
  const thread = await r.get("threads", { projectId: p.id, kind: "project" });
  const plans = thread ? await r.find("threadMessages", { threadId: thread.id, proposal: notNull() }) : [];
  const created = await currentKeys(db, p.id, plans.flatMap((m) => (m.proposal?.kind === "plan" && m.proposal.order === key ? m.proposal.created : [])));
  const ctx = { ...webCtx, tool: "screen.order_cancel" };
  const live = await r.find("agentRuns", { projectId: p.id, status: "running", taskKey: [key, ...created] });
  for (const run of live) stopRun(run.id, "pedido cancelado desde Compañía");
  const closed: string[] = [];
  for (const k of [key, ...created]) {
    const t = await r.get("tasks", { projectId: p.id, key: k });
    if (!t || ["Done", "Merged", "Released", "Won't do"].includes(t.status)) continue;
    if (t.owner) {
      try {
        await claim(db, { project: slug, key: k, action: "release" } as never, ctx);
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
      }
    }
    const fresh = await r.get("tasks", { projectId: p.id, key: k });
    await setTask(db, { project: slug, key: k, status: "Won't do", version: fresh!.version, reason: "Jorge canceló el pedido desde Compañía." } as never, ctx);
    closed.push(k);
  }
  return { cancelled: closed };
}

// PLA-I36-12: a ticket's key today, from the key it had or any of its aliases (a ticket moved under an initiative
// gets a new key; the old one stays in task_aliases). Unknown keys drop out.
export async function currentKeys(db: Db, projectId: string, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const r = readerOf(db);
  const direct = await r.find("tasks", { projectId, key: keys });
  const aliases = await r.find("taskAliases", { projectId, alias: keys });
  // An alias always has its task (the foreign key); its key today is the task's.
  const keyOf = new Map(aliases.length ? (await r.find("tasks", { id: [...new Set(aliases.map((a) => a.taskId))] })).map((t) => [t.id, t.key]) : []);
  const moved = aliases.flatMap((a) => (keyOf.has(a.taskId) ? [keyOf.get(a.taskId)!] : []));
  return [...new Set([...direct.map((t) => t.key), ...moved])];
}
