import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { docs, questions, tasks } from "../db/schema.js";
import { ToolError } from "./errors.js";
import type { Q } from "./tx.js";

// An idea moves one stage at a time: idea → research → design → planning → ready.
// Leaving a stage (the forward move) needs that stage's doc, with the headings below as markdown
// headings, and — where a gate is named — an answered question with that gate. Any answer counts,
// from anyone. A step back is one stage and needs a note. Skipping a stage is INVALID_STAGE_MOVE.

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
export type StageQuestion = { gate: string | null; question: string; answered: boolean };

// What a forward move still lacks. Null when the doc, its headings and the gate answer are all there.
export function forwardBlock(
  from: string,
  doc: StageDocRow | undefined,
  questionsOnIt: StageQuestion[],
): { code: "STAGE_REQUIREMENTS_MISSING"; doc: string; missing: string[] } | { code: "GATE_NOT_PASSED"; gate: Gate } | null {
  const req = STAGE_DOCS[from as Exclude<Stage, "ready">];
  if (!req) return null;
  if (!doc || doc.title !== req.doc) return { code: "STAGE_REQUIREMENTS_MISSING", doc: req.doc, missing: ["doc"] };
  const missing = req.headings.filter((h) => !hasHeading(doc.markdown, h));
  if (missing.length) return { code: "STAGE_REQUIREMENTS_MISSING", doc: req.doc, missing: [...missing] };
  if (req.gate && !questionsOnIt.some((q) => q.gate === req.gate && q.answered)) return { code: "GATE_NOT_PASSED", gate: req.gate };
  return null;
}

export function throwForwardBlock(from: string, to: string, block: NonNullable<ReturnType<typeof forwardBlock>>): never {
  if (block.code === "GATE_NOT_PASSED") throw new ToolError("GATE_NOT_PASSED", { from, to, gate: block.gate });
  throw new ToolError("STAGE_REQUIREMENTS_MISSING", { from, to, doc: block.doc, missing: block.missing });
}

// One line for the project page: the open gate, else the open question, else the doc or headings
// still missing, else that it can move.
export function ideaWaitText(stage: string | null, docRows: StageDocRow[], qs: StageQuestion[]): string {
  const open = qs.filter((q) => !q.answered);
  const gate = open.find((q) => q.gate);
  if (gate?.gate) return `Puerta ${gate.gate}`;
  if (open[0]) return open[0].question;
  if (!stage || stage === "ready") return "Lista para promover";
  const req = STAGE_DOCS[stage as Exclude<Stage, "ready">];
  if (!req) return "Puede avanzar";
  const block = forwardBlock(stage, docRows.find((d) => d.title === req.doc), qs);
  if (!block) return "Puede avanzar";
  if (block.code === "GATE_NOT_PASSED") return `Puerta ${block.gate}`;
  if (block.missing.includes("doc")) return `Doc ${block.doc}`;
  return block.missing.join(", ");
}

export async function loadStageEvidence(db: Q, taskId: string): Promise<{ docRows: StageDocRow[]; qs: StageQuestion[] }> {
  const docRows = await db.select({ title: docs.title, markdown: docs.markdown }).from(docs).where(eq(docs.taskId, taskId));
  const rows = await db
    .select({ gate: questions.gate, question: questions.question, answeredAt: questions.answeredAt })
    .from(questions)
    .where(eq(questions.taskId, taskId))
    .orderBy(asc(questions.askedAt));
  return { docRows, qs: rows.map((q) => ({ gate: q.gate, question: q.question, answered: !!q.answeredAt })) };
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
    .select({ taskId: questions.taskId, gate: questions.gate, question: questions.question, answeredAt: questions.answeredAt })
    .from(questions)
    .where(inArray(questions.taskId, ids))
    .orderBy(asc(questions.askedAt));
  for (const t of rows) {
    const mine = docRows.filter((d) => d.taskId === t.id);
    const qs = qRows.filter((q) => q.taskId === t.id).map((q) => ({ gate: q.gate, question: q.question, answered: !!q.answeredAt }));
    map.set(t.key, ideaWaitText(t.stage, mine, qs));
  }
  return map;
}

// The doc the forward move needs, if any. Used by set_task.
export async function assertForwardStage(db: Q, taskId: string, from: string, to: string): Promise<void> {
  const { docRows, qs } = await loadStageEvidence(db, taskId);
  const req = STAGE_DOCS[from as Exclude<Stage, "ready">];
  const block = forwardBlock(from, req ? docRows.find((d) => d.title === req.doc) : undefined, qs);
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
