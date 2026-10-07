import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { envBlockers, envCommits, envStates, taskBlockers, tasks, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { iso, type Q } from "./tx.js";

// blocked_by: a ticket (a key, or {task}) that must reach In review or Done, or an environment
// condition ({env, condition, value}) that must hold. get_task reports each with satisfied.

export const ENV_CONDITIONS = ["contains_commit", "migration_gte", "deployed_after"] as const;
export const SETTLED_STATUSES = ["In review", "Done"] as const;

export type BlockerInput = string | { task: string } | { env: string; condition: string; value?: string | number };
type EnvBlocker = { env: string; condition: string; value: string };

export const ENV_NAME = /^[a-z][a-z0-9_-]{0,29}$/;
const SHA = /^[0-9a-f]{7,40}$/;

function envBlocker(b: { env: string; condition: string; value?: string | number }): EnvBlocker {
  const bad = (hint: string) => new ToolError("INVALID_ENV_CONDITION", { ...b, hint });
  if (!ENV_NAME.test(b.env)) throw bad("env is lowercase, e.g. prod");
  const raw = b.value === undefined ? undefined : String(b.value).trim();
  switch (b.condition) {
    case "contains_commit":
      if (!raw || !SHA.test(raw.toLowerCase())) throw bad("value is a commit sha (7-40 hex)");
      return { env: b.env, condition: b.condition, value: raw.toLowerCase() };
    case "migration_gte":
      if (!raw || !/^\d{1,6}$/.test(raw)) throw bad("value is a migration number, e.g. 9 or 0009");
      return { env: b.env, condition: b.condition, value: String(Number(raw)) };
    case "deployed_after": {
      // Without a value: deployed after now, i.e. the next deploy. The server sets the time.
      const at = raw ? new Date(raw) : new Date();
      if (Number.isNaN(at.getTime())) throw bad("value is an ISO-8601 time, or omit it for 'the next deploy'");
      return { env: b.env, condition: b.condition, value: at.toISOString() };
    }
    default:
      throw bad(`condition is one of ${ENV_CONDITIONS.join(", ")}`);
  }
}

export function parseBlockers(inputs: BlockerInput[]): { keys: string[]; env: EnvBlocker[] } {
  const keys: string[] = [];
  const env: EnvBlocker[] = [];
  for (const b of inputs) {
    if (typeof b === "string") keys.push(b);
    else if ("task" in b) keys.push(b.task);
    else env.push(envBlocker(b));
  }
  return { keys: [...new Set(keys)], env };
}

// Maps blocker keys to ids. Unknown keys, and a task naming itself, are BLOCKER_NOT_FOUND.
export async function resolveTaskBlockers(db: Q, projectId: string, keys: string[], selfKey: string): Promise<string[]> {
  if (keys.length === 0) return [];
  if (keys.includes(selfKey)) throw new ToolError("BLOCKER_NOT_FOUND", { key: selfKey });
  const rows = await db
    .select({ id: tasks.id, key: tasks.key })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.key, keys)));
  if (rows.length !== keys.length) {
    const found = new Set(rows.map((r) => r.key));
    throw new ToolError("BLOCKER_NOT_FOUND", { keys: keys.filter((k) => !found.has(k)) });
  }
  return rows.map((r) => r.id);
}

export async function replaceBlockers(tx: Q, taskId: string, blockerIds: string[], env: EnvBlocker[]): Promise<void> {
  await tx.delete(taskBlockers).where(eq(taskBlockers.taskId, taskId));
  await tx.delete(envBlockers).where(eq(envBlockers.taskId, taskId));
  if (blockerIds.length) await tx.insert(taskBlockers).values(blockerIds.map((blockerId) => ({ taskId, blockerId })));
  if (env.length) await tx.insert(envBlockers).values(env.map((e) => ({ taskId, ...e })));
}

// SQL: true when the task (by id expression) has a blocker that does not hold yet.
export function hasUnsatisfiedBlocker(taskId: unknown) {
  return sql`(
    exists (
      select 1 from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id
      where tb.task_id = ${taskId} and b.status not in ('In review', 'Done')
    )
    or exists (
      select 1 from ${envBlockers} eb
      join ${tasks} bt on bt.id = eb.task_id
      left join ${envStates} es on es.project_id = bt.project_id and es.env = eb.env
      where eb.task_id = ${taskId} and not coalesce(case eb.condition
        when 'migration_gte' then es.migrations_applied >= eb.value::int
        when 'deployed_after' then es.deployed_at > eb.value::timestamptz
        when 'contains_commit' then exists (
          select 1 from ${envCommits} ec
          where ec.project_id = bt.project_id and ec.env = eb.env and ec.sha like eb.value || '%'
        )
      end, false)
    )
  )`;
}

// Every blocker of a task with whether it holds now.
export async function blockerList(db: Q, t: Pick<Task, "id" | "projectId">) {
  const taskRows = await db
    .select({ task: tasks.key, status: tasks.status })
    .from(taskBlockers)
    .innerJoin(tasks, eq(tasks.id, taskBlockers.blockerId))
    .where(eq(taskBlockers.taskId, t.id))
    .orderBy(asc(tasks.key));
  const envRows = await db
    .select({ b: envBlockers, s: envStates })
    .from(envBlockers)
    .leftJoin(envStates, and(eq(envStates.projectId, t.projectId), eq(envStates.env, envBlockers.env)))
    .where(eq(envBlockers.taskId, t.id))
    .orderBy(asc(envBlockers.env), asc(envBlockers.condition));
  const out: (
    | { task: string; status: string; satisfied: boolean }
    | { env: string; condition: string; value: string; current: unknown; satisfied: boolean }
  )[] = taskRows.map((r) => ({ ...r, satisfied: (SETTLED_STATUSES as readonly string[]).includes(r.status) }));
  for (const { b, s } of envRows) {
    let current: unknown = null;
    let satisfied = false;
    if (b.condition === "migration_gte") {
      current = s?.migrationsApplied ?? null;
      satisfied = s?.migrationsApplied != null && s.migrationsApplied >= Number(b.value);
    } else if (b.condition === "deployed_after") {
      current = iso(s?.deployedAt ?? null);
      satisfied = !!s?.deployedAt && s.deployedAt > new Date(b.value);
    } else {
      current = s?.commit ?? null;
      const [hit] = await db
        .select({ sha: envCommits.sha })
        .from(envCommits)
        .where(and(eq(envCommits.projectId, t.projectId), eq(envCommits.env, b.env), sql`${envCommits.sha} like ${b.value} || '%'`))
        .limit(1);
      satisfied = !!hit;
    }
    out.push({ env: b.env, condition: b.condition, value: b.value, current, satisfied });
  }
  return out;
}

export async function unsatisfiedBlockers(db: Q, t: Pick<Task, "id" | "projectId">) {
  return (await blockerList(db, t)).filter((b) => !b.satisfied);
}
