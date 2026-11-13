import type { Db } from "../db/client.js";
import { WAKE_INTERVAL_MS, claimsFor, liveClaims, presenceOf } from "../mcp/team.js";
import { SYSTEM_ACTOR, iso, writeTx } from "../mcp/tx.js";
import { COMPANY } from "../runner/limits.js";
import { pgStore, readerOf } from "../store/pg.js";
import { lt } from "../store/types.js";
import type { Job } from "./index.js";

// PLA-I21: hourly. An agent with no fresh check-in and a live claim is stuck. A claim whose lease
// is already past becomes a limpieza inbox item (claim.limpieza), once per lease. wake_url is
// POSTed at most once per agent per hour.

type Wake = typeof fetch;

// Tickets whose lease ended before now, with their project's slug.
const pastLeases = async (db: Db, now: Date) => {
  const r = readerOf(db);
  const tasks = await r.find("tasks", { leaseUntil: lt(now) });
  const slugOf = new Map(tasks.length ? (await r.find("projects", { id: [...new Set(tasks.map((t) => t.projectId))] })).map((p) => [p.id, p.slug]) : []);
  return tasks.filter((t) => slugOf.has(t.projectId)).map((t) => ({ id: t.id, project_id: t.projectId, slug: slugOf.get(t.projectId)!, owner: t.owner, lease_until: t.leaseUntil! }));
};

async function notePastLeases(db: Db, now: Date): Promise<number> {
  const past = await pastLeases(db, now);
  let noted = 0;
  for (const row of past) {
    const leaseUntil = iso(row.lease_until);
    const wrote = await writeTx(
      db,
      { id: row.project_id, slug: row.slug },
      { actor: SYSTEM_ACTOR, requestId: `limpieza:${row.id}:${leaseUntil}`, tool: "jobs.stuck" },
      async (tx, emit) => {
        const task = await readerOf(tx).get("tasks", { id: row.id });
        if (!task) return false;
        await emit("claim.limpieza", task, { owner: row.owner, lease_until: leaseUntil });
        return true;
      },
    );
    if (wrote) noted++;
  }
  return noted;
}

export async function sweepStuck(db: Db, now = new Date(), wake: Wake = fetch): Promise<{ alive: number; idle: number; stuck: number; woken: number; limpieza: number }> {
  const rows = await readerOf(db).find("agents");
  const claims = await liveClaims(db, now);
  const counts = { alive: 0, idle: 0, stuck: 0, woken: 0, limpieza: 0 };
  for (const row of rows) {
    // PLA-I32: a retired agent stays retired; its presence is not tracked.
    if (row.status === "retired") continue;
    const status = presenceOf(row.lastCheckInAt, claimsFor(row, claims), now);
    counts[status]++;
    const wakeDue = status === "stuck" && !!row.wakeUrl && (!row.lastWakeAt || now.getTime() - new Date(row.lastWakeAt).getTime() >= WAKE_INTERVAL_MS);
    if (status !== row.status || wakeDue) {
      await pgStore(db).write(COMPANY, {}, (uow) => uow.update("agents", { id: row.id }, { status, ...(wakeDue ? { lastWakeAt: now } : {}), updatedAt: uow.now }));
    }
    if (!wakeDue || !row.wakeUrl) continue;
    counts.woken++;
    try {
      await wake(row.wakeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: row.slug, status: "stuck" }),
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // last_wake_at is already stamped, so a failing target cannot loop inside the hour.
    }
  }
  counts.limpieza = await notePastLeases(db, now);
  return counts;
}

export const stuckJob: Job = {
  name: "stuck",
  intervalMs: 60 * 60 * 1000,
  runOnce: async (db, now) => sweepStuck(db, now),
};
