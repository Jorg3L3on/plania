import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { CaminoKeyStore } from "../camino/keys.js";
import { pollState, projects, type Project } from "../db/schema.js";
import { NO_TOKEN, vercelTargetOf, vercelTokenOf } from "./deploy-host.js";
import { setEnv } from "../mcp/env.js";
import { SYSTEM_ACTOR } from "../mcp/tx.js";
import { closeReleased, releaseMerged, type Fetch } from "./github.js";
import { logExcerpt, probeLive, productionUrlOf, writeDeployTruth } from "./deploy-truth.js";
import type { Job } from "./index.js";

// The Vercel poller (R-20, R-21, R-22-lite): every minute, the latest READY deployments of the
// project in settings.vercel become set_env records with the provider's time and id as the source
// (deployed_at is Vercel's, not ours). Then Merged tickets whose merge commit is deployed move to
// Released. The token comes from the env var in settings.vercel.token_env (default VERCEL_TOKEN).
//
// PLA-I74-8: every state is read, not only READY. A production deploy in ERROR is kept with its build log
// (src/jobs/deploy-truth.ts) so the screen shows a red card instead of «espera publicarse»; one still building
// holds the cursor so it is read again. The newest READY production deploy is recorded only once the production
// URL answers, so «En producción» never shows before the site does. Without a token the GitHub poller reads the
// commit statuses the host posts instead.
//
// PLA-170: which Vercel project is read, and with which key, is one rule (vercelTargetOf, vercelTokenOf): the project in
// settings.vercel, else the Vercel project picked as Camino's production server; the key saved in Camino › Conexiones,
// else the env var. Before, only settings.vercel and the env var counted, so a project set up through the screen was
// never read. A key the host refuses is stored as an error that is not «no token»: the GitHub poller falls back on it too.

type Deployment = {
  uid: string;
  url: string;
  state: string; // READY | ERROR | BUILDING | QUEUED | INITIALIZING | CANCELED
  target: string | null; // production | null (preview)
  created: number;
  ready?: number;
  inspectorUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  meta?: { githubCommitSha?: string; githubCommitRef?: string };
};
type BuildEvent = { type?: string; text?: string; payload?: { text?: string } };

export type VercelDeps = { fetch: Fetch; now?: Date; env?: Record<string, string | undefined>; keys?: CaminoKeyStore };

const FAILED = ["ERROR"];
const ENDED = ["ERROR", "CANCELED"];

/** The build log of a failed deploy, cut to what the owner reads; the host's own error message when the log is unreadable. */
async function buildLog(deps: VercelDeps, token: string, d: Deployment, teamId?: string): Promise<string | null> {
  const fallback = [d.errorCode, d.errorMessage].filter(Boolean).join(": ") || null;
  try {
    const q = new URLSearchParams({ builds: "1", direction: "backward", limit: "200" });
    if (teamId) q.set("teamId", teamId);
    const res = await deps.fetch(`https://api.vercel.com/v3/deployments/${encodeURIComponent(d.uid)}/events?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status >= 400) return fallback;
    const events = (await res.json()) as BuildEvent[];
    if (!Array.isArray(events)) return fallback;
    const lines = events
      .slice()
      .reverse()
      .map((e) => e.text ?? e.payload?.text ?? "")
      .flatMap((t) => t.split("\n"));
    return logExcerpt(fallback ? [...lines, fallback] : lines) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function pollVercelProject(db: Db, p: Project, deps: VercelDeps): Promise<Record<string, number>> {
  const cfg = await vercelTargetOf(db, p);
  if (!cfg) {
    // No Vercel project any more: an old error must not keep saying deploys cannot be read.
    await db.delete(pollState).where(and(eq(pollState.projectId, p.id), eq(pollState.source, "vercel")));
    return {};
  }
  const key = await vercelTokenOf(p, cfg, deps);
  const token = key?.token;
  const summary: Record<string, number> = { deployments: 0, released: 0, failed: 0 };
  const [row] = await db.select().from(pollState).where(and(eq(pollState.projectId, p.id), eq(pollState.source, "vercel")));
  const cursor = row?.cursor ?? {};
  const save = (error: string | null) =>
    db
      .insert(pollState)
      .values({ projectId: p.id, source: "vercel", cursor, polledAt: sql`now()`, error })
      .onConflictDoUpdate({ target: [pollState.projectId, pollState.source], set: { cursor, polledAt: sql`now()`, error } });
  if (!token) {
    await save(`${NO_TOKEN}: none saved in Camino, none in ${cfg.token_env ?? "VERCEL_TOKEN"}`);
    return summary;
  }
  const now = deps.now ?? new Date();
  try {
    const q = new URLSearchParams({ projectId: cfg.project_id, limit: "20" });
    if (cfg.team_id) q.set("teamId", cfg.team_id);
    const res = await deps.fetch(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status >= 400) throw new Error(`Vercel ${res.status}`);
    const { deployments } = (await res.json()) as { deployments: Deployment[] };
    const seen = Number(cursor.last_created ?? 0);
    const targets = cfg.targets ?? { production: p.settings.release_target ?? "prod", preview: "preview" };
    const fresh = [...deployments].sort((a, b) => a.created - b.created).filter((d) => d.created > seen);
    // Only the newest READY production deploy must answer live; older ones in the batch are history.
    const newestReady = fresh.filter((d) => d.target === "production" && d.state === "READY").at(-1)?.uid;
    let newest = seen;
    for (const d of fresh) {
      const prod = d.target === "production";
      const sha = d.meta?.githubCommitSha?.toLowerCase() ?? null;
      const base = { provider: "vercel" as const, deployment_id: d.uid, sha, url: d.inspectorUrl ?? `https://${d.url}`, created_at: new Date(d.created).toISOString() };
      if (ENDED.includes(d.state)) {
        newest = Math.max(newest, d.created);
        if (prod && FAILED.includes(d.state)) {
          await writeDeployTruth(db, p.id, { ...base, state: "error", probe_url: null, probe_status: null, log: await buildLog(deps, token, d, cfg.team_id) }, now);
          summary.failed!++;
        }
        continue;
      }
      if (d.state !== "READY") {
        // Still building: a production one holds the cursor so its end is read; a preview one is passed over.
        if (prod) {
          await writeDeployTruth(db, p.id, { ...base, state: "building", probe_url: null, probe_status: null, log: null }, now);
          break;
        }
        continue;
      }
      if (prod && d.uid === newestReady) {
        const probeUrl = (await productionUrlOf(db, p, `https://${d.url}`))!;
        const live = await probeLive(deps.fetch, probeUrl);
        await writeDeployTruth(db, p.id, { ...base, state: live.ok ? "live" : "checking", probe_url: probeUrl, probe_status: live.status, log: null }, now);
        if (!live.ok) break;
      }
      const env = targets[d.target ?? "preview"];
      newest = Math.max(newest, d.created);
      if (!env) continue;
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
    summary.closed = await closeReleased(db, p);
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
