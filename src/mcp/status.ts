import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { approvals, blockers, branches, envStates, pullRequests, questions, tasks, type Project, type Task } from "../db/schema.js";
import { lastAudit } from "./audit.js";
import { envShape } from "./env.js";
import { nextTask } from "./queries.js";
import { iso, type Q } from "./tx.js";

// The status block (R-02): what the server can work out, never typed by anyone. Per environment
// what runs there and whether it trails the integration branches; per open initiative the counts,
// the next claimable ticket, what waits on Jorge and what is in review with its PR state; plus the
// project-wide queues. audit_findings arrives with the audit in 2.3.

const CLOSED = ["Done", "Won't do"];

export async function statusBlock(db: Q, p: Project) {
  const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id)).orderBy(asc(tasks.key));
  const openInitiatives = all.filter((t) => t.kind === "initiative" && !CLOSED.includes(t.status));
  const envs = await db.select().from(envStates).where(eq(envStates.projectId, p.id)).orderBy(asc(envStates.env));
  const heads = await db.select().from(branches).where(and(eq(branches.projectId, p.id), isNull(branches.deletedAt)));
  const prs = await db.select().from(pullRequests).where(eq(pullRequests.projectId, p.id));
  const prOf = (t: Task) => prs.filter((pr) => pr.taskId === t.id).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const pending = await db
    .select({ taskId: approvals.taskId, action: approvals.action })
    .from(approvals)
    .where(and(eq(approvals.projectId, p.id), eq(approvals.state, "pending")));
  const openQ = await db
    .select({ taskId: questions.taskId })
    .from(questions)
    .where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt)));
  const humanActions = all.length
    ? await db
        .select({ taskId: blockers.taskId })
        .from(blockers)
        .where(and(inArray(blockers.taskId, all.map((t) => t.id)), eq(blockers.type, "human_action"), isNull(blockers.satisfiedAt)))
    : [];

  const waitingOn = (t: Task): string[] => {
    const why: string[] = [];
    if (t.status === "Needs Jorge" || openQ.some((q) => q.taskId === t.id)) why.push("question");
    for (const a of pending.filter((a) => a.taskId === t.id)) why.push(`approval:${a.action}`);
    if (humanActions.some((h) => h.taskId === t.id)) why.push("human_action");
    return why;
  };

  const initiatives = [];
  for (const i of openInitiatives) {
    const children = all.filter((t) => t.parentId === i.id);
    const counts: Record<string, number> = {};
    for (const c of children) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const head = i.branch ? heads.find((b) => b.name === i.branch) : undefined;
    initiatives.push({
      key: i.key,
      title: i.title,
      status: i.status,
      integration_branch: i.branch,
      head_sha: head?.headSha ?? null,
      counts,
      next_claimable: (await nextTask(db, p.id, i.key)).task?.key ?? null,
      waiting_on_jorge: children.map((c) => ({ key: c.key, why: waitingOn(c) })).filter((w) => w.why.length),
      in_review: children
        .filter((c) => ["In review", "Merged", "Released"].includes(c.status))
        .map((c) => {
          const pr = prOf(c);
          return { key: c.key, status: c.status, pr: pr ? { url: pr.url, state: pr.state, ci_state: pr.ciState, merge_sha: pr.mergeSha } : c.prUrl ? { url: c.prUrl, state: null, ci_state: null, merge_sha: null } : null };
        }),
    });
  }

  const envBlock = envs.map((e) => {
    const base = envShape(e);
    // Drift: the integration branches whose head the env does not run yet.
    const behind = openInitiatives
      .filter((i) => i.branch)
      .map((i) => ({ key: i.key, branch: i.branch!, head: heads.find((b) => b.name === i.branch)?.headSha ?? null }))
      .filter((x) => x.head && e.commit && !x.head.startsWith(e.commit) && !e.commit.startsWith(x.head));
    return { ...base, drift: { behind: behind.map((x) => ({ key: x.key, branch: x.branch, head_sha: x.head })) } };
  });

  const bugs = all.filter((t) => t.workType === "bug" && !CLOSED.includes(t.status) && (t.severity === "S1" || t.severity === "S2"));
  const released = all.filter((t) => t.status === "Released");
  const standaloneWaiting = all
    .filter((t) => t.kind === "ticket" && (!t.parentId || !openInitiatives.some((i) => i.id === t.parentId)))
    .map((t) => ({ key: t.key, why: waitingOn(t) }))
    .filter((w) => w.why.length);

  return {
    generated_at: iso(new Date()),
    envs: envBlock,
    initiatives,
    open_questions: openQ.length,
    pending_approvals: pending.length,
    human_actions: humanActions.length,
    released_waiting_done: released.map((t) => t.key),
    standalone_waiting_on_jorge: standaloneWaiting,
    s1_s2_bugs: bugs.map((t) => ({ key: t.key, severity: t.severity, title: t.title, status: t.status })),
    audit: await lastAudit(db, p.id),
    audit_findings: (await lastAudit(db, p.id))?.count ?? null,
  };
}

export type StatusBlock = Awaited<ReturnType<typeof statusBlock>>;
