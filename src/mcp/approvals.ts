import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { approvals, projects, tasks, type Actor, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { type ApprovalAction } from "./lifecycle.js";
import { findProject, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// Approvals (2.1, R-05). Won't do, reopening, a waiver once In review: an agent asks with
// request_approval, Jorge decides on screen (one event per decision), and the granted id unlocks
// exactly one move. No code an agent could fake: only the cookie API decides.

// "done" is gone: agents close finished work themselves (lifecycle.ts DONE_FROM). Old rows keep it.
export const APPROVAL_ACTIONS = ["wont_do", "reopen", "waive_check", "runbook_step", "lease_resource"] as const;
export type { ApprovalAction };

const GRANT_TTL = "7 days";

type ApprovalRow = typeof approvals.$inferSelect;

export function approvalShape(a: ApprovalRow) {
  return {
    id: a.id,
    key: a.taskKey,
    action: a.action,
    target: a.target,
    reason: a.reason,
    state: a.state,
    requested_by: a.requestedBy,
    requested_at: iso(a.requestedAt),
    decided_at: iso(a.decidedAt),
    decided_by: a.decidedBy,
    decision_note: a.decisionNote,
    expires_at: iso(a.expiresAt),
    used_at: iso(a.usedAt),
  };
}

export async function requestApproval(
  db: Db,
  input: { project: string; key: string; action: string; reason: string; target?: Record<string, unknown> },
  ctx: Ctx,
) {
  if (!(APPROVAL_ACTIONS as readonly string[]).includes(input.action)) throw new ToolError("INVALID_APPROVAL", { allowed: APPROVAL_ACTIONS });
  if (!input.reason.trim()) throw new ToolError("INVALID_APPROVAL", { field: "reason" });
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    const target = input.target ?? {};
    const [existing] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.taskId, t.id), eq(approvals.action, input.action), eq(approvals.state, "pending"), sql`${approvals.target} = ${JSON.stringify(target)}::jsonb`))
      .limit(1);
    if (existing) return { approval: approvalShape(existing), existing: true };
    const [a] = await tx
      .insert(approvals)
      .values({ projectId: p.id, taskId: t.id, taskKey: t.key, action: input.action, target, reason: input.reason.trim(), requestedBy: ctx.actor })
      .returning();
    await emit("approval.requested", t, { approval_id: a!.id, action: a!.action, target, reason: a!.reason });
    return { approval: approvalShape(a!), existing: false };
  });
}

export async function loadApproval(tx: Q, projectId: string, id: string): Promise<ApprovalRow> {
  const [a] = await tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.projectId, projectId), sql`${approvals.id}::text = ${id}`))
    .limit(1);
  if (!a) throw new ToolError("APPROVAL_NOT_FOUND", { approval_id: id });
  return a;
}

// Spends a granted approval on one move. Throws when it is for something else, not granted, or used.
export async function useApproval(
  tx: Q,
  emit: Emit,
  a: ApprovalRow,
  t: Task,
  action: ApprovalAction,
  target: Record<string, unknown>,
  ctx: Ctx,
): Promise<void> {
  if (a.taskId !== t.id || a.action !== action || JSON.stringify(a.target) !== JSON.stringify(target)) {
    throw new ToolError("APPROVAL_MISMATCH", { approval_id: a.id, expected: { key: a.taskKey, action: a.action, target: a.target } });
  }
  if (a.usedAt) throw new ToolError("APPROVAL_USED", { approval_id: a.id, used_at: iso(a.usedAt), used_by: a.usedBy });
  const expired = a.state === "granted" && a.expiresAt && a.expiresAt < new Date();
  if (a.state !== "granted" || expired) throw new ToolError("APPROVAL_NOT_GRANTED", { approval_id: a.id, state: expired ? "expired" : a.state });
  await tx.update(approvals).set({ usedAt: sql`now()`, usedBy: ctx.actor }).where(eq(approvals.id, a.id));
  await emit("approval.used", t, { approval_id: a.id, action, target });
}

// Jorge's decision, one approval at a time (the screen batches them, one event each).
export async function decideApproval(
  db: Db,
  input: { approval_id: string; decision: "grant" | "reject"; note?: string },
  ctx: Ctx,
) {
  const [found] = await db
    .select({ a: approvals, slug: projects.slug })
    .from(approvals)
    .innerJoin(projects, eq(projects.id, approvals.projectId))
    .where(sql`${approvals.id}::text = ${input.approval_id}`)
    .limit(1);
  if (!found) throw new ToolError("APPROVAL_NOT_FOUND", { approval_id: input.approval_id });
  const p = { id: found.a.projectId, slug: found.slug };
  return writeTx(db, p, ctx, async (tx, emit) => {
    const a = await loadApproval(tx, p.id, input.approval_id);
    if (a.state !== "pending") throw new ToolError("APPROVAL_NOT_GRANTED", { approval_id: a.id, state: a.state, hint: "already decided" });
    const state = input.decision === "grant" ? "granted" : "rejected";
    const [u] = await tx
      .update(approvals)
      .set({
        state,
        decidedAt: sql`now()`,
        decidedBy: ctx.actor,
        decisionNote: input.note?.trim() || null,
        expiresAt: input.decision === "grant" ? sql`now() + ${GRANT_TTL}::interval` : null,
      })
      .where(eq(approvals.id, a.id))
      .returning();
    const task = a.taskId ? { id: a.taskId, key: a.taskKey ?? "" } : null;
    await emit(`approval.${state}`, task, { approval_id: a.id, action: a.action, target: a.target, note: u!.decisionNote });
    return { approval: approvalShape(u!) };
  });
}

export async function pendingApprovals(db: Q, projectId: string) {
  const rows = await db
    .select({ a: approvals, title: tasks.title, kind: tasks.kind, parentId: tasks.parentId })
    .from(approvals)
    .leftJoin(tasks, eq(tasks.id, approvals.taskId))
    .where(and(eq(approvals.projectId, projectId), eq(approvals.state, "pending")))
    .orderBy(asc(approvals.requestedAt));
  return rows;
}

export type { ApprovalRow };
export type ApprovalActor = Actor;
