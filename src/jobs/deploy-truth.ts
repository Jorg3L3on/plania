// PLA-I74-8: what the host says about the newest production deploy, kept as data so the screen can tell a failed
// release from a slow one. The Vercel poller (src/jobs/vercel.ts) writes it from every deploy state; without a Vercel
// token the GitHub poller (src/jobs/github.ts) writes it from the commit statuses the host posts on the release branch.
//
//   building  the host is still building the production version
//   error     the host's production build failed: log holds the excerpt the owner sees, fix_key the Taller step
//             «Pedir arreglo» made for it
//   checking  the deploy is READY but the production URL has not answered yet: not «En producción» yet
//   live      READY and the production URL answered
//
// One row per project in poll_state (source "deploy"); no migration.
import { and, eq, sql } from "drizzle-orm";
import { caminoRow } from "../camino/store.js";
import { prodEnvOf } from "../camino/prod.js";
import type { Db } from "../db/client.js";
import { pollState, type Project } from "../db/schema.js";
import type { Fetch } from "./github.js";

export type DeployState = "building" | "error" | "checking" | "live";
export type DeployTruth = {
  state: DeployState;
  provider: "vercel" | "github";
  deployment_id: string;
  sha: string | null;
  // The host's page for the deploy (Vercel's inspector, the status target).
  url: string | null;
  // The address probed for a live answer, and what it answered (null: no answer at all).
  probe_url: string | null;
  probe_status: number | null;
  log: string | null;
  created_at: string;
  seen_at: string;
  fix_key: string | null;
};

export const DEPLOY_SOURCE = "deploy";

export async function readDeployTruth(db: Db, projectId: string): Promise<DeployTruth | null> {
  const [row] = await db
    .select({ cursor: pollState.cursor })
    .from(pollState)
    .where(and(eq(pollState.projectId, projectId), eq(pollState.source, DEPLOY_SOURCE)))
    .limit(1);
  const t = (row?.cursor as { prod?: DeployTruth } | undefined)?.prod;
  return t && typeof t.state === "string" ? t : null;
}

/** Store the newest production deploy. A fix step already asked for the same deploy is kept. */
export async function writeDeployTruth(db: Db, projectId: string, next: Omit<DeployTruth, "fix_key" | "seen_at"> & { seen_at?: string }, now = new Date()): Promise<DeployTruth> {
  const before = await readDeployTruth(db, projectId);
  const t: DeployTruth = { ...next, seen_at: next.seen_at ?? now.toISOString(), fix_key: before?.deployment_id === next.deployment_id ? (before.fix_key ?? null) : null };
  const cursor = { prod: t };
  await db
    .insert(pollState)
    .values({ projectId, source: DEPLOY_SOURCE, cursor, polledAt: sql`now()`, error: t.state === "error" ? "production deploy failed" : null })
    .onConflictDoUpdate({ target: [pollState.projectId, pollState.source], set: { cursor, polledAt: sql`now()`, error: t.state === "error" ? "production deploy failed" : null } });
  return t;
}

/** «Pedir arreglo» made a Taller step for this failed deploy. */
export async function setDeployFix(db: Db, projectId: string, deploymentId: string, key: string): Promise<void> {
  const t = await readDeployTruth(db, projectId);
  if (!t || t.deployment_id !== deploymentId) return;
  const cursor = { prod: { ...t, fix_key: key } };
  await db.update(pollState).set({ cursor }).where(and(eq(pollState.projectId, projectId), eq(pollState.source, DEPLOY_SOURCE)));
}

const PROBE_MS = 10_000;

/** A live answer: any HTTP answer below 400 from the production URL, within ten seconds. */
export async function probeLive(fetch: Fetch, url: string): Promise<{ ok: boolean; status: number | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "plania-deploy-check" }, signal: ctl.signal });
    return { ok: res.status >= 200 && res.status < 400, status: res.status };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

/** The address that must answer before a deploy counts as in production: settings.vercel.production_url, else the
 * health or plain URL of Camino's production environment, else the fallback (the deploy's own URL). */
export async function productionUrlOf(db: Db, p: Project, fallback: string | null): Promise<string | null> {
  const own = p.settings.vercel?.production_url?.trim();
  if (own) return own;
  const row = await caminoRow(db, p.id);
  const env = prodEnvOf(row.config, p.settings.release ?? null);
  return env?.health?.url?.trim() || env?.url?.trim() || fallback;
}

const MAX_LINES = 30;
const MAX_CHARS = 3000;
const ERRORISH = /\b(error|failed|fail|cannot|can't|not found|exit code|ERR!|TypeError|SyntaxError)\b/i;

/** The part of a build log the owner sees: from a few lines before the first error-looking line, else the tail. */
export function logExcerpt(lines: string[]): string | null {
  const clean = lines.map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trimEnd()).filter((l) => l.trim());
  if (!clean.length) return null;
  const first = clean.findIndex((l) => ERRORISH.test(l));
  const from = first < 0 ? Math.max(0, clean.length - MAX_LINES) : Math.max(0, Math.min(first - 3, clean.length - MAX_LINES));
  let out = clean.slice(from, from + MAX_LINES).join("\n");
  if (out.length > MAX_CHARS) out = out.slice(out.length - MAX_CHARS);
  return out;
}
