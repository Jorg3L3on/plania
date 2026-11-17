// PLA-I54-1 (Pedidos con recorrido, design doc of PLA-IDEA19): Pedir's «Darle forma». The owner's request becomes an
// idea (kind idea, stage idea, origin jorge, owned by the project's PO) that the PO shapes with him watching, and the
// floor draws the project's open ones as capsules in a tube under the stage board.
//   Stops   buzon (stage idea, no «Entendí» note), entendido (stage idea with it), investigacion, diseno, plan, lista
//           (stages research, design, planning, ready).
//   States  espera (an open question on it), trabajando (a live run on it), cola (in the buzón and no run ever took
//           it), quieta (the rest). PLA-I54-4 adds valvula (Jorge said «Constrúyelo»; not promoted yet).
// The trail is the idea's own event log, docs and questions: no new table (only F2's images have one).
// An idea that was promoted (promoted_to set), dropped (Won't do) or done leaves the tube.
import type { Db } from "../db/client.js";
import type { Agent, Task } from "../db/schema.js";
import { findProject } from "../mcp/queries.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { createTaskInTx } from "../mcp/writes.js";
import { eventWakesEnabled, queueWake } from "../runner/events.js";
import { readerOf, uowOf } from "../store/port.js";
import { understoodOf } from "./company-orders.js";

export type PedidoMode = "forma" | "ya";
export type PedidoStop = "buzon" | "entendido" | "investigacion" | "diseno" | "plan" | "lista";
export type PedidoState = "espera" | "trabajando" | "quieta" | "cola" | "valvula";
export const PEDIDO_STOPS: readonly PedidoStop[] = ["buzon", "entendido", "investigacion", "diseno", "plan", "lista"];

export type Pedido = {
  key: string;
  title: string;
  stop: PedidoStop;
  state: PedidoState;
  // The role that has it: the one running on it, else the stage's owner (Playbook: idea and plan are the PO's).
  who: string;
  // PLA-I54-2/5: the request's pictures. 0 until F5 counts them (task_images).
  images: number;
  // The PO's «Entendí: …» line, and its oldest open question.
  understood: string | null;
  question: { id: string; text: string } | null;
  // PLA-I54-3: Guardar takes it out of the tube; it is listed under Guardadas and can come back.
  guardada: boolean;
  at: string;
  // PLA-I61-6: deliveries he has not opened (Entendido, Investigación, Diseño, Plan; Lista is not one) and the newest.
  unseen: number;
  unseen_stop: PedidoStop | null;
};

// Event types the screen writes on an idea (src/api/company-pedido.ts reads them back for the trail).
export const GUARDADA = "pedido.guardada";
export const RESTAURADA = "pedido.restaurada";
export const CONSTRUIR = "pedido.construir";

const STAGE_STOP: Record<string, PedidoStop> = { research: "investigacion", design: "diseno", planning: "plan", ready: "lista" };
const STAGE_ROLE: Record<string, string> = { idea: "product-owner", research: "research", design: "artist", planning: "product-owner", ready: "product-owner" };

export const stopOf = (stage: string | null, understood: boolean): PedidoStop => STAGE_STOP[stage ?? ""] ?? (understood ? "entendido" : "buzon");

// What the PO reads on the idea (its scope). The PO's run prompt says it is an idea, not a ticket (runner.ts).
export function ideaScope(sentence: string, from = "Compañía"): string {
  return [
    `Pedido de Jorge desde ${from} (Darle forma): "${sentence}"`,
    "",
    "Para el PO: esto es una idea, no un ticket. Jorge la sigue en el tubo de su piso y la forma contigo.",
    "1. Escribe una nota `Entendí: …` sobre esta idea (set_task note) con lo que entendiste, en una línea.",
    "2. Lo que no esté claro, pregúntalo con `ask` sobre esta idea; Jorge contesta en la pantalla.",
    "3. Llena el doc de la idea (attach_doc, título «Idea») con los encabezados que Plania pide (## Problem, ## Who it is for, ## Why now) y los de su ficha: ## Tamaño, ## Solución, ## Riesgos, ## Fuera.",
    "4. Mueve la etapa (set_task stage) cuando su doc esté: idea → research → design → planning → ready. Research y Artist despiertan solos en sus etapas.",
    "5. Nunca crees tickets para Taller ni una iniciativa desde esta idea, y no pongas promoted_to: en Lista se queda quieta. Solo Jorge la manda construir con «Constrúyelo» en la pantalla; entonces Plania te despierta con esa orden.",
  ].join("\n");
}

const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0]!.trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

// «Darle forma»: the idea and the PO's wake in one write. wake says what happened, as for a ticket (createPoTicket):
// queued (on this idea), busy (the PO already has a run; it takes the idea when that run ends), off (no wakes).
export async function createPoIdea(db: Db, slug: string, po: Agent, text: string, from = "Compañía"): Promise<{ key: string; title: string; wake: "queued" | "busy" | "off" }> {
  const sentence = text.trim();
  const p = await findProject(db, slug);
  const title = firstLine(sentence);
  return writeTx(db, p, { ...webCtx, tool: "company.ask" }, async (tx, emit) => {
    const out = (await createTaskInTx(tx, emit, p, { project: slug, kind: "idea", title, scope: ideaScope(sentence, from), owner_agent: po.slug }, { ...webCtx, tool: "company.ask" })) as { key: string };
    // origin is a ticket field on create_task; on screen an idea the owner asked for carries it too (the tube's filter).
    const [t] = await uowOf(tx).update("tasks", { projectId: p.id, key: out.key }, { origin: "jorge" });
    if (!eventWakesEnabled()) return { key: out.key, title, wake: "off" as const };
    const w = await queueWake(tx, p, { id: t!.id, key: t!.key }, { agent: po, taskKey: out.key, reason: "pedido de Jorge para darle forma" }, "company.ask");
    return { key: out.key, title, wake: w.kind === "queued" ? ("queued" as const) : ("busy" as const) };
  });
}

// The latest Guardar or Restaurar on each idea decides whether it is on the shelf.
async function shelved(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await readerOf(db).find("events", { taskId: ids, type: [GUARDADA, RESTAURADA] }, { orderBy: [{ column: "id", desc: true }] });
  const seen = new Map<string, string>();
  for (const r of rows) if (r.taskId && !seen.has(r.taskId)) seen.set(r.taskId, r.type);
  return new Set([...seen].filter(([, type]) => type === GUARDADA).map(([id]) => id));
}

// PLA-I54-4: a «Constrúyelo» that has not turned into promoted_to yet.
async function ordered(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await readerOf(db).find("events", { taskId: ids, type: CONSTRUIR });
  return new Set(rows.map((r) => r.taskId!).filter(Boolean));
}

export async function openIdeasOf(db: Db, projectId: string): Promise<Task[]> {
  return readerOf(db).find("tasks", { projectId, kind: "idea", origin: "jorge", status: "Open", promotedTo: null }, { orderBy: [{ column: "createdAt" }] });
}

// PLA-I61-6: what La idea abierta marks «sin ver», counted for the tube, Ahora and the sky. A stop's delivery is its
// doc (and, for Diseño, Artist's frames); it is seen once an idea.visto for that stop came after it.
export const SEEN_EVENT = "idea.visto";
const STOP_DOC: [PedidoStop, string][] = [
  ["entendido", "idea"],
  ["investigacion", "research"],
  ["diseno", "design"],
  ["plan", "plan"],
];
export async function unseenOf(db: Db, taskId: string): Promise<{ count: number; newest: PedidoStop | null }> {
  const r = readerOf(db);
  const ds = (await r.find("docs", { taskId })).map((d) => ({ title: d.title, at: d.updatedAt }));
  const evs = (await r.find("events", { taskId, type: [SEEN_EVENT, "frames.attached"] }, { orderBy: [{ column: "id" }] })).map((e) => ({ type: e.type, payload: e.payload, at: e.createdAt }));
  let count = 0;
  let newest: PedidoStop | null = null;
  let newestAt = -1;
  for (const [stop, title] of STOP_DOC) {
    let at = ds.find((d) => d.title.toLowerCase() === title)?.at ?? null;
    const frames = stop === "diseno" ? evs.findLast((e) => e.type === "frames.attached")?.at : undefined;
    if (frames && (!at || frames > at)) at = frames;
    if (!at) continue;
    const seen = evs.some((e) => e.type === SEEN_EVENT && (e.payload as { stop?: string }).stop === stop && e.at >= at!);
    if (seen) continue;
    count++;
    if (at.getTime() >= newestAt) {
      newestAt = at.getTime();
      newest = stop;
    }
  }
  return { count, newest };
}

export async function pedidoOf(db: Db, projectId: string, t: Task, facts?: { running: Map<string, string>; taken: Set<string>; shelf: Set<string>; built: Set<string> }): Promise<Pedido> {
  const f = facts ?? (await factsOf(db, projectId, [t]));
  const understood = await understoodOf(db, t);
  const r = readerOf(db);
  const [oldest] = await r.find("questions", { taskId: t.id, answeredAt: null }, { orderBy: [{ column: "askedAt" }], limit: 1 });
  const q = oldest ? { id: oldest.id, text: oldest.question } : undefined;
  const stop = stopOf(t.stage, !!understood);
  const running = f.running.get(t.key);
  // PLA-I54-5: how many pictures the request carries.
  const pics = await r.count("taskImages", { taskId: t.id });
  const unseen = await unseenOf(db, t.id);
  const state: PedidoState = f.built.has(t.id) ? "valvula" : q ? "espera" : running ? "trabajando" : stop === "buzon" && !f.taken.has(t.key) ? "cola" : "quieta";
  return {
    key: t.key,
    title: t.title,
    stop,
    state,
    who: running ?? STAGE_ROLE[t.stage ?? "idea"] ?? "product-owner",
    images: pics,
    understood,
    question: q ? { id: q.id, text: q.text } : null,
    guardada: f.shelf.has(t.id),
    at: t.createdAt.toISOString(),
    unseen: unseen.count,
    unseen_stop: unseen.newest,
  };
}

async function factsOf(db: Db, projectId: string, rows: Task[]) {
  const keys = rows.map((t) => t.key);
  const runs = keys.length ? (await readerOf(db).find("agentRuns", { projectId, taskKey: keys })).map((r) => ({ key: r.taskKey, status: r.status, role: r.role })) : [];
  return {
    running: new Map(runs.filter((r) => r.status === "running").map((r) => [r.key!, r.role])),
    taken: new Set(runs.filter((r) => r.status !== "queued" && r.status !== "skipped").map((r) => r.key!)),
    shelf: await shelved(db, rows.map((t) => t.id)),
    built: await ordered(db, rows.map((t) => t.id)),
  };
}

// The company payload's pedidos for one project: open ideas with origin jorge, oldest first, shelved ones included
// (guardada: true) so the tube can count Guardadas.
export async function pedidosOf(db: Db, projectId: string): Promise<Pedido[]> {
  const rows = await openIdeasOf(db, projectId);
  const facts = await factsOf(db, projectId, rows);
  const out: Pedido[] = [];
  for (const t of rows) out.push(await pedidoOf(db, projectId, t, facts));
  return out;
}
