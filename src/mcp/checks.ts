import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { checks, tasks, type Actor, type Project, type Task } from "../db/schema.js";
import { LEGACY_APPROVAL_HINT } from "./delegate.js";
import { ToolError, findProject, liveOwner, requireTask, writeReply } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// "Done when" as data. Each check has a stable n; set_check ticks one without touching the rest,
// and set_task checks replaces the list (an item that keeps its n keeps its done state).

export type CheckInput = { n?: number; text: string; derived_from?: string | null };

export async function taskChecks(db: Q, taskId: string) {
  const rows = await db.select().from(checks).where(eq(checks.taskId, taskId)).orderBy(asc(checks.position));
  return rows.map((c) => ({
    n: c.n,
    text: c.text,
    done: c.done,
    done_at: iso(c.doneAt),
    done_by: c.doneBy,
    evidence_id: c.evidenceId,
    derived_from: c.derivedFrom,
    waived: c.waivedAt ? { at: iso(c.waivedAt), by: c.waivedBy, reason: c.waiveReason, approval_id: c.approvalId } : null,
  }));
}

// R-14: an initiative check derived from a child ticks itself when that child reaches Done.
export async function tickDerived(tx: Q, emit: Emit, child: Task, by: Actor): Promise<void> {
  if (!child.parentId) return;
  const rows = await tx
    .select()
    .from(checks)
    .where(and(eq(checks.taskId, child.parentId), eq(checks.done, false), sql`${checks.derivedFrom} = ${child.key} or ${checks.derivedFrom} in (select alias from task_aliases where task_id = ${child.id})`));
  if (!rows.length) return;
  const [parent] = await tx.select().from(tasks).where(eq(tasks.id, child.parentId)).limit(1);
  for (const c of rows) {
    await tx.update(checks).set({ done: true, doneAt: sql`now()`, doneBy: by }).where(eq(checks.id, c.id));
    await emit("check.set", { id: parent!.id, key: parent!.key }, { n: c.n, text: c.text, done: true, derived_from: child.key }, by);
  }
}

// Entering In review, Merged, Released or Done needs every check done or waived (R-13).
export async function assertChecksClosed(tx: Q, t: Pick<Task, "id">): Promise<void> {
  const open = await tx
    .select({ n: checks.n, text: checks.text })
    .from(checks)
    .where(and(eq(checks.taskId, t.id), eq(checks.done, false), isNull(checks.waivedAt)))
    .orderBy(asc(checks.n));
  // 2.13: each open check with its text, so the caller knows what is left without another read.
  if (open.length) throw new ToolError("CHECKS_OPEN", { open: open.map((c) => c.n), checks: open, hint: "set_check done (or add_result check_ns), or waive_check with a reason" });
}

function checkOwner(t: Task, ctx: Ctx): void {
  const owner = liveOwner(t);
  if (owner && owner.session_id !== ctx.actor.session_id && !ctx.human) {
    throw new ToolError("NOT_OWNER", { owner, lease_until: iso(t.leaseUntil) });
  }
}

const touch = async (tx: Q, t: Task) => (await tx.update(tasks).set({ updatedAt: sql`now()` }).where(eq(tasks.id, t.id)).returning())[0] as Task;

// Replaces the list. Returns [old texts, new texts] for the task.updated event, or null if unchanged.
export async function replaceChecks(tx: Q, taskId: string, items: CheckInput[]): Promise<[string[], string[]] | null> {
  const existing = await tx.select().from(checks).where(eq(checks.taskId, taskId)).orderBy(asc(checks.position));
  const byN = new Map(existing.map((c) => [c.n, c]));
  const kept = new Set<number>();
  for (const item of items) {
    if (item.n === undefined) continue;
    if (!byN.has(item.n) || kept.has(item.n)) throw new ToolError("CHECK_NOT_FOUND", { n: item.n });
    kept.add(item.n);
  }
  let next = Math.max(0, ...existing.map((c) => c.n)) + 1;
  const removed = existing.filter((c) => !kept.has(c.n)).map((c) => c.id);
  for (const id of removed) await tx.delete(checks).where(eq(checks.id, id));
  for (const [position, item] of items.entries()) {
    const derived = item.derived_from === undefined ? {} : { derivedFrom: item.derived_from?.trim() || null };
    if (item.n !== undefined) {
      await tx.update(checks).set({ text: item.text, position, ...derived }).where(and(eq(checks.taskId, taskId), eq(checks.n, item.n)));
    } else {
      await tx.insert(checks).values({ taskId, n: next++, position, text: item.text, ...derived });
    }
  }
  const before = existing.map((c) => c.text);
  const after = items.map((i) => i.text);
  return JSON.stringify(before) === JSON.stringify(after) && removed.length === 0 ? null : [before, after];
}

export type SetCheckInput = {
  project: string;
  key: string;
  n: number;
  done?: boolean;
  evidence_id?: string | null;
  text?: string;
  waived?: boolean; // only false does something: it lifts a waiver
};

// Marks one check done or not, amends its text (the old text stays in the log) or lifts a waiver.
// Commutative: needs no version and does not bump it. While another session holds a live lease,
// only the owner (or Jorge) touches its checks.
export async function setCheckInTx(
  tx: Q,
  emit: Emit,
  p: Project,
  input: SetCheckInput,
  ctx: Ctx,
  // Validates that evidence_id is a result of this project and says which task it came from.
  validateEvidence?: (tx: Q, t: Task, id: string) => Promise<{ source: string }>,
) {
  const t = await requireTask(tx, p.id, input.key);
  checkOwner(t, ctx);
  const evidence = input.evidence_id && validateEvidence ? await validateEvidence(tx, t, input.evidence_id) : undefined;
  const [before] = await tx.select().from(checks).where(and(eq(checks.taskId, t.id), eq(checks.n, input.n))).limit(1);
  if (!before) throw new ToolError("CHECK_NOT_FOUND", { n: input.n });
  const amended = input.text !== undefined && input.text.trim() && input.text !== before.text ? input.text : undefined;
  const [c] = await tx
    .update(checks)
    .set({
      ...(input.done !== undefined
        ? { done: input.done, doneAt: input.done ? sql`now()` : null, doneBy: input.done ? ctx.actor : null }
        : {}),
      ...(input.evidence_id !== undefined ? { evidenceId: input.evidence_id } : {}),
      ...(amended !== undefined ? { text: amended } : {}),
      ...(input.waived === false ? { waivedAt: null, waivedBy: null, waiveReason: null, approvalId: null } : {}),
    })
    .where(eq(checks.id, before.id))
    .returning();
  const u = await touch(tx, t);
  if (input.done !== undefined) await emit("check.set", u, { n: c!.n, text: c!.text, done: c!.done, evidence_id: c!.evidenceId, ...(evidence ? { source: evidence.source } : {}) });
  if (amended !== undefined) await emit("check.amended", u, { n: c!.n, from: before.text, to: amended });
  if (input.waived === false && before.waivedAt) await emit("check.unwaived", u, { n: c!.n });
  return writeReply(tx, u, ctx, ["checks"], { check: { n: c!.n, done: c!.done, evidence_id: c!.evidenceId, ...(evidence ? { source: evidence.source } : {}), waived: !!c!.waivedAt } });
}

export type WaiveCheckInput = { project: string; key: string; n: number; reason: string; approval_id?: string };

// A check that will not be done, with why. The reason is the record at every status.
export async function waiveCheckInTx(tx: Q, emit: Emit, p: Project, input: WaiveCheckInput, ctx: Ctx) {
  if (!input.reason.trim()) throw new ToolError("INVALID_APPROVAL", { field: "reason", hint: "say why the check is waived" });
  const t = await requireTask(tx, p.id, input.key);
  checkOwner(t, ctx);
  const [before] = await tx.select().from(checks).where(and(eq(checks.taskId, t.id), eq(checks.n, input.n))).limit(1);
  if (!before) throw new ToolError("CHECK_NOT_FOUND", { n: input.n });
  const [c] = await tx
    .update(checks)
    .set({ waivedAt: sql`now()`, waivedBy: ctx.actor, waiveReason: input.reason.trim(), approvalId: null })
    .where(eq(checks.id, before.id))
    .returning();
  const u = await touch(tx, t);
  await emit("check.waived", u, { n: c!.n, text: c!.text, reason: c!.waiveReason });
  const hint = typeof input.approval_id === "string" && input.approval_id.trim() ? LEGACY_APPROVAL_HINT : undefined;
  return writeReply(tx, u, ctx, ["checks"], { check: { n: c!.n, done: c!.done, waived: true }, ...(hint ? { hint } : {}) });
}

export async function waiveCheck(db: Db, input: WaiveCheckInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => waiveCheckInTx(tx, emit, p, input, ctx));
}

export async function setCheck(
  db: Db,
  input: SetCheckInput,
  ctx: Ctx,
  validateEvidence?: (tx: Q, t: Task, id: string) => Promise<{ source: string }>,
) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, (tx, emit) => setCheckInTx(tx, emit, p, input, ctx, validateEvidence));
}
