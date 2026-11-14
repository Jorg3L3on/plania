// PLA-I32-3: the conversation. One company thread (Jorge and Asistente) and one thread per project (Jorge
// and its PO; the team answers there too). A message is written inside writeTx with a thread.message event,
// so the event hook (src/runner/events.ts) can wake whoever should answer in the same transaction.
// Company-thread events live in Asistente's home project (PLANIA_HOME_PROJECT, else plania, else the first
// project by slug): events need a project, and Asistente's runs are recorded there.
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  LINK_KINDS,
  agents,
  projects,
  questions,
  tasks,
  threadMessages,
  threads,
  type Agent,
  type Project,
  type Thread,
  type ThreadLink,
  type ThreadMessage,
  type ProposalData,
} from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { writeTx, type Ctx, type Emit, type Q } from "../mcp/tx.js";
import { roleOf } from "./limits.js";

export const MAX_BODY = 4000;
export const MAX_LINKS = 10;
export const JORGE = { agent: "jorge", role: "ceo" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const homeSlug = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_HOME_PROJECT || env.PLANIA_PROMPTS_PROJECT || "plania";

export async function asistenteHome(db: Q, env: NodeJS.ProcessEnv = process.env): Promise<Project | null> {
  const [home] = await db.select().from(projects).where(eq(projects.slug, homeSlug(env))).limit(1);
  if (home) return home;
  const [first] = await db.select().from(projects).orderBy(asc(projects.slug)).limit(1);
  return first ?? null;
}

// ---- Threads (made on first use; 0041 made the ones that existed then)

export async function companyThread(db: Q): Promise<Thread> {
  const [row] = await db.select().from(threads).where(eq(threads.kind, "company")).limit(1);
  if (row) return row;
  await db.insert(threads).values({ kind: "company" }).onConflictDoNothing();
  return (await db.select().from(threads).where(eq(threads.kind, "company")).limit(1))[0]!;
}

export async function projectThread(db: Q, projectId: string): Promise<Thread> {
  const where = and(eq(threads.kind, "project"), eq(threads.projectId, projectId));
  const [row] = await db.select().from(threads).where(where).limit(1);
  if (row) return row;
  await db.insert(threads).values({ kind: "project", projectId }).onConflictDoNothing();
  return (await db.select().from(threads).where(where).limit(1))[0]!;
}

export type ThreadRef = { thread: Thread; project: Project | null };

// "company", a project slug, or a thread id.
export async function resolveThread(db: Q, ref: string): Promise<ThreadRef> {
  const value = ref.trim();
  if (value === "company") return { thread: await companyThread(db), project: null };
  if (UUID.test(value)) {
    const [row] = await db.select().from(threads).where(eq(threads.id, value)).limit(1);
    if (!row) throw new ToolError("THREAD_NOT_FOUND", { thread: value });
    const project = row.projectId ? ((await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1))[0] ?? null) : null;
    return { thread: row, project };
  }
  const [project] = await db.select().from(projects).where(eq(projects.slug, value)).limit(1);
  if (!project) throw new ToolError("THREAD_NOT_FOUND", { thread: value });
  return { thread: await projectThread(db, project.id), project };
}

// ---- Links

export function checkLinks(links: unknown): ThreadLink[] {
  if (links == null) return [];
  if (!Array.isArray(links) || links.length > MAX_LINKS) throw new ToolError("INVALID_FILTER", { field: "links", max: MAX_LINKS });
  return links.map((l, i) => {
    const link = l as Partial<ThreadLink>;
    if (!link || !(LINK_KINDS as readonly string[]).includes(String(link.kind))) throw new ToolError("INVALID_FILTER", { field: `links[${i}].kind`, allowed: LINK_KINDS });
    const ref = String(link.ref ?? "").trim();
    if (!ref || ref.length > 300) throw new ToolError("INVALID_FILTER", { field: `links[${i}].ref` });
    const title = String(link.title ?? "").trim().slice(0, 200);
    return { kind: link.kind!, ref, title };
  });
}

// ---- Writing

export type PostInput = {
  author: { agent: string; role: string };
  body: string;
  links?: ThreadLink[];
  questionId?: string | null;
  proposal?: ProposalData | null;
};

export async function postMessage(db: Db, ref: ThreadRef, input: PostInput, ctx: Ctx): Promise<ThreadMessage> {
  checkBody(input.body);
  const home = ref.project ?? (await asistenteHome(db));
  if (!home) throw new ToolError("PROJECT_NOT_FOUND", { hint: "no project to record the company thread's events in" });
  return writeTx(db, home, ctx, (tx, emit) => insertMessage(tx, emit, ref, input));
}

function checkBody(raw: string): string {
  const body = raw.trim();
  if (!body) throw new ToolError("INVALID_FILTER", { field: "body", hint: "empty" });
  if (body.length > MAX_BODY) throw new ToolError("TOO_LARGE", { field: "body", max: MAX_BODY });
  return body;
}

// PLA-I43-1: the insert and its thread.message event, inside a writeTx the caller already holds (Send to Plania
// posts the message and queues the PO's wake in one transaction, so neither happens without the other).
export async function insertMessage(tx: Q, emit: Emit, ref: ThreadRef, input: PostInput): Promise<ThreadMessage> {
  const body = checkBody(input.body);
  const links = input.links ?? [];
  // A question link names the question the message carries (Responder answers it).
  let questionId = input.questionId ?? null;
  if (!questionId) {
    const q = links.find((l) => l.kind === "question" && UUID.test(l.ref));
    if (q) {
      const [found] = await tx.select({ id: questions.id }).from(questions).where(eq(questions.id, q.ref)).limit(1);
      questionId = found?.id ?? null;
    }
  }
  const [msg] = await tx
    .insert(threadMessages)
    .values({ threadId: ref.thread.id, authorAgent: input.author.agent.slice(0, 60), authorRole: input.author.role.slice(0, 40), body, links, questionId, proposal: input.proposal ?? null })
    .returning();
  await emit("thread.message", null, {
    thread_id: ref.thread.id,
    thread_kind: ref.thread.kind,
    project: ref.project?.slug ?? null,
    message_id: msg!.id,
    author: msg!.authorAgent,
    author_role: msg!.authorRole,
  });
  return msg!;
}

// ---- Permissions (bots)

// Which project an agent's team is: project_id, else (rows from before 0041) po-<slug> or a capability.
export async function projectOfMember(db: Q, agent: Agent): Promise<Project | null> {
  if (agent.projectId) return (await db.select().from(projects).where(eq(projects.id, agent.projectId)).limit(1))[0] ?? null;
  const names = [...(agent.slug.startsWith("po-") ? [agent.slug.slice(3)] : []), ...agent.capabilities];
  if (names.length === 0) return null;
  return (await db.select().from(projects).where(inArray(projects.slug, names)).orderBy(asc(projects.slug)).limit(1))[0] ?? null;
}

// Asistente may use every thread; any other agent only its own project's thread.
export async function assertThreadAccess(db: Q, agent: Agent | null, ref: ThreadRef): Promise<{ agent: Agent; role: string }> {
  const denied = () => new ToolError("THREAD_FORBIDDEN", { thread: ref.project?.slug ?? "company", agent: agent?.slug ?? null });
  if (!agent || agent.status === "retired") throw denied();
  const role = roleOf(agent);
  if (role === "asistente") return { agent, role };
  if (!role || ref.thread.kind !== "project" || !ref.project) throw denied();
  const own = await projectOfMember(db, agent);
  if (!own || own.id !== ref.project.id) throw denied();
  return { agent, role };
}

// ---- Reading

export type MessageAction = "aceptar" | "cambios" | "responder" | "fusionar";

export type MessageView = {
  id: string;
  at: string;
  author: { agent: string; role: string };
  body: string;
  links: ThreadLink[];
  actions: MessageAction[];
  action_state: ThreadMessage["actionState"];
  question_id: string | null;
};

export type ThreadView = { id: string; kind: "company" | "project"; project: string | null; messages: MessageView[] };

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

// What Jorge can do on a message: answer its open question; accept (or merge, for a PR) and send back the
// ticket it links while that ticket is In review. Nothing once he acted, and nothing on his own messages.
export async function actionsFor(db: Q, msg: ThreadMessage, projectId: string | null): Promise<MessageAction[]> {
  if (msg.actionState || msg.authorAgent === JORGE.agent) return [];
  if (msg.questionId) {
    const [q] = await db.select({ answeredAt: questions.answeredAt }).from(questions).where(eq(questions.id, msg.questionId)).limit(1);
    if (q && !q.answeredAt) return ["responder"];
  }
  const ticket = msg.links.find((l) => l.kind === "ticket" || l.kind === "idea");
  if (!ticket) return [];
  const pid = projectId ?? null;
  const [t] = await db
    .select({ status: tasks.status, prUrl: tasks.prUrl, workType: tasks.workType, kind: tasks.kind })
    .from(tasks)
    .where(pid ? and(eq(tasks.projectId, pid), eq(tasks.key, ticket.ref)) : eq(tasks.key, ticket.ref))
    .limit(1);
  if (!t || t.status !== "In review") return [];
  const pr = msg.links.find((l) => l.kind === "pr" && PR_URL.test(l.ref)) ?? (t.prUrl && PR_URL.test(t.prUrl) ? { ref: t.prUrl } : null);
  const code = (t.workType ?? "code") === "code" || t.workType === "bug" || t.workType === "debt";
  return pr && code ? ["fusionar", "cambios"] : ["aceptar", "cambios"];
}

export async function messageView(db: Q, msg: ThreadMessage, projectId: string | null): Promise<MessageView> {
  return {
    id: msg.id,
    at: msg.at.toISOString(),
    author: { agent: msg.authorAgent, role: msg.authorRole },
    body: msg.body,
    links: msg.links,
    actions: await actionsFor(db, msg, projectId),
    action_state: msg.actionState ?? null,
    question_id: msg.questionId ?? null,
  };
}

const PAGE = 200;

// after: an ISO time or a message id; only later messages come back. Without it, the last 200.
export async function readThread(db: Q, ref: ThreadRef, after?: string | null): Promise<ThreadView> {
  // A message id compares in SQL: timestamps keep microseconds there, a JS Date only milliseconds.
  let since: ReturnType<typeof sql> | null = null;
  if (after?.trim()) {
    const a = after.trim();
    if (UUID.test(a)) since = sql`${threadMessages.at} > coalesce((select m.at from thread_messages m where m.id = ${a}::uuid), '-infinity'::timestamptz)`;
    else if (!Number.isNaN(Date.parse(a))) since = gt(threadMessages.at, new Date(a)) as unknown as ReturnType<typeof sql>;
    else throw new ToolError("INVALID_FILTER", { field: "after", hint: "an ISO time or a message id" });
  }
  const where = since ? and(eq(threadMessages.threadId, ref.thread.id), since) : eq(threadMessages.threadId, ref.thread.id);
  const rows = (await db.select().from(threadMessages).where(where).orderBy(desc(threadMessages.at), desc(threadMessages.id)).limit(PAGE)).reverse();
  const messages: MessageView[] = [];
  for (const m of rows) messages.push(await messageView(db, m, ref.project?.id ?? null));
  return { id: ref.thread.id, kind: ref.thread.kind as ThreadView["kind"], project: ref.project?.slug ?? null, messages };
}

export async function markRead(db: Q, threadId: string, at = new Date()): Promise<void> {
  await db.update(threads).set({ readAt: at }).where(eq(threads.id, threadId));
}

export type ThreadSummary = {
  id: string;
  kind: "company" | "project";
  project: string | null;
  title: string;
  unread: number;
  last: { at: string; author_role: string; body: string } | null;
};

export async function threadSummary(db: Q, thread: Thread, project: { slug: string; title: string } | null): Promise<ThreadSummary> {
  const [last] = await db.select().from(threadMessages).where(eq(threadMessages.threadId, thread.id)).orderBy(desc(threadMessages.at), desc(threadMessages.id)).limit(1);
  const unreadWhere = and(
    eq(threadMessages.threadId, thread.id),
    sql`${threadMessages.authorAgent} <> ${JORGE.agent}`,
    thread.readAt ? gt(threadMessages.at, thread.readAt) : undefined,
  );
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(threadMessages).where(unreadWhere);
  return {
    id: thread.id,
    kind: thread.kind as ThreadSummary["kind"],
    project: project?.slug ?? null,
    title: project ? project.title || project.slug : "Asistente",
    unread: count?.n ?? 0,
    last: last ? { at: last.at.toISOString(), author_role: last.authorRole, body: last.body } : null,
  };
}

// Every thread: the company's first, then one per project by slug (made here when missing).
export async function listThreads(db: Q): Promise<ThreadSummary[]> {
  const out = [await threadSummary(db, await companyThread(db), null)];
  for (const p of await db.select().from(projects).orderBy(asc(projects.slug))) out.push(await threadSummary(db, await projectThread(db, p.id), p));
  return out;
}

// The latest message an agent wrote that links a ticket, after a time (the closing-line dedup).
export async function lastLineFor(db: Q, threadId: string, author: string, ticket: string, since: Date | null): Promise<ThreadMessage | null> {
  const rows = await db
    .select()
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, threadId), eq(threadMessages.authorAgent, author), since ? gt(threadMessages.at, since) : undefined))
    .orderBy(desc(threadMessages.at))
    .limit(20);
  return rows.find((m) => m.links.some((l) => l.kind === "ticket" && l.ref === ticket)) ?? null;
}
