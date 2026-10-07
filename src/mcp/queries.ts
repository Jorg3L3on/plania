import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { decisions, designPages, projects, taskBlockers, tasks, type Project, type Task } from "../db/schema.js";

// Errors from the handoff §3 contract. status mirrors the HTTP-style code listed there.
export class ToolError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(code);
  }
}

// A blocker stops blocking once its task is In review or Done (handoff §Ciclo).
export const SETTLED_STATUSES = ["In review", "Done"] as const;
const CLAIMABLE_STATUSES = ["Backlog", "Ready"] as const;

// P0 first, P3 last, null after everything. Text order of P0..P3 is already correct.
const byPriority = sql`${tasks.priority} asc nulls last`;

export async function findProject(db: Db, slug: string): Promise<Project> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!row) throw new ToolError("PROJECT_NOT_FOUND", 404);
  return row;
}

export async function findTask(db: Db, projectId: string, key: string): Promise<Task | undefined> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.key, key)))
    .limit(1);
  return row;
}

export function resumeShape(p: Project) {
  return {
    project: p.slug,
    in_progress: p.resumeInProgress,
    next_action: p.resumeNextAction,
    branch_or_prod: p.resumeBranchOrProd,
    must_keep_decision: p.resumeMustKeepDecision,
  };
}

async function blockerKeys(db: Db, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ key: tasks.key })
    .from(taskBlockers)
    .innerJoin(tasks, eq(tasks.id, taskBlockers.blockerId))
    .where(eq(taskBlockers.taskId, taskId))
    .orderBy(asc(tasks.key));
  return rows.map((r) => r.key);
}

// The get_task shape. Every create_*/set_* tool returns this too.
export async function taskShape(db: Db, t: Task) {
  const [parent] = t.parentId
    ? await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1)
    : [];
  const children = await db
    .select({ key: tasks.key })
    .from(tasks)
    .where(eq(tasks.parentId, t.id))
    .orderBy(asc(tasks.key));
  return {
    key: t.key,
    kind: t.kind,
    title: t.title,
    summary: t.summary,
    body: t.body,
    status: t.status,
    priority: t.priority,
    origin: t.origin,
    parent_key: parent?.key ?? null,
    child_keys: children.map((c) => c.key),
    blocked_by: await blockerKeys(db, t.id),
    blocked_note: t.blockedNote,
    base_branch: t.baseBranch,
    branch: t.branch,
    pr_url: t.prUrl,
  };
}

export async function projectCounts(db: Db, projectId: string) {
  const discovered = sql`${tasks.origin} = 'discovered'`;
  const settled = sql`${tasks.status} in ('In review', 'Done')`;
  const [row] = await db
    .select({
      chartered: sql<number>`count(*) filter (where not coalesce(${discovered}, false))::int`,
      charteredSettled: sql<number>`count(*) filter (where not coalesce(${discovered}, false) and ${settled})::int`,
      found: sql<number>`count(*) filter (where ${discovered})::int`,
      foundOpen: sql<number>`count(*) filter (where ${discovered} and not ${settled})::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "ticket"), sql`${tasks.status} <> 'Won''t do'`));
  return row ?? { chartered: 0, charteredSettled: 0, found: 0, foundOpen: 0 };
}

export async function listTasks(
  db: Db,
  projectId: string,
  filters: { parentKey?: string; status?: string; kind?: string },
) {
  const parent = alias(tasks, "parent");
  const where: SQL[] = [eq(tasks.projectId, projectId)];
  if (filters.parentKey !== undefined) where.push(eq(parent.key, filters.parentKey));
  if (filters.status !== undefined) where.push(eq(tasks.status, filters.status));
  if (filters.kind !== undefined) where.push(eq(tasks.kind, filters.kind));
  return db
    .select({
      key: tasks.key,
      title: tasks.title,
      summary: tasks.summary,
      status: tasks.status,
      priority: tasks.priority,
      kind: tasks.kind,
      parent_key: parent.key,
      origin: tasks.origin,
    })
    .from(tasks)
    .leftJoin(parent, eq(parent.id, tasks.parentId))
    .where(and(...where))
    .orderBy(byPriority, desc(tasks.updatedAt));
}

export async function getMemory(db: Db, p: Project) {
  const pages = await db
    .select({ id: designPages.id, title: designPages.title, body: designPages.body })
    .from(designPages)
    .where(eq(designPages.projectId, p.id))
    .orderBy(asc(designPages.createdAt));
  const lines = await db
    .select({ id: decisions.id, line: decisions.line, adr_url: decisions.adrUrl, created_at: decisions.createdAt })
    .from(decisions)
    .where(eq(decisions.projectId, p.id))
    .orderBy(desc(decisions.createdAt))
    .limit(100);
  return { rules: p.rulesText, design_pages: pages, decisions: lines };
}

// Read-only. Claimable: ticket in Backlog|Ready whose blockers are all In review|Done.
export async function nextTask(db: Db, projectId: string, initiativeKey?: string) {
  const where: SQL[] = [
    eq(tasks.projectId, projectId),
    eq(tasks.kind, "ticket"),
    inArray(tasks.status, [...CLAIMABLE_STATUSES]),
    sql`not exists (
      select 1 from ${taskBlockers} tb
      join ${tasks} b on b.id = tb.blocker_id
      where tb.task_id = ${tasks.id}
        and b.status not in ('In review', 'Done')
    )`,
  ];
  if (initiativeKey !== undefined) {
    const initiative = await findTask(db, projectId, initiativeKey);
    if (!initiative || initiative.kind !== "initiative") throw new ToolError("INITIATIVE_NOT_FOUND", 404);
    where.push(eq(tasks.parentId, initiative.id));
  }
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(byPriority, asc(tasks.key))
    .limit(1);
  if (!t) return { task: null };
  const parent = t.parentId
    ? (await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1))[0]
    : undefined;
  return {
    task: {
      key: t.key,
      title: t.title,
      summary: t.summary,
      status: t.status,
      priority: t.priority,
      parent_key: parent?.key ?? null,
      blocked_by: await blockerKeys(db, t.id),
    },
  };
}
