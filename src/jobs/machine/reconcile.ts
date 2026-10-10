import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { footprints } from "../../db/schema.js";
import { bus } from "../../events.js";
import { releaseRow } from "../../mcp/footprint.js";
import { SYSTEM_ACTOR, writeTx, type Emit, type Q } from "../../mcp/tx.js";
import { groupOf } from "./collect.js";
import { GHOST_RELEASE_MS, computeVerdict, ownerFacts, suggestTeardown, type Directory, type Observed, type Owner, type StateInput, type Verdict } from "./infer.js";

// Per tick: compare what the collectors saw with the unreleased rows of this machine.
//   new → insert, event footprint.seen
//   seen again → last_seen_at, details, inferred owner, state; misses back to 0 (no event)
//   not seen while its collector ran → misses + 1; at GONE_AFTER misses the state is `gone`
//     (last_seen_at stays frozen at the last sighting), event footprint.gone
//   its collector did not run (tool missing, command failed, not due) → the row is left alone
//   declared and both rows are never `gone`: when their collector ran and did not see them they become
//     `ghost` (declared and never seen for 5 minutes, or seen before and missed twice), and a ghost row is
//     released (bookkeeping, nothing on the Mac) an hour later with footprint.released reason ghost
//   the state of a row that was seen is recomputed every tick: live / system / orphan, or stale (infer.ts)
// Plania never touches the Mac here: this only writes the footprints table.

export const GONE_AFTER = 2;
const GONE_KEEP_MS = 24 * 60 * 60 * 1000; // a gone row is released (kept for history, out of the inventory) a day after last seen
// details keys a collector only fills on some ticks; a tick without them keeps the last value.
// `declared` is what an agent passed to register_footprint: the job never sees it.
const STICKY = ["size_kb", "size_at", "version", "declared"];

type Row = typeof footprints.$inferSelect;
export type Inferred = { item: Observed; owner: Owner; repoPath: string | null; primary?: boolean };
export type ReconcileResult = { seen: number; gone: number; revived: number; updated: number; released: number; ghosted: number };

const keyOf = (kind: string, locator: string) => `${kind}\0${locator}`;

// Primary things (the live database, Plania itself, database servers) never get a suggested teardown.
const teardownOf = (i: Inferred) => (i.primary || i.item.self ? "" : suggestTeardown(i.item, i.repoPath));

// Key order differs between what we build and what jsonb returns, so compare sorted.
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

function detailsFor(i: Inferred, old: Record<string, unknown> | undefined): Record<string, unknown> {
  const d: Record<string, unknown> = { ...i.item.details };
  if (i.owner.repo) d.repo = i.owner.repo;
  else if (i.item.repoHint) d.repo = i.item.repoHint;
  for (const [k, v] of Object.entries(i.owner.extra ?? {})) if (v !== undefined && !(k in d)) d[k] = v;
  for (const k of STICKY) if (d[k] === undefined && old?.[k] !== undefined) d[k] = old[k];
  // The things the work stands on (the live database, Plania itself, database servers) carry no teardown.
  if (i.primary || i.item.self) d.primary = true;
  return d;
}

type Basis = { source: "observed" | "declared" | "both"; projectId: string | null; taskId: string | null; startedAt: Date | null };

// The state of something the collectors saw this tick, with why it is stale when it is.
function verdictFor(a: { dir: Directory; now: Date }, i: Inferred, b: Basis): Verdict {
  const d = i.item.details;
  const branch = typeof d.branch === "string" ? d.branch : null;
  const input: StateInput = {
    source: b.source,
    self: !!i.item.self,
    shared: !!i.item.shared,
    projectId: b.projectId,
    taskId: b.taskId,
    repo: i.owner.repo ?? i.item.repoHint ?? null,
    kind: i.item.kind,
    primary: !!i.primary || !!i.item.self,
    now: a.now,
    startedAt: b.startedAt,
    task: ownerFacts(a.dir, b.taskId, a.now),
    worktree:
      i.item.kind === "worktree"
        ? {
            merged: typeof d.merged === "boolean" ? d.merged : null,
            ownCommits: typeof d.own_commits === "number" ? d.own_commits : null,
            dirty: typeof d.dirty === "boolean" ? d.dirty : null,
            branchMergedAt: (b.projectId && branch ? a.dir.branchMergedAt?.get(`${b.projectId}\0${branch}`) : null) ?? null,
          }
        : null,
  };
  return computeVerdict(input);
}

// The why of a stale row travels in details, stable between ticks (no "3 h ago" in it: the screen
// and the audit add the age from stale_since).
function withVerdict(d: Record<string, unknown>, v: Verdict): Record<string, unknown> {
  if (v.state === "stale") {
    d.stale_reason = v.reason;
    if (v.since) d.stale_since = v.since.toISOString();
  }
  return d;
}

export async function reconcile(
  db: Db,
  a: { machine: string; now: Date; dir: Directory; inferred: Inferred[]; ran: Set<string> },
): Promise<ReconcileResult> {
  const { machine, now, dir } = a;
  const rows = await db.select().from(footprints).where(and(eq(footprints.machine, machine), isNull(footprints.releasedAt)));
  const existing = new Map(rows.map((r) => [keyOf(r.kind, r.locator), r]));
  const result: ReconcileResult = { seen: 0, gone: 0, revived: 0, updated: 0, released: 0, ghosted: 0 };

  // A Postgres server that no longer listens takes its databases with it: its databases group
  // counts as having run (and found nothing), or they would stay live forever.
  const ran = new Set(a.ran);
  if (ran.has("ports")) {
    const listening = new Set(a.inferred.filter((i) => i.item.kind === "db_server").map((i) => `databases:${i.item.details.port}`));
    for (const r of rows) {
      const g = groupOf(r.kind, r.locator, r.details);
      if (r.kind === "database" && !listening.has(g)) ran.add(g);
    }
  }

  const inserts: (typeof footprints.$inferInsert)[] = [];
  const touch: string[] = [];
  const changed: { id: string; set: Partial<typeof footprints.$inferInsert> }[] = [];
  const seenKeys = new Set<string>();

  for (const i of a.inferred) {
    const key = keyOf(i.item.kind, i.item.locator);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const row = existing.get(key);
    if (!row) {
      const v = verdictFor(a, i, { source: "observed", projectId: i.owner.projectId, taskId: i.owner.taskId, startedAt: now });
      inserts.push({
        id: crypto.randomUUID(),
        machine,
        kind: i.item.kind,
        locator: i.item.locator,
        projectId: i.owner.projectId,
        taskId: i.owner.taskId,
        sessionId: i.owner.sessionId,
        source: "observed",
        teardown: teardownOf(i),
        details: withVerdict(detailsFor(i, undefined), v),
        state: v.state,
        firstSeenAt: now,
        lastSeenAt: now,
      });
      continue;
    }
    // A declared owner is the agent's word; only observed rows take the inferred one.
    const inferredOwner = row.source === "observed";
    const source = row.source === "declared" ? "both" : (row.source as "observed" | "both");
    // The ticket that started it stays its owner after the claim ends: once the claim is released the
    // branch points at the initiative, which would hide "ticket ZIG-I3-2 Done" behind the initiative.
    const prev = row.taskId ? dir.tasksById.get(row.taskId) : undefined;
    const keepTicket = inferredOwner && !!prev && !!i.owner.taskId && prev.parentId === i.owner.taskId && !i.owner.sessionId;
    const projectId = inferredOwner ? i.owner.projectId : row.projectId;
    const taskId = keepTicket ? row.taskId : inferredOwner ? i.owner.taskId : row.taskId;
    const v = verdictFor(a, i, { source, projectId, taskId, startedAt: row.firstSeenAt ?? row.declaredAt });
    const next = {
      // Something an agent declared before the job saw it is now confirmed by both.
      source,
      projectId,
      taskId,
      sessionId: inferredOwner ? i.owner.sessionId : row.sessionId,
      details: withVerdict(detailsFor(i, row.details), v),
      state: v.state,
      // What an agent declared stays as declared; only the job's own suggestion is ours to change.
      teardown: row.source === "observed" ? teardownOf(i) : row.teardown,
    };
    const same =
      next.source === row.source &&
      next.projectId === row.projectId &&
      next.taskId === row.taskId &&
      next.sessionId === row.sessionId &&
      next.state === row.state &&
      next.teardown === row.teardown &&
      stable(next.details) === stable(row.details);
    if (row.state === "gone") result.revived++;
    if (same) {
      touch.push(row.id);
    } else {
      changed.push({ id: row.id, set: { ...next, misses: 0, lastSeenAt: now, updatedAt: now } });
      result.updated++;
    }
  }

  const goneRows: Row[] = [];
  const missed: string[] = [];
  const release: string[] = [];
  const ghostNew: Row[] = [];
  const ghostRelease: Row[] = [];
  for (const row of rows) {
    if (seenKeys.has(keyOf(row.kind, row.locator))) continue;
    const collected = ran.has(groupOf(row.kind, row.locator, row.details));
    if (row.source !== "observed") {
      // Declared and both rows are not `gone`: the agent said it was there. Not seen by a collector
      // that ran makes it a ghost, and a ghost is released (this only edits our table) an hour later.
      if (row.state === "ghost") {
        const since = typeof row.details.ghost_since === "string" ? new Date(row.details.ghost_since) : row.updatedAt;
        if (now.getTime() - since.getTime() >= GHOST_RELEASE_MS) ghostRelease.push(row);
        continue;
      }
      if (!collected) continue; // a cache has no collector; Docker may be missing: never a ghost
      const v = computeVerdict({
        source: row.source as "declared" | "both",
        self: false,
        shared: false,
        projectId: row.projectId,
        taskId: row.taskId,
        repo: null,
        seen: false,
        collectorRan: true,
        misses: row.misses + 1,
        declaredAt: row.declaredAt,
        now,
        current: row.state as StateInput["current"],
      });
      if (v.state === "ghost") ghostNew.push(row);
      else missed.push(row.id);
      continue;
    }
    if (row.state === "gone") {
      if (row.lastSeenAt && now.getTime() - row.lastSeenAt.getTime() > GONE_KEEP_MS) release.push(row.id);
      continue;
    }
    if (!collected) continue;
    if (row.misses + 1 >= GONE_AFTER) goneRows.push(row);
    else missed.push(row.id);
  }

  // ---- writes. Rows with a project are written inside writeTx, so footprint.seen / footprint.gone
  // commit with the row and reach that project's event feed. Rows without a project (a Postgres
  // server, plania's own repo) cannot have an event: events.project_id is NOT NULL and the log is
  // per project. They are still in the table and the live bus below tells the screen to refetch.
  type Bucket = { ins: typeof inserts; gone: Row[]; ghosts: Row[] };
  const byProject = new Map<string | null, Bucket>();
  const bucket = (p: string | null) => byProject.get(p) ?? byProject.set(p, { ins: [], gone: [], ghosts: [] }).get(p)!;
  for (const r of inserts) bucket(r.projectId ?? null).ins.push(r);
  for (const r of goneRows) bucket(r.projectId).gone.push(r);
  for (const r of ghostRelease) bucket(r.projectId).ghosts.push(r);

  const slugs = new Map(dir.projects.map((p) => [p.id, p.slug]));
  const apply = async (q: Q, emit: Emit | null, g: Bucket) => {
    if (g.ins.length) await q.insert(footprints).values(g.ins);
    for (const r of g.ins) {
      result.seen++;
      await emit?.("footprint.seen", taskRef(dir, r.taskId), payloadOf(r.id!, r.kind, r.locator, r.state!, r.details!, machine));
    }
    for (const r of g.gone) {
      await q.update(footprints).set({ state: "gone", misses: r.misses + 1, updatedAt: now }).where(eq(footprints.id, r.id));
      result.gone++;
      await emit?.("footprint.gone", taskRef(dir, r.taskId), payloadOf(r.id, r.kind, r.locator, "gone", r.details, machine, r.lastSeenAt));
    }
    for (const r of g.ghosts) {
      if (emit) await releaseRow(q, emit, r, "ghost");
      else await q.update(footprints).set({ releasedAt: now, state: "released", updatedAt: now }).where(eq(footprints.id, r.id));
      result.released++;
    }
  };
  for (const [projectId, g] of byProject) {
    const slug = projectId ? slugs.get(projectId) : undefined;
    if (projectId && slug) {
      await writeTx(db, { id: projectId, slug }, { actor: SYSTEM_ACTOR, requestId: `footprints:${machine}:${now.toISOString()}`, tool: "jobs.machine" }, async (tx, emit) => {
        await apply(tx, emit, g);
        return true;
      });
    } else {
      await db.transaction((tx) => apply(tx, null, g));
    }
  }

  if (touch.length) await db.update(footprints).set({ lastSeenAt: now, misses: 0 }).where(inArray(footprints.id, touch));
  for (const c of changed) await db.update(footprints).set(c.set).where(eq(footprints.id, c.id));
  if (missed.length) await db.update(footprints).set({ misses: sql`${footprints.misses} + 1` }).where(inArray(footprints.id, missed));
  for (const r of ghostNew) {
    await db.update(footprints).set({ state: "ghost", misses: r.misses + 1, details: { ...r.details, ghost_since: now.toISOString() }, updatedAt: now }).where(eq(footprints.id, r.id));
    result.ghosted++;
  }
  if (release.length) {
    await db.update(footprints).set({ releasedAt: now, updatedAt: now }).where(inArray(footprints.id, release));
    result.released = release.length;
  }

  // The inventory is global (all projects and none), so one project-less notice per tick that changed it.
  if (result.seen + result.gone + result.revived + result.updated + result.released + result.ghosted > 0) bus.publish({ type: "footprint", project: "" });
  return result;
}

function taskRef(dir: Directory, taskId: string | null | undefined) {
  const t = taskId ? dir.tasksById.get(taskId) : undefined;
  return t ? { id: t.id, key: t.key } : null;
}

function payloadOf(id: string, kind: string, locator: string, state: string, details: Record<string, unknown>, machine: string, lastSeen?: Date | null) {
  return { footprint_id: id, machine, kind, locator, state, repo: details.repo ?? null, last_seen_at: lastSeen ? lastSeen.toISOString() : undefined };
}
