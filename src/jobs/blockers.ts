import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { blockers, projects, tasks } from "../db/schema.js";
import { projectsWithChainedReady, promoteUnblocked } from "../mcp/blockers.js";
import { SYSTEM_ACTOR, writeTx } from "../mcp/tx.js";
import type { Job } from "./index.js";
import { ST } from "../state/status.js";

// time_after blockers are satisfied by the clock alone, so a job checks every 30 s for Blocked
// tickets whose blockers all hold and moves them to Ready (promoteUnblocked does the rest).
// PLA-54: it also sweeps Backlog chain steps whose blockers landed (promoteChained).

export async function promoteDue(db: Db, now = new Date()): Promise<number> {
  const due = await db
    .selectDistinct({ projectId: tasks.projectId, slug: projects.slug })
    .from(blockers)
    .innerJoin(tasks, eq(tasks.id, blockers.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(sql`${tasks.status} = ${ST.blocked} and ${blockers.type} = 'time_after' and (${blockers.spec}->>'at')::timestamptz <= ${now.toISOString()}::timestamptz`);
  // PLA-54: chain steps whose blockers landed while nothing promoted them (before PLA-54, or a raw write).
  const chained = await projectsWithChainedReady(db);
  for (const c of chained) if (!due.some((d) => d.projectId === c.projectId)) due.push(c);
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
