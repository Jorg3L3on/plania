import type { Db } from "../db/client.js";
import type { decisions, Project } from "../db/schema.js";
import { readerOf, uowOf } from "../store/port.js";
import type { Where } from "../store/types.js";
import { isUuidText, putDoc } from "./docs.js";
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

// Newest first. superseded_by is filled from the decision that reversed this one.
export async function listDecisions(db: Q, projectId: string, f: DecisionFilters = {}) {
  const r = readerOf(db);
  // The tasks a decision may be about: the one asked for, the initiative and its children, or both at once.
  let taskIds: string[] | undefined;
  if (f.taskKey !== undefined) {
    const t = await findTask(db, projectId, f.taskKey);
    if (!t) throw new ToolError("TASK_NOT_FOUND");
    taskIds = [t.id];
  }
  if (f.initiativeKey !== undefined) {
    const i = await findTask(db, projectId, f.initiativeKey);
    if (!i || i.kind !== "initiative") throw new ToolError("INITIATIVE_NOT_FOUND");
    const under = [i.id, ...(await r.find("tasks", { parentId: i.id })).map((c) => c.id)];
    taskIds = taskIds ? taskIds.filter((id) => under.includes(id)) : under;
  }
  const where: Where<"decisions"> = { projectId };
  if (taskIds) where.taskId = taskIds;
  if (f.pinned !== undefined) where.pinned = f.pinned;
  if (f.includeRetired !== true) where.retiredAt = null;
  const rows = await r.find("decisions", where, { orderBy: [{ column: "createdAt", desc: true }, { column: "id", desc: true }] });
  // Each decision is reversed at most once (decision_supersessions_old_unique).
  const reversals = rows.length ? await r.find("decisionSupersessions", { supersedesId: rows.map((d) => d.id) }) : [];
  const supersededBy = new Map(reversals.map((s) => [s.supersedesId, s.decisionId]));
  // The tag and the reversal are checked here, so the limit is taken only after them.
  const tag = f.tag?.trim().toLowerCase();
  const kept = rows
    .filter((d) => tag === undefined || d.tags.includes(tag))
    .filter((d) => f.includeSuperseded === true || !supersededBy.has(d.id))
    .slice(0, Math.min(f.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const reverses = kept.length ? await r.find("decisionSupersessions", { decisionId: kept.map((d) => d.id) }) : [];
  const about = [...new Set(kept.map((d) => d.taskId).filter((id): id is string => !!id))];
  const keyOf = new Map((about.length ? await r.find("tasks", { id: about }) : []).map((t) => [t.id, t.key]));
  return kept.map((d) =>
    decisionShape(
      d,
      d.taskId ? (keyOf.get(d.taskId) ?? null) : null,
      reverses.filter((s) => s.decisionId === d.id).map((s) => s.supersedesId),
      supersededBy.get(d.id) ?? null,
    ),
  );
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
  const d = isUuidText(id) ? await readerOf(tx).get("decisions", { projectId, id }) : undefined;
  if (!d) throw new ToolError("DECISION_NOT_FOUND", { decision_id: id });
  return d;
}

export async function addDecisionInTx(tx: Q, emit: Emit, p: Project, input: AddDecisionInput, ctx: Ctx) {
  rejectLeadingDate(input.text);
  const uow = uowOf(tx);
  {
    const ids = [...new Set(typeof input.supersedes === "string" ? [input.supersedes] : (input.supersedes ?? []))].filter(Boolean);
    const olds: DecisionRow[] = [];
    for (const id of ids) {
      const old = await findDecision(tx, p.id, id);
      if (old.retiredAt) throw new ToolError("DECISION_RETIRED", { decision_id: old.id });
      // A decision is reversed at most once. This lookup is what enforces it; the unique index backs it up.
      const taken = await uow.get("decisionSupersessions", { supersedesId: old.id });
      if (taken) throw new ToolError("ALREADY_SUPERSEDED", { decision_id: old.id, superseded_by: taken.decisionId });
      olds.push(old);
    }
    const old = olds[0];
    // A reversal is about the same task unless it says otherwise.
    const task = input.task_key
      ? await requireTask(tx, p.id, input.task_key)
      : old?.taskId
        ? await uow.get("tasks", { id: old.taskId })
        : undefined;
    const d = await uow.insert("decisions", {
      projectId: p.id,
      line: input.text,
      adrUrl: input.adr_url ?? null,
      taskId: task?.id ?? null,
      pinned: input.pin ?? old?.pinned ?? false,
      tags: normalizeTags(input.tags),
      actor: ctx.actor,
    });
    for (const o of olds) await uow.insert("decisionSupersessions", { decisionId: d.id, supersedesId: o.id });
    let decision = d;
    if (input.adr_body) {
      const doc = await putDoc(tx, emit, ctx, p.id, undefined, {
        title: `ADR ${decision.id.slice(0, 8)}: ${input.text.slice(0, 80)}`,
        markdown: input.adr_body,
      });
      [decision] = (await uow.update("decisions", { id: decision.id }, { docId: doc.id })) as [DecisionRow];
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
    const uow = uowOf(tx);
    const d = await findDecision(tx, p.id, input.decision_id);
    if (d.retiredAt) throw new ToolError("DECISION_RETIRED", { decision_id: d.id, retired_at: iso(d.retiredAt) });
    const [u] = (await uow.update(
      "decisions",
      { id: d.id },
      { retiredAt: uow.now, retiredBy: ctx.actor, retiredReason: input.reason.trim() || null },
    )) as [DecisionRow];
    const t = d.taskId ? await uow.get("tasks", { id: d.taskId }) : undefined;
    const task = t ? { id: t.id, key: t.key } : undefined;
    await emit("decision.retired", task ?? null, { decision_id: d.id, text: d.line, reason: u.retiredReason });
    return { decision: decisionShape(u, task?.key ?? null) };
  });
}

export async function addDecision(db: Db, input: AddDecisionInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => addDecisionInTx(tx, emit, p, input, ctx));
}
