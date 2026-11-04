import { asc, eq, sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { agents, taskComments, tasks, type TaskComment } from "../db/schema.js";
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

function rosterSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (!SLUG.test(slug)) throw new ToolError("INVALID_FILTER", { field: "to_agent", hint: "roster slug" });
  return slug;
}

function commentBody(raw: string): string {
  const body = raw.trim();
  if (!body) throw new ToolError("INVALID_FILTER", { field: "body" });
  if (body.length > COMMENT_MAX) throw new ToolError("TOO_LARGE", { field: "body", max: COMMENT_MAX });
  return body;
}

async function ownerSlug(db: Q, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await db.select({ slug: agents.slug }).from(agents).where(eq(agents.id, id)).limit(1);
  return row?.slug ?? null;
}

// True when an earlier assign already moved this pair in the opposite direction.
async function pairReversed(db: Q, taskId: string, from: string, to: string): Promise<boolean> {
  const rows = await db.execute<{ n: number }>(sql`
    select 1 as n from events
    where task_id = ${taskId}
      and type = 'task.assigned'
      and payload->>'from_agent' = ${to}
      and payload->>'to_agent' = ${from}
    limit 1`);
  return rows.rows.length > 0;
}

export async function listComments(db: Q, project: string, key: string): Promise<CommentView[]> {
  const p = await findProject(db, project);
  const task = await findTask(db, p.id, key);
  if (!task) throw new ToolError("TASK_NOT_FOUND");
  const rows = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, task.id))
    .orderBy(asc(taskComments.createdAt), asc(taskComments.id));
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
    const [row] = await tx
      .insert(taskComments)
      .values({ taskId: task.id, authorAgent: author, body })
      .returning();
    await emit("task.commented", task, { comment_id: row!.id, author_agent: author });
    return commentView(row!);
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
    const task = await findTask(tx, project.id, input.key);
    if (!task) throw new ToolError("TASK_NOT_FOUND");
    const [target] = await tx.select({ id: agents.id, slug: agents.slug }).from(agents).where(eq(agents.slug, to)).limit(1);
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
    const [updated] = await tx
      .update(tasks)
      .set({ ownerAgent: target.id, assignHops: hops, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
      .where(eq(tasks.id, task.id))
      .returning();
    let saved: CommentView | null = null;
    if (note) {
      const [row] = await tx.insert(taskComments).values({ taskId: task.id, authorAgent: author, body: note }).returning();
      saved = commentView(row!);
    }
    await emit("task.assigned", task, {
      from_agent: from,
      to_agent: target.slug,
      hops,
      ...(saved ? { comment_id: saved.id } : {}),
    });
    return {
      ok: true as const,
      value: { key: updated!.key, owner_agent: target.slug, assign_hops: hops, from_agent: from, comment: saved },
    };
  });
  if (!outcome.ok) throw new ToolError("HOP_CAP", { hops: outcome.hops, cap: outcome.cap });
  return outcome.value;
}

// Hop-cap refusals stay in limpieza for a day. One row per task, the latest refusal.
export async function delegationChores(db: Q, projectId: string, project: string, now = new Date()): Promise<InboxItem[]> {
  const since = new Date(now.getTime() - LIMPIEZA_MS).toISOString();
  const rows = await db.execute<{
    id: string;
    task_key: string;
    created_at: Date;
    title: string;
    kind: string;
    parent_key: string | null;
    pr_url: string | null;
  }>(sql`
    select distinct on (e.task_id)
      e.id::text as id, e.task_key, e.created_at, t.title, t.kind, parent.key as parent_key, t.pr_url
    from events e
    join tasks t on t.id = e.task_id
    left join tasks parent on parent.id = t.parent_id
    where e.project_id = ${projectId}
      and e.type = 'assign.limpieza'
      and e.created_at > ${since}::timestamptz
    order by e.task_id, e.id desc`);
  return rows.rows.map((row) => {
    const at = new Date(row.created_at);
    return {
      id: row.id,
      kind: "assign",
      group: "limpieza",
      project,
      key: row.task_key,
      task_kind: row.kind,
      parent_key: row.parent_key,
      title: row.title,
      why: `la tarea rebotó más de ${HOP_CAP} veces entre agentes`,
      waiting_since: iso(at),
      wait_s: Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000)),
      evidence: null,
      pr_url: row.pr_url,
      action_hint: "elige un dueño y deja de reasignar",
    };
  });
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
  const { db, identity, writeCtx, actor, request_id, run, write } = host;
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
}
