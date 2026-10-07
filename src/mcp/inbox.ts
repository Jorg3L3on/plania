import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { checks, projects, questions, results, tasks, type Project } from "../db/schema.js";
import { pendingApprovals } from "./approvals.js";
import { openHumanActions } from "./blockers.js";
import { iso, type Q } from "./tx.js";

// Jorge's inbox (R-28): everything waiting on him, in one list, oldest first within each kind:
// pending approvals, open questions, human actions a ticket is blocked on, and Released tickets
// waiting for Done. Later: runbook steps and S1/S2 bugs.

export type InboxItem = {
  id: string;
  kind: "approval" | "question" | "human_action" | "released";
  project: string;
  key: string | null;
  task_kind: string | null;
  parent_key: string | null;
  title: string | null;
  why: string;
  options?: string[];
  action?: string;
  target?: Record<string, unknown>;
  waiting_since: string;
  wait_s: number;
  evidence: { last_pass: { kind: string; cite: string; at: string } | null; open_checks: number } | null;
  pr_url: string | null;
  action_hint: string;
};

const waitSeconds = (since: Date) => Math.max(0, Math.round((Date.now() - since.getTime()) / 1000));

async function evidenceOf(db: Q, taskId: string | null) {
  if (!taskId) return null;
  const [last] = await db
    .select({ kind: results.kind, cite: results.cite, at: results.createdAt })
    .from(results)
    .where(and(eq(results.taskId, taskId), eq(results.verdict, "pass")))
    .orderBy(sql`${results.createdAt} desc`)
    .limit(1);
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(checks)
    .where(and(eq(checks.taskId, taskId), eq(checks.done, false), isNull(checks.waivedAt)));
  return { last_pass: last ? { kind: last.kind, cite: last.cite, at: iso(last.at) } : null, open_checks: open?.n ?? 0 };
}

async function parentKeyOf(db: Q, parentId: string | null): Promise<string | null> {
  if (!parentId) return null;
  const [p] = await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, parentId)).limit(1);
  return p?.key ?? null;
}

export async function inboxFor(db: Q, p: Project): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  for (const row of await pendingApprovals(db, p.id)) {
    const [task] = row.a.taskId ? await db.select({ prUrl: tasks.prUrl }).from(tasks).where(eq(tasks.id, row.a.taskId)).limit(1) : [];
    items.push({
      id: row.a.id,
      kind: "approval",
      project: p.slug,
      key: row.a.taskKey,
      task_kind: row.kind,
      parent_key: await parentKeyOf(db, row.parentId),
      title: row.title,
      why: row.a.reason,
      action: row.a.action,
      target: row.a.target,
      waiting_since: iso(row.a.requestedAt),
      wait_s: waitSeconds(row.a.requestedAt),
      evidence: await evidenceOf(db, row.a.taskId),
      pr_url: task?.prUrl ?? null,
      action_hint: `approve or reject: ${row.a.action}`,
    });
  }
  const open = await db
    .select({ q: questions, t: tasks })
    .from(questions)
    .innerJoin(tasks, eq(tasks.id, questions.taskId))
    .where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt)))
    .orderBy(asc(questions.askedAt));
  for (const { q, t } of open) {
    items.push({
      id: q.id,
      kind: "question",
      project: p.slug,
      key: t.key,
      task_kind: t.kind,
      parent_key: await parentKeyOf(db, t.parentId),
      title: t.title,
      why: q.question,
      options: q.options,
      waiting_since: iso(q.askedAt),
      wait_s: waitSeconds(q.askedAt),
      evidence: await evidenceOf(db, t.id),
      pr_url: t.prUrl,
      action_hint: "answer",
    });
  }
  for (const { b, t } of await openHumanActions(db, p.id)) {
    const spec = b.spec as { assignee: string; text: string };
    items.push({
      id: b.id,
      kind: "human_action",
      project: p.slug,
      key: t.key,
      task_kind: t.kind,
      parent_key: await parentKeyOf(db, t.parentId),
      title: t.title,
      why: spec.text,
      action: spec.assignee,
      waiting_since: iso(b.createdAt),
      wait_s: waitSeconds(b.createdAt),
      evidence: await evidenceOf(db, t.id),
      pr_url: t.prUrl,
      action_hint: "mark done",
    });
  }
  const released = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), eq(tasks.status, "Released")))
    .orderBy(asc(tasks.statusChangedAt));
  for (const t of released) {
    items.push({
      id: t.id,
      kind: "released",
      project: p.slug,
      key: t.key,
      task_kind: t.kind,
      parent_key: await parentKeyOf(db, t.parentId),
      title: t.title,
      why: "deployed; waiting for Done",
      waiting_since: iso(t.statusChangedAt ?? t.updatedAt),
      wait_s: waitSeconds(t.statusChangedAt ?? t.updatedAt),
      evidence: await evidenceOf(db, t.id),
      pr_url: t.prUrl,
      action_hint: "approve: done",
    });
  }
  return items;
}

// project: a slug, or "all" for every project.
export async function inbox(db: Q, which: Project | "all") {
  const list = which === "all" ? await db.select().from(projects).orderBy(asc(projects.slug)) : [which];
  const items = (await Promise.all(list.map((p) => inboxFor(db, p)))).flat();
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.project] = (counts[i.project] ?? 0) + 1;
  return { items, count: items.length, by_project: counts };
}

export async function projectsBySlugs(db: Q, slugs: string[]) {
  return db.select().from(projects).where(inArray(projects.slug, slugs));
}
