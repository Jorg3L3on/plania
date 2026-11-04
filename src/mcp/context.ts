import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { approvals, branches, questions, tasks, type Project, type Task, type Workspace } from "../db/schema.js";
import { listDecisions } from "./decisions.js";
import { auditForKeys } from "./orden.js";
import { ToolError } from "./errors.js";
import { footprintsOf, sessionFootprint } from "./footprint-read.js";
import { listEvents, liveOwner, taskSummary } from "./queries.js";
import { agentRefOf } from "./team.js";
import { openRequests } from "./requests.js";
import { iso, type Q } from "./tx.js";

// get_context (R-03): one call for a session opening a worktree. From the branch (and machine /
// worktree) it finds the initiative or tickets on it, the caller's live claims, the pinned decisions
// that apply, unanswered questions and pending approvals on those tickets, and the events since the
// cursor that touch them, plus the footprint on the Mac (src/mcp/footprint.ts) of those tickets and of the calling session. UNKNOWN_BRANCH when nothing is on that branch.

export async function getContext(
  db: Q,
  p: Project,
  input: { workspace: Workspace; session_id?: string; since_cursor?: number },
) {
  const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.key));
  const branch = input.workspace.branch?.trim();
  const mine = all.filter((t) => {
    const owner = liveOwner(t);
    if (!owner) return false;
    if (input.session_id && owner.session_id === input.session_id) return true;
    const ws = t.workspace;
    return !!ws && !!input.workspace.worktree_path && ws.worktree_path === input.workspace.worktree_path && (!input.workspace.machine || ws.machine === input.workspace.machine);
  });
  const onBranch = branch ? all.filter((t) => t.branch === branch || t.workspace?.branch === branch) : [];
  const initiative =
    onBranch.find((t) => t.kind === "initiative") ??
    (onBranch[0]?.parentId ? all.find((t) => t.id === onBranch[0]!.parentId) : undefined) ??
    (mine[0]?.parentId ? all.find((t) => t.id === mine[0]!.parentId) : undefined);
  if (branch && !onBranch.length && !mine.length) {
    const known = (await db.select({ name: branches.name }).from(branches).where(and(eq(branches.projectId, p.id), isNull(branches.deletedAt)))).map((b) => b.name);
    throw new ToolError("UNKNOWN_BRANCH", { branch, known });
  }
  const tickets = [...new Map([...mine, ...onBranch.filter((t) => t.kind === "ticket")].map((t) => [t.id, t])).values()];
  const ticketIds = new Set(tickets.map((t) => t.id));
  const family = new Set<string>([...ticketIds, ...(initiative ? [initiative.id] : [])]);
  const decisions = initiative
    ? await listDecisions(db, p.id, { initiativeKey: initiative.key, pinned: true, limit: 50 })
    : (await Promise.all(tickets.map((t) => listDecisions(db, p.id, { taskKey: t.key, pinned: true, limit: 20 })))).flat();
  const open = ticketIds.size
    ? await db
        .select({ q: questions, key: tasks.key })
        .from(questions)
        .innerJoin(tasks, eq(tasks.id, questions.taskId))
        .where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt), sql`${questions.taskId} in ${[...ticketIds]}`))
    : [];
  const pending = family.size
    ? await db.select().from(approvals).where(and(eq(approvals.projectId, p.id), sql`${approvals.taskId} in ${[...family]}`, sql`${approvals.state} in ('pending', 'granted')`, isNull(approvals.usedAt)))
    : [];
  const events = input.since_cursor !== undefined ? await listEvents(db, p.id, { since: input.since_cursor, limit: 500 }) : null;
  // What is running on the Mac for these tickets (each row says which), and what this session registered.
  const footprint = await footprintsOf(db, [...family]);
  const keyById = new Map([...tickets, ...(initiative ? [initiative] : [])].map((t) => [t.id, t.key]));
  const keys = new Set([...tickets.map((t) => t.key), ...(initiative ? [initiative.key] : [])]);
  return {
    project: p.slug,
    branch: branch ?? null,
    initiative: initiative ? await taskSummary(db, initiative) : null,
    // 2.12: what Jorge asked for on screen, newest first, whatever the branch.
    requests: await openRequests(db, p.id),
    tickets: await Promise.all(tickets.map((t) => taskSummary(db, t))),
    my_claims: await Promise.all(
      mine.map(async (t) => ({
        key: t.key,
        lease_until: iso(t.leaseUntil),
        workspace: t.workspace,
        handoff: t.handoff,
        owner_agent: await agentRefOf(db, t.ownerAgent),
      })),
    ),
    pinned_decisions: decisions,
    open_questions: open.map(({ q, key }) => ({ id: q.id, key, question: q.question, options: q.options, asked_at: iso(q.askedAt) })),
    footprint: footprint.map(({ taskId, ...f }) => ({ task_key: keyById.get(taskId!) ?? null, ...f })),
    my_footprint: input.session_id ? await sessionFootprint(db, p.id, input.session_id, input.workspace.machine) : [],
    approvals: pending.map((a) => ({ id: a.id, key: a.taskKey, action: a.action, target: a.target, state: a.state, expires_at: iso(a.expiresAt) })),
    // 2.11: the audit's last count, and the findings on these tickets (fix them while you are here).
    audit: await auditForKeys(db, p, keys),
    events: events ? { items: events.events.filter((e) => e.task_key && keys.has(e.task_key)), next_cursor: events.next_cursor, more: events.more } : null,
  };
}

export type { Task };
