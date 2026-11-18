// AUDIT-8: an idea stage delivers data, not headings. `deliver_stage` takes the stage's fields, checks what they
// say (not only their shape), renders the stage doc with the headings forwardBlock already reads, stores it with the
// usual doc write and keeps the data in a `stage.delivered` event {stage, data, doc_version}. No table, no column.
//   idea      problem, who, why_now, decisions (0 to 6 closed questions, each with the option the PO recommends)
//   research  learned, options (2 to 4), recommendation {option, why}, unknowns
//   design    approach, scope, out_of_scope (at least one thing)
//   planning  steps (1 to 6: title, done_when, try_it, work_type), risks, size
// Every index in the data is 0-based (decisions[].recommended, recommendation.option), as propose's `suggested` is.
// A decision is an assumption until the owner picks on his screen (src/api/company-idea.ts, event `idea.decision`):
// the doc's Assumptions section carries one line per decision and that line is rewritten when he decides. His pick
// outlives a new delivery: it is matched by the question's words.
// attach_doc with the headings still works; a doc written that way after a delivery makes the stored data stale, and
// the reads fall back to parsing the Markdown (deliveredOf).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { docs, events } from "../db/schema.js";
import { docSummary, putDoc } from "./docs.js";
import { ToolError } from "./errors.js";
import { STAGES, STAGE_DOCS, type Stage } from "./ideas.js";
import { findProject, requireTask } from "./queries.js";
import { writeTx, type Ctx, type Q } from "./tx.js";

export const DELIVERED = "stage.delivered";
export const DECISION = "idea.decision";
export const DELIVER_STAGES = ["idea", "research", "design", "planning"] as const;
export type DeliverStage = (typeof DELIVER_STAGES)[number];

export type StageDecision = { question: string; options: string[]; recommended: number; why: string };
export type IdeaData = { problem: string; who: string; why_now: string; decisions: StageDecision[] };
export type ResearchData = { learned: string[]; options: { title: string; text: string }[]; recommendation: { option: number; why: string }; unknowns: string[] };
export type DesignData = { approach: string; scope: string[]; out_of_scope: string[] };
export type PlanStep = { title: string; done_when: string; try_it: string; work_type: string };
export type PlanningData = { steps: PlanStep[]; risks: string[]; size: string | null };
export type StageDataMap = { idea: IdeaData; research: ResearchData; design: DesignData; planning: PlanningData };
export type StageData = StageDataMap[DeliverStage];

export const MAX_DECISIONS = 6;
export const MAX_STEPS = 6;
const STEP_TYPES = ["code", "ops", "research", "bug", "debt"];

export const isDeliverStage = (s: string): s is DeliverStage => (DELIVER_STAGES as readonly string[]).includes(s);

// ---- Shape. Everything is optional here on purpose: a field that is absent is reported with the content checks
// below (STAGE_REQUIREMENTS_MISSING names every one at once); zod only refuses what is malformed (INVALID_FILTER).
const text = (max: number) => z.string().max(max);
const list = (max: number, item = 400) => z.array(text(item)).max(max);
const SHAPES: Record<DeliverStage, z.ZodType> = {
  idea: z
    .object({
      problem: text(1500).optional(),
      who: text(600).optional(),
      why_now: text(600).optional(),
      decisions: z
        .array(z.object({ question: text(300).optional(), options: list(4, 120).optional(), recommended: z.number().int().min(0).max(3).optional(), why: text(400).optional() }).strict())
        .max(MAX_DECISIONS)
        .optional(),
    })
    .strict(),
  research: z
    .object({
      learned: list(12).optional(),
      options: z.array(z.object({ title: text(140).optional(), text: text(800).optional() }).strict()).max(4).optional(),
      recommendation: z.object({ option: z.number().int().min(0).max(3).optional(), why: text(800).optional() }).strict().optional(),
      unknowns: list(12).optional(),
    })
    .strict(),
  design: z.object({ approach: text(2000).optional(), scope: list(12).optional(), out_of_scope: list(12).optional() }).strict(),
  planning: z
    .object({
      steps: z
        .array(z.object({ title: text(200).optional(), done_when: text(300).optional(), try_it: text(300).optional(), work_type: z.string().max(20).optional() }).strict())
        .max(MAX_STEPS)
        .optional(),
      risks: list(12).optional(),
      size: text(200).optional(),
    })
    .strict(),
};

const SHAPE_HINT: Record<DeliverStage, string> = {
  idea: "data is {problem, who, why_now, decisions: [{question, options: [2 to 4 short labels], recommended: 0-based index, why}]} with 0 to 6 decisions",
  research: "data is {learned: [..], options: [{title, text}] (2 to 4), recommendation: {option: 0-based index, why}, unknowns: [..]}",
  design: "data is {approach, scope: [..], out_of_scope: [at least one thing]}",
  planning: "data is {steps: [{title, done_when, try_it, work_type?}] (1 to 6), risks: [..], size?}",
};

// ---- Content.
const tidy = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
// Several lines of prose: kept as written, except a line that would read as a heading (the stage headings are how
// forwardBlock and the screen find each section).
const para = (s: string | undefined) =>
  (s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^([ \t]*)(#{1,6})(?=[ \t])/gm, "$1\\$2")
    .trim();
const words = (s: string) => tidy(s).split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const PLACEHOLDER = /^(?:tbd|tba|todo|to do|to be (?:defined|decided|determined)|n\/?a|none|nothing|ninguno|ninguna|nada|pendiente|por definir|por hacer|por decidir|sin definir|placeholder|lorem ipsum.*|wip|same|idem|ídem|x+|\?+|\.+|…+|-+|_+)[.!]?$/i;
/** Nothing was said: empty, no letter in it, or a filler word. */
export const isPlaceholder = (s: string | undefined): boolean => {
  const t = tidy(s);
  return !t || !/\p{L}/u.test(t) || PLACEHOLDER.test(t);
};
const thin = (s: string | undefined, min: number) => isPlaceholder(s) || words(s ?? "") < min;

const VAGUE_DONE =
  /^(?:(?:it|this|that|everything|all|esto|eso|todo|ya|que|cuando|when)\s+)*(?:works?(?: well| fine| correctly| as expected)?|funciona(?: bien| correctamente)?|is (?:done|ready|finished|complete|completed|implemented|working)|done|ready|finished|completed?|implemented|est[aá] (?:listo|lista|hecho|hecha|terminado|terminada|completo|completa|implementado|implementada)|listo|hecho|terminado|implementado|se (?:termina|implementa|completa)|queda (?:listo|hecho))[.!]?$/i;
/** A `done_when` someone can check by looking: more than a filler, more than «it works», not the title again. */
export function isObservable(doneWhen: string | undefined, title = ""): boolean {
  const t = tidy(doneWhen);
  if (thin(t, 4) || VAGUE_DONE.test(t)) return false;
  const same = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return same(t) !== same(title);
}

const HINTS = {
  prose: "say it in a sentence of your own (no TBD, n/a or a single word)",
  item: "one real line per item (no TBD, n/a, none)",
  done: "state what someone can see or check once it lands, e.g. «the list shows the three filters» or «POST /x returns 200 with the row»; not «it works» and not the title again",
  try: "say what someone can try once this step lands: where to go and what to do there, in a sentence",
  out: "name at least one thing this idea will not do; «nothing» is not an answer",
};

type Missing = { field: string; hint: string };
const same = (a: string, b: string) => tidy(a).toLowerCase() === tidy(b).toLowerCase();

function malformed(stage: DeliverStage, field: string, hint: string): ToolError {
  return new ToolError("INVALID_FILTER", { field, hint, stage, shape: SHAPE_HINT[stage] });
}

function checkIdea(raw: Partial<IdeaData>, miss: (field: string, hint: string) => void): IdeaData {
  if (thin(raw.problem, 3)) miss("problem", HINTS.prose);
  if (isPlaceholder(raw.who)) miss("who", "name who has the problem");
  if (thin(raw.why_now, 3)) miss("why_now", HINTS.prose);
  const decisions = (raw.decisions ?? []).map((d, i) => {
    const at = `decisions[${i}]`;
    const options = (d.options ?? []).map(tidy);
    if (thin(d.question, 3)) miss(`${at}.question`, "a closed question the owner can answer by picking one option");
    if (options.length < 2 || options.some((o) => !o)) miss(`${at}.options`, "2 to 4 short labels, none empty");
    else if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw malformed("idea", `${at}.options`, "the options repeat: each label once");
    if (d.recommended === undefined) miss(`${at}.recommended`, "the 0-based index of the option you recommend: it applies unless the owner changes it");
    else if (options.length >= 2 && d.recommended >= options.length) throw malformed("idea", `${at}.recommended`, `0-based index of one of its ${options.length} options`);
    if (thin(d.why, 3)) miss(`${at}.why`, "why you recommend that option, in a sentence");
    return { question: tidy(d.question).replace(/\*/g, ""), options, recommended: d.recommended ?? 0, why: tidy(d.why) };
  });
  const questions = decisions.map((d) => d.question.toLowerCase());
  const twice = questions.findIndex((q, i) => q && questions.indexOf(q) !== i);
  if (twice >= 0) throw malformed("idea", `decisions[${twice}].question`, "the same question twice: ask it once");
  return { problem: para(raw.problem), who: para(raw.who), why_now: para(raw.why_now), decisions };
}

function checkResearch(raw: Partial<ResearchData>, miss: (field: string, hint: string) => void): ResearchData {
  const items = (field: "learned" | "unknowns", need: boolean) => {
    const out = (raw[field] ?? []).map(tidy);
    if (need && !out.length) miss(field, "at least one thing you found out");
    out.forEach((x, i) => isPlaceholder(x) && miss(`${field}[${i}]`, HINTS.item));
    return out;
  };
  const learned = items("learned", true);
  const options = (raw.options ?? []).map((o, i) => {
    if (isPlaceholder(o.title)) miss(`options[${i}].title`, "a short name for the option");
    if (thin(o.text, 3)) miss(`options[${i}].text`, "what the option is and what it costs, in a sentence or two");
    return { title: tidy(o.title).replace(/\*/g, "").replace(/[.:]+$/, ""), text: tidy(o.text) };
  });
  if (options.length < 2) miss("options", "2 to 4 options, each {title, text}");
  const rec = raw.recommendation ?? ({} as Partial<ResearchData["recommendation"]>);
  if (rec.option === undefined) miss("recommendation.option", "the 0-based index of the option you recommend");
  else if (options.length >= 2 && rec.option >= options.length) throw malformed("research", "recommendation.option", `0-based index of one of the ${options.length} options`);
  if (thin(rec.why, 3)) miss("recommendation.why", "why that option, in a sentence");
  return { learned, options, recommendation: { option: rec.option ?? 0, why: para(rec.why) }, unknowns: items("unknowns", false) };
}

function checkDesign(raw: Partial<DesignData>, miss: (field: string, hint: string) => void): DesignData {
  if (thin(raw.approach, 3)) miss("approach", HINTS.prose);
  const scope = (raw.scope ?? []).map(tidy);
  if (!scope.length) miss("scope", "at least one thing this idea does");
  scope.forEach((x, i) => isPlaceholder(x) && miss(`scope[${i}]`, HINTS.item));
  const out = (raw.out_of_scope ?? []).map(tidy);
  if (!out.length) miss("out_of_scope", HINTS.out);
  out.forEach((x, i) => isPlaceholder(x) && miss(`out_of_scope[${i}]`, HINTS.out));
  return { approach: para(raw.approach), scope, out_of_scope: out };
}

function checkPlanning(raw: Partial<PlanningData>, miss: (field: string, hint: string) => void): PlanningData {
  const steps = (raw.steps ?? []).map((s, i) => {
    const at = `steps[${i}]`;
    const title = tidy(s.title).replace(/\*/g, "").replace(/[.:]+$/, "");
    if (isPlaceholder(title)) miss(`${at}.title`, "a short name for the step");
    if (!isObservable(s.done_when, title)) miss(`${at}.done_when`, HINTS.done);
    if (thin(s.try_it, 3) || same(s.try_it ?? "", title)) miss(`${at}.try_it`, HINTS.try);
    const work_type = s.work_type ?? "code";
    if (!STEP_TYPES.includes(work_type)) throw malformed("planning", `${at}.work_type`, `one of ${STEP_TYPES.join(", ")}`);
    return { title, done_when: tidy(s.done_when), try_it: tidy(s.try_it), work_type };
  });
  if (!steps.length) miss("steps", `1 to ${MAX_STEPS} steps, each {title, done_when, try_it}`);
  const risks = (raw.risks ?? []).map(tidy);
  if (!risks.length) miss("risks", "at least one thing that could go wrong");
  risks.forEach((x, i) => isPlaceholder(x) && miss(`risks[${i}]`, HINTS.item));
  return { steps, risks, size: tidy(raw.size ?? undefined) || null };
}

/** The stage's data, trimmed, or a refusal that names every field to fix. */
export function checkStageData<S extends DeliverStage>(stage: S, raw: unknown): StageDataMap[S] {
  const parsed = SHAPES[stage].safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const unknown = issue.code === "unrecognized_keys" ? (issue as { keys?: string[] }).keys?.[0] : undefined;
    const path = [...issue.path.map(String), ...(unknown ? [unknown] : [])];
    const field = path.reduce((acc, part) => (/^\d+$/.test(part) ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part), "") || "data";
    throw malformed(stage, field, unknown ? "not a field of this stage" : issue.message);
  }
  const missing: Missing[] = [];
  const miss = (field: string, hint: string) => void missing.push({ field, hint });
  const value = parsed.data as never;
  const data = stage === "idea" ? checkIdea(value, miss) : stage === "research" ? checkResearch(value, miss) : stage === "design" ? checkDesign(value, miss) : checkPlanning(value, miss);
  if (missing.length) {
    throw new ToolError("STAGE_REQUIREMENTS_MISSING", {
      stage,
      doc: STAGE_DOCS[stage].doc,
      missing: missing.map((m) => m.field),
      fix: Object.fromEntries(missing.map((m) => [m.field, m.hint])),
      hint: `fill ${missing.map((m) => m.field).join(", ")} and call deliver_stage again with the whole data; nothing was stored`,
    });
  }
  return data as StageDataMap[S];
}

// ---- The owner's picks.
export type DecisionPick = { question: string; label: string; at: Date | null };
export type DecisionState = StageDecision & { state: "assumed" | "decided"; chosen: number; at: Date | null };

/** Each decision with the option in force: his latest pick when the question and that label are still there, else the recommended one. */
export function decisionStates(decisions: StageDecision[], picks: DecisionPick[]): DecisionState[] {
  return decisions.map((d) => {
    const mine = picks.findLast((p) => same(p.question, d.question) && d.options.some((o) => same(o, p.label)));
    if (!mine) return { ...d, state: "assumed" as const, chosen: d.recommended, at: null };
    return { ...d, state: "decided" as const, chosen: d.options.findIndex((o) => same(o, mine.label)), at: mine.at };
  });
}

// ---- The doc. Headings as STAGE_DOCS names them; fixed words in Spanish, which is what the owner reads.
const q = (s: string) => `«${s}»`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const ASSUMPTIONS = "Assumptions";

/** One line of the Assumptions section. It starts with the number and the question in bold, which is how it is found again. */
export function decisionLine(n: number, d: StageDecision, chosen: number | null = null): string {
  const head = `${n}. **${d.question}**`;
  const rec = d.options[d.recommended]!;
  if (chosen === null) {
    const others = d.options.filter((_, i) => i !== d.recommended).map(q);
    return `${head} Se asume ${q(rec)} hasta que Jorge decida: ${d.why} Otras opciones: ${others.join(", ")}.`;
  }
  return `${head} Decidido por Jorge: ${q(d.options[chosen]!)}.${chosen === d.recommended ? "" : ` El PO recomendaba ${q(rec)}.`}`;
}

/** The doc with that decision's line as decided. A doc someone rewrote by hand gets the line added under Assumptions. */
export function rewriteDecisionLine(markdown: string, n: number, d: StageDecision, chosen: number): string {
  const line = decisionLine(n, d, chosen);
  const at = new RegExp(`^[ \\t]*\\d+[.)][ \\t]+\\*\\*${esc(d.question)}\\*\\*.*$`, "m");
  if (at.test(markdown)) return markdown.replace(at, () => line);
  const heading = new RegExp(`^#{1,6}[ \\t]+${ASSUMPTIONS}[ \\t]*$`, "im").exec(markdown);
  if (!heading) return `${markdown.trimEnd()}\n\n## ${ASSUMPTIONS}\n\n${line}\n`;
  const start = heading.index + heading[0].length;
  const next = /^#{1,6}[ \t]+\S/m.exec(markdown.slice(start));
  const end = next ? start + next.index : markdown.length;
  return `${markdown.slice(0, end).trimEnd()}\n${line}\n${next ? `\n${markdown.slice(end)}` : ""}`;
}

/** Research's recommendation as one Markdown line: the option's number (as the screen counts them) and why. */
export const recommendationText = (d: ResearchData) => `**Opción ${d.recommendation.option + 1}: ${d.options[d.recommendation.option]!.title}.** ${d.recommendation.why}`;

const bullets = (items: string[]) => items.map((x) => `- ${x}`).join("\n");
const numbered = (items: string[]) => items.map((x, i) => `${i + 1}. ${x}`).join("\n");
const sections = (parts: [string, string][]) => `${parts.map(([h, body]) => `## ${h}\n\n${body}`).join("\n\n")}\n`;

/** The stage doc. It passes forwardBlock, and the readers that parse Markdown find what they found before. */
export function renderStageDoc<S extends DeliverStage>(stage: S, data: StageDataMap[S], picks: DecisionPick[] = []): string {
  if (stage === "idea") {
    const d = data as IdeaData;
    const states = decisionStates(d.decisions, picks);
    const parts: [string, string][] = [
      ["Problem", d.problem],
      ["Who it is for", d.who],
      ["Why now", d.why_now],
    ];
    if (states.length) parts.push([ASSUMPTIONS, states.map((s, i) => decisionLine(i + 1, s, s.state === "decided" ? s.chosen : null)).join("\n")]);
    return sections(parts);
  }
  if (stage === "research") {
    const d = data as ResearchData;
    const parts: [string, string][] = [
      ["What we learned", bullets(d.learned)],
      ["Options", numbered(d.options.map((o) => `**${o.title}.** ${o.text}`))],
      ["Recommendation", recommendationText(d)],
    ];
    if (d.unknowns.length) parts.push(["Unknown", bullets(d.unknowns)]);
    return sections(parts);
  }
  if (stage === "design") {
    const d = data as DesignData;
    return sections([
      ["Approach", d.approach],
      ["Scope", bullets(d.scope)],
      ["Out of scope", bullets(d.out_of_scope)],
    ]);
  }
  const d = data as PlanningData;
  const parts: [string, string][] = [
    ["Steps", numbered(d.steps.map((s) => s.title))],
    ["Done when", numbered(d.steps.map((s) => s.done_when))],
    ["Try it", numbered(d.steps.map((s) => s.try_it))],
    ["Risks", bullets(d.risks)],
  ];
  if (d.size) parts.push(["Tamaño", d.size]);
  return sections(parts);
}

// ---- Reads.
const DOC_STAGE = Object.fromEntries(DELIVER_STAGES.map((s) => [STAGE_DOCS[s].doc, s])) as Record<string, DeliverStage>;
export const DELIVERY_EVENTS = [DELIVERED, DECISION, "doc.put"];

/** What an idea's events say was delivered as data, oldest first. A doc written by hand after a delivery drops that stage's data. */
export function deliveredOf(evs: { type: string; payload: unknown; at?: Date }[]): { stages: Partial<StageDataMap>; picks: DecisionPick[] } {
  const stages: Partial<Record<DeliverStage, StageData>> = {};
  const picks: DecisionPick[] = [];
  for (const e of evs) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    // deliver_stage writes the doc first and the data after it, so its own doc.put is always the older of the two.
    if (e.type === "doc.put" && DOC_STAGE[String(p.title)]) delete stages[DOC_STAGE[String(p.title)]!];
    else if (e.type === DELIVERED && isDeliverStage(String(p.stage)) && p.data && typeof p.data === "object") stages[p.stage as DeliverStage] = p.data as StageData;
    else if (e.type === DECISION && typeof p.question === "string" && typeof p.label === "string") picks.push({ question: p.question, label: p.label, at: e.at ?? null });
  }
  return { stages: stages as Partial<StageDataMap>, picks };
}

export async function deliveredFor(db: Q, taskId: string) {
  const evs = await db
    .select({ type: events.type, payload: events.payload, at: events.createdAt })
    .from(events)
    .where(and(eq(events.taskId, taskId), inArray(events.type, DELIVERY_EVENTS)))
    .orderBy(asc(events.id));
  return deliveredOf(evs);
}

// ---- The write.
export type DeliverStageInput = { project: string; key: string; stage: string; data: unknown };

export async function deliverStage(db: Db, input: DeliverStageInput, ctx: Ctx) {
  const stage = input.stage;
  if (!isDeliverStage(stage)) throw new ToolError("INVALID_FILTER", { field: "stage", hint: `one of ${DELIVER_STAGES.join(", ")} (ready delivers nothing)` });
  const data = checkStageData(stage, input.data);
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    if (t.kind !== "idea") throw new ToolError("FIELD_NOT_ALLOWED", { field: "stage", kind: t.kind, hint: "deliver_stage is for an idea (PREFIX-IDEA<n>)" });
    if (t.status === "Done" || t.status === "Won't do") throw new ToolError("IDEA_CLOSED", { status: t.status });
    const title = STAGE_DOCS[stage].doc;
    // What the owner already decided stays decided in the new doc.
    const picks = stage === "idea" ? (await deliveredFor(tx, t.id)).picks : [];
    const [existing] = await tx.select({ version: docs.version }).from(docs).where(and(eq(docs.taskId, t.id), eq(docs.title, title))).limit(1);
    const d = await putDoc(tx, emit, ctx, p.id, t, { title, markdown: renderStageDoc(stage, data, picks), version: existing?.version });
    await emit(DELIVERED, t, { stage, data, doc_version: d.version });
    const next = t.stage === stage ? STAGES[STAGES.indexOf(stage as Stage) + 1] : undefined;
    return { key: t.key, stage: t.stage, delivered: stage, doc: docSummary(d), ...(next ? { next: `set_task {key: "${t.key}", stage: "${next}", version: ${t.version}} moves it on` } : {}) };
  });
}

type ActorIn = { agent?: string; session_id: string; machine?: string; model?: string };
type WriteCtx = (tool: string, input: { actor: ActorIn; request_id?: string; verbose?: boolean }, identity: Identity | undefined) => Ctx;

export const registerStageTools = (
  server: McpServer,
  host: { db: Db; identity: Identity | undefined; writeCtx: WriteCtx; actor: z.ZodType; request_id: z.ZodType; run: (fn: () => Promise<unknown>) => Promise<CallToolResult>; write: { readOnlyHint: false; destructiveHint: false; openWorldHint: false } },
): void => {
  const { db, identity, writeCtx, actor, request_id, run, write } = host;
  server.registerTool(
    "deliver_stage",
    {
      description: [
        "Deliver an idea's stage as data. Plania checks it, writes the stage doc for you (same title and headings as before, so do not also attach_doc it) and keeps the data for the owner's screen. Then move the idea with set_task stage.",
        "stage idea: data {problem, who, why_now, decisions}. decisions are the open questions you would otherwise ask (0 to 6): each {question, options (2 to 4 short labels), recommended (0-based index), why}. Nothing waits: your recommended option is assumed, the owner can change it on his screen, and a change sends the idea back to you with his note.",
        "stage research: data {learned: [..], options: [{title, text}] (2 to 4), recommendation: {option (0-based index), why}, unknowns: [..] (may be empty)}.",
        "stage design: data {approach, scope: [..], out_of_scope: [at least one thing it will not do]}.",
        `stage planning: data {steps (1 to ${MAX_STEPS}): [{title, done_when, try_it, work_type code|ops|research|bug|debt}], risks: [..], size (optional, one line)}. done_when states something a person can see or check; try_it says what someone can try once that step lands.`,
        "Refusals store nothing: STAGE_REQUIREMENTS_MISSING lists every field to fix (missing) with how (fix): empty or filler text (TBD, n/a), a done_when that only says it works, no out_of_scope, a step without try_it. INVALID_FILTER names one malformed field. Send the whole data again; a new delivery replaces the doc.",
        "Plain words for the owner: no ticket keys or branch names in questions, labels or steps.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        project: z.string().min(1),
        key: z.string().min(1).max(40).describe("The idea's key"),
        stage: z.enum(DELIVER_STAGES),
        data: z.record(z.string(), z.unknown()).describe("The stage's fields, as the description lists them"),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const input = raw as DeliverStageInput & { actor: ActorIn; request_id?: string };
        return deliverStage(db, input, writeCtx("deliver_stage", input, identity));
      }),
  );
};
