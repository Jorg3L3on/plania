import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { decisions, tasks, type Project } from "../db/schema.js";
import { putDoc } from "./docs.js";
import { ToolError, findProject, findTask, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// The decision log. One line each, tied to a task when it is about one, tagged, and able to name
// the decision it reverses (supersedes). The full ADR, when there is one, is a project doc.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type DecisionRow = typeof decisions.$inferSelect;

export function decisionShape(d: DecisionRow, taskKey: string | null, supersededBy: string | null = null) {
  return {
    id: d.id,
    text: d.line,
    task_key: taskKey,
    tags: d.tags,
    pinned: d.pinned,
    supersedes: d.supersedesId,
    superseded_by: supersededBy,
    adr_url: d.adrUrl,
    adr_doc_id: d.docId,
    decided_on: d.decidedOn,
    actor: d.actor,
    created_at: iso(d.createdAt),
  };
}

export type DecisionFilters = {
  taskKey?: string;
  initiativeKey?: string;
  tag?: string;
  pinned?: boolean;
  includeSuperseded?: boolean;
  limit?: number;
};

// Newest first. superseded_by is filled from the decision that names this one.
export async function listDecisions(db: Q, projectId: string, f: DecisionFilters = {}) {
  const later = alias(decisions, "later");
  const where: SQL[] = [eq(decisions.projectId, projectId)];
  if (f.taskKey !== undefined) {
    const t = await findTask(db, projectId, f.taskKey);
    if (!t) throw new ToolError("TASK_NOT_FOUND");
    where.push(eq(decisions.taskId, t.id));
  }
  if (f.initiativeKey !== undefined) {
    const i = await findTask(db, projectId, f.initiativeKey);
    if (!i || i.kind !== "initiative") throw new ToolError("INITIATIVE_NOT_FOUND");
    const children = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, i.id));
    where.push(or(eq(decisions.taskId, i.id), inArray(decisions.taskId, children))!);
  }
  if (f.tag !== undefined) where.push(sql`${f.tag.trim().toLowerCase()} = any(${decisions.tags})`);
  if (f.pinned !== undefined) where.push(eq(decisions.pinned, f.pinned));
  if (f.includeSuperseded === false) where.push(sql`${later.id} is null`);
  const rows = await db
    .select({ d: decisions, taskKey: tasks.key, supersededBy: later.id })
    .from(decisions)
    .leftJoin(tasks, eq(tasks.id, decisions.taskId))
    .leftJoin(later, eq(later.supersedesId, decisions.id))
    .where(and(...where))
    .orderBy(desc(decisions.createdAt), desc(decisions.id))
    .limit(Math.min(f.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  return rows.map((r) => decisionShape(r.d, r.taskKey, r.supersededBy));
}

const normalizeTags = (tags: string[] | undefined) =>
  [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];

// Dates are the server's job. A decision that starts with one was typed by an agent.
function rejectLeadingDate(text: string): void {
  if (/^\s*\d{4}-\d{2}-\d{2}\b/.test(text)) throw new ToolError("TEXT_HAS_DATE");
}

export type AddDecisionInput = {
  project: string;
  text: string;
  task_key?: string;
  tags?: string[];
  supersedes?: string;
  adr_body?: string;
  adr_url?: string;
  pin?: boolean;
  question_id?: string;
};

export async function addDecisionInTx(tx: Q, emit: Emit, p: Project, input: AddDecisionInput, ctx: Ctx) {
  rejectLeadingDate(input.text);
  {
    let old: DecisionRow | undefined;
    if (input.supersedes) {
      [old] = await tx
        .select()
        .from(decisions)
        .where(and(eq(decisions.projectId, p.id), sql`${decisions.id}::text = ${input.supersedes}`))
        .limit(1);
      if (!old) throw new ToolError("DECISION_NOT_FOUND", { decision_id: input.supersedes });
      const [taken] = await tx.select({ id: decisions.id }).from(decisions).where(eq(decisions.supersedesId, old.id)).limit(1);
      if (taken) throw new ToolError("ALREADY_SUPERSEDED", { superseded_by: taken.id });
    }
    // A reversal is about the same task unless it says otherwise.
    const task = input.task_key
      ? await requireTask(tx, p.id, input.task_key)
      : old?.taskId
        ? (await tx.select().from(tasks).where(eq(tasks.id, old.taskId)))[0]
        : undefined;
    const [d] = await tx
      .insert(decisions)
      .values({
        projectId: p.id,
        line: input.text,
        adrUrl: input.adr_url ?? null,
        taskId: task?.id ?? null,
        pinned: input.pin ?? old?.pinned ?? false,
        tags: normalizeTags(input.tags),
        supersedesId: old?.id ?? null,
        actor: ctx.actor,
      })
      .returning();
    let decision = d!;
    if (input.adr_body) {
      const doc = await putDoc(tx, emit, ctx, p.id, undefined, {
        title: `ADR ${decision.id.slice(0, 8)}: ${input.text.slice(0, 80)}`,
        markdown: input.adr_body,
      });
      [decision] = (await tx.update(decisions).set({ docId: doc.id }).where(eq(decisions.id, decision.id)).returning()) as [DecisionRow];
    }
    await emit("decision.added", task ?? null, {
      decision_id: decision.id,
      text: decision.line,
      pinned: decision.pinned,
      tags: decision.tags,
      ...(old ? { supersedes: old.id } : {}),
    });
    return { decision: decisionShape(decision, task?.key ?? null) };
  }
}

export async function addDecision(db: Db, input: AddDecisionInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => addDecisionInTx(tx, emit, p, input, ctx));
}
