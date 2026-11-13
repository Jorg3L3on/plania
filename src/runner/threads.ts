// PLA-I32-3: the conversation. One company thread (Jorge and Asistente) and one thread per project (Jorge
// and its PO; the team answers there too). A message is written inside writeTx with a thread.message event,
// so the event hook (src/runner/events.ts) can wake whoever should answer in the same transaction.
// Company-thread events live in Asistente's home project (PLANIA_HOME_PROJECT, else plania, else the first
// project by slug): events need a project, and Asistente's runs are recorded there.
import type { Db } from "../db/client.js";
import { LINK_KINDS, type Agent, type Project, type Thread, type ThreadLink, type ThreadMessage, type ProposalData } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { writeTx, type Ctx, type Q } from "../mcp/tx.js";
import { readerOf, uowOf } from "../store/pg.js";
import { roleOf, writeVia } from "./limits.js";

export const MAX_BODY = 4000;
export const MAX_LINKS = 10;
export const JORGE = { agent: "jorge", role: "ceo" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const homeSlug = (env: NodeJS.ProcessEnv = process.env): string => env.PLANIA_HOME_PROJECT || env.PLANIA_PROMPTS_PROJECT || "plania";

export async function asistenteHome(db: Q, env: NodeJS.ProcessEnv = process.env): Promise<Project | null> {
  const r = readerOf(db);
  const home = await r.get("projects", { slug: homeSlug(env) });
  if (home) return home;
  const [first] = await r.find("projects", {}, { orderBy: [{ column: "slug" }], limit: 1 });
  return first ?? null;
}

// ---- Threads (made on first use; 0041 made the ones that existed then)

// Read first; only a missing thread takes a write, and the write looks again before it inserts (two first
// uses at once make one thread, as the unique index did).
export async function companyThread(db: Q): Promise<Thread> {
  const row = await readerOf(db).get("threads", { kind: "company" });
  if (row) return row;
  return writeVia(db, async (uow) => (await uow.get("threads", { kind: "company" })) ?? uow.insert("threads", { kind: "company" }));
}

export async function projectThread(db: Q, projectId: string): Promise<Thread> {
  const where = { kind: "project", projectId };
  const row = await readerOf(db).get("threads", where);
  if (row) return row;
  return writeVia(db, async (uow) => (await uow.get("threads", where)) ?? uow.insert("threads", where), projectId);
}

export type ThreadRef = { thread: Thread; project: Project | null };

// "company", a project slug, or a thread id.
export async function resolveThread(db: Q, ref: string): Promise<ThreadRef> {
  const value = ref.trim();
  if (value === "company") return { thread: await companyThread(db), project: null };
  const r = readerOf(db);
  if (UUID.test(value)) {
    const row = await r.get("threads", { id: value });
    if (!row) throw new ToolError("THREAD_NOT_FOUND", { thread: value });
    const project = row.projectId ? ((await r.get("projects", { id: row.projectId })) ?? null) : null;
    return { thread: row, project };
  }
  const project = await r.get("projects", { slug: value });
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
  const body = input.body.trim();
  if (!body) throw new ToolError("INVALID_FILTER", { field: "body", hint: "empty" });
  if (body.length > MAX_BODY) throw new ToolError("TOO_LARGE", { field: "body", max: MAX_BODY });
  const home = ref.project ?? (await asistenteHome(db));
  if (!home) throw new ToolError("PROJECT_NOT_FOUND", { hint: "no project to record the company thread's events in" });
  const links = input.links ?? [];
  return writeTx(db, home, ctx, async (tx, emit) => {
    const uow = uowOf(tx);
    // A question link names the question the message carries (Responder answers it).
    let questionId = input.questionId ?? null;
    if (!questionId) {
      const q = links.find((l) => l.kind === "question" && UUID.test(l.ref));
      if (q) questionId = (await uow.get("questions", { id: q.ref }))?.id ?? null;
    }
    const msg = await uow.insert("threadMessages", {
      threadId: ref.thread.id,
      authorAgent: input.author.agent.slice(0, 60),
      authorRole: input.author.role.slice(0, 40),
      body,
      links,
      questionId,
      proposal: input.proposal ?? null,
    });
    await emit("thread.message", null, {
      thread_id: ref.thread.id,
      thread_kind: ref.thread.kind,
      project: ref.project?.slug ?? null,
      message_id: msg.id,
      author: msg.authorAgent,
      author_role: msg.authorRole,
    });
    return msg;
  });
}

// ---- Permissions (bots)

// Which project an agent's team is: project_id, else (rows from before 0041) po-<slug> or a capability.
export async function projectOfMember(db: Q, agent: Agent): Promise<Project | null> {
  const r = readerOf(db);
  if (agent.projectId) return (await r.get("projects", { id: agent.projectId })) ?? null;
  const names = [...(agent.slug.startsWith("po-") ? [agent.slug.slice(3)] : []), ...agent.capabilities];
  if (names.length === 0) return null;
  return (await r.find("projects", { slug: names }, { orderBy: [{ column: "slug" }], limit: 1 }))[0] ?? null;
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
  const r = readerOf(db);
  if (msg.questionId) {
    const q = await r.get("questions", { id: msg.questionId });
    if (q && !q.answeredAt) return ["responder"];
  }
  const ticket = msg.links.find((l) => l.kind === "ticket" || l.kind === "idea");
  if (!ticket) return [];
  const pid = projectId ?? null;
  const t = await r.get("tasks", pid ? { projectId: pid, key: ticket.ref } : { key: ticket.ref });
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

// A thread's messages, newest first. Postgres orders them, so timestamps compare at the microseconds they
// were stored with (a JS Date keeps only milliseconds).
const newestFirst = (db: Q, threadId: string, where: { authorAgent?: string } = {}) =>
  readerOf(db).find("threadMessages", { threadId, ...where }, { orderBy: [{ column: "at", desc: true }, { column: "id", desc: true }] });

// after: an ISO time or a message id; only later messages come back. Without it, the last 200.
export async function readThread(db: Q, ref: ThreadRef, after?: string | null): Promise<ThreadView> {
  let rows = await newestFirst(db, ref.thread.id);
  if (after?.trim()) {
    const a = after.trim();
    if (UUID.test(a)) {
      // The messages Postgres sorted ahead of that one; a message of another thread is compared by its time,
      // and an unknown id leaves them all.
      const at = rows.findIndex((m) => m.id === a.toLowerCase());
      if (at >= 0) rows = rows.slice(0, at);
      else {
        const other = await readerOf(db).get("threadMessages", { id: a });
        if (other) rows = rows.filter((m) => m.at.getTime() > other.at.getTime());
      }
    } else if (!Number.isNaN(Date.parse(a))) {
      const since = new Date(a).getTime();
      rows = rows.filter((m) => m.at.getTime() > since);
    } else throw new ToolError("INVALID_FILTER", { field: "after", hint: "an ISO time or a message id" });
  }
  rows = rows.slice(0, PAGE).reverse();
  const messages: MessageView[] = [];
  for (const m of rows) messages.push(await messageView(db, m, ref.project?.id ?? null));
  return { id: ref.thread.id, kind: ref.thread.kind as ThreadView["kind"], project: ref.project?.slug ?? null, messages };
}

export async function markRead(db: Q, threadId: string, at = new Date()): Promise<void> {
  await writeVia(db, (uow) => uow.update("threads", { id: threadId }, { readAt: at }));
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
  const rows = await newestFirst(db, thread.id);
  const last = rows[0];
  const readAt = thread.readAt?.getTime();
  const unread = rows.filter((m) => m.authorAgent !== JORGE.agent && (readAt === undefined || m.at.getTime() > readAt)).length;
  return {
    id: thread.id,
    kind: thread.kind as ThreadSummary["kind"],
    project: project?.slug ?? null,
    title: project ? project.title || project.slug : "Asistente",
    unread,
    last: last ? { at: last.at.toISOString(), author_role: last.authorRole, body: last.body } : null,
  };
}

// Every thread: the company's first, then one per project by slug (made here when missing).
export async function listThreads(db: Q): Promise<ThreadSummary[]> {
  const out = [await threadSummary(db, await companyThread(db), null)];
  for (const p of await readerOf(db).find("projects", {}, { orderBy: [{ column: "slug" }] })) out.push(await threadSummary(db, await projectThread(db, p.id), p));
  return out;
}

// The latest message an agent wrote that links a ticket, after a time (the closing-line dedup).
export async function lastLineFor(db: Q, threadId: string, author: string, ticket: string, since: Date | null): Promise<ThreadMessage | null> {
  const rows = (await newestFirst(db, threadId, { authorAgent: author })).filter((m) => !since || m.at.getTime() > since.getTime()).slice(0, 20);
  return rows.find((m) => m.links.some((l) => l.kind === "ticket" && l.ref === ticket)) ?? null;
}
