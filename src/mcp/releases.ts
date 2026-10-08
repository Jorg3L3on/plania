import { and, asc, desc, eq, sql } from "drizzle-orm";
import { envStates, pullRequests, releases, tasks, type Project } from "../db/schema.js";
import { iso, type Q } from "./tx.js";

// Release records (R-22): one per (env, commit) the pollers saw a ticket reach Released on. The
// tickets, PRs and migrations are computed, never typed. get_project.releases lists them.

export async function recordRelease(tx: Q, p: Project, env: string, taskKey: string): Promise<void> {
  const [state] = await tx.select().from(envStates).where(and(eq(envStates.projectId, p.id), eq(envStates.env, env))).limit(1);
  if (!state?.commit) return;
  const [t] = await tx.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, taskKey))).limit(1);
  const [pr] = t ? await tx.select().from(pullRequests).where(eq(pullRequests.taskId, t.id)).orderBy(desc(pullRequests.updatedAt)).limit(1) : [];
  const [previous] = await tx
    .select()
    .from(releases)
    .where(and(eq(releases.projectId, p.id), eq(releases.env, env), sql`${releases.commit} <> ${state.commit}`))
    .orderBy(desc(releases.createdAt))
    .limit(1);
  const newMigrations = state.migrations.filter((m) => !(previous?.migrations ?? []).includes(m));
  await tx
    .insert(releases)
    .values({
      projectId: p.id,
      env,
      commit: state.commit,
      deployedAt: state.deployedAt,
      source: state.deploySource,
      taskKeys: [taskKey],
      prs: pr ? [pr.url] : [],
      migrations: newMigrations,
    })
    .onConflictDoUpdate({
      target: [releases.projectId, releases.env, releases.commit],
      set: {
        taskKeys: sql`(select array(select distinct unnest(${releases.taskKeys} || array[${taskKey}]::text[]) order by 1))`,
        prs: pr ? sql`(select array(select distinct unnest(${releases.prs} || array[${pr.url}]::text[]) order by 1))` : releases.prs,
        deployedAt: state.deployedAt,
        source: state.deploySource,
      },
    });
}

export async function projectReleases(db: Q, projectId: string) {
  const rows = await db.select().from(releases).where(eq(releases.projectId, projectId)).orderBy(desc(releases.createdAt), asc(releases.env)).limit(50);
  return rows.map((r) => ({
    id: r.id,
    env: r.env,
    commit: r.commit,
    deployed_at: iso(r.deployedAt),
    source: r.source,
    tasks: r.taskKeys,
    prs: r.prs,
    migrations: r.migrations,
    notes: r.notes,
    created_at: iso(r.createdAt),
  }));
}
