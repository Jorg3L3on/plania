import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { footprints } from "../../db/schema.js";
import { bus } from "../../events.js";
import { SYSTEM_ACTOR, writeTx, type Emit, type Q } from "../../mcp/tx.js";
import { groupOf } from "./collect.js";
import { computeState, suggestTeardown, type Directory, type FootprintState, type Observed, type Owner } from "./infer.js";

// Per tick: compare what the collectors saw with the unreleased rows of this machine.
//   new → insert, event footprint.seen
//   seen again → last_seen_at, details, inferred owner, state; misses back to 0 (no event)
//   not seen while its collector ran → misses + 1; at GONE_AFTER misses the state is `gone`
//     (last_seen_at stays frozen at the last sighting), event footprint.gone
//   its collector did not run (tool missing, command failed, not due) → the row is left alone
// Plania never touches the Mac here: this only writes the footprints table.

export const GONE_AFTER = 2;
const GONE_KEEP_MS = 24 * 60 * 60 * 1000; // a gone row is released (kept for history, out of the inventory) a day after last seen
// details keys a collector only fills on some ticks; a tick without them keeps the last value.
const STICKY = ["size_kb", "size_at", "version"];

type Row = typeof footprints.$inferSelect;
export type Inferred = { item: Observed; owner: Owner; repoPath: string | null };
export type ReconcileResult = { seen: number; gone: number; revived: number; updated: number; released: number };

const keyOf = (kind: string, locator: string) => `${kind}\0${locator}`;

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
  return d;
}

function stateFor(i: Inferred, source: "observed" | "declared" | "both"): FootprintState {
  return computeState({
    source,
    self: !!i.item.self,
    shared: !!i.item.shared,
    projectId: i.owner.projectId,
    taskId: i.owner.taskId,
    repo: i.owner.repo ?? i.item.repoHint ?? null,
  });
}

export async function reconcile(
  db: Db,
  a: { machine: string; now: Date; dir: Directory; inferred: Inferred[]; ran: Set<string> },
): Promise<ReconcileResult> {
  const { machine, now, dir } = a;
  const rows = await db.select().from(footprints).where(and(eq(footprints.machine, machine), isNull(footprints.releasedAt)));
  const existing = new Map(rows.map((r) => [keyOf(r.kind, r.locator), r]));
  const result: ReconcileResult = { seen: 0, gone: 0, revived: 0, updated: 0, released: 0 };

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
      inserts.push({
        id: crypto.randomUUID(),
        machine,
        kind: i.item.kind,
        locator: i.item.locator,
        projectId: i.owner.projectId,
        taskId: i.owner.taskId,
        sessionId: i.owner.sessionId,
        source: "observed",
        teardown: suggestTeardown(i.item, i.repoPath),
        details: detailsFor(i, undefined),
        state: stateFor(i, "observed"),
        firstSeenAt: now,
        lastSeenAt: now,
      });
      continue;
    }
    // A declared owner is the agent's word; only observed rows take the inferred one.
    const inferredOwner = row.source === "observed";
    const next = {
      projectId: inferredOwner ? i.owner.projectId : row.projectId,
      taskId: inferredOwner ? i.owner.taskId : row.taskId,
      sessionId: inferredOwner ? i.owner.sessionId : row.sessionId,
      details: detailsFor(i, row.details),
      state: stateFor({ ...i, owner: { ...i.owner, projectId: inferredOwner ? i.owner.projectId : row.projectId, taskId: inferredOwner ? i.owner.taskId : row.taskId } }, row.source as "observed" | "declared" | "both"),
      teardown: row.source === "observed" ? suggestTeardown(i.item, i.repoPath) : row.teardown,
    };
    const same =
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
  for (const row of rows) {
    if (seenKeys.has(keyOf(row.kind, row.locator))) continue;
    if (row.source !== "observed") continue; // declared and both rows are phase 4/5: ghosts, not gone
    if (row.state === "gone") {
      if (row.lastSeenAt && now.getTime() - row.lastSeenAt.getTime() > GONE_KEEP_MS) release.push(row.id);
      continue;
    }
    if (!ran.has(groupOf(row.kind, row.locator, row.details))) continue;
    if (row.misses + 1 >= GONE_AFTER) goneRows.push(row);
    else missed.push(row.id);
  }

  // ---- writes. Rows with a project are written inside writeTx, so footprint.seen / footprint.gone
  // commit with the row and reach that project's event feed. Rows without a project (a Postgres
  // server, plania's own repo) cannot have an event: events.project_id is NOT NULL and the log is
  // per project. They are still in the table and the live bus below tells the screen to refetch.
  const byProject = new Map<string | null, { ins: typeof inserts; gone: Row[] }>();
  const bucket = (p: string | null) => byProject.get(p) ?? byProject.set(p, { ins: [], gone: [] }).get(p)!;
  for (const r of inserts) bucket(r.projectId ?? null).ins.push(r);
  for (const r of goneRows) bucket(r.projectId).gone.push(r);

  const slugs = new Map(dir.projects.map((p) => [p.id, p.slug]));
  const apply = async (q: Q, emit: Emit | null, g: { ins: typeof inserts; gone: Row[] }) => {
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
  if (release.length) {
    await db.update(footprints).set({ releasedAt: now, updatedAt: now }).where(inArray(footprints.id, release));
    result.released = release.length;
  }

  // The inventory is global (all projects and none), so one project-less notice per tick that changed it.
  if (result.seen + result.gone + result.revived + result.updated + result.released > 0) bus.publish({ type: "footprint", project: "" });
  return result;
}

function taskRef(dir: Directory, taskId: string | null | undefined) {
  const t = taskId ? dir.tasksById.get(taskId) : undefined;
  return t ? { id: t.id, key: t.key } : null;
}

function payloadOf(id: string, kind: string, locator: string, state: string, details: Record<string, unknown>, machine: string, lastSeen?: Date | null) {
  return { footprint_id: id, machine, kind, locator, state, repo: details.repo ?? null, last_seen_at: lastSeen ? lastSeen.toISOString() : undefined };
}
