import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  INITIATIVE_STATUSES,
  PRIORITIES,
  TICKET_STATUSES,
  decisions,
  projects,
  taskBlockers,
  tasks,
  type Task,
} from "../db/schema.js";
import { ToolError, findProject, findTask, resumeShape, taskShape } from "./queries.js";

// Handoff §3, write side. Every write that returns a task returns the get_task shape.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Children created while the parent is in flight were found along the way.
const IN_FLIGHT_PARENT = ["Active", "Shipping"];

function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) => (x as { code?: string } | undefined)?.code;
  return code(e) === "23505" || code((e as { cause?: unknown } | undefined)?.cause) === "23505";
}

function checkStatus(kind: string, status: string): void {
  const allowed: readonly string[] = kind === "initiative" ? INITIATIVE_STATUSES : TICKET_STATUSES;
  if (!allowed.includes(status)) throw new ToolError("INVALID_STATUS", 400);
}

function checkPriority(priority: string): void {
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw new ToolError("INVALID_PRIORITY", 400);
}

// Local calendar date of the server, YYYY-MM-DD.
function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function appendNote(body: string, note: string, now = new Date()): string {
  const line = `- ${today(now)} · ${note}`;
  if (!body) return line;
  return body.endsWith("\n") ? body + line : `${body}\n${line}`;
}

async function requireTask(db: Db | Tx, projectId: string, key: string): Promise<Task> {
  const t = await findTask(db as Db, projectId, key);
  if (!t) throw new ToolError("TASK_NOT_FOUND", 404);
  return t;
}

async function resolveParent(db: Db | Tx, projectId: string, parentKey: string): Promise<Task> {
  const parent = await requireTask(db, projectId, parentKey);
  if (parent.kind !== "initiative") throw new ToolError("PARENT_MUST_BE_INITIATIVE", 400);
  return parent;
}

// Maps blocker keys to ids. Unknown keys, and a task naming itself, are BLOCKER_NOT_FOUND.
async function resolveBlockers(db: Db | Tx, projectId: string, keys: string[], selfKey: string): Promise<string[]> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  if (unique.includes(selfKey)) throw new ToolError("BLOCKER_NOT_FOUND", 400);
  const rows = await db
    .select({ id: tasks.id, key: tasks.key })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.key, unique)));
  if (rows.length !== unique.length) throw new ToolError("BLOCKER_NOT_FOUND", 400);
  return rows.map((r) => r.id);
}

async function replaceBlockers(tx: Tx, taskId: string, blockerIds: string[]): Promise<void> {
  await tx.delete(taskBlockers).where(eq(taskBlockers.taskId, taskId));
  if (blockerIds.length) {
    await tx.insert(taskBlockers).values(blockerIds.map((blockerId) => ({ taskId, blockerId })));
  }
}

export async function updateResume(
  db: Db,
  slug: string,
  card: { in_progress: string; next_action: string; branch_or_prod: string; must_keep_decision: string },
) {
  const [row] = await db
    .update(projects)
    .set({
      resumeInProgress: card.in_progress,
      resumeNextAction: card.next_action,
      resumeBranchOrProd: card.branch_or_prod,
      resumeMustKeepDecision: card.must_keep_decision,
      updatedAt: sql`now()`,
    })
    .where(eq(projects.slug, slug))
    .returning();
  if (!row) throw new ToolError("PROJECT_NOT_FOUND", 404);
  return resumeShape(row);
}

export async function createInitiative(
  db: Db,
  input: { project: string; key: string; title: string; body: string; base_branch?: string; summary?: string },
) {
  const p = await findProject(db, input.project);
  try {
    const [row] = await db
      .insert(tasks)
      .values({
        projectId: p.id,
        kind: "initiative",
        key: input.key,
        title: input.title,
        summary: input.summary ?? "",
        body: input.body,
        status: "Planning",
        baseBranch: input.base_branch ?? "main",
      })
      .returning();
    return taskShape(db, row!);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ToolError("KEY_EXISTS", 409);
    throw e;
  }
}

export async function createTask(
  db: Db,
  input: {
    project: string;
    key: string;
    title: string;
    body: string;
    summary?: string;
    parent_key?: string | null;
    priority?: string;
    origin?: "chartered" | "discovered";
    blocked_by?: string[];
    status?: string;
  },
) {
  const p = await findProject(db, input.project);
  const status = input.status ?? "Backlog";
  const priority = input.priority ?? "P2";
  checkStatus("ticket", status);
  checkPriority(priority);
  // create_task has no note, so it cannot satisfy "Blocked requires a note".
  if (status === "Blocked") throw new ToolError("BLOCKED_REQUIRES_NOTE", 400);
  if (await findTask(db, p.id, input.key)) throw new ToolError("KEY_EXISTS", 409);

  const parent = input.parent_key ? await resolveParent(db, p.id, input.parent_key) : undefined;
  const origin = input.origin ?? (parent && IN_FLIGHT_PARENT.includes(parent.status) ? "discovered" : "chartered");
  const blockerIds = await resolveBlockers(db, p.id, input.blocked_by ?? [], input.key);

  try {
    const row = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tasks)
        .values({
          projectId: p.id,
          parentId: parent?.id ?? null,
          kind: "ticket",
          key: input.key,
          title: input.title,
          summary: input.summary ?? "",
          body: input.body,
          status,
          priority,
          origin,
          resolvedAt: status === "Done" ? sql`now()` : null,
        })
        .returning();
      await replaceBlockers(tx, t!.id, blockerIds);
      return t!;
    });
    return taskShape(db, row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ToolError("KEY_EXISTS", 409);
    throw e;
  }
}

export async function setTask(
  db: Db,
  input: {
    project: string;
    key: string;
    status?: string;
    priority?: string;
    parent_key?: string | null;
    blocked_by?: string[];
    branch?: string;
    pr_url?: string;
    summary?: string;
    body?: string;
    note?: string;
  },
) {
  const p = await findProject(db, input.project);
  const t = await requireTask(db, p.id, input.key);
  const patch: Partial<typeof tasks.$inferInsert> = {};

  if (input.status !== undefined) {
    checkStatus(t.kind, input.status);
    if (input.status === "Blocked") {
      if (!input.note?.trim()) throw new ToolError("BLOCKED_REQUIRES_NOTE", 400);
      patch.blockedNote = input.note;
    } else {
      // The note only means something while the task is Blocked.
      patch.blockedNote = null;
    }
    if (input.status === "Done" && t.status !== "Done") patch.resolvedAt = new Date();
    if (input.status !== "Done") patch.resolvedAt = null;
    patch.status = input.status;
  }

  if (input.priority !== undefined) {
    if (t.kind === "initiative") throw new ToolError("INVALID_PRIORITY", 400); // tickets only
    checkPriority(input.priority);
    patch.priority = input.priority;
  }

  if (input.parent_key !== undefined) {
    if (t.kind === "initiative") throw new ToolError("PARENT_MUST_BE_INITIATIVE", 400); // initiatives never have a parent
    patch.parentId = input.parent_key === null ? null : (await resolveParent(db, p.id, input.parent_key)).id;
  }

  const blockerIds =
    input.blocked_by !== undefined ? await resolveBlockers(db, p.id, input.blocked_by, t.key) : undefined;

  if (input.branch !== undefined) patch.branch = input.branch;
  if (input.pr_url !== undefined) patch.prUrl = input.pr_url;
  if (input.summary !== undefined) patch.summary = input.summary;

  let body = input.body ?? t.body;
  if (input.note !== undefined && input.status !== "Blocked" && input.note.trim()) body = appendNote(body, input.note);
  if (body !== t.body) patch.body = body;

  const row = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(tasks)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(tasks.id, t.id))
      .returning();
    if (blockerIds !== undefined) await replaceBlockers(tx, t.id, blockerIds);
    return u!;
  });
  return taskShape(db, row);
}

export async function setInitiative(db: Db, input: { project: string; key: string; status: string }) {
  const p = await findProject(db, input.project);
  const t = await requireTask(db, p.id, input.key);
  if (t.kind !== "initiative") throw new ToolError("NOT_INITIATIVE", 400);
  checkStatus("initiative", input.status);
  const [row] = await db
    .update(tasks)
    .set({
      status: input.status,
      resolvedAt: input.status === "Done" ? (t.resolvedAt ?? sql`now()`) : null,
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, t.id))
    .returning();
  return taskShape(db, row!);
}

export async function addDecision(
  db: Db,
  input: { project: string; line: string; adr_url?: string; pin_to_resume?: boolean },
) {
  const p = await findProject(db, input.project);
  const [d] = await db
    .insert(decisions)
    .values({ projectId: p.id, line: input.line, adrUrl: input.adr_url ?? null })
    .returning({ id: decisions.id, line: decisions.line, adr_url: decisions.adrUrl, created_at: decisions.createdAt });
  if (!input.pin_to_resume) return { decision: d! };
  const resume = await updateResume(db, p.slug, {
    in_progress: p.resumeInProgress,
    next_action: p.resumeNextAction,
    branch_or_prod: p.resumeBranchOrProd,
    must_keep_decision: input.line,
  });
  return { decision: d!, resume };
}
