import { withDb, type Db } from "../db/client.js";
import { asistenteJob } from "./asistente.js";
import { auditJob } from "./audit.js";
import { backupJob } from "./backup.js";
import { blockersJob } from "./blockers.js";
import { githubJob } from "./github.js";
import { leasesJob } from "./leases.js";
import { machineJob } from "./machine/index.js";
import { pushJob } from "./push.js";
import { heartbeatJob } from "./heartbeat.js";
import { stuckJob } from "./stuck.js";
import { vercelJob } from "./vercel.js";
import { lessonsJob } from "./lessons.js";
import { logosJob } from "./logos.js";
import { skillUpstreamJob } from "./skill-upstream.js";
import { copiasJob } from "./copias.js";
import { revisionJob } from "./revision.js";
import { turnsJob } from "./turns.js";

// Background jobs for the local server (2.1). Each job runs on its own interval with the shared pool,
// skips a tick while the previous one is still running, and writes through the normal tool
// functions as the system actor with deterministic request ids, so a double tick replays nothing.
// Off in tests and under `pnpm dev:api` (PLANIA_JOBS=0).

export type JobSummary = Record<string, number>;
export type Job = { name: string; intervalMs: number; runOnce: (db: Db, now: Date) => Promise<JobSummary> };

export const JOBS: Job[] = [leasesJob, blockersJob, githubJob, vercelJob, auditJob, machineJob, backupJob, pushJob, stuckJob, asistenteJob, logosJob, skillUpstreamJob, copiasJob, revisionJob];

// Heartbeats join the other jobs only when wakes are on: PLANIA_JOBS=1, or (PLA-I2-2) PLANIA_JOBS unset on an
// install made by the first-start screen.
// PLA-I67-3: the reflector uses the owner's plan like a run, so it starts with the wakes.
// PLA-I74-5: so does the turn watchdog: its heals are wakes.
export const jobsToStart = (): Job[] => (wakesOn() ? [...JOBS, heartbeatJob, lessonsJob, turnsJob] : [...JOBS]);

import { startAdmissionLoop } from "../runner/runner.js";
import { makeDb } from "../db/client.js";
import { onWakesOn, wakesOn } from "../install-state.js";

export function startJobs(opts: { every?: Partial<Record<string, number>>; log?: (line: string) => void } = {}): () => void {
  const log = opts.log ?? ((line: string) => console.log(line));
  const timers: NodeJS.Timeout[] = [];
  const schedule = (job: Job) => {
    const interval = opts.every?.[job.name] ?? job.intervalMs;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const summary = await withDb((db) => job.runOnce(db, new Date()));
        const changed = Object.entries(summary).filter(([, n]) => n > 0);
        if (changed.length) log(`[jobs] ${job.name}: ${changed.map(([k, n]) => `${k}=${n}`).join(" ")}`);
      } catch (e) {
        log(`[jobs] ${job.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    };
    // A little jitter so the jobs do not all wake at once.
    timers.push(setInterval(() => void tick(), interval + Math.round((Math.random() - 0.5) * interval * 0.2)));
  };
  const jobs = jobsToStart();
  for (const job of jobs) schedule(job);
  // PLA-I60-2: queued runs are admitted a moment after they are queued, not only on the heartbeat tick.
  let stopAdmission = jobs.some((j) => j.name === "heartbeat") ? startAdmissionLoop(makeDb().db, {}, log) : () => {};
  // PLA-I2-2: first start turns wakes on while the server runs; the heartbeat joins then, with no restart.
  const stopListening = jobs.some((j) => j.name === "heartbeat")
    ? () => {}
    : onWakesOn(() => {
        schedule(heartbeatJob);
        stopAdmission = startAdmissionLoop(makeDb().db, {}, log);
        log("[jobs] wakes on: heartbeat started");
      });
  return () => {
    timers.forEach((t) => clearInterval(t));
    stopAdmission();
    stopListening();
  };
}
