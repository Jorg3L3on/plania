import { and, asc, eq, inArray } from "drizzle-orm";
import { docs, questions, tasks } from "../db/schema.js";
import { ToolError } from "./errors.js";
import type { Q } from "./tx.js";

// An idea moves one stage at a time: idea → research → design → planning → ready.
// Leaving a stage (the forward move) needs that stage's doc, with the headings below as markdown
// headings. Nothing else holds it: gates were removed in 2.17 (PLA-I18), and the old gate
// questions stay on the ideas as read-only history. A step back is one stage and needs a note.
// Skipping a stage is INVALID_STAGE_MOVE.

export const STAGES = ["idea", "research", "design", "planning", "ready"] as const;
export type Stage = (typeof STAGES)[number];

type StageDoc = { doc: string; headings: readonly string[] };

export const STAGE_DOCS: Record<Exclude<Stage, "ready">, StageDoc> = {
  idea: { doc: "Idea", headings: ["Problem", "Who it is for", "Why now"] },
  research: { doc: "Research", headings: ["What we learned", "Options", "Recommendation"] },
  design: { doc: "Design", headings: ["Approach", "Scope", "Out of scope"] },
  planning: { doc: "Plan", headings: ["Steps", "Done when", "Risks"] },
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
export type StageQuestion = { question: string; answered: boolean };

// What a forward move still lacks. Null when the doc and its headings are there.
export function forwardBlock(from: string, doc: StageDocRow | undefined): { code: "STAGE_REQUIREMENTS_MISSING"; doc: string; missing: string[] } | null {
  const req = STAGE_DOCS[from as Exclude<Stage, "ready">];
  if (!req) return null;
  if (!doc || doc.title !== req.doc) return { code: "STAGE_REQUIREMENTS_MISSING", doc: req.doc, missing: ["doc"] };
  const missing = req.headings.filter((h) => !hasHeading(doc.markdown, h));
  if (missing.length) return { code: "STAGE_REQUIREMENTS_MISSING", doc: req.doc, missing: [...missing] };
  return null;
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

// One line for the project page: the open question, else the doc or headings still missing,
// else that it can move. An old gate question still open (before migration 0030 closes it) reads
// as its question, like any other.
export function ideaWaitText(stage: string | null, docRows: StageDocRow[], qs: StageQuestion[]): string {
  const open = qs.find((q) => !q.answered);
  if (open) return open.question;
  if (!stage || stage === "ready") return "Lista para promover";
  const req = STAGE_DOCS[stage as Exclude<Stage, "ready">];
  if (!req) return "Puede avanzar";
  const block = forwardBlock(stage, docRows.find((d) => d.title === req.doc));
  if (!block) return "Puede avanzar";
  if (block.missing.includes("doc")) return `Doc ${DOC_ES[block.doc] ?? block.doc}`;
  return block.missing.map((h) => HEADING_ES[h] ?? h).join(", ");
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
    .select({ taskId: questions.taskId, question: questions.question, answeredAt: questions.answeredAt })
    .from(questions)
    .where(inArray(questions.taskId, ids))
    .orderBy(asc(questions.askedAt));
  for (const t of rows) {
    const mine = docRows.filter((d) => d.taskId === t.id);
    const qs = qRows.filter((q) => q.taskId === t.id).map((q) => ({ question: q.question, answered: !!q.answeredAt }));
    map.set(t.key, ideaWaitText(t.stage, mine, qs));
  }
  return map;
}

// The doc the forward move needs, if any. Used by set_task.
export async function assertForwardStage(db: Q, taskId: string, from: string, to: string): Promise<void> {
  const req = STAGE_DOCS[from as Exclude<Stage, "ready">];
  const docRows = req ? await db.select({ title: docs.title, markdown: docs.markdown }).from(docs).where(eq(docs.taskId, taskId)) : [];
  const block = forwardBlock(from, req ? docRows.find((d) => d.title === req.doc) : undefined);
  if (block) throw new ToolError("STAGE_REQUIREMENTS_MISSING", { from, to, doc: block.doc, missing: block.missing });
}
