// PLA-I54-3 (Pedidos con recorrido): one open request in La ficha's «Pedido» tab, on the cookie-only company routes.
//   GET  /api/company/projects/:slug/pedidos/:key             the idea: stop, state, who, the PO's open question,
//        Recorrido (its events, docs and questions, oldest first) and Ficha de la idea (the five headings, read from its
//        docs; null where nobody wrote it yet)
//   POST /api/company/projects/:slug/pedidos/:key/guardar      off the tube, listed under Guardadas (an event)
//   POST /api/company/projects/:slug/pedidos/:key/restaurar    back to its stop
//   POST /api/company/projects/:slug/pedidos/:key/descartar {reason?}   Won't do, with the reason as its note
//   POST /api/company/projects/:slug/pedidos/:key/construir   PLA-I54-4: «Constrúyelo» (the order, then the PO's wake)
// The note box uses POST …/tasks/:key/note (company-runs.ts: the PO reads it on its next run) and the answer box the
// screen's answer route (POST /api/projects/:slug/questions/:id/answer, which wakes the PO that asked).
// PLA-I54-5: the detail's pictures come from task_images (src/pedidos/images.ts); the tab hangs each under the
// owner's trail item it was sent with.
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, docs, events, projects, questions, tasks, type Actor, type Task } from "../db/schema.js";
import { listTaskImages } from "../pedidos/images.js";
import { findProject } from "../mcp/queries.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { agentOfActor, eventWakesEnabled, queueWake } from "../runner/events.js";
import { projectPo } from "./company-actions.js";
import { roleOf } from "../runner/limits.js";
import { CONSTRUIR, GUARDADA, RESTAURADA, pedidoOf, type Pedido } from "./company-pedidos.js";
import { isOwnerAgent } from "../owner.js";
import { ownerEs } from "../owner.js";

export type FichaIdea = { problema: string | null; tamano: string | null; solucion: string | null; riesgos: string | null; fuera: string | null };
export type TrailItem = {
  at: string;
  // jorge, a runner role (product-owner, research, artist…), or the actor's own name.
  who: string;
  kind: "pedido" | "nota" | "entendi" | "pregunta" | "respuesta" | "doc" | "etapa" | "guardada" | "restaurada" | "construir" | "valvula" | "descartada" | "veredicto" | "marcos" | "despertar";
  // PLA-I61-3: the stop an item belongs to (a doc, an answer), so the idea view links it to that stop.
  stop?: string;
  text: string;
  doc?: { id: string; title: string };
};
export type PedidoDetail = Pedido & {
  mode: "forma";
  // The owner's words as he sent them.
  text: string;
  status: string;
  stage: string | null;
  promoted_to: string | null;
  question_options: string[];
  trail: TrailItem[];
  ficha: FichaIdea;
  // PLA-I54-5: the request's pictures (thumbnails in the trail), oldest first.
  pictures: { id: string; url: string; at: string }[];
};
type Refusal = { error: string; status: 404 | 409; hint: string };

const STAGE_WORD: Record<string, string> = { idea: "Idea", research: "Investigación", design: "Diseño", planning: "Plan", ready: "Lista" };
// Each line of the idea's ficha, from its docs: the Spanish heading the PO is asked for, else the stage docs' own.
const FICHA_HEADINGS: Record<keyof FichaIdea, string[]> = {
  problema: ["Problema", "Problem"],
  tamano: ["Tamaño", "Size"],
  solucion: ["Solución", "Solution", "Recommendation", "Approach"],
  riesgos: ["Riesgos", "Risks"],
  fuera: ["Fuera", "Out of scope"],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The text under a markdown heading, up to the next heading; null when the heading is missing or empty.
export function section(markdown: string, heading: string): string | null {
  const m = new RegExp(`^(#{1,6})[ \\t]+${esc(heading)}[ \\t]*$`, "im").exec(markdown);
  if (!m) return null;
  const rest = markdown.slice(m.index + m[0].length);
  const next = /^#{1,6}[ \t]+\S/m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  if (!body) return null;
  return body.length > 600 ? `${body.slice(0, 599).trimEnd()}…` : body;
}

export const RESPUESTA = "idea.respuesta";
export const VISTO = "idea.visto";
export const DESPERTAR = "idea.despertar";
const STOP_WORD: Record<string, string> = { entendido: "lo que entendió el PO", investigacion: "la investigación", diseno: "el diseño", plan: "el plan" };
// One line per answer, in the owner's voice.
export function answerLine(p: Record<string, unknown>): string | null {
  const what = STOP_WORD[String(p.stop ?? "")] ?? "la entrega";
  const notes = Array.isArray(p.notes) ? p.notes.length : 0;
  const text = typeof p.text === "string" && p.text.trim() ? `: «${p.text.trim()}»` : "";
  switch (p.verdict) {
    case "ok":
      return p.stop === "entendido" ? "Le dijiste al PO que así es." : p.stop === "investigacion" ? "Vas con la opción recomendada." : `Te gustó ${what}.`;
    case "deshacer":
      return `Deshiciste tu respuesta sobre ${what}.`;
    case "opcion":
      return `Pediste la opción ${Number(p.option)} de la investigación${text}.`;
    case "corregir":
      return `Corregiste al PO${text}.`;
    case "cambios":
      return notes ? `Pediste cambios en ${what} con ${notes} ${notes === 1 ? "nota" : "notas"}${text}.` : `Pediste cambios en ${what}${text}.`;
    default:
      return null;
  }
}

// The whole text under a heading (no cut), for the idea view's deliveries.
export function sectionAll(markdown: string, ...headings: string[]): string | null {
  for (const heading of headings) {
    const m = new RegExp(`^(#{1,6})[ \\t]+${esc(heading)}[ \\t]*$`, "im").exec(markdown);
    if (!m) continue;
    const rest = markdown.slice(m.index + m[0].length);
    const next = new RegExp(`^#{1,${m[1]!.length}}[ \\t]+\\S`, "m").exec(rest);
    const body = (next ? rest.slice(0, next.index) : rest).trim();
    if (body) return body;
  }
  return null;
}

export function fichaOf(list: { markdown: string }[]): FichaIdea {
  const out = { problema: null, tamano: null, solucion: null, riesgos: null, fuera: null } as FichaIdea;
  for (const k of Object.keys(FICHA_HEADINGS) as (keyof FichaIdea)[]) {
    for (const h of FICHA_HEADINGS[k]) {
      for (const d of list) {
        out[k] ??= section(d.markdown, h);
        if (out[k]) break;
      }
      if (out[k]) break;
    }
  }
  return out;
}

const ASKED = /\(Darle forma\): "([\s\S]*)"\n/;
export const askedText = (scope: string, title: string) => ASKED.exec(scope)?.[1] ?? title;
const UNDERSTOOD = /^\s*entend[ií]\s*[:：-]/i;
const SCREEN_NOTE = /^De Compañía:\s*/;
const BUILD_NOTE = /^Constrúyelo \(orden de/;
// PLA-I61-4: the note an answer leaves for the stage owner; the answer's own line already tells it.
// AUDIT-8: the same for the note his pick on a decision leaves (company-idea.ts decisionNote).
const ANSWER_NOTE = /^[^.:\n]{1,80}? (pide cambios en|pide la opción|dice que no es eso|decidió \(desde Compañía\)|confirmó \(desde Compañía\))/;
// AUDIT-8: his pick on one of the PO's decisions (event idea.decision, written by company-idea.ts).
const DECISION = "idea.decision";
export function decisionLine(p: Record<string, unknown>): string {
  const head = `«${String(p.label ?? "")}» en «${String(p.question ?? "")}»`;
  return p.changed ? `Decidiste ${head} (se asumía «${String(p.was ?? "")}»).` : `Confirmaste ${head}.`;
}
const DROPPED = /^Descartada por [^\n]{1,80}? desde Compañía(?::\s*([\s\S]+)|\.)$/;

// PLA-I61-1: the runner writes as «plania-runner» with a session named after the seat (po-mianovia-idea1-…,
// research-…, artist-…): the trail names the role, not the runner.
const SESSION_ROLE: [RegExp, string][] = [
  [/^po-/i, "product-owner"],
  [/^research-/i, "research"],
  [/^artist-/i, "artist"],
  [/^taller-/i, "taller"],
  [/^qa-/i, "qa"],
  [/^asistente-/i, "asistente"],
];
export const roleOfSession = (sessionId: string | null | undefined): string | null => SESSION_ROLE.find(([re]) => re.test(sessionId ?? ""))?.[1] ?? null;

export async function whoOf(db: Db, actor: Actor | null | undefined, cache: Map<string, string>): Promise<string> {
  if (!actor) return "plania";
  if (isOwnerAgent(actor.agent)) return "owner";
  const id = `${actor.agent}|${actor.session_id}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const a = await agentOfActor(db, actor);
  const who = a ? (roleOf(a) ?? a.role) : (roleOfSession(actor.session_id) ?? actor.agent);
  cache.set(id, who);
  return who;
}

export async function trailOf(db: Db, t: Task): Promise<TrailItem[]> {
  const rows = await db.select().from(events).where(eq(events.taskId, t.id)).orderBy(asc(events.id));
  const cache = new Map<string, string>();
  const out: TrailItem[] = [];
  for (const e of rows) {
    const p = e.payload as Record<string, unknown>;
    const at = e.createdAt.toISOString();
    const who = await whoOf(db, e.actor as Actor, cache);
    const push = (kind: TrailItem["kind"], text: string, extra: Partial<TrailItem> = {}) => out.push({ at, who, kind, text, ...extra });
    if (e.type === "task.created") push("pedido", "Lo pediste.");
    else if (e.type === "note") {
      const text = String(p.text ?? "");
      const dropped = DROPPED.exec(text);
      if (dropped) {
        // Descartar writes the status and its reason: one item says both.
        const line = dropped[1] ? `La descartaste: ${dropped[1]}` : "La descartaste.";
        const prev = out.findLast((x) => x.kind === "descartada");
        if (prev) prev.text = line;
        else push("descartada", line);
      } else if (BUILD_NOTE.test(text) || ANSWER_NOTE.test(text)) continue;
      else push(UNDERSTOOD.test(text) ? "entendi" : "nota", text.replace(SCREEN_NOTE, ""));
    } else if (e.type === "question.asked") push("pregunta", `Preguntó: ${String(p.question ?? "")}`);
    else if (e.type === "question.answered") push("respuesta", String(p.answer ?? ""));
    else if (e.type === "doc.put") push("doc", Number(p.version ?? 1) > 1 ? `Actualizó «${String(p.title)}».` : `Escribió «${String(p.title)}».`, { doc: { id: String(p.doc_id), title: String(p.title) } });
    else if (e.type === "task.updated") {
      const ch = (p.changes ?? {}) as Record<string, unknown>;
      const stage = ch.stage as [string, string] | undefined;
      const promoted = ch.promoted_to as [string | null, string | null] | undefined;
      if (Array.isArray(stage) && stage[0] !== stage[1]) push("etapa", `La pasó a ${STAGE_WORD[stage[1]] ?? stage[1]}.`);
      if (Array.isArray(promoted) && promoted[1]) push("valvula", `Pasó la válvula: ahora es ${promoted[1]} en el tablero.`);
    } else if (e.type === "task.status" && p.to === "Won't do") push("descartada", "La descartaste.");
    else if (e.type === GUARDADA) push("guardada", "La guardaste para después.");
    else if (e.type === RESTAURADA) push("restaurada", "La sacaste de Guardadas.");
    else if (e.type === CONSTRUIR) push("construir", "Dijiste «Constrúyelo».");
    // PLA-I61: the owner's answers to a stop, Artist's frames, a wake from the screen. «Visto» stays out of the trail.
    else if (e.type === RESPUESTA) {
      const line = answerLine(p);
      if (line) push("veredicto", line, { stop: String(p.stop ?? "") });
    } else if (e.type === DECISION) push("veredicto", decisionLine(p), { stop: "entendido" });
    else if (e.type === "frames.attached") push("marcos", `Subió ${Number(p.count ?? 0)} ${Number(p.count) === 1 ? "marco" : "marcos"} del diseño.`, { stop: "diseno" });
    else if (e.type === DESPERTAR) push("despertar", "La despertaste.");
  }
  return out;
}

// A request of the owner's in this project: an idea with origin jorge.
async function ideaOf(db: Db, slug: string, key: string): Promise<{ project: { id: string; slug: string }; t: Task } | Refusal> {
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t || t.kind !== "idea" || t.origin !== "owner") return { error: "PEDIDO_NOT_FOUND", status: 404, hint: "Ese pedido no está en este proyecto." };
  return { project: p, t };
}
const open = (t: Task): Refusal | null => (t.status !== "Open" ? { error: "PEDIDO_CLOSED", status: 409, hint: "Ese pedido ya está cerrado." } : t.promotedTo ? { error: "PEDIDO_PROMOTED", status: 409, hint: `Ya pasó la válvula: es ${t.promotedTo}.` } : null);

export async function pedidoDetail(db: Db, slug: string, key: string): Promise<PedidoDetail | Refusal> {
  const found = await ideaOf(db, slug, key);
  if ("error" in found) return found;
  const { project, t } = found;
  const base = await pedidoOf(db, project.id, t);
  const list = await db.select({ markdown: docs.markdown }).from(docs).where(eq(docs.taskId, t.id)).orderBy(desc(docs.updatedAt));
  const [q] = base.question ? await db.select({ options: questions.options }).from(questions).where(eq(questions.id, base.question.id)).limit(1) : [];
  return {
    ...base,
    mode: "forma",
    text: askedText(t.scope, t.title),
    status: t.status,
    stage: t.stage,
    promoted_to: t.promotedTo,
    question_options: q?.options ?? [],
    trail: await trailOf(db, t),
    ficha: fichaOf(list),
    pictures: (await listTaskImages(db, slug, key)).map((i) => ({ id: i.id, url: i.url, at: i.created_at })),
  };
}

async function mark(db: Db, slug: string, key: string, type: string, want: (guardada: boolean) => Refusal | null): Promise<{ key: string; guardada: boolean } | Refusal> {
  const found = await ideaOf(db, slug, key);
  if ("error" in found) return found;
  const closed = open(found.t);
  if (closed) return closed;
  const now = await pedidoOf(db, found.project.id, found.t);
  const no = want(now.guardada);
  if (no) return no;
  const p = await findProject(db, slug);
  await writeTx(db, p, { ...webCtx, tool: "company.pedido" }, async (_tx, emit) => emit(type, { id: found.t.id, key: found.t.key }, {}));
  return { key, guardada: type === GUARDADA };
}

export const guardarPedido = (db: Db, slug: string, key: string) => mark(db, slug, key, GUARDADA, (g) => (g ? { error: "ALREADY_SAVED", status: 409, hint: "Ya está en Guardadas." } : null));
export const restaurarPedido = (db: Db, slug: string, key: string) => mark(db, slug, key, RESTAURADA, (g) => (!g ? { error: "NOT_SAVED", status: 409, hint: "No está en Guardadas." } : null));

export async function descartarPedido(db: Db, slug: string, key: string, reason?: string): Promise<{ key: string; status: "Won't do" } | Refusal> {
  const found = await ideaOf(db, slug, key);
  if ("error" in found) return found;
  const closed = open(found.t);
  if (closed) return closed;
  const note = `Descartada ${ownerEs("por")} desde Compañía${reason?.trim() ? `: ${reason.trim()}` : "."}`;
  await setTask(db, { project: slug, key, status: "Won't do", reason: note, note, version: found.t.version } as never, { ...webCtx, tool: "company.pedido" });
  return { key, status: "Won't do" };
}

// Still an open request (for routes that act on one).
export async function openPedido(db: Db, slug: string, key: string): Promise<{ project: { id: string; slug: string }; t: Task } | Refusal> {
  const found = await ideaOf(db, slug, key);
  if ("error" in found) return found;
  return open(found.t) ?? found;
}

// PLA-I54-4: «Constrúyelo», from any stop. The order is an event on the idea (the only thing that lets promoted_to be set
// on an owner's request: writes.ts PEDIDO_SIN_ORDEN) and a note the PO reads; the PO wakes on the idea with the promote
// instruction. While it runs the capsule says «Pasando la válvula»; once promoted_to is set the idea leaves the tube and
// its initiative is a track on the board. Nothing else promotes it: an idea at Lista waits for this.
// PLA-I2-14: functions, so the text names the owner as they are called now.
export const buildNoteText = () =>
  `Constrúyelo (orden ${ownerEs("de")} desde Compañía): termina los docs de las etapas que faltan, luego crea la iniciativa y sus tickets directamente, sin preguntar, y pon promoted_to en esta idea con la clave de la iniciativa.`;
export const buildReason = () => `${ownerEs(undefined, { capital: true })} dijo «Constrúyelo» en esta idea: termina los docs de las etapas que faltan, crea la iniciativa y sus tickets directamente, sin preguntar, y pon promoted_to en la idea`;

export async function construirPedido(db: Db, slug: string, key: string): Promise<{ key: string; state: "valvula"; wake: "queued" | "busy" | "off" } | Refusal> {
  const found = await openPedido(db, slug, key);
  if ("error" in found) return found;
  const now = await pedidoOf(db, found.project.id, found.t);
  if (now.state === "valvula") return { error: "ALREADY_ORDERED", status: 409, hint: "Ya dijiste «Constrúyelo»: está pasando la válvula." };
  if (now.guardada) return { error: "SAVED", status: 409, hint: "Está en Guardadas: sácala primero." };
  const [owner] = found.t.ownerAgent ? await db.select().from(agents).where(eq(agents.id, found.t.ownerAgent)).limit(1) : [];
  const po = owner ?? (await projectPo(db, found.project));
  const p = await findProject(db, slug);
  const t = { id: found.t.id, key: found.t.key };
  return writeTx(db, p, { ...webCtx, tool: "company.pedido" }, async (tx, emit) => {
    await emit(CONSTRUIR, t, { stage: found.t.stage });
    await emit("note", t, { text: buildNoteText() });
    if (!eventWakesEnabled() || !po) return { key, state: "valvula" as const, wake: "off" as const };
    const w = await queueWake(tx, p, t, { agent: po, taskKey: key, reason: buildReason() }, CONSTRUIR);
    return { key, state: "valvula" as const, wake: w.kind === "queued" ? ("queued" as const) : ("busy" as const) };
  });
}
