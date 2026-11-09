// PLA-I32-3: the threads for bots. thread_post and thread_read work on "company", a project slug or a
// thread id. Asistente may use every thread; a PO or any other team member only its own project's thread.
// The author is the agent behind the actor (a runner session run-<id>, else the roster slug), with its role.
// After a runner's finish or add_result, closingLine posts the run's line in the project thread with a link
// to what it delivered (ticket, PR, doc), once per ticket per run for add_result.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { LINK_KINDS, agentRuns, docs, projects, tasks, type ThreadLink } from "../db/schema.js";
import { agentOfActor } from "../runner/events.js";
import { roleOf } from "../runner/limits.js";
import { assertThreadAccess, checkLinks, lastLineFor, messageView, postMessage, projectThread, readThread, resolveThread } from "../runner/threads.js";
import type { Ctx } from "./tx.js";

type WriteCtx = (
  tool: string,
  input: { actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string; verbose?: boolean },
  identity: Identity | undefined,
) => Ctx;

export const THREAD_REF = "\"company\" (Asistente's thread with Jorge), a project slug (that project's thread), or a thread id";

export async function threadPost(db: Db, input: { thread: string; body: string; links?: unknown }, ctx: Ctx) {
  const ref = await resolveThread(db, input.thread);
  const { agent, role } = await assertThreadAccess(db, await agentOfActor(db, ctx.actor), ref);
  const links = checkLinks(input.links);
  const msg = await postMessage(db, ref, { author: { agent: agent.slug, role }, body: input.body, links }, ctx);
  return { thread: ref.thread.id, message: await messageView(db, msg, ref.project?.id ?? null) };
}

export async function threadRead(db: Db, input: { thread: string; after?: string }, ctx: Pick<Ctx, "actor">) {
  const ref = await resolveThread(db, input.thread);
  await assertThreadAccess(db, await agentOfActor(db, ctx.actor), ref);
  return readThread(db, ref, input.after);
}

// ---- The closing line

const RUN_SESSION = /^run-([0-9a-f]{8})$/;

export type Closing = { project: string; key: string; via: "finish" | "add_result"; verdict?: string; cite?: string; prUrl?: string | null };

export async function closingLine(db: Db, ctx: Ctx, c: Closing): Promise<string | null> {
  const m = RUN_SESSION.exec(ctx.actor.session_id ?? "");
  if (!m) return null;
  const [run] = await db
    .select({ id: agentRuns.id, startedAt: agentRuns.startedAt, queuedAt: agentRuns.queuedAt })
    .from(agentRuns)
    .where(sql`${agentRuns.id}::text like ${`${m[1]}%`}`)
    .limit(1);
  const agent = await agentOfActor(db, ctx.actor);
  if (!run || !agent) return null;
  const [project] = await db.select().from(projects).where(eq(projects.slug, c.project)).limit(1);
  if (!project) return null;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, c.key))).limit(1);
  if (!t) return null;
  const thread = await projectThread(db, project.id);
  if (c.via === "add_result" && (await lastLineFor(db, thread.id, agent.slug, t.key, run.startedAt ?? run.queuedAt))) return null;

  const links: ThreadLink[] = [{ kind: t.kind === "idea" ? "idea" : "ticket", ref: t.key, title: t.title.slice(0, 200) }];
  const pr = c.prUrl?.trim() || t.prUrl;
  if (pr) links.push({ kind: "pr", ref: pr, title: `PR de ${t.key}` });
  const [doc] = await db.select({ id: docs.id, title: docs.title }).from(docs).where(eq(docs.taskId, t.id)).orderBy(desc(docs.updatedAt)).limit(1);
  if (doc) links.push({ kind: "doc", ref: doc.id, title: doc.title.slice(0, 200) });

  const cite = (c.cite ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const head = c.via === "finish" ? `${t.key} queda En revisión: ${t.title}.` : `${t.key}: evidencia ${c.verdict ?? ""} registrada.`.replace(/\s+\./, ".");
  const body = [head, cite ? `Hice: ${cite}` : null, c.via === "finish" ? "Necesito: que lo revises (Aceptar o Pedir cambios)." : null].filter(Boolean).join("\n");
  const msg = await postMessage(db, { thread, project }, { author: { agent: agent.slug, role: roleOf(agent) ?? agent.role }, body, links }, { ...ctx, requestId: undefined, tool: "thread.closing_line" });
  return msg.id;
}

// A runner's ask, posted in its project thread with the question attached (Responder answers it there).
export async function questionLine(db: Db, ctx: Ctx, q: { project: string; key: string; question: string; questionId: string }): Promise<string | null> {
  if (!RUN_SESSION.test(ctx.actor.session_id ?? "")) return null;
  const agent = await agentOfActor(db, ctx.actor);
  const [project] = await db.select().from(projects).where(eq(projects.slug, q.project)).limit(1);
  if (!agent || !project) return null;
  const [t] = await db.select({ key: tasks.key, title: tasks.title, kind: tasks.kind }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, q.key))).limit(1);
  const links: ThreadLink[] = t ? [{ kind: t.kind === "idea" ? "idea" : "ticket", ref: t.key, title: t.title.slice(0, 200) }] : [];
  links.push({ kind: "question", ref: q.questionId, title: q.question.slice(0, 200) });
  const thread = await projectThread(db, project.id);
  const msg = await postMessage(
    db,
    { thread, project },
    { author: { agent: agent.slug, role: roleOf(agent) ?? agent.role }, body: `Pregunta${t ? ` sobre ${t.key}` : ""}: ${q.question}`.slice(0, 4000), links, questionId: q.questionId },
    { ...ctx, requestId: undefined, tool: "thread.question_line" },
  );
  return msg.id;
}

// ---- Registration

export const registerThreadTools = (
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
): void => {
  const { db, identity, writeCtx, actor, request_id, run, readOnly, write } = host;
  const link = z.object({ kind: z.enum(LINK_KINDS), ref: z.string().min(1).max(300), title: z.string().max(200) });

  server.registerTool(
    "thread_post",
    {
      description: [
        "Write a message in a thread Jorge reads on Compañía: a reply, a delivered doc, PR or idea, or what you need from him.",
        "Asistente may post in every thread; any other agent only in its own project's thread (THREAD_FORBIDDEN otherwise).",
        "links (up to 10) point at what the message talks about: {kind ticket|doc|pr|idea|question, ref (key, doc id, PR url, question id), title}. A ticket In review gets Aceptar and Pedir cambios on screen; a question link gets Responder.",
        "body: plain Spanish, up to 4000 characters. You are the author (your roster slug and role).",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        thread: z.string().min(1).describe(THREAD_REF),
        body: z.string().min(1).max(4000),
        links: z.array(link).max(10).optional(),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const input = raw as { actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string; thread: string; body: string; links?: unknown };
        return threadPost(db, input, writeCtx("thread_post", input, identity));
      }),
  );

  server.registerTool(
    "thread_read",
    {
      description: [
        "Read a thread's messages, oldest first (the last 200, or only those after `after`: an ISO time or a message id).",
        "Each message has its author {agent, role}, body, links, the actions Jorge can take on it and the one he took (action_state).",
        "Same access as thread_post: Asistente every thread, a team member its own project's.",
      ].join(" "),
      inputSchema: {
        actor,
        thread: z.string().min(1).describe(THREAD_REF),
        after: z.string().optional(),
      },
      annotations: readOnly,
    },
    (raw) =>
      run(() => {
        const input = raw as { actor: { agent?: string; session_id: string; machine?: string; model?: string }; thread: string; after?: string };
        const agent = identity?.agent ?? input.actor.agent ?? "";
        return threadRead(db, input, { actor: { ...input.actor, agent } });
      }),
  );
};
