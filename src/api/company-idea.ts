// PLA-I61 (La idea abierta, PLA-IDEA24): one idea in La ficha, the same from Pedido, Ideas, Diseño or Ahora.
//   GET  /api/company/projects/:slug/ideas/:key                 the idea: its six stops, what each delivered (the PO's
//        reading and the idea's ficha, Research's recommendation and options, Artist's frames, the plan's steps), who
//        and when, whether the owner saw it and what he answered; the trail; the request parts when it is one of his.
//   POST /api/company/projects/:slug/ideas/:key/visto {stop}    he opened that stop (an event; the trail leaves it out)
//   POST /api/company/projects/:slug/ideas/:key/respuesta {stop, verdict, text?, option?, notes?}
//        ok | deshacer: a mark in the trail, nothing moves (deshacer only takes back an ok).
//        cambios | opcion | corregir: a note with his words (and his pinned notes), the idea goes back to that stop's
//        stage, and its owner wakes (Research and Artist wake on the stage itself; the PO is woken here).
//   POST /api/company/projects/:slug/ideas/:key/despertar       wakes the owner of the stage it sits on
//   GET  /api/company/projects/:slug/ideas/:key/frames/:id      one of Artist's frames (src/pedidos/frames.ts)
// Nothing waits on an answer: without one the idea keeps going.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, docs, events, ideaFrames, projects, questions, tasks, type Actor, type Task } from "../db/schema.js";
import { findProject } from "../mcp/queries.js";
import { webCtx, writeTx } from "../mcp/tx.js";
import { eventWakesEnabled, queueWake, serviceAgent } from "../runner/events.js";
import { listTaskImages } from "../pedidos/images.js";
import { listFrames, type FrameView } from "../pedidos/frames.js";
import { projectPo } from "./company-actions.js";
import { DESPERTAR, RESPUESTA, VISTO, askedText, fichaOf, sectionAll, trailOf, whoOf, type FichaIdea, type TrailItem } from "./company-pedido.js";
import { PEDIDO_STOPS, pedidoOf, type Pedido, type PedidoStop } from "./company-pedidos.js";

export type IdeaVerdict = "ok" | "deshacer" | "cambios" | "opcion" | "corregir";
export type IdeaNote = { frame: string; x: number; y: number; text: string };
export type IdeaAnswer = { verdict: Exclude<IdeaVerdict, "deshacer">; text: string | null; option: number | null; notes: IdeaNote[]; at: string };
export type IdeaStop = {
  stop: PedidoStop;
  // done: behind the idea; here: where it is; todo: ahead (what it has is redone when it gets there).
  state: "done" | "here" | "todo";
  // Who delivered it (a role, or jorge for the request), and when.
  by: string | null;
  at: string | null;
  delivered: boolean;
  doc: { id: string; title: string; version: number; markdown: string } | null;
  seen: boolean;
  answer: IdeaAnswer | null;
};
export type IdeaOption = { n: number; title: string; text: string };
export type IdeaDetail = Pedido & {
  summary: string;
  // The owner's words when he asked for it (else the title).
  text: string;
  status: string;
  stage: string | null;
  promoted_to: string | null;
  // His own request (origin jorge): the view carries Constrúyelo, Guardar and Descartar.
  pedido: boolean;
  question_options: string[];
  stops: IdeaStop[];
  ficha: FichaIdea;
  research: { recommendation: string | null; options: IdeaOption[]; unknown: string[] };
  plan_steps: string[];
  frames: FrameView[];
  // Delivered stops he has not opened.
  unseen: number;
  // Nobody runs on it, nobody is queued for it and nothing waits on him: since when (its last event).
  quiet_since: string | null;
  // A wake waiting in the queue for it: the role that will take it.
  queued: string | null;
  trail: TrailItem[];
  pictures: { id: string; url: string; at: string }[];
};
type Refusal = { error: string; status: 400 | 404 | 409; hint: string };

// Which doc and stage each stop is; the stage owner wakes on an answer that sends it back.
const STOP_DOC: Partial<Record<PedidoStop, string>> = { entendido: "Idea", investigacion: "Research", diseno: "Design", plan: "Plan" };
const STOP_STAGE: Record<PedidoStop, string> = { buzon: "idea", entendido: "idea", investigacion: "research", diseno: "design", plan: "planning", lista: "ready" };
const STAGE_ORDER = ["idea", "research", "design", "planning", "ready"];
const STAGE_ROLE: Record<string, "product-owner" | "research" | "artist"> = { idea: "product-owner", research: "research", design: "artist", planning: "product-owner", ready: "product-owner" };
const ANSWERABLE: PedidoStop[] = ["entendido", "investigacion", "diseno", "plan"];
const STOP_WORD: Record<string, string> = { entendido: "Entendido", investigacion: "Investigación", diseno: "Diseño", plan: "Plan" };

async function anyIdea(db: Db, slug: string, key: string): Promise<{ project: { id: string; slug: string }; t: Task } | Refusal> {
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t || t.kind !== "idea") return { error: "IDEA_NOT_FOUND", status: 404, hint: "Esa idea no está en este proyecto." };
  return { project: p, t };
}

const clean = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
// A numbered list under a heading: «1. **Title.** text» → {n, title, text}.
export function numbered(body: string | null): IdeaOption[] {
  if (!body) return [];
  const out: IdeaOption[] = [];
  for (const block of body.split(/\n(?=\s*\d+[.)]\s)/)) {
    const m = /^\s*(\d+)[.)]\s+([\s\S]*)$/.exec(block);
    if (!m) continue;
    const raw = m[2]!.trim();
    const bold = /^\*\*([^*]+)\*\*\s*[.:]?\s*([\s\S]*)$/.exec(raw);
    const title = clean(bold ? bold[1]! : (raw.split(/(?<=[.:])\s/)[0] ?? raw)).replace(/[.:]$/, "");
    const rest = clean(bold ? bold[2]! : raw.slice(title.length).replace(/^[.:]\s*/, ""));
    out.push({ n: Number(m[1]), title: title.slice(0, 140), text: rest.length > 320 ? `${rest.slice(0, 319).trimEnd()}…` : rest });
  }
  return out;
}
const bullets = (body: string | null): string[] =>
  (body ?? "")
    .split("\n")
    .map((l) => /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(l)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => clean(x))
    .slice(0, 12);

export async function ideaDetail(db: Db, slug: string, key: string): Promise<IdeaDetail | Refusal> {
  const found = await anyIdea(db, slug, key);
  if ("error" in found) return found;
  const { project, t } = found;
  const base = await pedidoOf(db, project.id, t);
  const list = await db.select().from(docs).where(eq(docs.taskId, t.id)).orderBy(desc(docs.updatedAt));
  const docOf = (title: string) => list.find((d) => d.title.toLowerCase() === title.toLowerCase()) ?? null;
  const evs = await db
    .select({ type: events.type, payload: events.payload, actor: events.actor, at: events.createdAt })
    .from(events)
    .where(and(eq(events.taskId, t.id), inArray(events.type, [VISTO, RESPUESTA, "frames.attached", "task.created", "note"])))
    .orderBy(events.id);
  const frames = await listFrames(db, slug, t.id, t.key);
  const framesAt = evs.findLast((e) => e.type === "frames.attached")?.at ?? null;
  const understood = evs.find((e) => e.type === "note" && /^\s*entend[ií]\s*[:：-]/i.test(String((e.payload as { text?: string }).text ?? "")));
  const cache = new Map<string, string>();
  const here = PEDIDO_STOPS.indexOf(base.stop);
  const stops: IdeaStop[] = [];
  for (const [i, stop] of PEDIDO_STOPS.entries()) {
    const d = STOP_DOC[stop] ? docOf(STOP_DOC[stop]!) : null;
    let at: Date | null = d?.updatedAt ?? null;
    let by: string | null = d ? await whoOf(db, d.actor as Actor, cache) : null;
    if (stop === "buzon") {
      at = t.createdAt;
      by = t.origin === "jorge" ? "jorge" : null;
    }
    if (stop === "entendido" && !d && understood) {
      at = understood.at;
      by = await whoOf(db, understood.actor as Actor, cache);
    }
    if (stop === "diseno" && framesAt && (!at || framesAt > at)) at = framesAt;
    if (stop === "lista" && t.stage === "ready") by = "product-owner";
    const delivered = stop === "buzon" ? true : stop === "lista" ? t.stage === "ready" : !!at;
    const after = (e: { at: Date }) => !at || e.at >= at;
    const mine = evs.filter((e) => (e.payload as { stop?: string }).stop === stop && after(e));
    // Lista is where the idea waits for «Constrúyelo», not something to look at (PLA-I61-6).
    const seen = stop === "buzon" || stop === "lista" || !delivered || mine.some((e) => e.type === VISTO);
    const last = mine.findLast((e) => e.type === RESPUESTA);
    const lp = (last?.payload ?? {}) as Record<string, unknown>;
    const answer: IdeaAnswer | null =
      last && lp.verdict !== "deshacer"
        ? {
            verdict: lp.verdict as IdeaAnswer["verdict"],
            text: typeof lp.text === "string" ? lp.text : null,
            option: typeof lp.option === "number" ? lp.option : null,
            notes: Array.isArray(lp.notes) ? (lp.notes as IdeaNote[]) : [],
            at: last.at.toISOString(),
          }
        : null;
    stops.push({
      stop,
      state: i < here ? "done" : i === here ? "here" : "todo",
      by,
      at: at ? at.toISOString() : null,
      delivered,
      doc: d ? { id: d.id, title: d.title, version: d.version, markdown: d.markdown } : null,
      seen,
      answer,
    });
  }
  const research = docOf("Research")?.markdown ?? "";
  const plan = docOf("Plan")?.markdown ?? "";
  const [q] = base.question ? await db.select({ options: questions.options }).from(questions).where(eq(questions.id, base.question.id)).limit(1) : [];
  const [inLine] = await db
    .select({ role: agentRuns.role })
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, project.id), eq(agentRuns.taskKey, t.key), eq(agentRuns.status, "queued")))
    .limit(1);
  const [lastEv] = await db.select({ at: events.createdAt }).from(events).where(and(eq(events.taskId, t.id), sql`${events.type} not in ('usage.reported', 'idea.visto')`)).orderBy(desc(events.id)).limit(1);
  return {
    ...base,
    summary: t.summary,
    text: askedText(t.scope, t.title),
    status: t.status,
    stage: t.stage,
    promoted_to: t.promotedTo,
    pedido: t.origin === "jorge",
    question_options: q?.options ?? [],
    stops,
    ficha: fichaOf(list),
    research: {
      recommendation: sectionAll(research, "Recommendation", "Recomendación"),
      options: numbered(sectionAll(research, "Options", "Opciones")),
      unknown: bullets(sectionAll(research, "Unknown", "Desconocido", "Lo que no sabemos")),
    },
    plan_steps: bullets(sectionAll(plan, "Steps", "Pasos")),
    frames,
    unseen: stops.filter((s) => s.delivered && !s.seen && s.stop !== "buzon").length,
    quiet_since: base.state === "quieta" && !inLine && t.status === "Open" && !t.promotedTo ? (lastEv?.at.toISOString() ?? null) : null,
    queued: inLine?.role ?? null,
    trail: await trailOf(db, t),
    pictures: t.origin === "jorge" ? (await listTaskImages(db, slug, key)).map((i) => ({ id: i.id, url: i.url, at: i.created_at })) : [],
  };
}

// How many delivered stops he has not opened, per idea (the Ideas list, the tube and the Diseño tab).
export async function unseenByIdea(db: Db, slug: string, keys: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const d = await ideaDetail(db, slug, key);
    if (!("error" in d)) out[key] = d.unseen;
  }
  return out;
}

const writable = (t: Task): Refusal | null =>
  t.status !== "Open" ? { error: "IDEA_CLOSED", status: 409, hint: "Esa idea ya está cerrada." } : t.promotedTo ? { error: "IDEA_PROMOTED", status: 409, hint: `Ya es ${t.promotedTo} en el tablero.` } : null;

export async function ideaVisto(db: Db, slug: string, key: string, stop: string): Promise<{ key: string; stop: string } | Refusal> {
  const found = await anyIdea(db, slug, key);
  if ("error" in found) return found;
  if (!(PEDIDO_STOPS as readonly string[]).includes(stop)) return { error: "INVALID_STOP", status: 400, hint: "Esa parada no existe." };
  const p = await findProject(db, slug);
  await writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (_tx, emit) => emit(VISTO, { id: found.t.id, key: found.t.key }, { stop }));
  return { key, stop };
}

type AnswerInput = { stop: string; verdict: IdeaVerdict; text?: string; option?: number; notes?: IdeaNote[] };

// The note the stage owner reads: his words, the option, each pinned note with its frame and spot.
export function answerNote(stop: string, input: AnswerInput, frames: { frame: string; name: string }[]): string {
  const head = { cambios: `Jorge pide cambios en ${STOP_WORD[stop] ?? stop} (desde Compañía).`, opcion: `Jorge pide la opción ${input.option} de la investigación en lugar de la recomendada (desde Compañía).`, corregir: "Jorge dice que no es eso lo que pidió (desde Compañía)." }[input.verdict as "cambios" | "opcion" | "corregir"];
  const lines = [head];
  if (input.text?.trim()) lines.push(`Sus palabras: «${input.text.trim()}»`);
  (input.notes ?? []).forEach((n, i) => {
    const f = frames.find((x) => x.frame === n.frame);
    lines.push(`${i + 1}. Marco ${n.frame}${f ? ` (${f.name})` : ""}, punto ${Math.round(n.x)}% desde la izquierda y ${Math.round(n.y)}% desde arriba: ${n.text.trim()}`);
  });
  lines.push("Rehaz esta etapa con eso y vuelve a mover la idea cuando esté.");
  return lines.join("\n").slice(0, 3800);
}

export async function ideaRespuesta(db: Db, slug: string, key: string, input: AnswerInput): Promise<{ key: string; stage: string | null; wake: "queued" | "busy" | "off" | "none" } | Refusal> {
  const found = await anyIdea(db, slug, key);
  if ("error" in found) return found;
  const { t } = found;
  const no = writable(t);
  if (no) return no;
  const stop = input.stop as PedidoStop;
  if (!ANSWERABLE.includes(stop)) return { error: "INVALID_STOP", status: 400, hint: "A esa parada no se le responde." };
  const detail = await ideaDetail(db, slug, key);
  if ("error" in detail) return detail;
  const s = detail.stops.find((x) => x.stop === stop)!;
  if (!s.delivered) return { error: "NOTHING_TO_ANSWER", status: 409, hint: "Esa parada todavía no entrega nada." };
  const v = input.verdict;
  if (v === "opcion" && (stop !== "investigacion" || !detail.research.options.some((o) => o.n === input.option))) return { error: "INVALID_OPTION", status: 400, hint: "Esa opción no está en la investigación." };
  if (v === "corregir" && stop !== "entendido") return { error: "INVALID_VERDICT", status: 400, hint: "Corregir es para lo que entendió el PO." };
  if ((v === "cambios" || v === "corregir" || v === "opcion") && !input.text?.trim() && !(input.notes ?? []).some((n) => n.text.trim()) && v !== "opcion")
    return { error: "EMPTY_ANSWER", status: 400, hint: "Di qué cambiarías: una frase o una nota en un marco." };
  if (v === "deshacer" && s.answer?.verdict !== "ok") return { error: "NOTHING_TO_UNDO", status: 409, hint: "Solo se deshace un «me gusta»." };
  const notes = (input.notes ?? []).filter((n) => n.text.trim()).map((n) => ({ frame: n.frame, x: Math.max(0, Math.min(100, n.x)), y: Math.max(0, Math.min(100, n.y)), text: n.text.trim().slice(0, 600) }));
  const p = await findProject(db, slug);
  const ref = { id: t.id, key: t.key };
  const payload = { stop, verdict: v, ...(input.text?.trim() ? { text: input.text.trim().slice(0, 1000) } : {}), ...(v === "opcion" ? { option: input.option } : {}), ...(notes.length ? { notes } : {}) };
  if (v === "ok" || v === "deshacer") {
    await writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (_tx, emit) => emit(RESPUESTA, ref, payload));
    return { key, stage: t.stage, wake: "none" };
  }
  // Back to that stop's stage in one move (the stage hook wakes Research or Artist); the PO is woken here.
  const target = STOP_STAGE[stop];
  const from = t.stage ?? "idea";
  const back = STAGE_ORDER.indexOf(target) < STAGE_ORDER.indexOf(from);
  const text = answerNote(stop, { ...input, notes }, detail.frames);
  return writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (tx, emit) => {
    await emit(RESPUESTA, ref, payload);
    await emit("note", ref, { text });
    if (back) {
      await tx.update(tasks).set({ stage: target, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` }).where(eq(tasks.id, t.id));
      await emit("task.updated", ref, { changes: { stage: [from, target] } });
    }
    const role = STAGE_ROLE[target]!;
    if (!eventWakesEnabled()) return { key, stage: back ? target : t.stage, wake: "off" as const };
    if (back && (role === "research" || role === "artist")) return { key, stage: target, wake: "queued" as const };
    const agent = role === "product-owner" ? ((await projectPo(db, p)) ?? (await serviceAgent(tx, role, p))) : await serviceAgent(tx, role, p);
    const w = await queueWake(tx, p, ref, { agent, taskKey: key, reason: `Jorge respondió en ${STOP_WORD[stop]}: rehaz la etapa con su nota` }, RESPUESTA);
    return { key, stage: back ? target : t.stage, wake: w.kind === "queued" ? ("queued" as const) : ("busy" as const) };
  });
}

export async function ideaDespertar(db: Db, slug: string, key: string): Promise<{ key: string; wake: "queued" | "busy" | "off" } | Refusal> {
  const found = await anyIdea(db, slug, key);
  if ("error" in found) return found;
  const { t } = found;
  const no = writable(t);
  if (no) return no;
  const p = await findProject(db, slug);
  const role = STAGE_ROLE[t.stage ?? "idea"]!;
  return writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (tx, emit) => {
    const ref = { id: t.id, key: t.key };
    await emit(DESPERTAR, ref, { stage: t.stage });
    if (!eventWakesEnabled()) return { key, wake: "off" as const };
    const agent = role === "product-owner" ? ((await projectPo(db, p)) ?? (await serviceAgent(tx, role, p))) : await serviceAgent(tx, role, p);
    const w = await queueWake(tx, p, ref, { agent, taskKey: key, reason: `Jorge la despertó desde Compañía: sigue la etapa ${t.stage ?? "idea"}` }, DESPERTAR);
    return { key, wake: w.kind === "queued" ? ("queued" as const) : ("busy" as const) };
  });
}

// For the Diseño tab: the ideas of a project that carry frames, with a few of them.
export async function ideasWithFrames(db: Db, projectId: string, slug: string): Promise<{ key: string; title: string; count: number; thumbs: string[] }[]> {
  const rows = await db
    .select({ key: tasks.key, title: tasks.title, summary: tasks.summary, taskId: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "idea"), sql`exists (select 1 from ${ideaFrames} where ${ideaFrames.taskId} = ${tasks.id})`))
    .orderBy(desc(tasks.updatedAt))
    .limit(20);
  const out = [];
  for (const r of rows) {
    const f = await listFrames(db, slug, r.taskId, r.key);
    out.push({ key: r.key, title: r.summary?.trim() || r.title, count: f.length, thumbs: f.slice(0, 4).map((x) => x.url) });
  }
  return out;
}
