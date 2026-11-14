import type { Project } from "../db/schema.js";
import { readerOf, uowOf } from "../store/port.js";
import { prRowOf } from "./queries.js";
import { iso, type Q } from "./tx.js";

// Release records (R-22): one per (env, commit) the pollers saw a ticket reach Released on. The
// tickets, PRs and migrations are computed, never typed. get_project.releases lists them.

// A record's task keys and PR urls: each once, sorted. Sorted here by code unit, which is what the C
// collation does; Postgres sorted these arrays by the database's collation before they moved off SQL.
function withOne(list: string[], item: string): string[] {
  return [...new Set([...list, item])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function recordRelease(tx: Q, p: Project, env: string, taskKey: string): Promise<void> {
  const uow = uowOf(tx);
  const state = await uow.get("envStates", { projectId: p.id, env });
  if (!state?.commit) return;
  const t = await uow.get("tasks", { projectId: p.id, key: taskKey });
  const pr = t ? await prRowOf(tx, t) : undefined;
  // The newest record of this env for another commit: its migrations already shipped.
  const previous = (await uow.find("releases", { projectId: p.id, env }, { orderBy: [{ column: "createdAt", desc: true }] })).find((r) => r.commit !== state.commit);
  const newMigrations = state.migrations.filter((m) => !(previous?.migrations ?? []).includes(m));
  const at = { projectId: p.id, env, commit: state.commit };
  const existing = await uow.get("releases", at);
  if (existing) {
    await uow.update("releases", at, {
      taskKeys: withOne(existing.taskKeys, taskKey),
      ...(pr ? { prs: withOne(existing.prs, pr.url) } : {}),
      deployedAt: state.deployedAt,
      source: state.deploySource,
    });
    return;
  }
  await uow.insert("releases", {
    ...at,
    deployedAt: state.deployedAt,
    source: state.deploySource,
    taskKeys: [taskKey],
    prs: pr ? [pr.url] : [],
    migrations: newMigrations,
  });
}

export async function projectReleases(db: Q, projectId: string) {
  const rows = await readerOf(db).find("releases", { projectId }, { orderBy: [{ column: "createdAt", desc: true }, { column: "env" }], limit: 50 });
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
