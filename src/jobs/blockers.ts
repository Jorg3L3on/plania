import type { Db } from "../db/client.js";
import { projectsWithChainedReady, promoteUnblocked } from "../mcp/blockers.js";
import { SYSTEM_ACTOR, writeTx } from "../mcp/tx.js";
import { readerOf } from "../store/port.js";
import type { Job } from "./index.js";

// time_after blockers are satisfied by the clock alone, so a job checks every 30 s for Blocked
// tickets whose blockers all hold and moves them to Ready (promoteUnblocked does the rest).
// PLA-54: it also sweeps Backlog chain steps whose blockers landed (promoteChained).

export async function promoteDue(db: Db, now = new Date()): Promise<number> {
  const r = readerOf(db);
  // The projects with a Blocked ticket whose time_after has come, each once.
  const blocked = new Map((await r.find("tasks", { status: "Blocked" })).map((t) => [t.id, t]));
  const due = blocked.size ? (await r.find("blockers", { taskId: [...blocked.keys()], type: "time_after" })).filter((b) => b.spec.at != null && new Date(String(b.spec.at)).getTime() <= now.getTime()) : [];
  // PLA-54: chain steps whose blockers landed while nothing promoted them (before PLA-54, or a raw write).
  const chained = await projectsWithChainedReady(db, now);
  const projectIds = [...new Set([...due.map((b) => blocked.get(b.taskId)!.projectId), ...chained.map((c) => c.projectId)])];
  const projects = projectIds.length ? await r.find("projects", { id: projectIds }) : [];
  let promoted = 0;
  for (const { id: projectId, slug } of projects) {
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
