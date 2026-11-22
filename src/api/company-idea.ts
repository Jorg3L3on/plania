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
//   POST /api/company/projects/:slug/ideas/:key/decision {decision, option, question?, text?}
//        AUDIT-8: he picks an option of one of the PO's decisions (both numbers 1-based, as the screen shows them). An
//        event, that line of the Idea doc as decided, a note in his words; a pick other than the option in force sends
//        the idea back to the idea stage and wakes the PO. ideaDecisionRoutes below carries the route.
//   GET  /api/company/projects/:slug/ideas/:key/frames/:id      one of Artist's frames (src/pedidos/frames.ts)
// PLA-I65-1 (Una sola ficha): the same read serves the thing's whole life. It adds `short` (the idea's short name),
// `gist` per stop (one line, null when the stop has nothing yet) and `built` (the initiative it became: steps with
// their stage and PR, and when it was published). The key may be an initiative's: the idea promoted to it answers;
// an initiative no idea points at answers with empty stops and its `built`.
// Nothing waits on an answer: without one the idea keeps going.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { UNDERSTOOD_MARK, isUnderstood } from "./understood.js";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";
import { withDb, type Db } from "../db/client.js";
import { cronometroFor, type Cronometro } from "./cronometro.js";
import { deployCardOf, type DeployCard } from "./deploy-fix.js";
import { runReportFor, type ReportMarks, type RunReport } from "./run-report.js";
import { agentRuns, docs, events, ideaFrames, projects, pullRequests, questions, results, tasks, type Actor, type Task } from "../db/schema.js";
import { projectEtapas, type EtapaId } from "./etapa.js";
import { findProject } from "../mcp/queries.js";
import { DECISION, DELIVERY_EVENTS, decisionStates, deliveredFor, deliveredOf, recommendationText, rewriteDecisionLine, type DecisionState, type PlanStep, type StageData } from "../mcp/stage-docs.js";
import { webCtx, writeTx, type Emit, type Q } from "../mcp/tx.js";
import { eventWakesEnabled, queueWake, serviceAgent } from "../runner/events.js";
import { listTaskImages } from "../pedidos/images.js";
import { listFrames, type FrameView } from "../pedidos/frames.js";
import { projectPo } from "./company-actions.js";
import { DESPERTAR, RESPUESTA, VISTO, askedText, fichaOf, sectionAll, trailOf, whoOf, type FichaIdea, type TrailItem } from "./company-pedido.js";
import { CONSTRUIR as CONSTRUIR_EVENT, PEDIDO_STOPS, pedidoOf, type Pedido, type PedidoStop } from "./company-pedidos.js";
import { ownerEs, ownerName } from "../owner.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the idea's gists, refusals, and the notes and wake reasons it writes, in the install's language; the
// Spanish is unchanged. company-pedido.ts reads the Spanish notes of old rows back (ANSWER_NOTE).
const Owner = () => ownerEs(undefined, { capital: true });
const OwnerEn = () => ownerName("en", { capital: true });
export const COMPANY_IDEA_WORDS = defineWords({
  es: {
    stop: { entendido: "Entendido", investigacion: "Investigación", diseno: "Diseño", plan: "Plan" } as Record<string, string>,
    stage: { research: "Investigación", design: "Diseño", planning: "Plan", ready: "Lista" } as Record<string, string>,
    notHere: "Esa idea no está en este proyecto.",
    recommends: (t: string) => `Recomienda: ${t}`,
    frames: (n: number) => `${n} ${n === 1 ? "marco" : "marcos"} de Artist`,
    steps: (n: number) => `${n} ${n === 1 ? "paso" : "pasos"}`,
    onBoard: (k: string) => `Es ${k} en el tablero`,
    readyToBuild: "Lista para construir",
    closed: "Esa idea ya está cerrada.",
    promoted: (k: string) => `Ya es ${k} en el tablero.`,
    noStop: "Esa parada no existe.",
    headChanges: (stop: string) => `${Owner()} pide cambios en ${stop} (desde Compañía).`,
    headOption: (n: unknown) => `${Owner()} pide la opción ${n} de la investigación en lugar de la recomendada (desde Compañía).`,
    headCorrect: () => `${Owner()} dice que no es eso lo que pidió (desde Compañía).`,
    words: (t: string) => `Sus palabras: «${t}»`,
    pin: (i: number, frame: string, name: string | null, x: number, y: number, text: string) =>
      `${i}. Marco ${frame}${name !== null ? ` (${name})` : ""}, punto ${x}% desde la izquierda y ${y}% desde arriba: ${text}`,
    redo: "Rehaz esta etapa con eso y vuelve a mover la idea cuando esté.",
    notAnswerable: "A esa parada no se le responde.",
    nothingYet: "Esa parada todavía no entrega nada.",
    noOption: "Esa opción no está en la investigación.",
    correctPo: "Corregir es para lo que entendió el PO.",
    emptyAnswer: "Di qué cambiarías: una frase o una nota en un marco.",
    undoLike: "Solo se deshace un «me gusta».",
    answeredReason: (stop: string) => `${Owner()} respondió en ${stop}: rehaz la etapa con su nota`,
    decided: (label: string, question: string, was: string) => `${Owner()} decidió (desde Compañía) «${label}» en «${question}», en lugar de «${was}».`,
    confirmed: (label: string, question: string) => `${Owner()} confirmó (desde Compañía) «${label}» en «${question}».`,
    nothingChanges: "Nada cambia: sigue con lo que asumiste.",
    forward: (stage: string) =>
      `La idea sigue en ${stage}; el doc «Idea» ya dice lo que decidió. Tenlo en cuenta en esta etapa: si cambia algo de lo que ya entregaste, entrégala otra vez con deliver_stage. Si su decisión deshace una etapa anterior, regrésala con una nota que diga por qué.`,
    redoDeliver: "Rehaz esta etapa con eso: entrégala otra vez con deliver_stage y vuelve a mover la idea cuando esté.",
    noDecisions: "Esta idea no trae preguntas por decidir.",
    noQuestion: "Esa pregunta no está en la idea.",
    questionsChanged: "Las preguntas cambiaron. Vuelve a abrir la idea y elige otra vez.",
    noPick: "Esa opción no está en la pregunta.",
    alreadyPicked: "Ya habías elegido esa.",
    changedReason: (stage: string) => `${Owner()} cambió una decisión del PO: llévala a tu etapa (${stage}) según su nota`,
    otherReason: () => `${Owner()} decidió otra cosa en una de tus preguntas: rehaz la etapa con su nota y entrégala con deliver_stage`,
    wokeReason: (stage: string) => `${Owner()} la despertó desde Compañía: sigue la etapa ${stage}`,
  },
  en: {
    stop: { entendido: "Understood", investigacion: "Research", diseno: "Design", plan: "Plan" } as Record<string, string>,
    stage: { research: "Research", design: "Design", planning: "Plan", ready: "Ready" } as Record<string, string>,
    notHere: "That idea is not in this project.",
    recommends: (t: string) => `Recommends: ${t}`,
    frames: (n: number) => `${n} ${n === 1 ? "frame" : "frames"} from Artist`,
    steps: (n: number) => `${n} ${n === 1 ? "step" : "steps"}`,
    onBoard: (k: string) => `It is ${k} on the board`,
    readyToBuild: "Ready to build",
    closed: "That idea is already closed.",
    promoted: (k: string) => `It is already ${k} on the board.`,
    noStop: "That stop does not exist.",
    headChanges: (stop: string) => `${OwnerEn()} asks for changes in ${stop} (from Compañía).`,
    headOption: (n: unknown) => `${OwnerEn()} asks for option ${n} of the research instead of the recommended one (from Compañía).`,
    headCorrect: () => `${OwnerEn()} says that is not what they asked for (from Compañía).`,
    words: (t: string) => `Their words: «${t}»`,
    pin: (i: number, frame: string, name: string | null, x: number, y: number, text: string) =>
      `${i}. Frame ${frame}${name !== null ? ` (${name})` : ""}, point ${x}% from the left and ${y}% from the top: ${text}`,
    redo: "Redo this stage with that and move the idea again when it is ready.",
    notAnswerable: "That stop takes no answer.",
    nothingYet: "That stop has delivered nothing yet.",
    noOption: "That option is not in the research.",
    correctPo: "Correct is for what the PO understood.",
    emptyAnswer: "Say what you would change: a sentence or a note on a frame.",
    undoLike: "Only a «like» can be undone.",
    answeredReason: (stop: string) => `${OwnerEn()} answered on ${stop}: redo the stage with their note`,
    decided: (label: string, question: string, was: string) => `${OwnerEn()} decided (from Compañía) «${label}» on «${question}», instead of «${was}».`,
    confirmed: (label: string, question: string) => `${OwnerEn()} confirmed (from Compañía) «${label}» on «${question}».`,
    nothingChanges: "Nothing changes: go on with what you assumed.",
    forward: (stage: string) =>
      `The idea stays in ${stage}; the «Idea» doc already says what was decided. Keep it in mind in this stage: if it changes anything you already delivered, deliver it again with deliver_stage. If the decision undoes an earlier stage, send it back with a note that says why.`,
    redoDeliver: "Redo this stage with that: deliver it again with deliver_stage and move the idea again when it is ready.",
    noDecisions: "This idea has no questions to decide.",
    noQuestion: "That question is not in the idea.",
    questionsChanged: "The questions changed. Open the idea again and choose again.",
    noPick: "That option is not in the question.",
    alreadyPicked: "You had already chosen that one.",
    changedReason: (stage: string) => `${OwnerEn()} changed one of the PO's decisions: carry it into your stage (${stage}) per their note`,
    otherReason: () => `${OwnerEn()} decided otherwise on one of your questions: redo the stage with their note and deliver it with deliver_stage`,
    wokeReason: (stage: string) => `${OwnerEn()} woke it from Compañía: continue the ${stage} stage`,
  },
});
const iw = () => say(COMPANY_IDEA_WORDS);

export type IdeaVerdict = "ok" | "deshacer" | "cambios" | "opcion" | "corregir";
export type IdeaNote = { frame: string; x: number; y: number; text: string };
export type IdeaAnswer = { verdict: Exclude<IdeaVerdict, "deshacer">; text: string | null; option: number | null; notes: IdeaNote[]; at: string };
export type IdeaStop = {
  stop: PedidoStop;
  // done: behind the idea; here: where it is; todo: ahead (what it has is redone when it gets there).
  state: "done" | "here" | "todo";
  // Who delivered it (a role, or owner for the request), and when.
  by: string | null;
  at: string | null;
  delivered: boolean;
  doc: { id: string; title: string; version: number; markdown: string } | null;
  seen: boolean;
  answer: IdeaAnswer | null;
  // AUDIT-8: what the stage delivered as data (deliver_stage); null when its doc was written by hand.
  data: StageData | null;
};
// AUDIT-8: one of the PO's decisions. recommended and chosen are option numbers (1-based); chosen is the one in
// force: the recommended one while it is assumed, his pick once decided.
export type IdeaDecisionView = { n: number; question: string; options: string[]; recommended: number; why: string; state: "assumed" | "decided"; chosen: number; at: string | null };
export type IdeaOption = { n: number; title: string; text: string };
// PLA-I65-1: one step of the initiative the idea became, with its stage on the board and its PR.
export type BuiltStep = { key: string; title: string; status: string; phase: number | null; etapa: EtapaId | null; pr: { number: number; state: string; url: string } | null };
export type Built = {
  key: string;
  title: string;
  status: string;
  version: number;
  // Landed steps (Merged, Released, Done) and every step but Won't do.
  done: number;
  total: number;
  can_close: boolean;
  steps: BuiltStep[];
  prs: { number: number; state: string; url: string; key: string }[];
  // Every step landed and released (or the initiative is Done): when the last one did.
  published_at: string | null;
  // The newest passing evidence on its steps (what Publicado shows).
  evidence: { key: string; kind: string; cite: string; commit: string | null; env: string | null; at: string }[];
  // PLA-I73-1: where the time went, per step and in total.
  tiempo: Cronometro;
  // PLA-I74-8: the production deploy its merged steps wait on, when it failed, builds or waits for a live answer.
  deploy: DeployCard | null;
  // PLA-I74-1: the run report (src/api/run-report.ts): fixes, extra clicks, heals, time per stop, the longest gap, tokens.
  informe: RunReport;
};
export type IdeaDetail = Pedido & {
  summary: string;
  // The owner's words when he asked for it (else the title).
  text: string;
  status: string;
  stage: string | null;
  promoted_to: string | null;
  // His own request (origin owner): the view carries Constrúyelo, Guardar and Descartar.
  pedido: boolean;
  question_options: string[];
  stops: IdeaStop[];
  ficha: FichaIdea;
  // PLA-112 (guided test PLA-86, F-5): the PO's own ficha (its Idea doc only), for the Entendido stop; the merged
  // ficha put Research's recommendation under «Solución» there.
  ficha_po: FichaIdea;
  // recommended: the number of the option Research recommends (null when the doc does not say it as data).
  research: { recommendation: string | null; options: IdeaOption[]; unknown: string[]; recommended: number | null; learned: string[] };
  plan_steps: string[];
  // AUDIT-8: the plan as data (each step with what done means and what to try); null for a Plan written by hand.
  plan: { steps: PlanStep[]; risks: string[]; size: string | null } | null;
  decisions: IdeaDecisionView[];
  frames: FrameView[];
  // Delivered stops he has not opened.
  unseen: number;
  // Nobody runs on it, nobody is queued for it and nothing waits on him: since when (its last event).
  quiet_since: string | null;
  // A wake waiting in the queue for it: the role that will take it.
  queued: string | null;
  trail: TrailItem[];
  pictures: { id: string; url: string; at: string }[];
  // PLA-I65-1. kind: what the key named (an idea, or an initiative with or without an idea behind it).
  kind: "idea" | "initiative";
  short: string;
  // The PO's newest «Entendí» line whole (understood is cut at 160 for the lists).
  understood_text: string | null;
  gist: Record<PedidoStop, string | null>;
  built: Built | null;
};
type Refusal = { error: string; status: 400 | 404 | 409; hint: string };

// Which doc and stage each stop is; the stage owner wakes on an answer that sends it back.
const STOP_DOC: Partial<Record<PedidoStop, string>> = { entendido: "Idea", investigacion: "Research", diseno: "Design", plan: "Plan" };
const STOP_STAGE: Record<PedidoStop, string> = { buzon: "idea", entendido: "idea", investigacion: "research", diseno: "design", plan: "planning", lista: "ready" };
const STAGE_ORDER = ["idea", "research", "design", "planning", "ready"];
const STAGE_ROLE: Record<string, "product-owner" | "research" | "artist"> = { idea: "product-owner", research: "research", design: "artist", planning: "product-owner", ready: "product-owner" };
const ANSWERABLE: PedidoStop[] = ["entendido", "investigacion", "diseno", "plan"];

async function anyIdea(db: Db, slug: string, key: string): Promise<{ project: { id: string; slug: string }; t: Task } | Refusal> {
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (!t || t.kind !== "idea") return { error: "IDEA_NOT_FOUND", status: 404, hint: iw().notHere };
  return { project: p, t };
}

// PLA-I65-1: an initiative's key reads as the idea promoted to it (the newest one), else as the initiative alone.
async function thingOf(db: Db, slug: string, key: string): Promise<{ project: { id: string; slug: string }; t: Task; init: Task | null } | Refusal> {
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) return { error: "PROJECT_NOT_FOUND", status: 404, hint: "no such project" };
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  if (t?.kind === "idea") return { project: p, t, init: null };
  if (t?.kind !== "initiative") return { error: "IDEA_NOT_FOUND", status: 404, hint: iw().notHere };
  const [idea] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "idea"), eq(tasks.promotedTo, t.key)))
    .orderBy(desc(tasks.updatedAt))
    .limit(1);
  return { project: p, t: idea ?? t, init: t };
}

const LANDED = ["Merged", "Released", "Done"];
const PUBLISHED = ["Released", "Done"];

/** The initiative an idea became: its steps with their stage and PR, and when it was published. */
export async function builtOf(db: Db, slug: string, init: Task, stopMarks: ReportMarks = {}): Promise<Built> {
  const p = await findProject(db, slug);
  const kids = (await db.select().from(tasks).where(and(eq(tasks.parentId, init.id), eq(tasks.kind, "ticket")))).filter((k) => k.status !== "Won't do");
  const etapas = kids.length ? await projectEtapas(db, p) : null;
  const prRows = kids.length
    ? await db
        .select({ taskId: pullRequests.taskId, number: pullRequests.number, state: pullRequests.state, url: pullRequests.url, updatedAt: pullRequests.updatedAt })
        .from(pullRequests)
        .where(inArray(pullRequests.taskId, kids.map((k) => k.id)))
        .orderBy(desc(pullRequests.updatedAt))
    : [];
  const keyNo = (k: string) => Number(/(\d+)$/.exec(k)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const sorted = [...kids].sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || keyNo(a.key) - keyNo(b.key) || a.key.localeCompare(b.key));
  const prOf = (id: string) => {
    const mine = prRows.filter((r) => r.taskId === id);
    const r = mine.find((x) => x.state === "open") ?? mine[0];
    return r ? { number: r.number, state: r.state, url: r.url } : null;
  };
  const steps: BuiltStep[] = sorted.map((k) => ({ key: k.key, title: k.title, status: k.status, phase: k.phase ?? null, etapa: etapas?.byTicket.get(k.key)?.etapa.etapa ?? null, pr: prOf(k.id) }));
  const done = sorted.filter((k) => LANDED.includes(k.status)).length;
  const closed = sorted.filter((k) => k.status === "Done").length;
  const landedAt = (k: Task) => (k.resolvedAt ?? k.statusChangedAt ?? k.updatedAt)?.getTime() ?? 0;
  const all = sorted.length > 0 && sorted.every((k) => PUBLISHED.includes(k.status));
  const published = init.status === "Done" ? (init.resolvedAt ?? init.statusChangedAt ?? (all ? new Date(Math.max(...sorted.map(landedAt))) : null)) : all ? new Date(Math.max(...sorted.map(landedAt))) : null;
  const ev = kids.length
    ? await db
        .select({ taskId: results.taskId, kind: results.kind, cite: results.cite, commit: results.commit, env: results.env, at: results.createdAt })
        .from(results)
        .where(and(inArray(results.taskId, kids.map((k) => k.id)), eq(results.verdict, "pass")))
        .orderBy(desc(results.createdAt))
        .limit(4)
    : [];
  const keyOfId = new Map(kids.map((k) => [k.id, k.key]));
  const [idea] = await db.select().from(tasks).where(and(eq(tasks.projectId, init.projectId), eq(tasks.kind, "idea"), eq(tasks.promotedTo, init.key))).limit(1);
  const tiempo = await cronometroFor(db, init, sorted, idea?.createdAt ?? null);
  // PLA-I74-1: «Constrúyelo» is the newest order on the idea; building ends when the last step landed.
  const [ordered] = idea
    ? await db.select({ at: events.createdAt }).from(events).where(and(eq(events.taskId, idea.id), eq(events.type, CONSTRUIR_EVENT))).orderBy(desc(events.id)).limit(1)
    : [];
  const marks: ReportMarks = { ...stopMarks, lista: ordered?.at ?? stopMarks.lista ?? null, construccion: tiempo.end ? new Date(tiempo.end) : null, publicado: published };
  const informe = await runReportFor(db, init, sorted, idea ?? null, marks, published);
  return {
    key: init.key,
    title: init.title,
    status: init.status,
    version: init.version,
    done,
    total: sorted.length,
    can_close: sorted.length > 0 && closed === sorted.length && init.status !== "Done",
    steps,
    prs: sorted.flatMap((k) => prRows.filter((r) => r.taskId === k.id).map((r) => ({ number: r.number, state: r.state, url: r.url, key: k.key }))),
    published_at: published ? published.toISOString() : null,
    evidence: ev.map((r) => ({ key: keyOfId.get(r.taskId) ?? "", kind: r.kind, cite: r.cite, commit: r.commit, env: r.env, at: r.at.toISOString() })),
    tiempo,
    deploy: published ? null : await deployCardOf(db, p.id, sorted),
    informe,
  };
}

/** The short name: the idea's summary, else the first words of its title. */
export function shortOf(summary: string | null | undefined, title: string): string {
  const s = (summary ?? "").trim();
  if (s && s.length <= 80) return s;
  const words = (s || title).replace(/\s+/g, " ").trim().split(" ");
  const out = words.slice(0, 7).join(" ");
  return words.length > 7 ? `${out.replace(/[.,;:]$/, "")}…` : out;
}

const oneLine = (s: string | null | undefined, n = 90) => {
  const x = clean((s ?? "").replace(/[#>]/g, " "));
  if (!x) return null;
  return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x;
};

/** One or two lines per stop, from what that stop delivered; null when it has nothing (never the doc's title). */
export function gistOf(d: Pick<IdeaDetail, "text" | "understood" | "understood_text" | "research" | "frames" | "plan_steps" | "ficha" | "stage" | "promoted_to" | "stops">): Record<PedidoStop, string | null> {
  const has = (s: PedidoStop) => d.stops.find((x) => x.stop === s)?.delivered ?? false;
  const rec = d.research.recommendation;
  const n = rec ? Number(/(?:opci[oó]n|option)\s*(\d+)/i.exec(rec)?.[1] ?? NaN) : NaN;
  const recOption = d.research.options.find((o) => o.n === n) ?? (rec ? null : (d.research.options[0] ?? null));
  const nf = d.frames.length;
  const size = oneLine(d.ficha.tamano, 40);
  return {
    buzon: oneLine(d.text, 80),
    entendido: has("entendido") ? oneLine((d.understood_text ?? d.understood)?.replace(UNDERSTOOD_MARK, "")) : null,
    investigacion: has("investigacion") ? (recOption ? iw().recommends(recOption.title) : oneLine(rec)) : null,
    diseno: has("diseno") && nf ? iw().frames(nf) : null,
    plan: has("plan") && d.plan_steps.length ? `${iw().steps(d.plan_steps.length)}${size ? ` · ${size.replace(/\.$/, "").toLowerCase()}` : ""}` : null,
    lista: d.promoted_to ? iw().onBoard(d.promoted_to) : d.stage === "ready" ? iw().readyToBuild : null,
  };
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

// lite: without built (the lists count unseen deliveries over every idea; the board read is not needed there).
export async function ideaDetail(db: Db, slug: string, key: string, opts: { lite?: boolean } = {}): Promise<IdeaDetail | Refusal> {
  const found = await thingOf(db, slug, key);
  if ("error" in found) return found;
  const { project, t, init } = found;
  if (t.kind === "initiative") return initiativeAlone(db, slug, t, !opts.lite);
  const base = await pedidoOf(db, project.id, t);
  const list = await db.select().from(docs).where(eq(docs.taskId, t.id)).orderBy(desc(docs.updatedAt));
  const docOf = (title: string) => list.find((d) => d.title.toLowerCase() === title.toLowerCase()) ?? null;
  const evs = await db
    .select({ type: events.type, payload: events.payload, actor: events.actor, at: events.createdAt })
    .from(events)
    .where(and(eq(events.taskId, t.id), inArray(events.type, [VISTO, RESPUESTA, "frames.attached", "task.created", "note", ...DELIVERY_EVENTS])))
    .orderBy(events.id);
  // AUDIT-8: the stages delivered as data, and what he decided on the PO's questions.
  const stageData = deliveredOf(evs);
  const frames = await listFrames(db, slug, t.id, t.key);
  const framesAt = evs.findLast((e) => e.type === "frames.attached")?.at ?? null;
  const understood = evs.find((e) => e.type === "note" && isUnderstood(String((e.payload as { text?: string }).text ?? "")));
  const cache = new Map<string, string>();
  const here = PEDIDO_STOPS.indexOf(base.stop);
  const stops: IdeaStop[] = [];
  for (const [i, stop] of PEDIDO_STOPS.entries()) {
    const d = STOP_DOC[stop] ? docOf(STOP_DOC[stop]!) : null;
    let at: Date | null = d?.updatedAt ?? null;
    let by: string | null = d ? await whoOf(db, d.actor as Actor, cache) : null;
    if (stop === "buzon") {
      at = t.createdAt;
      by = t.origin === "owner" ? "owner" : null;
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
      data: STOP_DOC[stop] ? (stageData.stages[STOP_STAGE[stop] as keyof typeof stageData.stages] ?? null) : null,
    });
  }
  const research = docOf("Research")?.markdown ?? "";
  const plan = docOf("Plan")?.markdown ?? "";
  const rData = stageData.stages.research ?? null;
  const pData = stageData.stages.planning ?? null;
  const [q] = base.question ? await db.select({ options: questions.options }).from(questions).where(eq(questions.id, base.question.id)).limit(1) : [];
  const [inLine] = await db
    .select({ role: agentRuns.role })
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, project.id), eq(agentRuns.taskKey, t.key), eq(agentRuns.status, "queued")))
    .limit(1);
  const [lastEv] = await db.select({ at: events.createdAt }).from(events).where(and(eq(events.taskId, t.id), sql`${events.type} not in ('usage.reported', 'idea.visto')`)).orderBy(desc(events.id)).limit(1);
  const promoted = opts.lite ? null : init ?? (t.promotedTo ? ((await db.select().from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, t.promotedTo))).limit(1))[0] ?? null) : null);
  const out: Omit<IdeaDetail, "gist"> & { gist?: IdeaDetail["gist"] } = {
    ...base,
    summary: t.summary,
    text: askedText(t.scope, t.title, t.ownerWords),
    status: t.status,
    stage: t.stage,
    promoted_to: t.promotedTo,
    pedido: t.origin === "owner",
    question_options: q?.options ?? [],
    stops,
    ficha: fichaOf(list),
    ficha_po: fichaOf(list.filter((x) => x.title.toLowerCase() === "idea")),
    // AUDIT-8: from the data when the stage delivered it; else the Markdown, read as before.
    research: rData
      ? { recommendation: recommendationText(rData), options: rData.options.map((o, i) => ({ n: i + 1, title: o.title, text: o.text })), unknown: rData.unknowns, recommended: rData.recommendation.option + 1, learned: rData.learned }
      : {
          recommendation: sectionAll(research, "Recommendation", "Recomendación"),
          options: numbered(sectionAll(research, "Options", "Opciones")),
          unknown: bullets(sectionAll(research, "Unknown", "Desconocido", "Lo que no sabemos")),
          recommended: null,
          learned: [],
        },
    plan_steps: pData ? pData.steps.map((s) => s.title) : bullets(sectionAll(plan, "Steps", "Pasos")),
    plan: pData ? { steps: pData.steps, risks: pData.risks, size: pData.size } : null,
    decisions: decisionStates(stageData.stages.idea?.decisions ?? [], stageData.picks).map(decisionView),
    frames,
    unseen: stops.filter((s) => s.delivered && !s.seen && s.stop !== "buzon").length,
    quiet_since: base.state === "quieta" && !inLine && t.status === "Open" && !t.promotedTo ? (lastEv?.at.toISOString() ?? null) : null,
    queued: inLine?.role ?? null,
    trail: await trailOf(db, t),
    pictures: t.origin === "owner" ? (await listTaskImages(db, slug, t.key)).map((i) => ({ id: i.id, url: i.url, at: i.created_at })) : [],
    kind: init ? "initiative" : "idea",
    short: shortOf(t.summary, t.title),
    understood_text: ((): string | null => {
      const last = evs.findLast((e) => e.type === "note" && isUnderstood(String((e.payload as { text?: string }).text ?? "")));
      const text = last ? String((last.payload as { text?: string }).text ?? "").replace(UNDERSTOOD_MARK, "").trim() : "";
      return text || null;
    })(),
    built: promoted?.kind === "initiative" ? await builtOf(db, slug, promoted, marksOf(stops)) : null,
  };
  return { ...out, gist: gistOf(out) };
}

// An initiative no idea points at: empty stops (nothing delivered there) and its built.
async function initiativeAlone(db: Db, slug: string, t: Task, withBuilt: boolean): Promise<IdeaDetail> {
  const empty = Object.fromEntries(PEDIDO_STOPS.map((s) => [s, null])) as Record<PedidoStop, string | null>;
  return {
    key: t.key,
    title: t.title,
    stop: "lista",
    state: "quieta",
    who: "product-owner",
    images: 0,
    understood: null,
    question: null,
    guardada: false,
    at: t.createdAt.toISOString(),
    unseen_stop: null,
    summary: t.summary,
    text: t.title,
    status: t.status,
    stage: null,
    promoted_to: t.key,
    pedido: false,
    question_options: [],
    stops: PEDIDO_STOPS.map((stop) => ({ stop, state: "done" as const, by: null, at: null, delivered: false, doc: null, data: null, seen: true, answer: null })),
    ficha: { problema: null, tamano: null, solucion: null, riesgos: null, fuera: null },
    ficha_po: { problema: null, tamano: null, solucion: null, riesgos: null, fuera: null },
    research: { recommendation: null, options: [], unknown: [], recommended: null, learned: [] },
    // AUDIT-8: an initiative read on its own has no stage data.
    plan: null,
    decisions: [],
    plan_steps: [],
    frames: [],
    unseen: 0,
    quiet_since: null,
    queued: null,
    trail: [],
    pictures: [],
    kind: "initiative",
    short: shortOf(t.summary, t.title),
    understood_text: null,
    gist: empty,
    built: withBuilt ? await builtOf(db, slug, t) : null,
  };
}

// PLA-I74-1: when each of the idea's stops was reached, for the run report's time per stop.
const marksOf = (stops: IdeaStop[]): ReportMarks => Object.fromEntries(stops.filter((s) => s.stop !== "lista" && s.delivered && s.at).map((s) => [s.stop, new Date(s.at!)]));

const decisionView = (s: DecisionState, i: number): IdeaDecisionView => ({ n: i + 1, question: s.question, options: s.options, recommended: s.recommended + 1, why: s.why, state: s.state, chosen: s.chosen + 1, at: s.at ? s.at.toISOString() : null });

// How many delivered stops he has not opened, per idea (the Ideas list, the tube and the Diseño tab).
export async function unseenByIdea(db: Db, slug: string, keys: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const d = await ideaDetail(db, slug, key, { lite: true });
    if (!("error" in d)) out[key] = d.unseen;
  }
  return out;
}

const writable = (t: Task): Refusal | null =>
  t.status !== "Open" ? { error: "IDEA_CLOSED", status: 409, hint: iw().closed } : t.promotedTo ? { error: "IDEA_PROMOTED", status: 409, hint: iw().promoted(t.promotedTo) } : null;

export async function ideaVisto(db: Db, slug: string, key: string, stop: string): Promise<{ key: string; stop: string } | Refusal> {
  const found = await anyIdea(db, slug, key);
  if ("error" in found) return found;
  if (!(PEDIDO_STOPS as readonly string[]).includes(stop)) return { error: "INVALID_STOP", status: 400, hint: iw().noStop };
  const p = await findProject(db, slug);
  await writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (_tx, emit) => emit(VISTO, { id: found.t.id, key: found.t.key }, { stop }));
  return { key, stop };
}

type AnswerInput = { stop: string; verdict: IdeaVerdict; text?: string; option?: number; notes?: IdeaNote[] };

// The note the stage owner reads: his words, the option, each pinned note with its frame and spot.
export function answerNote(stop: string, input: AnswerInput, frames: { frame: string; name: string }[]): string {
  const w = iw();
  const head = { cambios: () => w.headChanges(w.stop[stop] ?? stop), opcion: () => w.headOption(input.option), corregir: () => w.headCorrect() }[input.verdict as "cambios" | "opcion" | "corregir"]();
  const lines = [head];
  if (input.text?.trim()) lines.push(w.words(input.text.trim()));
  (input.notes ?? []).forEach((n, i) => {
    const f = frames.find((x) => x.frame === n.frame);
    lines.push(w.pin(i + 1, n.frame, f ? f.name : null, Math.round(n.x), Math.round(n.y), n.text.trim()));
  });
  lines.push(w.redo);
  return lines.join("\n").slice(0, 3800);
}

export async function ideaRespuesta(db: Db, slug: string, key: string, input: AnswerInput): Promise<{ key: string; stage: string | null; wake: "queued" | "busy" | "off" | "none" } | Refusal> {
  const found = await anyIdea(db, slug, key);
  if ("error" in found) return found;
  const { t } = found;
  const no = writable(t);
  if (no) return no;
  const stop = input.stop as PedidoStop;
  if (!ANSWERABLE.includes(stop)) return { error: "INVALID_STOP", status: 400, hint: iw().notAnswerable };
  const detail = await ideaDetail(db, slug, key, { lite: true });
  if ("error" in detail) return detail;
  const s = detail.stops.find((x) => x.stop === stop)!;
  if (!s.delivered) return { error: "NOTHING_TO_ANSWER", status: 409, hint: iw().nothingYet };
  const v = input.verdict;
  if (v === "opcion" && (stop !== "investigacion" || !detail.research.options.some((o) => o.n === input.option))) return { error: "INVALID_OPTION", status: 400, hint: iw().noOption };
  if (v === "corregir" && stop !== "entendido") return { error: "INVALID_VERDICT", status: 400, hint: iw().correctPo };
  if ((v === "cambios" || v === "corregir" || v === "opcion") && !input.text?.trim() && !(input.notes ?? []).some((n) => n.text.trim()) && v !== "opcion")
    return { error: "EMPTY_ANSWER", status: 400, hint: iw().emptyAnswer };
  if (v === "deshacer" && s.answer?.verdict !== "ok") return { error: "NOTHING_TO_UNDO", status: 409, hint: iw().undoLike };
  const notes = (input.notes ?? []).filter((n) => n.text.trim()).map((n) => ({ frame: n.frame, x: Math.max(0, Math.min(100, n.x)), y: Math.max(0, Math.min(100, n.y)), text: n.text.trim().slice(0, 600) }));
  const p = await findProject(db, slug);
  const ref = { id: t.id, key: t.key };
  const payload = { stop, verdict: v, ...(input.text?.trim() ? { text: input.text.trim().slice(0, 1000) } : {}), ...(v === "opcion" ? { option: input.option } : {}), ...(notes.length ? { notes } : {}) };
  if (v === "ok" || v === "deshacer") {
    await writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (_tx, emit) => emit(RESPUESTA, ref, payload));
    return { key, stage: t.stage, wake: "none" };
  }
  const text = answerNote(stop, { ...input, notes }, detail.frames);
  return writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (tx, emit) => {
    await emit(RESPUESTA, ref, payload);
    await emit("note", ref, { text, kind: "answer" });
    return { key, ...(await sendBack(db, tx, emit, p, t, STOP_STAGE[stop], iw().answeredReason(iw().stop[stop]!), RESPUESTA)) };
  });
}

// Back to a stage in one move (the stage hook wakes Research or Artist); the PO is woken here. An idea already on
// that stage (or before it) does not move, and its owner is woken all the same.
async function sendBack(db: Db, tx: Q, emit: Emit, p: Awaited<ReturnType<typeof findProject>>, t: Task, target: string, reason: string, fromEvent: string): Promise<{ stage: string | null; wake: "queued" | "busy" | "off" }> {
  const ref = { id: t.id, key: t.key };
  const from = t.stage ?? "idea";
  const back = STAGE_ORDER.indexOf(target) < STAGE_ORDER.indexOf(from);
  if (back) {
    await tx.update(tasks).set({ stage: target, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` }).where(eq(tasks.id, t.id));
    await emit("task.updated", ref, { changes: { stage: [from, target] } });
  }
  const role = STAGE_ROLE[target]!;
  if (!eventWakesEnabled()) return { stage: back ? target : t.stage, wake: "off" };
  if (back && (role === "research" || role === "artist")) return { stage: target, wake: "queued" };
  const agent = role === "product-owner" ? ((await projectPo(db, p)) ?? (await serviceAgent(tx, role, p))) : await serviceAgent(tx, role, p);
  const w = await queueWake(tx, p, ref, { agent, taskKey: t.key, reason }, fromEvent);
  return { stage: back ? target : t.stage, wake: w.kind === "queued" ? "queued" : "busy" };
}

// ---- AUDIT-8: the owner's pick on one of the PO's decisions.
export type DecisionInput = { decision: number; option: number; question?: string; text?: string };
const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

// The note the PO reads: what he picked, over what, and his words.
// PLA-88: forward is the stage the idea sits on when it is past the idea stage: the decision is carried into that
// stage instead of sending the idea back to the PO.
export function decisionNote(question: string, label: string, was: string, changed: boolean, text?: string, forward?: string): string {
  const w = iw();
  const lines = [changed ? w.decided(label, question, was) : w.confirmed(label, question)];
  if (text?.trim()) lines.push(w.words(text.trim()));
  if (!changed) lines.push(w.nothingChanges);
  else if (forward) lines.push(w.forward(w.stage[forward] ?? forward));
  else lines.push(w.redoDeliver);
  return lines.join("\n");
}

// A pick is a change when it is not the option in force (the recommended one while assumed, his earlier pick after).
// On the idea stage a change wakes the PO to redo it. PLA-88: past it, the idea stays where it is and the owner of
// that stage is woken with the note to carry the decision forward; sending it back to Idea threw away Research's
// delivery and Artist's run for one line (guided test PLA-86, F-6). The doc keeps its author and its time: the delivery is still the PO's,
// and the stop does not read as new.
export async function ideaDecision(db: Db, slug: string, key: string, input: DecisionInput): Promise<{ key: string; stage: string | null; changed: boolean; decision: IdeaDecisionView; wake: "queued" | "busy" | "off" | "none" } | Refusal> {
  const found = await anyIdea(db, slug, key);
  if ("error" in found) return found;
  const { t } = found;
  const no = writable(t);
  if (no) return no;
  const delivered = await deliveredFor(db, t.id);
  const states = decisionStates(delivered.stages.idea?.decisions ?? [], delivered.picks);
  if (!states.length) return { error: "NO_DECISIONS", status: 409, hint: iw().noDecisions };
  const s = states[input.decision - 1];
  if (!s) return { error: "INVALID_DECISION", status: 400, hint: iw().noQuestion };
  if (input.question !== undefined && !sameText(input.question, s.question)) return { error: "DECISION_CHANGED", status: 409, hint: iw().questionsChanged };
  const pick = input.option - 1;
  const label = s.options[pick];
  if (label === undefined) return { error: "INVALID_OPTION", status: 400, hint: iw().noPick };
  if (s.state === "decided" && s.chosen === pick) return { error: "ALREADY_DECIDED", status: 409, hint: iw().alreadyPicked };
  const changed = pick !== s.chosen;
  const was = s.options[s.chosen]!;
  const words = input.text?.trim().slice(0, 1000) || undefined;
  const p = await findProject(db, slug);
  const ref = { id: t.id, key: t.key };
  return writeTx(db, p, { ...webCtx, tool: "company.idea" }, async (tx, emit) => {
    await emit(DECISION, ref, { stop: "entendido", stage: "idea", n: input.decision, question: s.question, option: input.option, label, was, recommended: s.options[s.recommended], changed, ...(words ? { text: words } : {}) });
    const [doc] = await tx.select({ id: docs.id, markdown: docs.markdown }).from(docs).where(and(eq(docs.taskId, t.id), eq(docs.title, "Idea"))).limit(1);
    if (doc) await tx.update(docs).set({ markdown: rewriteDecisionLine(doc.markdown, input.decision, s, pick), version: sql`${docs.version} + 1` }).where(eq(docs.id, doc.id));
    const at = t.stage ?? "idea";
    const forward = changed && at !== "idea" && STAGE_ORDER.includes(at) ? at : undefined;
    await emit("note", ref, { text: decisionNote(s.question, label, was, changed, words, forward), kind: "answer" });
    const decision = decisionView({ ...s, state: "decided", chosen: pick, at: new Date() }, input.decision - 1);
    if (!changed) return { key, stage: t.stage, changed, decision, wake: "none" as const };
    if (forward) return { key, changed, decision, ...(await sendBack(db, tx, emit, p, t, forward, iw().changedReason(iw().stage[forward]!), DECISION)) };
    return { key, changed, decision, ...(await sendBack(db, tx, emit, p, t, "idea", iw().otherReason(), DECISION)) };
  });
}

// The route, kept here so company.ts only mounts it (`companyRoutes.route("/", ideaDecisionRoutes)`). It checks the
// owner's session itself, as companyRoutes does, so it is screen-only wherever it is mounted.
const DecisionBody = z.object({ decision: z.number().int().min(1).max(6), option: z.number().int().min(1).max(4), question: z.string().max(300).optional(), text: z.string().trim().max(1000).optional() }).strict();
export const ideaDecisionRoutes = new Hono();
ideaDecisionRoutes.post("/projects/:slug/ideas/:key/decision", async (c) => {
  if (/^\s*bearer\b/i.test(c.req.header("Authorization") ?? "")) return c.json({ error: "FORBIDDEN", hint: "a decision on an idea is the owner's screen only" }, 403);
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "UNAUTHORIZED" }, 401);
  if (!c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  const input = DecisionBody.safeParse(await c.req.json().catch(() => undefined));
  if (!input.success) return c.json({ error: "INVALID_BODY" }, 400);
  const out = await withDb((db) => ideaDecision(db, c.req.param("slug"), c.req.param("key"), input.data));
  if ("error" in out) {
    const { status, ...rest } = out;
    return c.json(rest, status);
  }
  return c.json(out);
});

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
    const w = await queueWake(tx, p, ref, { agent, taskKey: key, reason: iw().wokeReason(t.stage ?? "idea") }, DESPERTAR);
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
