// PLA-16: a runner run that ended in fail still holds its ticket. The ticket stayed In progress until the
// lease ran out and nothing continued it. Each heartbeat tick this frees those tickets:
//   first failure in a row    the ticket goes back to Ready and the same agent is queued on it once more
//                             (the run resumes its session in the same worktree, so it keeps what it did)
//   second failure in a row   the ticket goes to Blocked with a line for Jorge (a step in his inbox); when he
//                             marks it done the ticket returns to Ready and the event hook wakes the role
// "In a row" counts this agent's finished runs on the ticket, newest first, up to the first that did not
// fail. Odd: retry. Even: ask. So each time Jorge lets it go on, the agent gets two attempts again.
// A stopped run is not a failure (Jorge or a switch stopped it). A run that ended ok without closing its
// ticket is left to the lease: the reaper wakes the role when it runs out (src/runner/events.ts).
// The retry waits while the agent is busy or a switch is off: the ticket is freed only once its wake is queued.
import { hostname } from "node:os";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, projects, tasks, type Agent, type Project, type Task } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { SYSTEM_ACTOR, writeTx, type Ctx, type Emit, type Q } from "../mcp/tx.js";
import { setTask } from "../mcp/writes.js";
import { queueWake } from "./events.js";

// Plania itself, as a plain writer: the system flag is for the pollers, whose moves stop at Merged and
// Released (SYSTEM_MOVES in src/mcp/lifecycle.ts), and Ready → Blocked is an ordinary ticket move.
const ctx = (): Ctx => ({ actor: { ...SYSTEM_ACTOR, machine: hostname() }, tool: "runner.failed_run" });

// "fail: error_max_turns (41 turns, session 491bc14d)" → "error_max_turns (41 turns)"
export const failureWords = (summary: string): string =>
  summary
    .replace(/^fail:\s*/i, "")
    .replace(/,?\s*session [0-9a-z-]+/gi, "")
    .replace(/\(\s*\)/g, "")
    .trim() || "sin detalle";

type Held = { task_id: string; key: string; project_id: string; run_id: string; agent_id: string; summary: string } & Record<string, unknown>;

// How many of this agent's finished runs on the ticket failed in a row, newest first.
export async function failStreak(db: Q, agentId: string, projectId: string, key: string): Promise<number> {
  const runs = await db
    .select({ status: agentRuns.status })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.projectId, projectId), eq(agentRuns.taskKey, key), inArray(agentRuns.status, ["ok", "fail", "stopped"])))
    .orderBy(desc(sql`coalesce(${agentRuns.endedAt}, ${agentRuns.queuedAt})`), desc(agentRuns.queuedAt))
    .limit(50);
  let n = 0;
  for (const r of runs) {
    if (r.status !== "fail") break;
    n += 1;
  }
  return n;
}

// The dead run's lease comes off and the ticket goes back to Ready, only if that run still holds it.
async function free(tx: Q, emit: Emit, row: Held, reason: string): Promise<Task | null> {
  const session = `run-${row.run_id.slice(0, 8)}`;
  const [before] = await tx.select({ owner: tasks.owner }).from(tasks).where(eq(tasks.id, row.task_id)).limit(1);
  const [u] = await tx
    .update(tasks)
    .set({ owner: null, claimedAt: null, leaseUntil: null, expiringWarnedAt: null, status: "Ready", statusChangedAt: sql`now()`, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(tasks.id, row.task_id), eq(tasks.status, "In progress"), sql`${tasks.owner}->>'session_id' = ${session}`))
    .returning();
  if (!u) return null;
  await emit("claim.released", u, { owner: before?.owner ?? null, from: "In progress", to: "Ready", reason });
  return u;
}

async function retry(db: Db, p: Project, agent: Agent, row: Held): Promise<boolean> {
  return writeTx(db, p, ctx(), async (tx, emit) => {
    const [t] = await tx.select({ status: tasks.status, owner: tasks.owner }).from(tasks).where(eq(tasks.id, row.task_id)).limit(1);
    // The lease may have run out inside this write: the reaper already freed the ticket and woke its role.
    if (!t || t.status !== "In progress") return false;
    const task = { id: row.task_id, key: row.key };
    const out = await queueWake(tx, p, task, { agent, taskKey: row.key, reason: "retry after a failed run" }, "run.failed");
    if (out.kind !== "queued") return false;
    const u = await free(tx, emit, row, "run failed");
    if (!u) throw new Error(`PLA-16: ${row.key} changed hands inside the retry`);
    await emit("note", u, { text: `La corrida de ${agent.name} terminó con error (${failureWords(row.summary)}). Plania liberó el ticket y lo reintenta una vez, en la misma sesión.` });
    return true;
  });
}

async function hold(db: Db, p: Project, agent: Agent, row: Held): Promise<boolean> {
  const freed = await writeTx(db, p, ctx(), (tx, emit) => free(tx, emit, row, "run failed twice"));
  if (!freed) return false;
  try {
    await setTask(
      db,
      {
        project: p.slug,
        key: row.key,
        status: "Blocked",
        version: freed.version,
        note: `Jorge: ${agent.name} falló dos veces seguidas en este paso (${failureWords(row.summary)}). Revisa qué lo detiene; cuando marques esto como hecho, lo retoma.`,
      } as never,
      ctx(),
    );
  } catch (error) {
    // Someone took or changed the freed ticket in between: it is theirs now. Anything else is a defect and
    // must be loud, or the ticket would sit in Ready with nobody told.
    if (!(error instanceof ToolError) || !["STALE_VERSION", "NOT_OWNER"].includes(error.code)) throw error;
    return false;
  }
  return true;
}

export async function sweepFailedRuns(db: Db): Promise<{ retried: number; held: number }> {
  const found = await db.execute<Held>(sql`
    select t.id as task_id, t.key, t.project_id, r.id as run_id, r.agent_id, r.summary
    from tasks t
    join agent_runs r on r.project_id = t.project_id and r.task_key = t.key and 'run-' || left(r.id::text, 8) = t.owner->>'session_id'
    where t.kind = 'ticket' and t.status = 'In progress' and r.status = 'fail'
    order by r.ended_at, r.id`);
  const out = { retried: 0, held: 0 };
  for (const row of found.rows) {
    const [p] = await db.select().from(projects).where(eq(projects.id, row.project_id)).limit(1);
    const [agent] = await db.select().from(agents).where(eq(agents.id, row.agent_id)).limit(1);
    if (!p || !agent) continue;
    const streak = await failStreak(db, row.agent_id, row.project_id, row.key);
    // A newer run of this agent on the ticket did not fail: the old lease is left to run out.
    if (streak === 0) continue;
    if (streak % 2 === 1) out.retried += Number(await retry(db, p, agent, row));
    else out.held += Number(await hold(db, p, agent, row));
  }
  return out;
}
