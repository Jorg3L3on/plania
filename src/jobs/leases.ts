import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { SYSTEM_ACTOR, iso, writeTx } from "../mcp/tx.js";
import type { Job } from "./index.js";

// R-07 (part): claim.expiring, logged once per lease five minutes before it runs out, so a session
// that listens to the feed can heartbeat in time. A heartbeat clears the mark (writes.ts).

export const EXPIRING_WINDOW_MIN = 5;

export async function warnExpiringLeases(db: Db, now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_MIN * 60_000);
  const rows = await db
    .select({ t: tasks, slug: projects.slug })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(sql`${tasks.leaseUntil} > ${now.toISOString()}::timestamptz`, sql`${tasks.leaseUntil} <= ${soon.toISOString()}::timestamptz`, isNull(tasks.expiringWarnedAt)));
  let warned = 0;
  for (const { t, slug } of rows) {
    const leaseUntil = iso(t.leaseUntil!);
    await writeTx(
      db,
      { id: t.projectId, slug },
      { actor: SYSTEM_ACTOR, requestId: `claim-expiring:${t.key}:${leaseUntil}`, tool: "jobs.leases" },
      async (tx, emit) => {
        const [u] = await tx
          .update(tasks)
          .set({ expiringWarnedAt: sql`now()` })
          .where(and(eq(tasks.id, t.id), isNull(tasks.expiringWarnedAt)))
          .returning({ id: tasks.id });
        if (!u) return false;
        await emit("claim.expiring", t, { owner: t.owner, lease_until: leaseUntil, minutes_left: EXPIRING_WINDOW_MIN });
        warned++;
        return true;
      },
    );
  }
  return warned;
}

export const leasesJob: Job = {
  name: "leases",
  intervalMs: 60 * 1000,
  runOnce: async (db, now) => ({ warned: await warnExpiringLeases(db, now) }),
};
