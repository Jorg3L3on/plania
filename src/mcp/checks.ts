import type { Db } from "../db/client.js";
import type { Actor, Project, Task } from "../db/schema.js";
import { readerOf, uowOf } from "../store/pg.js";
import { LEGACY_APPROVAL_HINT } from "./delegate.js";
import { ToolError, findProject, liveOwner, requireTask, writeReply } from "./queries.js";
import { iso, writeTx, type Ctx, type Emit, type Q } from "./tx.js";

// "Done when" as data. Each check has a stable n; set_check ticks one without touching the rest,
// and set_task checks replaces the list (an item that keeps its n keeps its done state).

export type CheckInput = { n?: number; text: string; derived_from?: string | null };

export async function taskChecks(db: Q, taskId: string) {
  const rows = await readerOf(db).find("checks", { taskId }, { orderBy: [{ column: "position" }] });
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
  const uow = uowOf(tx);
  const aliases = (await uow.find("taskAliases", { taskId: child.id })).map((a) => a.alias);
  // The SQL this replaced read "parent's open check derived from the key OR derived from a former key"
  // without brackets, so AND bound first: a check derived from a former key matched in any task, done
  // or not. Kept as it was; the port is not the place to change what it ticks.
  const byKey = await uow.find("checks", { taskId: child.parentId, done: false, derivedFrom: child.key });
  const byAlias = aliases.length ? await uow.find("checks", { derivedFrom: aliases }) : [];
  const rows = [...new Map([...byKey, ...byAlias].map((c) => [c.id, c])).values()];
  if (!rows.length) return;
  const parent = await uow.get("tasks", { id: child.parentId });
  for (const c of rows) {
    await uow.update("checks", { id: c.id }, { done: true, doneAt: uow.now, doneBy: by });
    await emit("check.set", { id: parent!.id, key: parent!.key }, { n: c.n, text: c.text, done: true, derived_from: child.key }, by);
  }
}

// Entering In review, Merged, Released or Done needs every check done or waived (R-13).
export async function assertChecksClosed(tx: Q, t: Pick<Task, "id">): Promise<void> {
  const open = (await readerOf(tx).find("checks", { taskId: t.id, done: false, waivedAt: null }, { orderBy: [{ column: "n" }] })).map((c) => ({ n: c.n, text: c.text }));
  // 2.13: each open check with its text, so the caller knows what is left without another read.
  if (open.length) throw new ToolError("CHECKS_OPEN", { open: open.map((c) => c.n), checks: open, hint: "set_check done (or add_result check_ns), or waive_check with a reason" });
}

function checkOwner(t: Task, ctx: Ctx): void {
  const owner = liveOwner(t);
  if (owner && owner.session_id !== ctx.actor.session_id && !ctx.human) {
    throw new ToolError("NOT_OWNER", { owner, lease_until: iso(t.leaseUntil) });
  }
}

// Appends leave the version alone but still date the task.
const touch = async (tx: Q, t: Task) => {
  const uow = uowOf(tx);
  return (await uow.update("tasks", { id: t.id }, { updatedAt: uow.now }))[0] as Task;
};

// Replaces the list. Returns [old texts, new texts] for the task.updated event, or null if unchanged.
export async function replaceChecks(tx: Q, taskId: string, items: CheckInput[]): Promise<[string[], string[]] | null> {
  const uow = uowOf(tx);
  const existing = await uow.find("checks", { taskId }, { orderBy: [{ column: "position" }] });
  const byN = new Map(existing.map((c) => [c.n, c]));
  const kept = new Set<number>();
  for (const item of items) {
    if (item.n === undefined) continue;
    if (!byN.has(item.n) || kept.has(item.n)) throw new ToolError("CHECK_NOT_FOUND", { n: item.n });
    kept.add(item.n);
  }
  let next = Math.max(0, ...existing.map((c) => c.n)) + 1;
  const removed = existing.filter((c) => !kept.has(c.n)).map((c) => c.id);
  for (const id of removed) await uow.delete("checks", { id });
  for (const [position, item] of items.entries()) {
    const derived = item.derived_from === undefined ? {} : { derivedFrom: item.derived_from?.trim() || null };
    if (item.n !== undefined) {
      await uow.update("checks", { taskId, n: item.n }, { text: item.text, position, ...derived });
    } else {
      await uow.insert("checks", { taskId, n: next++, position, text: item.text, ...derived });
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
  const uow = uowOf(tx);
  // A missing n names no check (the port would read a missing value as "any").
  const before = input.n == null ? undefined : await uow.get("checks", { taskId: t.id, n: input.n });
  if (!before) throw new ToolError("CHECK_NOT_FOUND", { n: input.n });
  const amended = input.text !== undefined && input.text.trim() && input.text !== before.text ? input.text : undefined;
  const [c] = await uow.update(
    "checks",
    { id: before.id },
    {
      ...(input.done !== undefined ? { done: input.done, doneAt: input.done ? uow.now : null, doneBy: input.done ? ctx.actor : null } : {}),
      ...(input.evidence_id !== undefined ? { evidenceId: input.evidence_id } : {}),
      ...(amended !== undefined ? { text: amended } : {}),
      ...(input.waived === false ? { waivedAt: null, waivedBy: null, waiveReason: null, approvalId: null } : {}),
    },
  );
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
  const uow = uowOf(tx);
  const before = input.n == null ? undefined : await uow.get("checks", { taskId: t.id, n: input.n });
  if (!before) throw new ToolError("CHECK_NOT_FOUND", { n: input.n });
  const [c] = await uow.update("checks", { id: before.id }, { waivedAt: uow.now, waivedBy: ctx.actor, waiveReason: input.reason.trim(), approvalId: null });
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
