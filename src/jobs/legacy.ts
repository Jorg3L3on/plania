import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { decisions, envStates, projects, tasks } from "../db/schema.js";
import { archiveLegacyCard } from "../mcp/project.js";
import { legacyCard } from "../mcp/queries.js";
import { SYSTEM_ACTOR } from "../mcp/tx.js";
import type { Job } from "./index.js";

// R-01: the v1 hand-written card goes away on its own once a project has v2 data to stand on:
// an initiative with a scope, an environment record and a pinned, live decision.

export async function archiveReadyCards(db: Db): Promise<number> {
  let archived = 0;
  for (const p of await db.select().from(projects)) {
    if (!legacyCard(p)) continue;
    const [initiative] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, p.id), eq(tasks.kind, "initiative"), sql`${tasks.scope} <> ''`))
      .limit(1);
    const [env] = await db.select({ env: envStates.env }).from(envStates).where(eq(envStates.projectId, p.id)).limit(1);
    const [pinned] = await db
      .select({ id: decisions.id })
      .from(decisions)
      .where(and(eq(decisions.projectId, p.id), eq(decisions.pinned, true), isNull(decisions.retiredAt)))
      .limit(1);
    if (!initiative || !env || !pinned) continue;
    await archiveLegacyCard(
      db,
      { project: p.slug, reason: "auto: the project has a v2 initiative, an env record and a pinned decision" },
      { actor: SYSTEM_ACTOR, requestId: `legacy-archive:${p.slug}`, tool: "archive_legacy_card" },
    );
    archived++;
  }
  return archived;
}

export const legacyJob: Job = {
  name: "legacy",
  intervalMs: 60 * 60 * 1000,
  runOnce: async (db) => ({ archived: await archiveReadyCards(db) }),
};
