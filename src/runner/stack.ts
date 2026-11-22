// PLA-I73-2: stacked steps. With settings.velocidad.apilar on, a chained step goes Ready as soon as the step it waits
// on is delivered (In review with a branch: src/mcp/blockers.ts chainedReady). Its worktree is cut from that branch,
// so it builds on code that is not in the start branch yet; its PR still goes to the start branch and shows the step
// under it too until that one merges. It may only be accepted after the step under it (stackHold).
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Q } from "../mcp/tx.js";
import { projects, taskBlockers, tasks } from "../db/schema.js";
import { velocidadOf } from "./velocidad.js";

const LANDED = ["Merged", "Released", "Done"];

export type StackBase = { key: string; title: string; branch: string; status: string };

/** The step this one is stacked on: its one unlanded task blocker, when that blocker has a branch. */
export async function stackBaseOf(db: Q, taskId: string): Promise<StackBase | null> {
  const rows = await db
    .select({ key: tasks.key, title: tasks.title, branch: tasks.branch, status: tasks.status, projectId: tasks.projectId })
    .from(taskBlockers)
    .innerJoin(tasks, eq(tasks.id, taskBlockers.blockerId))
    .where(and(eq(taskBlockers.taskId, taskId), notInArray(tasks.status, LANDED)));
  if (rows.length !== 1) return null;
  const b = rows[0]!;
  if (!b.branch?.trim()) return null;
  const [p] = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, b.projectId)).limit(1);
  if (!velocidadOf(p?.settings).apilar) return null;
  return { key: b.key, title: b.title, branch: b.branch.trim(), status: b.status };
}

/** Why this step cannot be accepted yet: a step it waits on has not landed. null: it may be accepted. */
export async function stackHold(db: Q, taskId: string): Promise<StackBase | null> {
  const [b] = await db
    .select({ key: tasks.key, title: tasks.title, branch: tasks.branch, status: tasks.status })
    .from(taskBlockers)
    .innerJoin(tasks, eq(tasks.id, taskBlockers.blockerId))
    .where(and(eq(taskBlockers.taskId, taskId), notInArray(tasks.status, [...LANDED, "Won't do"])))
    .limit(1);
  return b ? { key: b.key, title: b.title, branch: b.branch ?? "", status: b.status } : null;
}

/** Open steps stacked on this one (they wait on it and have started): told when it goes back to Taller. */
export async function stackedOn(db: Q, blockerId: string): Promise<{ id: string; key: string }[]> {
  return db
    .select({ id: tasks.id, key: tasks.key })
    .from(taskBlockers)
    .innerJoin(tasks, eq(tasks.id, taskBlockers.taskId))
    .where(and(eq(taskBlockers.blockerId, blockerId), inArray(tasks.status, ["Ready", "In progress", "In review"])));
}
