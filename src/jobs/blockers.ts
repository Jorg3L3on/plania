import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { blockers, projects, tasks } from "../db/schema.js";
import { promoteUnblocked } from "../mcp/blockers.js";
import { SYSTEM_ACTOR, writeTx } from "../mcp/tx.js";
import type { Job } from "./index.js";

// time_after blockers are satisfied by the clock alone, so a job checks every 30 s for Blocked
// tickets whose blockers all hold and moves them to Ready (promoteUnblocked does the rest).

export async function promoteDue(db: Db, now = new Date()): Promise<number> {
  const due = await db
    .selectDistinct({ projectId: tasks.projectId, slug: projects.slug })
    .from(blockers)
    .innerJoin(tasks, eq(tasks.id, blockers.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(sql`${tasks.status} = 'Blocked' and ${blockers.type} = 'time_after' and (${blockers.spec}->>'at')::timestamptz <= ${now.toISOString()}::timestamptz`);
  let promoted = 0;
  for (const { projectId, slug } of due) {
    const keys = await writeTx(db, { id: projectId, slug }, { actor: SYSTEM_ACTOR, tool: "jobs.blockers" }, (tx, emit) => promoteUnblocked(tx, emit, projectId));
    promoted += keys.length;
  }
  return promoted;
}

export const blockersJob: Job = {
  name: "blockers",
  intervalMs: 30 * 1000,
  runOnce: async (db, now) => ({ promoted: await promoteDue(db, now) }),
};
