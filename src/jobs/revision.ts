// PLA-I74-6: «Revisar proyecto» on its own. A project Plania photographs (settings.capture) gets its first check-up
// soon after it is set up (no pass yet), then one each night: between NIGHT_FROM and NIGHT_TO on this Mac's clock,
// once the last pass is older than NIGHTLY_AGE_MS. One project per tick, so a night of several projects runs them in
// turn. Plania itself checks itself with its own tests and is skipped, as is a project whose repo is not here.
import { existsSync } from "node:fs";
import type { Db } from "../db/client.js";
import { projects, type Project } from "../db/schema.js";
import { supported } from "../lib/system-support.js";
import { repoPathOf } from "../runner/worktree.js";
import { isSelfProject, serverRoot } from "../self/plania-self.js";
import { lastRevision, revisando, revisar, type RevisionTrigger } from "../captures/revision.js";
import type { Job } from "./index.js";

export const NIGHT_FROM = 2; // 02:00
export const NIGHT_TO = 5; // until 05:00
export const NIGHTLY_AGE_MS = 20 * 60 * 60_000;

/** Why a project is due a check-up now, or null. */
export function dueFor(last: { finished_at: string } | null, at: Date): RevisionTrigger | null {
  if (!last) return "setup";
  const h = at.getHours();
  if (h < NIGHT_FROM || h >= NIGHT_TO) return null;
  return at.getTime() - Date.parse(last.finished_at) > NIGHTLY_AGE_MS ? "nightly" : null;
}

export type RevisionJobDeps = { revisar?: typeof revisar; exists?: (p: string) => boolean; serverRoot?: string };

export async function runRevisionJob(db: Db, at: Date, deps: RevisionJobDeps = {}): Promise<Record<string, number>> {
  if (!supported("test_copy")) return {};
  const exists = deps.exists ?? existsSync;
  const all: Project[] = await db.select().from(projects);
  for (const p of all) {
    if (!p.settings.capture || revisando(p.slug)) continue;
    const repo = repoPathOf(p.slug, p.settings);
    if (!exists(repo) || isSelfProject(repo, deps.serverRoot ?? serverRoot())) continue;
    const why = dueFor(await lastRevision(db, p.id), at);
    if (!why) continue;
    const pass = await (deps.revisar ?? revisar)(db, p.slug, why);
    return { [why]: 1, ...(pass.ok ? {} : { red: 1 }) };
  }
  return {};
}

export const revisionJob: Job = {
  name: "revision",
  intervalMs: 10 * 60_000,
  runOnce: (db, now) => runRevisionJob(db, now),
};
