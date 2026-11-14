import type { Db } from "../db/client.js";
import type { Project, ProjectSettings } from "../db/schema.js";
import { uowOf } from "../store/port.js";
import type { Row, TableName, UnitOfWork } from "../store/types.js";
import { ToolError } from "./errors.js";
import { headlineWarnings } from "./jorge-lines.js";
import { checkReleaseSettings } from "./release-plan.js";
import { TEXT_LIMITS } from "./limits.js";
import { findProject } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// The project's own text: title, body (stack, repo, prod, constraints), rules (project-specific
// additions to the protocol) and the headline (one line on where it stands, ≤ 280 chars).
// Replaced with the version you read; rules_version moves with the rules, headline_version with the headline.

const SETTING_KEYS = ["release_target", "branch_pattern", "claim_from", "resources", "quotas", "github", "vercel", "release", "team"] as const;

// settings merge key by key; null removes one. Secrets never: integrations name env vars.
function mergeSettings(current: ProjectSettings, patch: Record<string, unknown>): ProjectSettings {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!(SETTING_KEYS as readonly string[]).includes(k)) throw new ToolError("INVALID_FILTER", { field: `settings.${k}`, allowed: SETTING_KEYS });
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (next.claim_from !== undefined && !["backlog", "ready"].includes(String(next.claim_from))) throw new ToolError("INVALID_FILTER", { field: "settings.claim_from", allowed: ["backlog", "ready"] });
  if (next.branch_pattern !== undefined) {
    try {
      new RegExp(String(next.branch_pattern));
    } catch {
      throw new ToolError("INVALID_FILTER", { field: "settings.branch_pattern", hint: "a valid regular expression" });
    }
  }
  if (next.release_target !== undefined && !/^[a-z][a-z0-9_-]{0,29}$/.test(String(next.release_target))) throw new ToolError("INVALID_FILTER", { field: "settings.release_target" });
  if (next.release !== undefined) next.release = checkReleaseSettings(next.release);
  if (next.team !== undefined) {
    const team = next.team as { idle_minutes?: unknown };
    if (typeof team !== "object" || team === null || Array.isArray(team)) throw new ToolError("INVALID_FILTER", { field: "settings.team" });
    if (team.idle_minutes !== undefined && (!Number.isInteger(team.idle_minutes) || (team.idle_minutes as number) < 1 || (team.idle_minutes as number) > 24 * 60)) {
      throw new ToolError("INVALID_FILTER", { field: "settings.team.idle_minutes", hint: "minutes from 1 to 1440" });
    }
  }
  for (const [name, q] of Object.entries((next.quotas as Record<string, { daily?: unknown }> | undefined) ?? {})) {
    if (!Number.isInteger(q?.daily) || (q.daily as number) < 1) throw new ToolError("INVALID_FILTER", { field: `settings.quotas.${name}.daily`, hint: "a positive integer" });
  }
  return next as ProjectSettings;
}

export async function setProject(
  db: Db,
  input: { project: string; version?: number; title?: string; body?: string; rules?: string; headline?: string; settings?: Record<string, unknown> },
  ctx: Ctx,
) {
  const p = await findProject(db, input.project);
  if (input.version === undefined) throw new ToolError("VERSION_REQUIRED");
  if (input.headline !== undefined && input.headline.length > TEXT_LIMITS.headline!) {
    throw new ToolError("TOO_LARGE", { field: "headline", max: TEXT_LIMITS.headline });
  }
  return writeTx(db, p, ctx, async (tx, emit) => {
    const uow = uowOf(tx);
    const current = (await uow.get("projects", { id: p.id }))!;
    if (current.version !== input.version) throw new ToolError("STALE_VERSION", { current_version: current.version });
    const changes: Record<string, [unknown, unknown]> = {};
    if (input.title !== undefined && input.title !== current.title) changes.title = [current.title, input.title];
    if (input.body !== undefined && input.body !== current.body) changes.body = [current.body, input.body];
    if (input.rules !== undefined && input.rules !== current.rulesText) changes.rules = [current.rulesText, input.rules];
    const headline = input.headline?.trim();
    if (headline !== undefined && headline !== current.headlineNote) changes.headline = [current.headlineNote, headline];
    const settings = input.settings ? mergeSettings(current.settings, input.settings) : undefined;
    if (settings && JSON.stringify(settings) !== JSON.stringify(current.settings)) changes.settings = [current.settings, settings];
    if (!Object.keys(changes).length) return projectShape(current);
    // 2.10: a Jorge line in the headline only warns; it makes no blocker.
    const warnings = changes.headline ? headlineWarnings(headline) : [];
    // The version read above guards the update: no row back means it moved.
    const [u] = await uow.update(
      "projects",
      { id: p.id, version: current.version },
      {
        ...(changes.title ? { title: input.title } : {}),
        ...(changes.body ? { body: input.body } : {}),
        ...(changes.rules ? { rulesText: input.rules, rulesVersion: current.rulesVersion + 1 } : {}),
        ...(changes.headline
          ? { headlineNote: headline, headlineNoteVersion: current.headlineNoteVersion + 1, headlineNoteAt: uow.now, headlineNoteStale: false }
          : {}),
        ...(changes.settings ? { settings } : {}),
        version: current.version + 1,
        updatedAt: uow.now,
      },
    );
    if (!u) throw new ToolError("STALE_VERSION", { current_version: (await uow.get("projects", { id: p.id }))?.version });
    await emit("project.updated", null, { changes });
    return warnings.length ? { ...projectShape(u!), warnings } : projectShape(u!);
  });
}

// 2.11: what set_project headline writes is the note beside the generated headline (src/mcp/headline.ts).
export function headlineNoteShape(p: Project) {
  return { text: p.headlineNote, version: p.headlineNoteVersion, at: iso(p.headlineNoteAt), stale: p.headlineNoteStale };
}

function projectShape(p: Project) {
  return {
    project: p.slug,
    title: p.title,
    body: p.body,
    rules: p.rulesText,
    rules_version: p.rulesVersion,
    headline: headlineNoteShape(p),
    settings: p.settings,
    version: p.version,
  };
}

// The note describes a moment; an env change, an initiative moving or a ticket reaching Done
// after it was written makes it stale until set_project writes a new one. The generated headline never is.
export async function markHeadlineStale(tx: Q, projectId: string): Promise<void> {
  const uow = uowOf(tx);
  const p = await uow.get("projects", { id: projectId });
  if (p && p.headlineNote !== "" && !p.headlineNoteStale) await uow.update("projects", { id: projectId }, { headlineNoteStale: true });
}

// Deleting a project. Postgres used to do it from one `delete from projects`, through the foreign keys'
// ON DELETE actions; a store that is not SQL has none, so the write removes each row itself. FOREIGN_KEYS is
// every foreign key Postgres has (the 59 in pg_constraint after the migrations), and deleteProject follows them
// the way Postgres does: a cascade removes the rows pointing at a removed row, again and again down the chain
// (a task's children, a question's delegated answer), and a set null clears the pointer on a row that stays
// (an event keeps its task_key once the task is gone, an agent leaves the project's team).
type ForeignKey<T extends TableName> = { column: keyof Row<T> & string; references: TableName; onDelete: "cascade" | "set null" };

// One entry per table, so a new table does not compile until it says what deleting a project does to it.
// Every foreign key points at its table's id.
const FOREIGN_KEYS: { [T in TableName]: ForeignKey<T>[] } = {
  projects: [],
  agentTokens: [],
  keyCounters: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  taskAliases: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "taskId", references: "tasks", onDelete: "cascade" },
  ],
  decisions: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "taskId", references: "tasks", onDelete: "set null" },
    { column: "docId", references: "docs", onDelete: "set null" },
  ],
  decisionSupersessions: [
    { column: "decisionId", references: "decisions", onDelete: "cascade" },
    { column: "supersedesId", references: "decisions", onDelete: "cascade" },
  ],
  tasks: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "parentId", references: "tasks", onDelete: "cascade" },
    { column: "ownerAgent", references: "agents", onDelete: "set null" },
    { column: "goalId", references: "goals", onDelete: "set null" },
  ],
  taskBlockers: [
    { column: "taskId", references: "tasks", onDelete: "cascade" },
    { column: "blockerId", references: "tasks", onDelete: "cascade" },
  ],
  docs: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "taskId", references: "tasks", onDelete: "cascade" },
  ],
  questions: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "taskId", references: "tasks", onDelete: "cascade" },
    { column: "decisionId", references: "decisions", onDelete: "set null" },
  ],
  delegatedAnswers: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "questionId", references: "questions", onDelete: "cascade" },
  ],
  results: [{ column: "taskId", references: "tasks", onDelete: "cascade" }],
  checks: [
    { column: "taskId", references: "tasks", onDelete: "cascade" },
    { column: "evidenceId", references: "results", onDelete: "set null" },
  ],
  sequences: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  sequenceReservations: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "taskId", references: "tasks", onDelete: "set null" },
  ],
  envStates: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  envCommits: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  blockers: [{ column: "taskId", references: "tasks", onDelete: "cascade" }],
  projectMetrics: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  branches: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "ownerTaskId", references: "tasks", onDelete: "set null" },
  ],
  resources: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  quotaUsage: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  footprints: [
    { column: "projectId", references: "projects", onDelete: "set null" },
    { column: "taskId", references: "tasks", onDelete: "set null" },
  ],
  pullRequests: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "taskId", references: "tasks", onDelete: "set null" },
  ],
  auditRuns: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  releases: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  pollState: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  machineState: [],
  pushSubscriptions: [],
  writeRequests: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  events: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "taskId", references: "tasks", onDelete: "set null" },
  ],
  digestReads: [],
  agents: [
    { column: "reportsTo", references: "agents", onDelete: "set null" },
    { column: "projectId", references: "projects", onDelete: "set null" },
  ],
  goals: [
    { column: "projectId", references: "projects", onDelete: "cascade" },
    { column: "parentId", references: "goals", onDelete: "cascade" },
  ],
  taskComments: [{ column: "taskId", references: "tasks", onDelete: "cascade" }],
  routineRuns: [],
  tokenUsage: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  heartbeatRuns: [{ column: "agentId", references: "agents", onDelete: "cascade" }],
  runnerSettings: [],
  agentRuns: [
    { column: "agentId", references: "agents", onDelete: "cascade" },
    { column: "projectId", references: "projects", onDelete: "cascade" },
  ],
  agentSessions: [
    { column: "agentId", references: "agents", onDelete: "cascade" },
    { column: "projectId", references: "projects", onDelete: "cascade" },
  ],
  planReadings: [],
  threads: [{ column: "projectId", references: "projects", onDelete: "cascade" }],
  threadMessages: [
    { column: "threadId", references: "threads", onDelete: "cascade" },
    { column: "questionId", references: "questions", onDelete: "set null" },
  ],
};

type AnyKey = { column: string; references: TableName; onDelete: "cascade" | "set null" };
const keysOf = (table: TableName) => FOREIGN_KEYS[table] as AnyKey[];
const TABLES = Object.keys(FOREIGN_KEYS) as TableName[];
// The tables some foreign key points at: the only ones whose removed ids reach further.
const REFERENCED = TABLES.filter((t) => TABLES.some((c) => keysOf(c).some((k) => k.references === t)));

// Children before parents: a table comes before every other table it points at, so no delete ever leaves
// Postgres a row to cascade or null on its own (that change would miss the write set). Fixed at load; a cycle
// between tables stops the server here instead of deleting in a wrong order.
const DELETE_ORDER: TableName[] = (() => {
  const order: TableName[] = [];
  const state = new Map<TableName, "visiting" | "done">();
  const visit = (t: TableName) => {
    if (state.get(t) === "done") return;
    if (state.get(t) === "visiting") throw new Error(`deleteProject: foreign keys loop through ${t}`);
    state.set(t, "visiting");
    // Every table pointing at t goes first.
    for (const c of TABLES) if (c !== t && keysOf(c).some((k) => k.references === t)) visit(c);
    state.set(t, "done");
    order.push(t);
  };
  for (const t of TABLES) visit(t);
  return order;
})();

// The port's calls with a column chosen at run time. FOREIGN_KEYS already ties each column to its table.
type Loose = {
  find(table: TableName, where: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  update(table: TableName, where: Record<string, unknown>, patch: Record<string, unknown>): Promise<unknown[]>;
  delete(table: TableName, where: Record<string, unknown>): Promise<unknown[]>;
};

/**
 * Removes a project and every row its foreign keys would have taken with it, and clears the pointers they
 * would have set to null, all through the unit of work. Nothing is left for a cascade to do, so every change
 * is in the write set.
 */
export async function deleteProject(uow: UnitOfWork, projectId: string): Promise<void> {
  const store = uow as unknown as Loose;
  // 1. The ids the cascade reaches in every table that others point at, until a pass finds nothing new.
  const gone = new Map<TableName, Set<string>>(REFERENCED.map((t) => [t, new Set<string>()]));
  gone.get("projects")!.add(projectId);
  for (let grew = true; grew; ) {
    grew = false;
    for (const table of REFERENCED) {
      const ids = gone.get(table)!;
      for (const k of keysOf(table)) {
        const parents = gone.get(k.references)!;
        if (k.onDelete !== "cascade" || !parents.size) continue;
        for (const row of await store.find(table, { [k.column]: [...parents] })) {
          const id = row.id as string;
          if (!ids.has(id)) {
            ids.add(id);
            grew = true;
          }
        }
      }
    }
  }
  // 2. Table by table, children first: delete what a cascade would, then clear what a set null would on the
  // rows that stay. A table's own parent column goes first (a task under a removed task, at any depth), so the
  // rows deleted by its other columns have no children left.
  for (const table of DELETE_ORDER) {
    if (table === "projects") continue;
    const keys = keysOf(table);
    const ordered = [...keys.filter((k) => k.references === table), ...keys.filter((k) => k.references !== table)];
    for (const k of ordered) {
      const parents = gone.get(k.references)!;
      if (k.onDelete === "cascade" && parents.size) await store.delete(table, { [k.column]: [...parents] });
    }
    for (const k of ordered) {
      const parents = gone.get(k.references)!;
      if (k.onDelete === "set null" && parents.size) await store.update(table, { [k.column]: [...parents] }, { [k.column]: null });
    }
  }
  await uow.delete("projects", { id: projectId });
}
