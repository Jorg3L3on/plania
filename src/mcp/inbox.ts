import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { checks, footprints, projects, questions, results, tasks, type Project } from "../db/schema.js";
import { describeStale } from "../jobs/machine/infer.js";
import { delegatedForInbox, type DelegatedReviewItem } from "./delegate.js";
import { openHumanActions } from "./blockers.js";
import { releasePending, releasePlan, releaseUnknown } from "./release-plan.js";
import { iso, type Q } from "./tx.js";

// Jorge's inbox (R-28): everything waiting on him, in one list, oldest first within each kind:
// open questions, human actions a ticket is blocked on, and what agents left running on the Mac
// that nobody claims (orphan) or that is stale for a day. Released tickets are not his: agents
// close them. Logged Won't do and reopen moves sit in `delegated`, not in this list.
// 2.10: three tones. decisiones (questions) and pasos (human actions, releases) are what count;
// limpieza (footprints) is a chore, counted apart in `chores`.

// How long something on the Mac has to sit orphan or stale before it asks for Jorge.
export const FOOTPRINT_INBOX_AFTER_MS = 24 * 3600_000;
// The pseudo-project the Mac's items without a project (Plania's repo, nobody's) are listed under in "all".
export const MACHINE_INBOX_PROJECT = "machine";

export type InboxGroup = "decisiones" | "pasos" | "limpieza";
export type InboxKind = "question" | "human_action" | "release" | "footprint" | "lease";
export const GROUP_OF: Record<InboxKind, InboxGroup> = {
  question: "decisiones",
  human_action: "pasos",
  release: "pasos",
  footprint: "limpieza",
  lease: "limpieza",
};

// A past lease stays in limpieza for a day, or until someone claims the ticket again.
const LEASE_LIMPIEZA_MS = 24 * 3600_000;

export type InboxItem = {
  id: string;
  kind: InboxKind;
  group: InboxGroup;
  project: string;
  key: string | null;
  task_kind: string | null;
  parent_key: string | null;
  title: string | null;
  why: string;
  options?: string[];
  blocks?: string[];
  urgency?: string | null;
  human_only?: boolean;
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

// Orphan and stale rows older than a day, for one project or (null) for those without one.
async function footprintItems(db: Q, projectId: string | null, project: string, now = new Date()): Promise<InboxItem[]> {
  const rows = await db
    .select({ f: footprints, key: tasks.key, kind: tasks.kind, title: tasks.title })
    .from(footprints)
    .leftJoin(tasks, eq(tasks.id, footprints.taskId))
    .where(and(isNull(footprints.releasedAt), inArray(footprints.state, ["orphan", "stale"]), projectId ? eq(footprints.projectId, projectId) : isNull(footprints.projectId)));
  const items: InboxItem[] = [];
  for (const { f, key, kind } of rows) {
    // An orphan waits from the first sighting; a stale row from the moment its reason started to hold.
    const stale = typeof f.details.stale_since === "string" ? new Date(f.details.stale_since) : null;
    const since = f.state === "stale" && stale && !Number.isNaN(stale.getTime()) ? stale : (f.firstSeenAt ?? f.declaredAt ?? f.createdAt);
    if (now.getTime() - since.getTime() < FOOTPRINT_INBOX_AFTER_MS) continue;
    items.push({
      id: f.id,
      kind: "footprint",
      group: "limpieza",
      project,
      key,
      task_kind: kind,
      parent_key: null,
      title: `${f.kind} ${f.locator}`,
      why: f.state === "stale" ? `obsoleto: ${describeStale(f.details, now) ?? "sin motivo guardado"}` : "sin dueño: nadie lo declaró y no se sabe de quién es",
      target: { kind: f.kind, locator: f.locator, teardown: f.teardown, state: f.state },
      waiting_since: iso(since),
      wait_s: waitSeconds(since),
      evidence: null,
      pr_url: null,
      action_hint: f.teardown || "release_footprint once it is gone, or register_footprint to claim it",
    });
  }
  return items.sort((a, b) => b.wait_s - a.wait_s);
}

export async function inboxFor(db: Q, p: Project): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  const open = await db
    .select({ q: questions, t: tasks })
    .from(questions)
    .innerJoin(tasks, eq(tasks.id, questions.taskId))
    // Rows that still carry the pre-2.17 letter are history, not decisions: migration 0030 closes them.
    .where(and(eq(questions.projectId, p.id), isNull(questions.answeredAt), isNull(questions.legacyMark)))
    .orderBy(asc(questions.askedAt));
  for (const { q, t } of open) {
    items.push({
      id: q.id,
      kind: "question",
      group: "decisiones",
      project: p.slug,
      key: t.key,
      task_kind: t.kind,
      parent_key: await parentKeyOf(db, t.parentId),
      title: t.title,
      why: q.question,
      options: q.options,
      blocks: q.blocks,
      urgency: q.urgency,
      human_only: q.humanOnly,
      waiting_since: iso(q.askedAt),
      wait_s: waitSeconds(q.askedAt),
      evidence: await evidenceOf(db, t.id),
      pr_url: t.prUrl,
      action_hint: "answer",
    });
  }
  for (const { b, t } of await openHumanActions(db, p.id)) {
    const spec = b.spec as { assignee: string; text: string; source?: string; field?: string };
    items.push({
      id: b.id,
      kind: "human_action",
      group: "pasos",
      project: p.slug,
      key: t.key,
      task_kind: t.kind,
      parent_key: await parentKeyOf(db, t.parentId),
      title: t.title,
      why: spec.text,
      action: spec.assignee,
      ...(spec.source === "parsed" ? { target: { source: "parsed", field: spec.field } } : {}),
      waiting_since: iso(b.createdAt),
      wait_s: waitSeconds(b.createdAt),
      evidence: await evidenceOf(db, t.id),
      pr_url: t.prUrl,
      action_hint: "mark done",
    });
  }
  // 2.10: the release, one step per project once `from` is ahead with merged tickets on it.
  const plan = await releasePlan(db, p);
  // PLA-03: with no GitHub data the step still shows, saying so, instead of disappearing.
  if (releasePending(plan) || releaseUnknown(plan)) {
    const n = plan.tickets.length;
    const since = await releaseWaitingSince(db, p.id, plan.tickets.map((t) => t.key));
    items.push({
      id: `release:${p.slug}`,
      kind: "release",
      group: "pasos",
      project: p.slug,
      key: null,
      task_kind: null,
      parent_key: null,
      title: `${plan.from.branch} → ${plan.into.branch}`,
      why: `${n} ${n === 1 ? "ticket listo" : "tickets listos"} para ${plan.env}${plan.ahead === null ? "; sin datos de GitHub" : ""}`,
      action: "release",
      target: plan as unknown as Record<string, unknown>,
      waiting_since: iso(since),
      wait_s: waitSeconds(since),
      evidence: { last_pass: null, open_checks: plan.open_checks },
      pr_url: null,
      action_hint: plan.command,
    });
  }
  items.push(...(await footprintItems(db, p.id, p.slug)));
  items.push(...(await leaseItems(db, p.id, p.slug)));
  return items;
}

async function leaseItems(db: Q, projectId: string, project: string, now = new Date()): Promise<InboxItem[]> {
  const since = new Date(now.getTime() - LEASE_LIMPIEZA_MS).toISOString();
  const rows = await db.execute<{ id: string; task_key: string; created_at: Date; title: string; kind: string; parent_id: string | null; pr_url: string | null }>(sql`
    select distinct on (e.task_id) e.id::text as id, e.task_key, e.created_at, t.title, t.kind, t.parent_id, t.pr_url
    from events e
    join tasks t on t.id = e.task_id
    where e.project_id = ${projectId}
      and e.type = 'claim.limpieza'
      and e.created_at > ${since}::timestamptz
      and not exists (
        select 1 from events n
        where n.task_id = e.task_id and n.type = 'claim.acquired' and n.id > e.id
      )
    order by e.task_id, e.id desc`);
  const items: InboxItem[] = [];
  for (const row of rows.rows) {
    const at = new Date(row.created_at);
    items.push({
      id: row.id,
      kind: "lease",
      group: "limpieza",
      project,
      key: row.task_key,
      task_kind: row.kind,
      parent_key: await parentKeyOf(db, row.parent_id),
      title: row.title,
      why: "el turno venció y nadie lo renovó",
      waiting_since: iso(at),
      wait_s: waitSeconds(at),
      evidence: null,
      pr_url: row.pr_url,
      action_hint: "reclamar de nuevo o soltar el trabajo",
    });
  }
  return items;
}

// The release waits since its oldest ticket reached Merged.
async function releaseWaitingSince(db: Q, projectId: string, keys: string[]): Promise<Date> {
  const [row] = await db
    .select({ at: sql<Date | null>`min(${tasks.statusChangedAt})` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.key, keys)));
  return row?.at ? new Date(row.at) : new Date();
}

// project: a slug, or "all" for every project.
export async function inbox(db: Q, which: Project | "all") {
  const list = which === "all" ? await db.select().from(projects).orderBy(asc(projects.slug)) : [which];
  const items = (await Promise.all(list.map((p) => inboxFor(db, p)))).flat();
  if (which === "all") items.push(...(await footprintItems(db, null, MACHINE_INBOX_PROJECT)));
  const counts: Record<string, number> = {};
  const groups: Record<InboxGroup, number> = { decisiones: 0, pasos: 0, limpieza: 0 };
  for (const i of items) {
    groups[i.group] += 1;
    if (i.group !== "limpieza") counts[i.project] = (counts[i.project] ?? 0) + 1;
  }
  return {
    items,
    count: groups.decisiones + groups.pasos,
    by_project: counts,
    groups,
    chores: groups.limpieza,
    delegated: await delegatedForInbox(db, list),
  };
}

export type { DelegatedReviewItem };

export async function projectsBySlugs(db: Q, slugs: string[]) {
  return db.select().from(projects).where(inArray(projects.slug, slugs));
}
