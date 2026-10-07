import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { pollState, projects, type Project } from "../db/schema.js";
import { setEnv } from "../mcp/env.js";
import { SYSTEM_ACTOR } from "../mcp/tx.js";
import { releaseMerged, type Fetch } from "./github.js";
import type { Job } from "./index.js";

// The Vercel poller (R-20, R-21, R-22-lite): every minute, the latest READY deployments of the
// project in settings.vercel become set_env records with the provider's time and id as the source
// (deployed_at is Vercel's, not ours). Then Merged tickets whose merge commit is deployed move to
// Released. The token comes from the env var in settings.vercel.token_env (default VERCEL_TOKEN).

type Deployment = {
  uid: string;
  url: string;
  state: string; // READY | ERROR | BUILDING | ...
  target: string | null; // production | null (preview)
  created: number;
  ready?: number;
  meta?: { githubCommitSha?: string; githubCommitRef?: string };
};

export type VercelDeps = { fetch: Fetch; now?: Date; env?: Record<string, string | undefined> };

export async function pollVercelProject(db: Db, p: Project, deps: VercelDeps): Promise<Record<string, number>> {
  const cfg = p.settings.vercel;
  if (!cfg?.project_id) return {};
  const token = (deps.env ?? process.env)[cfg.token_env ?? "VERCEL_TOKEN"];
  const summary: Record<string, number> = { deployments: 0, released: 0 };
  const [row] = await db.select().from(pollState).where(and(eq(pollState.projectId, p.id), eq(pollState.source, "vercel")));
  const cursor = row?.cursor ?? {};
  const save = (error: string | null) =>
    db
      .insert(pollState)
      .values({ projectId: p.id, source: "vercel", cursor, polledAt: sql`now()`, error })
      .onConflictDoUpdate({ target: [pollState.projectId, pollState.source], set: { cursor, polledAt: sql`now()`, error } });
  if (!token) {
    await save(`no token in ${cfg.token_env ?? "VERCEL_TOKEN"}`);
    return summary;
  }
  try {
    const q = new URLSearchParams({ projectId: cfg.project_id, limit: "10", state: "READY" });
    if (cfg.team_id) q.set("teamId", cfg.team_id);
    const res = await deps.fetch(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status >= 400) throw new Error(`Vercel ${res.status}`);
    const { deployments } = (await res.json()) as { deployments: Deployment[] };
    const seen = Number(cursor.last_created ?? 0);
    const targets = cfg.targets ?? { production: p.settings.release_target ?? "prod", preview: "preview" };
    let newest = seen;
    for (const d of [...deployments].sort((a, b) => a.created - b.created)) {
      if (d.created <= seen || d.state !== "READY") continue;
      const env = targets[d.target ?? "preview"];
      newest = Math.max(newest, d.created);
      if (!env) continue;
      const sha = d.meta?.githubCommitSha?.toLowerCase();
      await setEnv(
        db,
        {
          project: p.slug,
          env,
          ...(sha ? { commit: sha, commits: [sha] } : {}),
          ...(d.meta?.githubCommitRef ? { branch: d.meta.githubCommitRef } : {}),
          deployed: { provider: "vercel", deployment_id: d.uid, url: `https://${d.url}` },
        },
        { actor: { ...SYSTEM_ACTOR, machine: "poller" }, requestId: `vercel:${d.uid}`, tool: "jobs.vercel" },
      );
      summary.deployments!++;
    }
    cursor.last_created = newest;
    summary.released = await releaseMerged(db, p);
    await save(null);
  } catch (e) {
    await save(e instanceof Error ? e.message : String(e));
    throw e;
  }
  return summary;
}

export async function pollVercel(db: Db, deps: VercelDeps): Promise<Record<string, number>> {
  const total: Record<string, number> = {};
  for (const p of await db.select().from(projects)) {
    if (!p.settings.vercel?.project_id) continue;
    try {
      for (const [k, v] of Object.entries(await pollVercelProject(db, p, deps))) total[k] = (total[k] ?? 0) + v;
    } catch (e) {
      total.errors = (total.errors ?? 0) + 1;
      console.error(`[jobs] vercel ${p.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return total;
}

export const vercelJob: Job = {
  name: "vercel",
  intervalMs: 60 * 1000,
  runOnce: (db, now) => pollVercel(db, { fetch: (url, init) => fetch(url, init), now }),
};
