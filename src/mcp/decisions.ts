import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { decisionSupersessions, decisions, tasks, type Project } from "../db/schema.js";
import { putDoc } from "./docs.js";
import { ToolError, findProject, findTask, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// The decision log. One line each, tied to a task when it is about one, tagged, and able to name
// the decisions it reverses (supersedes). A decision that no longer holds and has no replacement
// is retired (retire_decision). Reversed and retired decisions are hidden unless asked for.
// The full ADR, when there is one, is a project doc.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type DecisionRow = typeof decisions.$inferSelect;

export function decisionShape(d: DecisionRow, taskKey: string | null, supersedes: string[] = [], supersededBy: string | null = null) {
  return {
    id: d.id,
    text: d.line,
    task_key: taskKey,
    tags: d.tags,
    pinned: d.pinned,
    supersedes,
    superseded_by: supersededBy,
    retired: d.retiredAt ? { at: iso(d.retiredAt), by: d.retiredBy, reason: d.retiredReason } : null,
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
  includeSuperseded?: boolean; // default false
  includeRetired?: boolean; // default false
  limit?: number;
};

const supersededBySql = sql<string | null>`(select ds.decision_id from ${decisionSupersessions} ds where ds.supersedes_id = ${decisions.id} limit 1)`;
const supersedesSql = sql<string[]>`array(select ds.supersedes_id from ${decisionSupersessions} ds where ds.decision_id = ${decisions.id})`;

// Newest first. superseded_by is filled from the decision that reversed this one.
export async function listDecisions(db: Q, projectId: string, f: DecisionFilters = {}) {
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
  if (f.includeSuperseded !== true) where.push(sql`${supersededBySql} is null`);
  if (f.includeRetired !== true) where.push(isNull(decisions.retiredAt));
  const rows = await db
    .select({ d: decisions, taskKey: tasks.key, supersededBy: supersededBySql, supersedes: supersedesSql })
    .from(decisions)
    .leftJoin(tasks, eq(tasks.id, decisions.taskId))
    .where(and(...where))
    .orderBy(desc(decisions.createdAt), desc(decisions.id))
    .limit(Math.min(f.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  return rows.map((r) => decisionShape(r.d, r.taskKey, r.supersedes, r.supersededBy));
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
  supersedes?: string | string[];
  adr_body?: string;
  adr_url?: string;
  pin?: boolean;
  question_id?: string;
};

async function findDecision(tx: Q, projectId: string, id: string): Promise<DecisionRow> {
  const [d] = await tx
    .select()
    .from(decisions)
    .where(and(eq(decisions.projectId, projectId), sql`${decisions.id}::text = ${id}`))
    .limit(1);
  if (!d) throw new ToolError("DECISION_NOT_FOUND", { decision_id: id });
  return d;
}

export async function addDecisionInTx(tx: Q, emit: Emit, p: Project, input: AddDecisionInput, ctx: Ctx) {
  rejectLeadingDate(input.text);
  {
    const ids = [...new Set(typeof input.supersedes === "string" ? [input.supersedes] : (input.supersedes ?? []))].filter(Boolean);
    const olds: DecisionRow[] = [];
    for (const id of ids) {
      const old = await findDecision(tx, p.id, id);
      if (old.retiredAt) throw new ToolError("DECISION_RETIRED", { decision_id: old.id });
      const [taken] = await tx
        .select({ id: decisionSupersessions.decisionId })
        .from(decisionSupersessions)
        .where(eq(decisionSupersessions.supersedesId, old.id))
        .limit(1);
      if (taken) throw new ToolError("ALREADY_SUPERSEDED", { decision_id: old.id, superseded_by: taken.id });
      olds.push(old);
    }
    const old = olds[0];
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
        actor: ctx.actor,
      })
      .returning();
    if (olds.length) await tx.insert(decisionSupersessions).values(olds.map((o) => ({ decisionId: d!.id, supersedesId: o.id })));
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
      ...(olds.length ? { supersedes: olds.map((o) => o.id) } : {}),
    });
    return { decision: decisionShape(decision, task?.key ?? null, olds.map((o) => o.id)) };
  }
}

// R-24: a decision that no longer holds and has no replacement. Hidden from get_memory and the
// resume's must_keep from then on; the text stays in the log.
export async function retireDecision(db: Db, input: { project: string; decision_id: string; reason: string }, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const d = await findDecision(tx, p.id, input.decision_id);
    if (d.retiredAt) throw new ToolError("DECISION_RETIRED", { decision_id: d.id, retired_at: iso(d.retiredAt) });
    const [u] = (await tx
      .update(decisions)
      .set({ retiredAt: sql`now()`, retiredBy: ctx.actor, retiredReason: input.reason.trim() || null })
      .where(eq(decisions.id, d.id))
      .returning()) as [DecisionRow];
    const task = d.taskId ? (await tx.select({ id: tasks.id, key: tasks.key }).from(tasks).where(eq(tasks.id, d.taskId)))[0] : undefined;
    await emit("decision.retired", task ?? null, { decision_id: d.id, text: d.line, reason: u.retiredReason });
    return { decision: decisionShape(u, task?.key ?? null) };
  });
}

export async function addDecision(db: Db, input: AddDecisionInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => addDecisionInTx(tx, emit, p, input, ctx));
}
