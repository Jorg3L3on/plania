import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { ROUTINE_STATUSES, type RoutineRun, type TaskComment } from "../db/schema.js";
import { pgStore, readerOf, uowOf } from "../store/pg.js";
import type { FindOptions } from "../store/types.js";
import { NO_PROJECT, payloadText } from "./delegate.js";
import { ToolError } from "./errors.js";
import type { InboxItem } from "./inbox.js";
import { findProject, findTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// PLA-I23: agents comment on a task and hand owner_agent to each other.
// A chain stops at HOP_CAP. The same pair the other way is ping-pong and does not count.

export const HOP_CAP = 3;
export const COMMENT_MAX = 2_000;
const LIMPIEZA_MS = 24 * 3600_000;
const SLUG = /^[a-z][a-z0-9-]{0,58}$/;

export type CommentView = {
  id: string;
  author_agent: string;
  body: string;
  created_at: string;
};

export type AssignResult = {
  key: string;
  owner_agent: string;
  assign_hops: number;
  from_agent: string | null;
  comment: CommentView | null;
};

type WriteCtx = (
  tool: string,
  input: { actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string; verbose?: boolean },
  identity: Identity | undefined,
) => Ctx;

function commentView(row: TaskComment): CommentView {
  return {
    id: row.id,
    author_agent: row.authorAgent,
    body: row.body,
    created_at: iso(row.createdAt),
  };
}

function rosterSlug(raw: string, field = "to_agent"): string {
  const slug = raw.trim().toLowerCase();
  if (!SLUG.test(slug)) throw new ToolError("INVALID_FILTER", { field, hint: "roster slug" });
  return slug;
}

const ROUTINE_NAME = /^[a-z][a-z0-9._-]{0,79}$/;
const SUMMARY_MAX = 2_000;

function routineName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!ROUTINE_NAME.test(name)) throw new ToolError("INVALID_FILTER", { field: "routine", hint: "lowercase letters, digits, dot, underscore, dash" });
  return name;
}

function routineStatus(raw: string): (typeof ROUTINE_STATUSES)[number] {
  if (!(ROUTINE_STATUSES as readonly string[]).includes(raw)) {
    throw new ToolError("INVALID_FILTER", { field: "status", allowed: [...ROUTINE_STATUSES] });
  }
  return raw as (typeof ROUTINE_STATUSES)[number];
}

function parseTime(field: string, raw: string): Date {
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new ToolError("INVALID_FILTER", { field, hint: "ISO-8601" });
  return at;
}

function utcDay(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError("INVALID_FILTER", { field: "date", hint: "YYYY-MM-DD" });
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
    throw new ToolError("INVALID_FILTER", { field: "date", hint: "YYYY-MM-DD" });
  }
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function commentBody(raw: string): string {
  const body = raw.trim();
  if (!body) throw new ToolError("INVALID_FILTER", { field: "body" });
  if (body.length > COMMENT_MAX) throw new ToolError("TOO_LARGE", { field: "body", max: COMMENT_MAX });
  return body;
}

async function ownerSlug(db: Q, id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await readerOf(db).get("agents", { id }))?.slug ?? null;
}

// True when an earlier assign already moved this pair in the opposite direction.
async function pairReversed(db: Q, taskId: string, from: string, to: string): Promise<boolean> {
  const assigned = await readerOf(db).find("events", { taskId, type: "task.assigned" });
  return assigned.some((e) => payloadText(e.payload, "from_agent") === to && payloadText(e.payload, "to_agent") === from);
}

export async function listComments(db: Q, project: string, key: string): Promise<CommentView[]> {
  const p = await findProject(db, project);
  const task = await findTask(db, p.id, key);
  if (!task) throw new ToolError("TASK_NOT_FOUND");
  const rows = await readerOf(db).find("taskComments", { taskId: task.id }, { orderBy: [{ column: "createdAt" }, { column: "id" }] });
  return rows.map(commentView);
}

export async function comment(
  db: Db,
  input: { project: string; key: string; body: string },
  ctx: Ctx,
): Promise<CommentView> {
  const body = commentBody(input.body);
  const author = ctx.actor.agent?.trim() ?? "";
  if (!author) throw new ToolError("ACTOR_REQUIRED");
  const project = await findProject(db, input.project);
  return writeTx(db, project, ctx, async (tx, emit) => {
    const task = await findTask(tx, project.id, input.key);
    if (!task) throw new ToolError("TASK_NOT_FOUND");
    const row = await uowOf(tx).insert("taskComments", { taskId: task.id, authorAgent: author, body });
    await emit("task.commented", task, { comment_id: row.id, author_agent: author });
    return commentView(row);
  });
}

export async function assign(
  db: Db,
  input: { project: string; key: string; to_agent: string; note?: string },
  ctx: Ctx,
): Promise<AssignResult> {
  const to = rosterSlug(input.to_agent);
  const note = input.note?.trim() ?? "";
  if (note.length > COMMENT_MAX) throw new ToolError("TOO_LARGE", { field: "note", max: COMMENT_MAX });
  const author = ctx.actor.agent?.trim() ?? "";
  if (!author) throw new ToolError("ACTOR_REQUIRED");
  const project = await findProject(db, input.project);
  const outcome = await writeTx(db, project, ctx, async (tx, emit) => {
    const uow = uowOf(tx);
    const task = await findTask(tx, project.id, input.key);
    if (!task) throw new ToolError("TASK_NOT_FOUND");
    const target = await uow.get("agents", { slug: to });
    if (!target) throw new ToolError("AGENT_NOT_FOUND", { slug: to });
    const from = await ownerSlug(tx, task.ownerAgent);
    if (from === target.slug) {
      return {
        ok: true as const,
        value: { key: task.key, owner_agent: target.slug, assign_hops: task.assignHops, from_agent: from, comment: null },
      };
    }
    if (from && (await pairReversed(tx, task.id, from, target.slug))) {
      throw new ToolError("PING_PONG", { from, to: target.slug });
    }
    if (task.assignHops >= HOP_CAP) {
      await emit("assign.limpieza", task, { hops: task.assignHops, cap: HOP_CAP, from_agent: from, to_agent: target.slug });
      return { ok: false as const, hops: task.assignHops, cap: HOP_CAP };
    }
    const hops = task.assignHops + 1;
    const [updated] = await uow.update(
      "tasks",
      { id: task.id, version: task.version },
      { ownerAgent: target.id, assignHops: hops, version: task.version + 1, updatedAt: uow.now },
    );
    // Writes are serialized and nothing above changed the task, so its version is the one just read.
    if (!updated) throw new ToolError("STALE_VERSION", { current_version: task.version });
    let saved: CommentView | null = null;
    if (note) {
      const row = await uow.insert("taskComments", { taskId: task.id, authorAgent: author, body: note });
      saved = commentView(row);
    }
    await emit("task.assigned", task, {
      from_agent: from,
      to_agent: target.slug,
      hops,
      ...(saved ? { comment_id: saved.id } : {}),
    });
    return {
      ok: true as const,
      value: { key: updated.key, owner_agent: target.slug, assign_hops: hops, from_agent: from, comment: saved },
    };
  });
  if (!outcome.ok) throw new ToolError("HOP_CAP", { hops: outcome.hops, cap: outcome.cap });
  return outcome.value;
}

export type RoutineRunView = {
  id: string;
  agent: string;
  routine: string;
  started_at: string;
  ended_at: string | null;
  status: (typeof ROUTINE_STATUSES)[number];
  summary: string;
  task_key: string | null;
};

export type RecordRoutineInput = {
  agent: string;
  routine: string;
  started_at: string;
  ended_at?: string | null;
  status: string;
  summary?: string;
  task_key?: string | null;
};

function routineView(row: RoutineRun): RoutineRunView {
  return {
    id: row.id,
    agent: row.agent,
    routine: row.routine,
    started_at: iso(row.startedAt),
    ended_at: iso(row.endedAt),
    status: routineStatus(row.status),
    summary: row.summary,
    task_key: row.taskKey,
  };
}

async function requireRosterSlug(db: Q, raw: string, field: string): Promise<string> {
  const slug = rosterSlug(raw, field);
  const row = await readerOf(db).get("agents", { slug });
  if (!row) throw new ToolError("AGENT_NOT_FOUND", { slug });
  return row.slug;
}

export async function recordRoutineRun(db: Db, input: RecordRoutineInput): Promise<RoutineRunView> {
  const agent = await requireRosterSlug(db, input.agent, "agent");
  const routine = routineName(input.routine);
  const status = routineStatus(input.status);
  const startedAt = parseTime("started_at", input.started_at);
  const endedAt = input.ended_at ? parseTime("ended_at", input.ended_at) : null;
  if (endedAt && endedAt < startedAt) throw new ToolError("INVALID_FILTER", { field: "ended_at", hint: "not before started_at" });
  const summary = (input.summary ?? "").trim();
  if (summary.length > SUMMARY_MAX) throw new ToolError("TOO_LARGE", { field: "summary", max: SUMMARY_MAX });
  const taskKey = input.task_key?.trim() || null;
  if (taskKey && (taskKey.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(taskKey))) {
    throw new ToolError("INVALID_FILTER", { field: "task_key" });
  }
  // A run belongs to an agent, not to a project.
  const row = await pgStore(db).write(NO_PROJECT, {}, (uow) =>
    uow.insert("routineRuns", { agent, routine, startedAt, endedAt, status, summary, taskKey }),
  );
  return routineView(row);
}

export async function listRoutineRuns(
  db: Q,
  filter: { agent?: string; date?: string; limit?: number } = {},
): Promise<{ runs: RoutineRunView[] }> {
  const agent = filter.agent ? await requireRosterSlug(db, filter.agent, "agent") : undefined;
  const day = filter.date ? utcDay(filter.date) : undefined;
  const limit = filter.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ToolError("INVALID_FILTER", { field: "limit", max: 500 });
  const r = readerOf(db);
  const where = agent ? { agent } : {};
  const orderBy: FindOptions<"routineRuns">["orderBy"] = [{ column: "startedAt", desc: true }, { column: "id", desc: true }];
  // The port has no ranges: with a day the runs are filtered here, and only then cut to the limit.
  const rows = day
    ? (await r.find("routineRuns", where, { orderBy })).filter((run) => run.startedAt >= day.start && run.startedAt < day.end).slice(0, limit)
    : await r.find("routineRuns", where, { orderBy, limit });
  return { runs: rows.map(routineView) };
}

// Hop-cap refusals stay in limpieza for a day. One row per task, the latest refusal.
export async function delegationChores(db: Q, projectId: string, project: string, now = new Date()): Promise<InboxItem[]> {
  const r = readerOf(db);
  const since = now.getTime() - LIMPIEZA_MS;
  // By task, newest first: the first refusal of each task inside the day is its latest one.
  const refusals = await r.find("events", { projectId, type: "assign.limpieza" }, { orderBy: [{ column: "taskId" }, { column: "id", desc: true }] });
  const latest = new Map<string, (typeof refusals)[number]>();
  for (const e of refusals) if (e.taskId && e.createdAt.getTime() > since && !latest.has(e.taskId)) latest.set(e.taskId, e);
  const taskIds = [...latest.keys()];
  const taskOf = new Map((taskIds.length ? await r.find("tasks", { id: taskIds }) : []).map((t) => [t.id, t]));
  const parentIds = [...new Set([...taskOf.values()].map((t) => t.parentId).filter((id): id is string => !!id))];
  const parentKey = new Map((parentIds.length ? await r.find("tasks", { id: parentIds }) : []).map((t) => [t.id, t.key]));
  const items: InboxItem[] = [];
  for (const [taskId, e] of latest) {
    // A refusal whose task is gone is left out, as the join with tasks had it.
    const t = taskOf.get(taskId);
    if (!t) continue;
    const at = e.createdAt;
    items.push({
      id: String(e.id),
      kind: "assign",
      group: "limpieza",
      project,
      key: e.taskKey,
      task_kind: t.kind,
      parent_key: t.parentId ? (parentKey.get(t.parentId) ?? null) : null,
      title: t.title,
      why: `la tarea rebotó más de ${HOP_CAP} veces entre agentes`,
      waiting_since: iso(at),
      wait_s: Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000)),
      evidence: null,
      pr_url: t.prUrl,
      action_hint: "elige un dueño y deja de reasignar",
    });
  }
  return items;
}

// One registration point. register.ts calls this; comment, assign and (later) routines stay here.
export function registerDelegationTools(
  server: McpServer,
  host: {
    db: Db;
    identity: Identity | undefined;
    writeCtx: WriteCtx;
    actor: z.ZodType;
    request_id: z.ZodType;
    run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
    readOnly: { readOnlyHint: true; openWorldHint: false };
    write: { readOnlyHint: false; destructiveHint: false; openWorldHint: false };
  },
): void {
  const { db, identity, writeCtx, actor, request_id, run, readOnly, write } = host;
  const project = z.string().min(1).describe("Project slug, e.g. micasa");
  const key = z.string().min(1).describe("Human key, e.g. MIC-01");

  server.registerTool(
    "comment",
    {
      description: [
        "Add a comment on a task. The author is actor.agent.",
        `body is at most ${COMMENT_MAX} characters (TOO_LARGE). An empty body is INVALID_FILTER. Comments do not move the task or its owner.`,
      ].join(" "),
      inputSchema: { project, actor, request_id, key, body: z.string() },
      annotations: write,
    },
    (input) =>
      run(() => {
        const body = input as { project: string; key: string; body: string; actor: Ctx["actor"]; request_id?: string };
        const ctx = writeCtx("comment", body, identity);
        return comment(db, { project: body.project, key: body.key, body: body.body }, ctx);
      }),
  );

  server.registerTool(
    "assign",
    {
      description: [
        "Set a task's owner_agent to another roster agent and count the hop.",
        `More than ${HOP_CAP} hops is HOP_CAP: the owner stays and a limpieza inbox item is posted.`,
        "Assigning a pair back the way it already went is PING_PONG. note, when present, is also a comment. The lease is not touched.",
      ].join(" "),
      inputSchema: {
        project,
        actor,
        request_id,
        key,
        to_agent: z.string().min(1).describe("Roster slug that should own the task"),
        note: z.string().optional().describe("Optional comment recorded with the assignment"),
      },
      annotations: write,
    },
    (input) =>
      run(() => {
        const body = input as {
          project: string;
          key: string;
          to_agent: string;
          note?: string;
          actor: Ctx["actor"];
          request_id?: string;
        };
        const ctx = writeCtx("assign", body, identity);
        return assign(db, { project: body.project, key: body.key, to_agent: body.to_agent, note: body.note }, ctx);
      }),
  );

  server.registerTool(
    "record_routine_run",
    {
      description: [
        "Record one run of a roster agent's routine.",
        "status is ok, fail or skipped. started_at and ended_at are ISO-8601. summary is at most 2000 characters. task_key is optional.",
        "Each call is one run. List them with list_routine_runs.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        agent: z.string().min(1).describe("Roster slug whose routine ran"),
        routine: z.string().min(1).describe("Routine name, e.g. morning-brief"),
        started_at: z.string().min(1),
        ended_at: z.string().nullable().optional(),
        status: z.enum(ROUTINE_STATUSES),
        summary: z.string().optional(),
        task_key: z.string().nullable().optional().describe("Task key this run touched, if any"),
      },
      annotations: write,
    },
    (input) =>
      run(() => {
        const body = input as RecordRoutineInput & { actor: Ctx["actor"]; request_id?: string };
        writeCtx("record_routine_run", body, identity);
        return recordRoutineRun(db, body);
      }),
  );

  server.registerTool(
    "list_routine_runs",
    {
      description: [
        "Routine runs, newest first.",
        "Filter by agent (roster slug) and date (YYYY-MM-DD, UTC). Omit both for the latest runs across the company.",
      ].join(" "),
      inputSchema: {
        agent: z.string().min(1).optional().describe("Roster slug"),
        date: z.string().optional().describe("UTC day, YYYY-MM-DD"),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: readOnly,
    },
    ({ agent, date, limit }) => run(() => listRoutineRuns(db, { agent, date, limit })),
  );
}
