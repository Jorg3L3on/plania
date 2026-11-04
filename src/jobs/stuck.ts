import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agents, tasks, type Actor } from "../db/schema.js";
import { WAKE_INTERVAL_MS, claimsFor, liveClaims, presenceOf } from "../mcp/team.js";
import { SYSTEM_ACTOR, iso, writeTx } from "../mcp/tx.js";
import type { Job } from "./index.js";

// PLA-I21: hourly. An agent with no fresh check-in and a live claim is stuck. A claim whose lease
// is already past becomes a limpieza inbox item (claim.limpieza), once per lease. wake_url is
// POSTed at most once per agent per hour.

type Wake = typeof fetch;

const pastLeases = async (db: Db, now: Date) =>
  db.execute<{ id: string; project_id: string; slug: string; owner: Actor; lease_until: Date }>(sql`
    select t.id, t.project_id, p.slug, t.owner, t.lease_until
    from tasks t
    join projects p on p.id = t.project_id
    where t.lease_until < ${now.toISOString()}::timestamptz`);

async function notePastLeases(db: Db, now: Date): Promise<number> {
  const past = await pastLeases(db, now);
  let noted = 0;
  for (const row of past.rows) {
    const leaseUntil = iso(new Date(row.lease_until));
    const wrote = await writeTx(
      db,
      { id: row.project_id, slug: row.slug },
      { actor: SYSTEM_ACTOR, requestId: `limpieza:${row.id}:${leaseUntil}`, tool: "jobs.stuck" },
      async (tx, emit) => {
        const [task] = await tx.select().from(tasks).where(eq(tasks.id, row.id)).limit(1);
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
  const rows = await db.select().from(agents);
  const claims = await liveClaims(db, now);
  const counts = { alive: 0, idle: 0, stuck: 0, woken: 0, limpieza: 0 };
  for (const row of rows) {
    const status = presenceOf(row.lastCheckInAt, claimsFor(row, claims), now);
    counts[status]++;
    const wakeDue = status === "stuck" && !!row.wakeUrl && (!row.lastWakeAt || now.getTime() - new Date(row.lastWakeAt).getTime() >= WAKE_INTERVAL_MS);
    if (status !== row.status || wakeDue) {
      await db
        .update(agents)
        .set({ status, ...(wakeDue ? { lastWakeAt: now } : {}), updatedAt: sql`now()` })
        .where(eq(agents.id, row.id));
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
