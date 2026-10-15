import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { blockers, envCommits, envStates, projectMetrics, taskAliases, taskBlockers, tasks, type Actor, type Task } from "../db/schema.js";
import { ToolError } from "./errors.js";
import { gatingSql, isGating } from "./jorge-lines.js";
import { SYSTEM_ACTOR, iso, type Emit, type Q } from "./tx.js";

// blocked_by: a ticket (a key, or {task}) that must reach In review or later, or a typed blocker
// the server evaluates (R-15):
//   {env, condition, value}            contains_commit <sha> | migration_gte <n> | deployed_after [ISO]
//   {human_action: {assignee, text}}   cleared by Jorge from the inbox
//   {env_flag: {env, flag, equals}}    a flag set with set_env
//   {time_after: ISO}                  the clock
//   {metric_gte: {name, value}}        a metric reported with set_metric or on a result
// get_task reports each with satisfied. When every blocker of a Blocked ticket holds, the server
// moves it to Ready on its own (blocker.satisfied).

export const ENV_CONDITIONS = ["contains_commit", "migration_gte", "deployed_after"] as const;
export const BLOCKER_TYPES = ["env", "human_action", "env_flag", "time_after", "metric_gte"] as const;
export const SETTLED_STATUSES = ["In review", "Merged", "Released", "Done"] as const;

export type BlockerInput =
  | string
  | { task: string }
  | { env: string; condition: string; value?: string | number }
  | { human_action: { assignee?: string; text: string; before_release?: boolean } }
  | { env_flag: { env: string; flag: string; equals: string | number | boolean } }
  | { time_after: string }
  | { metric_gte: { name: string; value: number } };

export type TypedBlocker = { type: (typeof BLOCKER_TYPES)[number]; spec: Record<string, unknown> };

export const ENV_NAME = /^[a-z][a-z0-9_-]{0,29}$/;
export const METRIC_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const SHA = /^[0-9a-f]{7,40}$/;

function envBlocker(b: { env: string; condition: string; value?: string | number }): TypedBlocker {
  const bad = (hint: string) => new ToolError("INVALID_ENV_CONDITION", { ...b, hint });
  if (!ENV_NAME.test(b.env)) throw bad("env is lowercase, e.g. prod");
  const raw = b.value === undefined ? undefined : String(b.value).trim();
  switch (b.condition) {
    case "contains_commit":
      if (!raw || !SHA.test(raw.toLowerCase())) throw bad("value is a commit sha (7-40 hex)");
      return { type: "env", spec: { env: b.env, condition: b.condition, value: raw.toLowerCase() } };
    case "migration_gte":
      if (!raw || !/^\d{1,6}$/.test(raw)) throw bad("value is a migration number, e.g. 9 or 0009");
      return { type: "env", spec: { env: b.env, condition: b.condition, value: String(Number(raw)) } };
    case "deployed_after": {
      // Without a value: deployed after now, i.e. the next deploy. The server sets the time.
      const at = raw ? new Date(raw) : new Date();
      if (Number.isNaN(at.getTime())) throw bad("value is an ISO-8601 time, or omit it for 'the next deploy'");
      return { type: "env", spec: { env: b.env, condition: b.condition, value: at.toISOString() } };
    }
    default:
      throw bad(`condition is one of ${ENV_CONDITIONS.join(", ")}`);
  }
}

function typedBlocker(b: Exclude<BlockerInput, string | { task: string } | { env: string; condition: string; value?: string | number }>): TypedBlocker {
  const bad = (type: string, hint: string) => new ToolError("INVALID_BLOCKER", { type, hint });
  if ("human_action" in b) {
    const text = b.human_action?.text?.trim();
    if (!text) throw bad("human_action", "text says what Jorge has to do");
    return { type: "human_action", spec: { assignee: b.human_action.assignee?.trim() || "jorge", text, ...(b.human_action.before_release ? { before_release: true } : {}) } };
  }
  if ("env_flag" in b) {
    const f = b.env_flag ?? ({} as { env?: string; flag?: string; equals?: unknown });
    if (!f.env || !ENV_NAME.test(f.env)) throw bad("env_flag", "env is lowercase, e.g. prod");
    if (!f.flag || !/^[a-z][a-z0-9_]{0,59}$/.test(f.flag)) throw bad("env_flag", "flag is a snake_case name");
    if (!["string", "number", "boolean"].includes(typeof f.equals)) throw bad("env_flag", "equals is a string, number or boolean");
    return { type: "env_flag", spec: { env: f.env, flag: f.flag, equals: f.equals } };
  }
  if ("time_after" in b) {
    const at = new Date(b.time_after);
    if (!b.time_after || Number.isNaN(at.getTime())) throw bad("time_after", "an ISO-8601 time");
    return { type: "time_after", spec: { at: at.toISOString() } };
  }
  if ("metric_gte" in b) {
    const m = b.metric_gte ?? ({} as { name?: string; value?: unknown });
    if (!m.name || !METRIC_NAME.test(m.name)) throw bad("metric_gte", "name is lowercase, e.g. pickevent_nights");
    if (typeof m.value !== "number" || !Number.isFinite(m.value)) throw bad("metric_gte", "value is a number");
    return { type: "metric_gte", spec: { name: m.name, value: m.value } };
  }
  throw bad("unknown", "a task key, {task}, {env, condition, value}, {human_action}, {env_flag}, {time_after} or {metric_gte}");
}

export function parseBlockers(inputs: BlockerInput[]): { keys: string[]; typed: TypedBlocker[] } {
  const keys: string[] = [];
  const typed: TypedBlocker[] = [];
  for (const b of inputs) {
    if (typeof b === "string") keys.push(b);
    else if ("task" in b) keys.push(b.task);
    else if ("env" in b && "condition" in b) typed.push(envBlocker(b));
    else typed.push(typedBlocker(b));
  }
  return { keys: [...new Set(keys)], typed };
}

// Maps blocker keys to ids (aliases included). Unknown keys, and a task naming itself, are BLOCKER_NOT_FOUND.
export async function resolveTaskBlockers(db: Q, projectId: string, keys: string[], selfKey: string): Promise<string[]> {
  if (keys.length === 0) return [];
  if (keys.includes(selfKey)) throw new ToolError("BLOCKER_NOT_FOUND", { key: selfKey });
  const rows = await db
    .select({ id: tasks.id, key: tasks.key, alias: taskAliases.alias })
    .from(tasks)
    .leftJoin(taskAliases, and(eq(taskAliases.taskId, tasks.id), inArray(taskAliases.alias, keys)))
    .where(and(eq(tasks.projectId, projectId), or(inArray(tasks.key, keys), inArray(taskAliases.alias, keys))));
  const found = new Set(rows.flatMap((r) => [r.key, r.alias].filter((k): k is string => !!k)));
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) throw new ToolError("BLOCKER_NOT_FOUND", { keys: missing });
  if (rows.some((r) => r.key === selfKey)) throw new ToolError("BLOCKER_NOT_FOUND", { key: selfKey });
  return [...new Set(rows.map((r) => r.id))];
}

export async function replaceBlockers(tx: Q, taskId: string, blockerIds: string[], typed: TypedBlocker[]): Promise<void> {
  await tx.delete(taskBlockers).where(eq(taskBlockers.taskId, taskId));
  // A human action already cleared stays cleared when the same list is written again.
  // 2.10: blockers parsed from a "Jorge:" line belong to their text, not to blocked_by: they stay, and
  // a human action in the list with the same text as one of them is not written twice.
  const existing = await tx.select().from(blockers).where(eq(blockers.taskId, taskId));
  const parsedTexts = new Set(existing.filter((e) => e.spec.source === "parsed").map((e) => String(e.spec.text)));
  await tx.delete(blockers).where(and(eq(blockers.taskId, taskId), sql`coalesce(${blockers.spec}->>'source', '') <> 'parsed'`));
  if (blockerIds.length) await tx.insert(taskBlockers).values(blockerIds.map((blockerId) => ({ taskId, blockerId })));
  typed = typed.filter((b) => !(b.type === "human_action" && parsedTexts.has(String(b.spec.text))));
  if (typed.length) {
    await tx.insert(blockers).values(
      typed.map((b) => {
        const same = existing.find((e) => e.type === b.type && JSON.stringify(e.spec) === JSON.stringify(b.spec));
        return { taskId, type: b.type, spec: b.spec, satisfiedAt: same?.satisfiedAt ?? null, satisfiedBy: same?.satisfiedBy ?? null };
      }),
    );
  }
}

// SQL: true when the task (by id expression) has a blocker that does not hold yet.
export function hasUnsatisfiedBlocker(taskId: unknown) {
  return sql`(
    exists (
      select 1 from ${taskBlockers} tb join ${tasks} b on b.id = tb.blocker_id
      where tb.task_id = ${taskId} and b.status not in ('In review', 'Merged', 'Released', 'Done')
    )
    or exists (
      select 1 from ${blockers} bl
      join ${tasks} bt on bt.id = bl.task_id
      left join ${envStates} es on es.project_id = bt.project_id and es.env = bl.spec->>'env'
      where bl.task_id = ${taskId} and ${gatingSql("bl")} and not coalesce(case bl.type
        when 'env' then case bl.spec->>'condition'
          when 'migration_gte' then es.migrations_applied >= (bl.spec->>'value')::int
          when 'deployed_after' then es.deployed_at > (bl.spec->>'value')::timestamptz
          when 'contains_commit' then exists (
            select 1 from ${envCommits} ec
            where ec.project_id = bt.project_id and ec.env = bl.spec->>'env' and ec.sha like (bl.spec->>'value') || '%'
          )
        end
        when 'human_action' then bl.satisfied_at is not null
        when 'env_flag' then es.flags -> (bl.spec->>'flag') = bl.spec -> 'equals'
        when 'time_after' then now() >= (bl.spec->>'at')::timestamptz
        when 'metric_gte' then exists (
          select 1 from ${projectMetrics} pm
          where pm.project_id = bt.project_id and pm.name = bl.spec->>'name' and pm.value >= (bl.spec->>'value')::numeric
        )
      end, false)
    )
  )`;
}

export type BlockerView =
  | { type: "task"; task: string; status: string; satisfied: boolean }
  | { type: "env"; env: string; condition: string; value: string; current: unknown; satisfied: boolean }
  | { type: "human_action"; id: string; assignee: string; text: string; satisfied: boolean; satisfied_at: string | null; source?: "parsed"; field?: string; gating?: boolean }
  | { type: "env_flag"; env: string; flag: string; equals: unknown; current: unknown; satisfied: boolean }
  | { type: "time_after"; at: string; satisfied: boolean }
  | { type: "metric_gte"; name: string; value: number; current: number | null; satisfied: boolean };

// Every blocker of a task with whether it holds now.
export async function blockerList(db: Q, t: Pick<Task, "id" | "projectId">): Promise<BlockerView[]> {
  const taskRows = await db
    .select({ task: tasks.key, status: tasks.status })
    .from(taskBlockers)
    .innerJoin(tasks, eq(tasks.id, taskBlockers.blockerId))
    .where(eq(taskBlockers.taskId, t.id))
    .orderBy(asc(tasks.key));
  const out: BlockerView[] = taskRows.map((r) => ({ type: "task", ...r, satisfied: (SETTLED_STATUSES as readonly string[]).includes(r.status) }));
  const rows = await db.select().from(blockers).where(eq(blockers.taskId, t.id)).orderBy(asc(blockers.type), asc(blockers.createdAt));
  const envOf = async (env: string) =>
    (await db.select().from(envStates).where(and(eq(envStates.projectId, t.projectId), eq(envStates.env, env))).limit(1))[0];
  for (const b of rows) {
    const spec = b.spec as Record<string, string>;
    if (b.type === "env") {
      const s = await envOf(spec.env!);
      let current: unknown = null;
      let satisfied = false;
      if (spec.condition === "migration_gte") {
        current = s?.migrationsApplied ?? null;
        satisfied = s?.migrationsApplied != null && s.migrationsApplied >= Number(spec.value);
      } else if (spec.condition === "deployed_after") {
        current = iso(s?.deployedAt ?? null);
        satisfied = !!s?.deployedAt && s.deployedAt > new Date(spec.value!);
      } else {
        current = s?.commit ?? null;
        const [hit] = await db
          .select({ sha: envCommits.sha })
          .from(envCommits)
          .where(and(eq(envCommits.projectId, t.projectId), eq(envCommits.env, spec.env!), sql`${envCommits.sha} like ${spec.value} || '%'`))
          .limit(1);
        satisfied = !!hit;
      }
      out.push({ type: "env", env: spec.env!, condition: spec.condition!, value: spec.value!, current, satisfied });
    } else if (b.type === "human_action") {
      const parsed = spec.source === "parsed" ? { source: "parsed" as const, field: spec.field!, gating: isGating(b.spec) } : {};
      out.push({ type: "human_action", id: b.id, assignee: spec.assignee!, text: spec.text!, satisfied: !!b.satisfiedAt, satisfied_at: iso(b.satisfiedAt), ...parsed });
    } else if (b.type === "env_flag") {
      const s = await envOf(spec.env!);
      const current = s?.flags?.[spec.flag!] ?? null;
      out.push({ type: "env_flag", env: spec.env!, flag: spec.flag!, equals: b.spec.equals, current, satisfied: current !== null && current === b.spec.equals });
    } else if (b.type === "time_after") {
      out.push({ type: "time_after", at: spec.at!, satisfied: new Date(spec.at!) <= new Date() });
    } else {
      const [m] = await db
        .select({ value: projectMetrics.value })
        .from(projectMetrics)
        .where(and(eq(projectMetrics.projectId, t.projectId), eq(projectMetrics.name, spec.name!)))
        .limit(1);
      const current = m?.value ?? null;
      out.push({ type: "metric_gte", name: spec.name!, value: Number(b.spec.value), current, satisfied: current !== null && current >= Number(b.spec.value) });
    }
  }
  return out;
}

export async function unsatisfiedBlockers(db: Q, t: Pick<Task, "id" | "projectId">) {
  // A line parsed from free text (outside blocked_note) reaches the inbox but never holds a claim.
  return (await blockerList(db, t)).filter((b) => !b.satisfied && !(b.type === "human_action" && b.gating === false));
}

// Blocked tickets that have blockers and none left unsatisfied go back to Ready, by the server.
// Runs at the end of writes that may have satisfied one (set_env, set_metric, a status change,
// a human action resolved) and from the blockers job for time_after.
export async function promoteUnblocked(tx: Q, emit: Emit, projectId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: tasks.id, key: tasks.key })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.status, "Blocked"),
        sql`(exists (select 1 from ${taskBlockers} tb where tb.task_id = ${tasks.id}) or exists (select 1 from ${blockers} bl where bl.task_id = ${tasks.id} and ${gatingSql("bl")}))`,
        sql`not ${hasUnsatisfiedBlocker(tasks.id)}`,
      ),
    );
  const promoted: string[] = [];
  for (const r of rows) {
    const [u] = await tx
      .update(tasks)
      .set({ status: "Ready", blockedNote: null, statusChangedAt: sql`now()`, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(tasks.id, r.id), eq(tasks.status, "Blocked")))
      .returning({ id: tasks.id, key: tasks.key });
    if (!u) continue;
    const satisfied = await blockerList(tx, { id: r.id, projectId });
    await emit("blocker.satisfied", u, { blockers: satisfied }, SYSTEM_ACTOR);
    await emit("task.status", u, { from: "Blocked", to: "Ready" }, SYSTEM_ACTOR);
    promoted.push(u.key);
  }
  return promoted;
}

// Jorge resolves a human action (the inbox); the ticket may move to Ready right away.
export async function resolveHumanAction(tx: Q, emit: Emit, projectId: string, blockerId: string, by: Actor, note?: string) {
  const [b] = await tx
    .select({ b: blockers, taskKey: tasks.key, taskId: tasks.id })
    .from(blockers)
    .innerJoin(tasks, eq(tasks.id, blockers.taskId))
    .where(and(sql`${blockers.id}::text = ${blockerId}`, eq(tasks.projectId, projectId), eq(blockers.type, "human_action")))
    .limit(1);
  if (!b) throw new ToolError("BLOCKER_NOT_FOUND", { blocker_id: blockerId });
  if (!b.b.satisfiedAt) {
    await tx.update(blockers).set({ satisfiedAt: sql`now()`, satisfiedBy: by }).where(eq(blockers.id, b.b.id));
    await emit("blocker.resolved", { id: b.taskId, key: b.taskKey }, { blocker_id: b.b.id, text: (b.b.spec as { text: string }).text });
  }
  // 2.10: what Jorge says about it lands in the ticket's log as his note.
  if (note?.trim()) await emit("note", { id: b.taskId, key: b.taskKey }, { text: note.trim(), blocker_id: b.b.id }, by);
  await promoteUnblocked(tx, emit, projectId);
  return { blocker_id: b.b.id, key: b.taskKey };
}

// Human actions waiting on Jorge, for the inbox.
export async function openHumanActions(db: Q, projectId: string) {
  return db
    .select({ b: blockers, t: tasks })
    .from(blockers)
    .innerJoin(tasks, eq(tasks.id, blockers.taskId))
    .where(and(eq(tasks.projectId, projectId), eq(blockers.type, "human_action"), isNull(blockers.satisfiedAt), sql`${tasks.status} not in ('Done', 'Won''t do')`))
    .orderBy(asc(blockers.createdAt));
}

export async function setMetricInTx(tx: Q, emit: Emit, projectId: string, name: string, value: number, by: Actor) {
  if (!METRIC_NAME.test(name)) throw new ToolError("INVALID_METRIC", { field: "name" });
  if (!Number.isInteger(value)) throw new ToolError("INVALID_METRIC", { field: "value" });
  await tx
    .insert(projectMetrics)
    .values({ projectId, name, value, by })
    .onConflictDoUpdate({ target: [projectMetrics.projectId, projectMetrics.name], set: { value, by, updatedAt: sql`now()` } });
  await emit("metric.set", null, { name, value });
  await promoteUnblocked(tx, emit, projectId);
  return { name, value };
}

export async function projectMetricsOf(db: Q, projectId: string) {
  const rows = await db.select().from(projectMetrics).where(eq(projectMetrics.projectId, projectId)).orderBy(asc(projectMetrics.name));
  return Object.fromEntries(rows.map((m) => [m.name, { value: m.value, by: m.by, updated_at: iso(m.updatedAt) }]));
}
