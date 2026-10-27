import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { docs, events, questions, tasks } from "../db/schema.js";
import { ToolError } from "./errors.js";
import type { Q } from "./tx.js";

// An idea moves one stage at a time: idea → research → design → planning → ready.
// Leaving a stage (the forward move) needs that stage's doc, with the headings below as markdown
// headings, and — where a gate is named — the latest answer for that gate given after the idea
// entered this stage. Only pursue (A), proceed (B) and ready (C) move it on; drop, later and
// rework do not. A step back makes that answer stale, so the gate is asked again. A step back is
// one stage and needs a note. Skipping a stage is INVALID_STAGE_MOVE.

export const STAGES = ["idea", "research", "design", "planning", "ready"] as const;
export type Stage = (typeof STAGES)[number];

export const GATES = ["A", "B", "C"] as const;
export type Gate = (typeof GATES)[number];

// ask {gate} stores these and ignores options the caller sent.
export const GATE_OPTIONS: Record<Gate, readonly string[]> = {
  A: ["pursue", "drop", "later"],
  B: ["proceed", "rework", "drop"],
  C: ["ready", "rework", "drop"],
};

type StageDoc = { doc: string; headings: readonly string[]; gate: Gate | null };

export const STAGE_DOCS: Record<Exclude<Stage, "ready">, StageDoc> = {
  idea: { doc: "Idea", headings: ["Problem", "Who it is for", "Why now"], gate: "A" },
  research: { doc: "Research", headings: ["What we learned", "Options", "Recommendation"], gate: "B" },
  design: { doc: "Design", headings: ["Approach", "Scope", "Out of scope"], gate: null },
  planning: { doc: "Plan", headings: ["Steps", "Done when", "Risks"], gate: "C" },
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function hasHeading(markdown: string, heading: string): boolean {
  return new RegExp(`^#{1,6}[ \\t]+${esc(heading)}[ \\t]*$`, "im").test(markdown);
}

export function isStage(s: string): s is Stage {
  return (STAGES as readonly string[]).includes(s);
}

// "same" when the stage did not move. Throws INVALID_STAGE_MOVE otherwise, including a step back
// that came without a note.
export function assertStageMove(from: string | null, to: string, note?: string): "same" | "forward" | "back" {
  if (from === to) return "same";
  const i = from ? STAGES.indexOf(from as Stage) : -1;
  const j = STAGES.indexOf(to as Stage);
  const allowed = i >= 0 ? [STAGES[i - 1], STAGES[i + 1]].filter((s): s is Stage => !!s) : [];
  if (i < 0 || j < 0 || Math.abs(j - i) !== 1) throw new ToolError("INVALID_STAGE_MOVE", { from, to, allowed });
  if (j < i && !note?.trim()) throw new ToolError("INVALID_STAGE_MOVE", { from, to, allowed, hint: "a step back needs a note" });
  return j > i ? "forward" : "back";
}

export type StageDocRow = { title: string; markdown: string };
export type StageQuestion = {
  gate: string | null;
  question: string;
  answered: boolean;
  answer?: string | null;
  answeredAt?: Date | string | null;
};

// The option that moves the idea on. The others (drop, later, rework) leave the gate closed.
const ADVANCES: Record<Gate, string> = { A: "pursue", B: "proceed", C: "ready" };

// The latest answer for this gate given strictly after the idea entered the stage. Earlier answers,
// including one that advanced before a step back, do not count.
function gateAdvances(gate: Gate, qs: StageQuestion[], since: Date | null): boolean {
  let latest: StageQuestion | undefined;
  for (const q of qs) {
    if (q.gate !== gate || !q.answered || !q.answeredAt) continue;
    const at = new Date(q.answeredAt);
    if (Number.isNaN(at.getTime()) || (since && at <= since)) continue;
    if (!latest || at > new Date(latest.answeredAt!)) latest = q;
  }
  return !!latest && latest.answer === ADVANCES[gate];
}

// What a forward move still lacks. Null when the doc, its headings and an advancing gate answer are all there.
// `since` is when the idea entered `from`; null on the first visit, which has no stage-change event.
export function forwardBlock(
  from: string,
  doc: StageDocRow | undefined,
  questionsOnIt: StageQuestion[],
  since: Date | null = null,
): { code: "STAGE_REQUIREMENTS_MISSING"; doc: string; missing: string[] } | { code: "GATE_NOT_PASSED"; gate: Gate } | null {
  const req = STAGE_DOCS[from as Exclude<Stage, "ready">];
  if (!req) return null;
  if (!doc || doc.title !== req.doc) return { code: "STAGE_REQUIREMENTS_MISSING", doc: req.doc, missing: ["doc"] };
  const missing = req.headings.filter((h) => !hasHeading(doc.markdown, h));
  if (missing.length) return { code: "STAGE_REQUIREMENTS_MISSING", doc: req.doc, missing: [...missing] };
  if (req.gate && !gateAdvances(req.gate, questionsOnIt, since)) return { code: "GATE_NOT_PASSED", gate: req.gate };
  return null;
}

export function throwForwardBlock(from: string, to: string, block: NonNullable<ReturnType<typeof forwardBlock>>): never {
  if (block.code === "GATE_NOT_PASSED") throw new ToolError("GATE_NOT_PASSED", { from, to, gate: block.gate });
  throw new ToolError("STAGE_REQUIREMENTS_MISSING", { from, to, doc: block.doc, missing: block.missing });
}

// Shown on the project page. The stored headings and doc titles stay as written in the markdown.
const DOC_ES: Record<string, string> = { Idea: "Idea", Research: "Investigación", Design: "Diseño", Plan: "Plan" };
const HEADING_ES: Record<string, string> = {
  Problem: "Problema",
  "Who it is for": "Para quién es",
  "Why now": "Por qué ahora",
  "What we learned": "Qué aprendimos",
  Options: "Opciones",
  Recommendation: "Recomendación",
  Approach: "Enfoque",
  Scope: "Alcance",
  "Out of scope": "Fuera de alcance",
  Steps: "Pasos",
  "Done when": "Listo cuando",
  Risks: "Riesgos",
};

// One line for the project page: the open gate, else the open question, else the doc or headings
// still missing, else that it can move. `since` matches forwardBlock, so a stale gate stays a gate.
export function ideaWaitText(stage: string | null, docRows: StageDocRow[], qs: StageQuestion[], since: Date | null = null): string {
  const open = qs.filter((q) => !q.answered);
  const gate = open.find((q) => q.gate);
  if (gate?.gate) return `Puerta ${gate.gate}`;
  if (open[0]) return open[0].question;
  if (!stage || stage === "ready") return "Lista para promover";
  const req = STAGE_DOCS[stage as Exclude<Stage, "ready">];
  if (!req) return "Puede avanzar";
  const block = forwardBlock(stage, docRows.find((d) => d.title === req.doc), qs, since);
  if (!block) return "Puede avanzar";
  if (block.code === "GATE_NOT_PASSED") return `Puerta ${block.gate}`;
  if (block.missing.includes("doc")) return `Doc ${DOC_ES[block.doc] ?? block.doc}`;
  return block.missing.map((h) => HEADING_ES[h] ?? h).join(", ");
}

// When the idea last entered this stage (the task.updated that set stage to it). Null on the first
// visit: an idea is created already in "idea", so that visit has no stage-change event.
export async function stageEnteredAt(db: Q, taskId: string, stage: string | null): Promise<Date | null> {
  if (!stage) return null;
  const [row] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.taskId, taskId), eq(events.type, "task.updated"), sql`${events.payload}->'changes'->'stage'->>1 = ${stage}`))
    .orderBy(desc(events.id))
    .limit(1);
  return row?.createdAt ?? null;
}

export async function loadStageEvidence(db: Q, taskId: string): Promise<{ docRows: StageDocRow[]; qs: StageQuestion[] }> {
  const docRows = await db.select({ title: docs.title, markdown: docs.markdown }).from(docs).where(eq(docs.taskId, taskId));
  const rows = await db
    .select({ gate: questions.gate, question: questions.question, answer: questions.answer, answeredAt: questions.answeredAt })
    .from(questions)
    .where(eq(questions.taskId, taskId))
    .orderBy(asc(questions.askedAt));
  return {
    docRows,
    qs: rows.map((q) => ({ gate: q.gate, question: q.question, answered: !!q.answeredAt, answer: q.answer, answeredAt: q.answeredAt })),
  };
}

// What each idea on the project page is waiting on, keyed by task key.
export async function ideaWaits(db: Q, projectId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: tasks.id, key: tasks.key, stage: tasks.stage })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "idea")));
  const map = new Map<string, string>();
  if (!rows.length) return map;
  const ids = rows.map((r) => r.id);
  const docRows = await db.select({ taskId: docs.taskId, title: docs.title, markdown: docs.markdown }).from(docs).where(inArray(docs.taskId, ids));
  const qRows = await db
    .select({ taskId: questions.taskId, gate: questions.gate, question: questions.question, answer: questions.answer, answeredAt: questions.answeredAt })
    .from(questions)
    .where(inArray(questions.taskId, ids))
    .orderBy(asc(questions.askedAt));
  const arrivals = await db
    .select({ taskId: events.taskId, createdAt: events.createdAt, entered: sql<string | null>`${events.payload}->'changes'->'stage'->>1` })
    .from(events)
    .where(and(inArray(events.taskId, ids), eq(events.type, "task.updated")))
    .orderBy(desc(events.id));
  const stageOf = new Map(rows.map((t) => [t.id, t.stage]));
  const sinceByTask = new Map<string, Date>();
  for (const row of arrivals) {
    if (!row.taskId || sinceByTask.has(row.taskId)) continue;
    if (row.entered === stageOf.get(row.taskId)) sinceByTask.set(row.taskId, row.createdAt);
  }
  for (const t of rows) {
    const mine = docRows.filter((d) => d.taskId === t.id);
    const qs = qRows
      .filter((q) => q.taskId === t.id)
      .map((q) => ({ gate: q.gate, question: q.question, answered: !!q.answeredAt, answer: q.answer, answeredAt: q.answeredAt }));
    map.set(t.key, ideaWaitText(t.stage, mine, qs, sinceByTask.get(t.id) ?? null));
  }
  return map;
}

// Becoming Active (Planning or On hold) on an initiative an idea was promoted to. No gate C
// question: unchanged (ideas and initiatives that existed before gates, or a promotion with no
// gate C). A gate C question must have the advancing answer (`ready`) from after the idea entered
// planning — the same rule as the idea's own move. New gate questions are human_only, so that
// answer can only have come from the screen. On hold is included so it is not a way around the gate.
export async function assertPromotedInitiativeActive(db: Q, initiative: { projectId: string; key: string }, from: string): Promise<void> {
  const ideas = await db
    .select({ id: tasks.id, key: tasks.key })
    .from(tasks)
    .where(and(eq(tasks.projectId, initiative.projectId), eq(tasks.kind, "idea"), eq(tasks.promotedTo, initiative.key)));
  for (const idea of ideas) {
    const { qs } = await loadStageEvidence(db, idea.id);
    if (!qs.some((q) => q.gate === "C")) continue;
    const since = await stageEnteredAt(db, idea.id, "planning");
    if (!gateAdvances("C", qs, since)) throw new ToolError("GATE_NOT_PASSED", { from, to: "Active", gate: "C", idea: idea.key });
  }
}

// The doc the forward move needs, if any. Used by set_task.
export async function assertForwardStage(db: Q, taskId: string, from: string, to: string): Promise<void> {
  const { docRows, qs } = await loadStageEvidence(db, taskId);
  const since = await stageEnteredAt(db, taskId, from);
  const req = STAGE_DOCS[from as Exclude<Stage, "ready">];
  const block = forwardBlock(from, req ? docRows.find((d) => d.title === req.doc) : undefined, qs, since);
  if (block) throwForwardBlock(from, to, block);
}

// One open gate question per idea. Returns the fixed options.
export async function assertGateAsk(db: Q, taskId: string, gate: Gate): Promise<string[]> {
  const [open] = await db
    .select({ id: questions.id, gate: questions.gate })
    .from(questions)
    .where(and(eq(questions.taskId, taskId), isNull(questions.answeredAt), sql`${questions.gate} is not null`))
    .limit(1);
  if (open) throw new ToolError("GATE_OPEN", { gate: open.gate, question_id: open.id });
  return [...GATE_OPTIONS[gate]];
}
