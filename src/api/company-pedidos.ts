// PLA-I54-1 (Pedidos con recorrido, design doc of PLA-IDEA19): Pedir's «Darle forma». The owner's request becomes an
// idea (kind idea, stage idea, origin owner, owned by the project's PO) that the PO shapes with him watching, and the
// floor draws the project's open ones as capsules in a tube under the stage board.
//   Stops   buzon (stage idea, no «Entendí» note), entendido (stage idea with it), investigacion, diseno, plan, lista
//           (stages research, design, planning, ready).
//   States  espera (an open question on it), trabajando (a live run on it), cola (in the buzón and no run ever took
//           it), quieta (the rest). PLA-I54-4 adds valvula (the owner said «Constrúyelo»; not promoted yet).
// The trail is the idea's own event log, docs and questions: no new table (only F2's images have one).
// An idea that was promoted (promoted_to set), dropped (Won't do) or done leaves the tube.
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { installLanguage } from "../language.js";
import { ownerName } from "../owner.js";
import { placeEn } from "./places.js";
import type { Db } from "../db/client.js";
import { agentRuns, docs, events, questions, taskImages, tasks, type Agent, type Task } from "../db/schema.js";
import { findProject } from "../mcp/queries.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { createTaskInTx } from "../mcp/writes.js";
import { eventWakesEnabled, queueWake } from "../runner/events.js";
import { understoodOf } from "./company-orders.js";
import { ownerEs } from "../owner.js";

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
// PLA-I2-10: the idea's scope in the install's language (the Spanish is unchanged). The owner's words are also the
// idea's owner_words field (askedText reads it first).
export function ideaScope(sentence: string, from = "Compañía"): string {
  if (installLanguage() === "en") return ideaScopeEn(sentence, from);
  return [
    `Pedido ${ownerEs("de")} desde ${from} (Darle forma): "${sentence}"`,
    "",
    `Para el PO: esto es una idea, no un ticket. ${ownerEs(undefined, { capital: true })} la sigue en el tubo de su piso y la forma contigo.`,
    "1. Escribe una nota `Entendí: …` sobre esta idea (set_task note) con lo que entendiste, en una línea.",
    // AUDIT-8: the stage is delivered as data, and what is unclear goes with it as closed questions that nothing waits on.
    "2. Lo que no esté claro va como `decisions` en tu entrega: una pregunta cerrada, de 2 a 4 opciones y la que recomiendas. Se aplica tu recomendación salvo que " + ownerEs() + " la cambie en la pantalla; nada lo espera. Usa `ask` solo cuando no puedas recomendar ninguna opción.",
    "3. Entrega tus etapas con `deliver_stage`: en idea, problem, who, why_now y decisions; en planning, steps (cada uno con done_when y try_it), risks y size. Plania revisa lo que dicen y escribe el doc; no lo escribas con attach_doc.",
    "4. Mueve la etapa (set_task stage) cuando esté entregada: idea → research → design → planning → ready. Research y Artist despiertan solos en sus etapas.",
    "5. Nunca crees tickets para Taller ni una iniciativa desde esta idea, y no pongas promoted_to: en Lista se queda quieta. Solo " + ownerEs() + " la manda construir con «Constrúyelo» en la pantalla; entonces Plania te despierta con esa orden.",
  ].join("\n");
}

function ideaScopeEn(sentence: string, from: string): string {
  const owner = ownerName("en");
  return [
    `Request from ${owner} via ${placeEn(from)} (Shape it): "${sentence}"`,
    "",
    `For the PO: this is an idea, not a ticket. ${ownerName("en", { capital: true })} follows it in the tube on their floor and shapes it with you.`,
    "1. Write a note `Understood: …` on this idea (set_task note) with what you understood, in one line.",
    `2. What is unclear goes as \`decisions\` in your delivery: a closed question, 2 to 4 options and the one you recommend. Your recommendation applies unless ${owner} changes it on the screen; nothing waits on it. Use \`ask\` only when you cannot recommend any option.`,
    "3. Deliver your stages with `deliver_stage`: for idea, problem, who, why_now and decisions; for planning, steps (each with done_when and try_it), risks and size. Plania checks what they say and writes the doc; do not write it with attach_doc.",
    "4. Move the stage (set_task stage) once it is delivered: idea → research → design → planning → ready. Research and Artist wake on their own at their stages.",
    `5. Never create tickets for Taller or an initiative from this idea, and do not set promoted_to: at Ready it stays put. Only ${owner} sends it to be built with «Build it» on the screen; then Plania wakes you with that order.`,
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
    const out = (await createTaskInTx(tx, emit, p, { project: slug, kind: "idea", title, scope: ideaScope(sentence, from), owner_agent: po.slug, owner_words: sentence }, { ...webCtx, tool: "company.ask" })) as { key: string };
    // origin is a ticket field on create_task; on screen an idea the owner asked for carries it too (the tube's filter).
    const [t] = await tx.update(tasks).set({ origin: "owner" }).where(and(eq(tasks.projectId, p.id), eq(tasks.key, out.key))).returning({ id: tasks.id, key: tasks.key });
    if (!eventWakesEnabled()) return { key: out.key, title, wake: "off" as const };
    const w = await queueWake(tx, p, t!, { agent: po, taskKey: out.key, reason: `pedido ${ownerEs("de")} para darle forma` }, "company.ask");
    return { key: out.key, title, wake: w.kind === "queued" ? ("queued" as const) : ("busy" as const) };
  });
}

// The latest Guardar or Restaurar on each idea decides whether it is on the shelf.
async function shelved(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ taskId: events.taskId, type: events.type })
    .from(events)
    .where(and(inArray(events.taskId, ids), inArray(events.type, [GUARDADA, RESTAURADA])))
    .orderBy(desc(events.id));
  const seen = new Map<string, string>();
  for (const r of rows) if (r.taskId && !seen.has(r.taskId)) seen.set(r.taskId, r.type);
  return new Set([...seen].filter(([, type]) => type === GUARDADA).map(([id]) => id));
}

// PLA-I54-4: a «Constrúyelo» that has not turned into promoted_to yet.
async function ordered(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ taskId: events.taskId }).from(events).where(and(inArray(events.taskId, ids), eq(events.type, CONSTRUIR)));
  return new Set(rows.map((r) => r.taskId!).filter(Boolean));
}

export async function openIdeasOf(db: Db, projectId: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "idea"), eq(tasks.origin, "owner"), eq(tasks.status, "Open"), isNull(tasks.promotedTo)))
    .orderBy(asc(tasks.createdAt));
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
  const ds = await db.select({ title: docs.title, at: docs.updatedAt }).from(docs).where(eq(docs.taskId, taskId));
  const evs = await db
    .select({ type: events.type, payload: events.payload, at: events.createdAt })
    .from(events)
    .where(and(eq(events.taskId, taskId), inArray(events.type, [SEEN_EVENT, "frames.attached"])))
    .orderBy(asc(events.id));
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
  const [q] = await db
    .select({ id: questions.id, text: questions.question })
    .from(questions)
    .where(and(eq(questions.taskId, t.id), isNull(questions.answeredAt)))
    .orderBy(asc(questions.askedAt))
    .limit(1);
  const stop = stopOf(t.stage, !!understood);
  const running = f.running.get(t.key);
  // PLA-I54-5: how many pictures the request carries.
  const pics = await db.select({ id: taskImages.id }).from(taskImages).where(eq(taskImages.taskId, t.id));
  const unseen = await unseenOf(db, t.id);
  const state: PedidoState = f.built.has(t.id) ? "valvula" : q ? "espera" : running ? "trabajando" : stop === "buzon" && !f.taken.has(t.key) ? "cola" : "quieta";
  return {
    key: t.key,
    title: t.title,
    stop,
    state,
    who: running ?? STAGE_ROLE[t.stage ?? "idea"] ?? "product-owner",
    images: pics.length,
    understood,
    question: q ? { id: q.id, text: q.text } : null,
    guardada: f.shelf.has(t.id),
    at: t.createdAt.toISOString(),
    unseen: unseen.count,
    unseen_stop: unseen.newest,
  };
}

export async function factsOf(db: Db, projectId: string, rows: Task[]) {
  const keys = rows.map((t) => t.key);
  const runs = keys.length
    ? await db
        .select({ key: agentRuns.taskKey, status: agentRuns.status, role: agentRuns.role })
        .from(agentRuns)
        .where(and(eq(agentRuns.projectId, projectId), inArray(agentRuns.taskKey, keys)))
    : [];
  return {
    running: new Map(runs.filter((r) => r.status === "running").map((r) => [r.key!, r.role])),
    taken: new Set(runs.filter((r) => r.status !== "queued" && r.status !== "skipped").map((r) => r.key!)),
    shelf: await shelved(db, rows.map((t) => t.id)),
    built: await ordered(db, rows.map((t) => t.id)),
  };
}

// The company payload's pedidos for one project: open ideas with origin owner, oldest first, shelved ones included
// (guardada: true) so the tube can count Guardadas.
export async function pedidosOf(db: Db, projectId: string): Promise<Pedido[]> {
  const rows = await openIdeasOf(db, projectId);
  const facts = await factsOf(db, projectId, rows);
  const out: Pedido[] = [];
  for (const t of rows) out.push(await pedidoOf(db, projectId, t, facts));
  return out;
}
