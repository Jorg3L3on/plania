import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { checks, tasks, type Task } from "../db/schema.js";
import { ToolError, findProject, liveOwner, requireTask, taskShape } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// "Done when" as data. Each check has a stable n; set_check ticks one without touching the rest,
// and set_task checks replaces the list (an item that keeps its n keeps its done state).

export type CheckInput = { n?: number; text: string };

export async function taskChecks(db: Q, taskId: string) {
  const rows = await db.select().from(checks).where(eq(checks.taskId, taskId)).orderBy(asc(checks.position));
  return rows.map((c) => ({
    n: c.n,
    text: c.text,
    done: c.done,
    done_at: iso(c.doneAt),
    done_by: c.doneBy,
    evidence_id: c.evidenceId,
  }));
}

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
    if (item.n !== undefined) {
      await tx.update(checks).set({ text: item.text, position }).where(and(eq(checks.taskId, taskId), eq(checks.n, item.n)));
    } else {
      await tx.insert(checks).values({ taskId, n: next++, position, text: item.text });
    }
  }
  const before = existing.map((c) => c.text);
  const after = items.map((i) => i.text);
  return JSON.stringify(before) === JSON.stringify(after) && removed.length === 0 ? null : [before, after];
}

// Marks one check done or not. Commutative: needs no version and does not bump it.
// While another session holds a live lease, only the owner (or Jorge) ticks its checks.
export async function setCheck(
  db: Db,
  input: { project: string; key: string; n: number; done: boolean; evidence_id?: string | null },
  ctx: Ctx,
  // Set by B3: validates that evidence_id is a result of this task.
  validateEvidence?: (tx: Q, t: Task, id: string) => Promise<void>,
) {
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const t = await requireTask(tx, p.id, input.key);
    const owner = liveOwner(t);
    if (owner && owner.session_id !== ctx.actor.session_id && !ctx.human) {
      throw new ToolError("NOT_OWNER", { owner, lease_until: iso(t.leaseUntil) });
    }
    if (input.evidence_id && validateEvidence) await validateEvidence(tx, t, input.evidence_id);
    const [c] = await tx
      .update(checks)
      .set({
        done: input.done,
        doneAt: input.done ? sql`now()` : null,
        doneBy: input.done ? ctx.actor : null,
        ...(input.evidence_id !== undefined ? { evidenceId: input.evidence_id } : {}),
      })
      .where(and(eq(checks.taskId, t.id), eq(checks.n, input.n)))
      .returning();
    if (!c) throw new ToolError("CHECK_NOT_FOUND", { n: input.n });
    await tx.update(tasks).set({ updatedAt: sql`now()` }).where(eq(tasks.id, t.id));
    await emit("check.set", t, { n: c.n, text: c.text, done: c.done, evidence_id: c.evidenceId });
    return taskShape(tx, (await requireTask(tx, p.id, input.key)));
  });
}
