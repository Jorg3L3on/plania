import { isDeepStrictEqual } from "node:util";
import type { Actor, Task } from "../db/schema.js";
import { readerOf, uowOf } from "../store/port.js";
import type { Reader, Row } from "../store/types.js";
import { ToolError } from "./errors.js";
import { isGating } from "./jorge-lines.js";
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
  | { human_action: { assignee?: string; text: string; before_release?: boolean; file?: { path: string; append: string } } }
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
    // A file the session may not write (e.g. .env.example): the lines go with it, and Compañía commits them to the PR.
    const file = b.human_action.file;
    if (file && (typeof file.path !== "string" || !file.path.trim() || typeof file.append !== "string" || !file.append.trim()))
      throw bad("human_action", "file needs path (inside the repo) and append (the exact lines)");
    return {
      type: "human_action",
      spec: {
        assignee: b.human_action.assignee?.trim() || "jorge",
        text,
        ...(b.human_action.before_release ? { before_release: true } : {}),
        ...(file ? { file: { path: file.path.trim(), append: file.append } } : {}),
      },
    };
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
  const r = readerOf(db);
  const byKey = await r.find("tasks", { projectId, key: keys });
  const aliases = await r.find("taskAliases", { projectId, alias: keys });
  const viaAlias = aliases.length ? (await r.find("tasks", { id: [...new Set(aliases.map((a) => a.taskId))] })).filter((t) => t.projectId === projectId) : [];
  const aliased = new Set(viaAlias.map((t) => t.id));
  const matched = [...byKey, ...viaAlias];
  const found = new Set([...matched.map((t) => t.key), ...aliases.filter((a) => aliased.has(a.taskId)).map((a) => a.alias)]);
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) throw new ToolError("BLOCKER_NOT_FOUND", { keys: missing });
  if (matched.some((t) => t.key === selfKey)) throw new ToolError("BLOCKER_NOT_FOUND", { key: selfKey });
  return [...new Set(matched.map((t) => t.id))];
}

export async function replaceBlockers(tx: Q, taskId: string, blockerIds: string[], typed: TypedBlocker[]): Promise<void> {
  const uow = uowOf(tx);
  await uow.delete("taskBlockers", { taskId });
  // A human action already cleared stays cleared when the same list is written again.
  // 2.10: blockers parsed from a "Jorge:" line belong to their text, not to blocked_by: they stay, and
  // a human action in the list with the same text as one of them is not written twice.
  const existing = await uow.find("blockers", { taskId });
  const parsedTexts = new Set(existing.filter((e) => e.spec.source === "parsed").map((e) => String(e.spec.text)));
  const dropped = existing.filter((e) => e.spec.source !== "parsed").map((e) => e.id);
  if (dropped.length) await uow.delete("blockers", { id: dropped });
  for (const blockerId of blockerIds) await uow.insert("taskBlockers", { taskId, blockerId });
  typed = typed.filter((b) => !(b.type === "human_action" && parsedTexts.has(String(b.spec.text))));
  for (const b of typed) {
    const same = existing.find((e) => e.type === b.type && JSON.stringify(e.spec) === JSON.stringify(b.spec));
    await uow.insert("blockers", { taskId, type: b.type, spec: b.spec, satisfiedAt: same?.satisfiedAt ?? null, satisfiedBy: same?.satisfiedBy ?? null });
  }
}

// The blocker rows of some tasks: ticket links and typed blockers.
type BlockerRows = { links: Row<"taskBlockers">[]; typed: Row<"blockers">[] };

async function blockerRowsOf(r: Reader, taskIds: string[]): Promise<BlockerRows> {
  if (!taskIds.length) return { links: [], typed: [] };
  return { links: await r.find("taskBlockers", { taskId: taskIds }), typed: await r.find("blockers", { taskId: taskIds }) };
}

// Whether one typed blocker holds at `now`, against the project's environments, commits and metrics
// (read once, on first need). A condition that cannot be evaluated does not hold.
export function typedHolds(r: Reader, projectId: string, now: Date) {
  let envs: Promise<Map<string, Row<"envStates">>> | undefined;
  let metrics: Promise<Map<string, number>> | undefined;
  const commits = new Map<string, Promise<string[]>>();
  const envOf = async (env: unknown) => {
    envs ??= r.find("envStates", { projectId }).then((rows) => new Map(rows.map((e) => [e.env, e])));
    return env == null ? undefined : (await envs).get(String(env));
  };
  const commitsOf = (env: string) => {
    let hit = commits.get(env);
    if (!hit) commits.set(env, (hit = r.find("envCommits", { projectId, env }).then((rows) => rows.map((c) => c.sha))));
    return hit;
  };
  const metricOf = async (name: unknown) => {
    metrics ??= r.find("projectMetrics", { projectId }).then((rows) => new Map(rows.map((m) => [m.name, m.value])));
    return name == null ? undefined : (await metrics).get(String(name));
  };
  return async (b: Row<"blockers">): Promise<boolean> => {
    const spec = b.spec;
    switch (b.type) {
      case "env": {
        const es = await envOf(spec.env);
        if (spec.condition === "migration_gte") return es?.migrationsApplied != null && es.migrationsApplied >= Number(spec.value);
        if (spec.condition === "deployed_after") return !!es?.deployedAt && spec.value != null && es.deployedAt > new Date(String(spec.value));
        if (spec.condition === "contains_commit") {
          if (spec.env == null || spec.value == null) return false;
          const prefix = String(spec.value);
          return (await commitsOf(String(spec.env))).some((sha) => sha.startsWith(prefix));
        }
        return false;
      }
      case "human_action":
        return b.satisfiedAt !== null;
      case "env_flag": {
        // jsonb equality between the flag's value and the expected one.
        const flags = (await envOf(spec.env))?.flags;
        if (!flags || spec.flag == null || !Object.hasOwn(flags, String(spec.flag)) || spec.equals === undefined) return false;
        return isDeepStrictEqual(flags[String(spec.flag)], spec.equals);
      }
      case "time_after":
        return spec.at != null && now >= new Date(String(spec.at));
      case "metric_gte": {
        const value = await metricOf(spec.name);
        return value !== undefined && value >= Number(spec.value);
      }
      default:
        return false;
    }
  };
}

// A typed blocker that counts (it is gating) and does not hold at `now`. The predicate reads the project's
// environments, commits and metrics once, on first need. Takes rows of one project.
export function typedBlockerOpen(r: Reader, projectId: string, now: Date): (b: Row<"blockers">) => Promise<boolean> {
  const holds = typedHolds(r, projectId, now);
  return async (b) => isGating(b.spec) && !(await holds(b));
}

async function unsatisfiedAmong(r: Reader, projectId: string, rows: BlockerRows, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  if (rows.links.length) {
    const status = new Map((await r.find("tasks", { id: [...new Set(rows.links.map((l) => l.blockerId))] })).map((t) => [t.id, t.status]));
    for (const l of rows.links) {
      const s = status.get(l.blockerId);
      if (s !== undefined && !(SETTLED_STATUSES as readonly string[]).includes(s)) out.add(l.taskId);
    }
  }
  const open = typedBlockerOpen(r, projectId, now);
  for (const b of rows.typed) {
    if (out.has(b.taskId)) continue;
    if (await open(b)) out.add(b.taskId);
  }
  return out;
}

// The tasks among taskIds (all of one project) with a blocker that does not hold at `now`: a blocking
// ticket not yet In review or later, or a gating typed blocker whose condition is false.
export async function blockedTaskIds(r: Reader, projectId: string, taskIds: string[], now: Date): Promise<Set<string>> {
  return unsatisfiedAmong(r, projectId, await blockerRowsOf(r, taskIds), now);
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
  const r = readerOf(db);
  const links = await r.find("taskBlockers", { taskId: t.id });
  // The blocking tickets in key order, sorted by the store so text order stays the database's.
  const taskRows = links.length ? await r.find("tasks", { id: links.map((l) => l.blockerId) }, { orderBy: [{ column: "key" }] }) : [];
  const out: BlockerView[] = taskRows.map((b) => ({ type: "task", task: b.key, status: b.status, satisfied: (SETTLED_STATUSES as readonly string[]).includes(b.status) }));
  const rows = await r.find("blockers", { taskId: t.id }, { orderBy: [{ column: "type" }, { column: "createdAt" }] });
  // A spec without an env matches no environment (the port would read a missing value as "any").
  const envOf = async (env: string | undefined) => (env === undefined ? undefined : await r.get("envStates", { projectId: t.projectId, env }));
  for (const b of rows) {
    const spec = b.spec as Record<string, string>;
    if (b.type === "env") {
      const s = await envOf(spec.env);
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
        // A commit the environment is known to contain, named by any prefix of its sha.
        const known = spec.env === undefined || spec.value == null ? [] : await r.find("envCommits", { projectId: t.projectId, env: spec.env });
        satisfied = known.some((c) => c.sha.startsWith(spec.value!));
      }
      out.push({ type: "env", env: spec.env!, condition: spec.condition!, value: spec.value!, current, satisfied });
    } else if (b.type === "human_action") {
      const parsed = spec.source === "parsed" ? { source: "parsed" as const, field: spec.field!, gating: isGating(b.spec) } : {};
      out.push({ type: "human_action", id: b.id, assignee: spec.assignee!, text: spec.text!, satisfied: !!b.satisfiedAt, satisfied_at: iso(b.satisfiedAt), ...parsed });
    } else if (b.type === "env_flag") {
      const s = await envOf(spec.env);
      const current = s?.flags?.[spec.flag!] ?? null;
      out.push({ type: "env_flag", env: spec.env!, flag: spec.flag!, equals: b.spec.equals, current, satisfied: current !== null && current === b.spec.equals });
    } else if (b.type === "time_after") {
      out.push({ type: "time_after", at: spec.at!, satisfied: new Date(spec.at!) <= new Date() });
    } else {
      const m = spec.name === undefined ? undefined : await r.get("projectMetrics", { projectId: t.projectId, name: spec.name });
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
  const uow = uowOf(tx);
  const blocked = await uow.find("tasks", { projectId, status: "Blocked" });
  const rows = await blockerRowsOf(uow, blocked.map((t) => t.id));
  // Only a ticket held by something (a ticket, or a typed blocker that holds claims) is let go.
  const held = new Set([...rows.links.map((l) => l.taskId), ...rows.typed.filter((b) => isGating(b.spec)).map((b) => b.taskId)]);
  const unsatisfied = await unsatisfiedAmong(uow, projectId, rows, uow.now);
  const promoted: string[] = [];
  for (const r of blocked) {
    if (!held.has(r.id) || unsatisfied.has(r.id)) continue;
    // Read again: an earlier promotion in this loop may have moved it.
    const cur = await uow.get("tasks", { id: r.id });
    if (!cur || cur.status !== "Blocked") continue;
    const [u] = await uow.update(
      "tasks",
      { id: r.id, status: "Blocked", version: cur.version },
      { status: "Ready", blockedNote: null, statusChangedAt: uow.now, version: cur.version + 1, updatedAt: uow.now },
    );
    if (!u) continue;
    const satisfied = await blockerList(tx, { id: r.id, projectId });
    await emit("blocker.satisfied", u, { blockers: satisfied }, SYSTEM_ACTOR);
    await emit("task.status", u, { from: "Blocked", to: "Ready" }, SYSTEM_ACTOR);
    promoted.push(u.key);
  }
  return promoted;
}

// A row id as Postgres prints it. Ids were matched as text, so only this canonical lowercase form names
// a row, and anything else is "not found" rather than a uuid parse error.
export const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Jorge resolves a human action (the inbox); the ticket may move to Ready right away.
export async function resolveHumanAction(tx: Q, emit: Emit, projectId: string, blockerId: string, by: Actor, note?: string) {
  const uow = uowOf(tx);
  const row = typeof blockerId === "string" && UUID_TEXT.test(blockerId) ? await uow.get("blockers", { id: blockerId, type: "human_action" }) : undefined;
  const task = row ? await uow.get("tasks", { id: row.taskId }) : undefined;
  if (!row || !task || task.projectId !== projectId) throw new ToolError("BLOCKER_NOT_FOUND", { blocker_id: blockerId });
  const b = { b: row, taskKey: task.key, taskId: task.id };
  if (!b.b.satisfiedAt) {
    await uow.update("blockers", { id: b.b.id }, { satisfiedAt: uow.now, satisfiedBy: by });
    await emit("blocker.resolved", { id: b.taskId, key: b.taskKey }, { blocker_id: b.b.id, text: (b.b.spec as { text: string }).text });
  }
  // 2.10: what Jorge says about it lands in the ticket's log as his note.
  if (note?.trim()) await emit("note", { id: b.taskId, key: b.taskKey }, { text: note.trim(), blocker_id: b.b.id }, by);
  await promoteUnblocked(tx, emit, projectId);
  return { blocker_id: b.b.id, key: b.taskKey };
}

// Human actions waiting on Jorge, for the inbox.
export async function openHumanActions(db: Q, projectId: string) {
  const r = readerOf(db);
  const open = new Map((await r.find("tasks", { projectId })).filter((t) => t.status !== "Done" && t.status !== "Won't do").map((t) => [t.id, t]));
  if (!open.size) return [];
  const rows = await r.find("blockers", { taskId: [...open.keys()], type: "human_action", satisfiedAt: null }, { orderBy: [{ column: "createdAt" }] });
  return rows.map((b) => ({ b, t: open.get(b.taskId)! }));
}

export async function setMetricInTx(tx: Q, emit: Emit, projectId: string, name: string, value: number, by: Actor) {
  if (!METRIC_NAME.test(name)) throw new ToolError("INVALID_METRIC", { field: "name" });
  if (!Number.isInteger(value)) throw new ToolError("INVALID_METRIC", { field: "value" });
  const uow = uowOf(tx);
  if (await uow.get("projectMetrics", { projectId, name })) await uow.update("projectMetrics", { projectId, name }, { value, by, updatedAt: uow.now });
  else await uow.insert("projectMetrics", { projectId, name, value, by });
  await emit("metric.set", null, { name, value });
  await promoteUnblocked(tx, emit, projectId);
  return { name, value };
}

export async function projectMetricsOf(db: Q, projectId: string) {
  const rows = await readerOf(db).find("projectMetrics", { projectId }, { orderBy: [{ column: "name" }] });
  return Object.fromEntries(rows.map((m) => [m.name, { value: m.value, by: m.by, updated_at: iso(m.updatedAt) }]));
}
