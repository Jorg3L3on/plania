import { withDb, type Db } from "../db/client.js";
import { legacyJob } from "./legacy.js";
import { leasesJob } from "./leases.js";

// Background jobs for the local server (2.1). Each job runs on its own interval with a fresh pool,
// skips a tick while the previous one is still running, and writes through the normal tool
// functions as the system actor with deterministic request ids, so a double tick replays nothing.
// Off in tests and under `pnpm dev:api` (PLANIA_JOBS=0).

export type JobSummary = Record<string, number>;
export type Job = { name: string; intervalMs: number; runOnce: (db: Db, now: Date) => Promise<JobSummary> };

export const JOBS: Job[] = [leasesJob, legacyJob];

export function startJobs(opts: { every?: Partial<Record<string, number>>; log?: (line: string) => void } = {}): () => void {
  const log = opts.log ?? ((line: string) => console.log(line));
  const timers: NodeJS.Timeout[] = [];
  for (const job of JOBS) {
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
  }
  return () => timers.forEach((t) => clearInterval(t));
}
