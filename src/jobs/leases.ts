import type { Db } from "../db/client.js";
import { liveTaskFootprint } from "../mcp/footprint-read.js";
import { SYSTEM_ACTOR, iso, writeTx } from "../mcp/tx.js";
import { readerOf, uowOf } from "../store/port.js";
import type { Job } from "./index.js";

// R-07 (part): claim.expiring, logged once per lease five minutes before it runs out, so a session
// that listens to the feed can heartbeat in time. A heartbeat clears the mark (writes.ts). The payload
// lists the ticket's live footprint (kind, locator, teardown).

export const EXPIRING_WINDOW_MIN = 5;

// Project slugs by id: a task's project, for writeTx.
async function slugsOf(db: Db): Promise<Map<string, string>> {
  return new Map((await readerOf(db).find("projects")).map((p) => [p.id, p.slug]));
}

export async function warnExpiringLeases(db: Db, now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_MIN * 60_000);
  const slugs = await slugsOf(db);
  const rows = (await readerOf(db).find("tasks", { expiringWarnedAt: null }))
    .filter((t) => t.leaseUntil && t.leaseUntil > now && t.leaseUntil <= soon && slugs.has(t.projectId))
    .map((t) => ({ t, slug: slugs.get(t.projectId)! }));
  let warned = 0;
  for (const { t, slug } of rows) {
    const leaseUntil = iso(t.leaseUntil!);
    await writeTx(
      db,
      { id: t.projectId, slug },
      { actor: SYSTEM_ACTOR, requestId: `claim-expiring:${t.key}:${leaseUntil}`, tool: "jobs.leases" },
      async (tx, emit) => {
        const uow = uowOf(tx);
        // Only while the mark is still clear: a row back means this write set it.
        const [u] = await uow.update("tasks", { id: t.id, expiringWarnedAt: null }, { expiringWarnedAt: uow.now });
        if (!u) return false;
        // What the ticket has running on the Mac, so a session listening to the feed can tear it down or extend the claim.
        const footprint = (await liveTaskFootprint(tx, t.id)).map((f) => ({ kind: f.kind, locator: f.locator, teardown: f.teardown }));
        await emit("claim.expiring", t, { owner: t.owner, lease_until: leaseUntil, minutes_left: EXPIRING_WINDOW_MIN, footprint });
        warned++;
        return true;
      },
    );
  }
  return warned;
}

// 2.7: leases expire lazily (writeTx reaps them on the next write in the project). In a project
// nobody writes to, a dead session would never be logged, so this runs an empty writeTx on every
// project with an expired lease: the usual reaper fires (owner cleared, In progress → Ready,
// claim.expired) within a minute. Returns how many projects were reaped.
export async function reapExpired(db: Db, now = new Date()): Promise<number> {
  const slugs = await slugsOf(db);
  const expired = new Set((await readerOf(db).find("tasks")).filter((t) => t.leaseUntil && t.leaseUntil < now && slugs.has(t.projectId)).map((t) => t.projectId));
  const rows = [...expired].map((id) => ({ id, slug: slugs.get(id)! }));
  for (const p of rows) await writeTx(db, p, { actor: SYSTEM_ACTOR, tool: "jobs.leases" }, async () => undefined);
  return rows.length;
}

export const leasesJob: Job = {
  name: "leases",
  intervalMs: 60 * 1000,
  runOnce: async (db, now) => ({ warned: await warnExpiringLeases(db, now), expired: await reapExpired(db, now) }),
};
