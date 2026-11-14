// PLA-I41-6: the scheduled Morning brief (spec §3, §4 "Triggers and waiting", §11; decisions D1 and D4).
// The asistente job calls scheduledBrief() every minute. It replaces the old free-text Asistente brief run:
// - brief_settings.enabled off: nothing (Generate now still works).
// - Local time (brief_settings.timezone, else PLANIA_TZ) at or after run_at: start the pipeline once per local date.
//   A Mac asleep at run_at catches up on the first tick after it wakes. A brief made with Generate now since run_at
//   today counts as today's brief; a manual run still going makes the tick wait for it.
// - A build running: the pipeline reserves the runner slot and waits with no cutoff (no new run starts meanwhile).
// - The plan guard at its limit: the tick waits before starting (like a busy slot).
// - fallback_at (default 11:00): a scheduled run still waiting is aborted, so the pipeline stores a facts-only brief
//   from buildBrief() + facts with one cross item. If nothing started today (asleep past fallback_at, or the plan
//   guard never cleared), a facts-only brief is stored right away. No automatic Claude brief runs later that day.
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { briefRuns, morningBriefs } from "../db/schema.js";
import { lastReading, loadSettings, planView } from "../runner/limits.js";
import { BriefRunningError, ceilingText, isoInZone, localDateIn, markStaleRuns, runningRun, startBrief, type RunBriefDeps, type RunBriefResult } from "./pipeline.js";
import { loadBriefSettings, resolveBriefSettings } from "./settings.js";

const DAY = 24 * 3600_000;

export type ScheduleDeps = {
  env?: NodeJS.ProcessEnv;
  // The screen's zone (PLANIA_TZ) when brief_settings.timezone is not set.
  tz?: string;
  // Passed to the pipeline (tests: fake spawnPass, clock, liveRuns).
  brief?: RunBriefDeps;
};

export type ScheduleTick = {
  // A scheduled run started this tick (Claude or facts only).
  started: 0 | 1;
  // That run is facts only (fallback_at passed with nothing started).
  fallback: 0 | 1;
  // A waiting scheduled run was stopped at fallback_at.
  ceiling: 0 | 1;
  // Waiting this tick: a manual run is going, or the plan guard is at its limit.
  waiting: 0 | 1;
};

type Active = { date: string; runId: string; controller: AbortController; done: Promise<RunBriefResult> };
let active: Active | null = null;
// Dates whose late facts-only brief was already tried by this process (a crash must not retry every minute).
const lateTried = new Set<string>();

export function resetScheduleForTests(): void {
  active?.controller.abort();
  active = null;
  lateTried.clear();
}

/** Tests and the CLI: resolves when the scheduled run this process started has ended. */
export async function waitForScheduledBrief(): Promise<RunBriefResult | null> {
  return active ? active.done : null;
}

export const scheduledRunId = (): string | null => active?.runId ?? null;

const hhmm = (d: Date, tz: string): string => isoInZone(d, tz).slice(11, 16);

function guardText(lang: string, pct: number | null, resetsAt: string | null, tz: string): string {
  const after = resetsAt && !Number.isNaN(Date.parse(resetsAt)) ? hhmm(new Date(resetsAt), tz) : null;
  const p = pct != null ? ` (${pct} %)` : "";
  if (lang === "es") return `El uso de Claude está en su límite${p}, así que este brief es solo de datos.${after ? ` Genera de nuevo después de las ${after}.` : ""}`;
  return `Claude usage is at its limit${p}, so this brief is facts only.${after ? ` Generate again after ${after}.` : ""}`;
}

export async function scheduledBrief(db: Db, now: Date, deps: ScheduleDeps = {}): Promise<ScheduleTick> {
  const out: ScheduleTick = { started: 0, fallback: 0, ceiling: 0, waiting: 0 };
  const base = deps.env ?? process.env;
  // The pipeline resolves the zone from the same env, so the run's local_date matches this tick's date.
  const env = deps.tz && !base.PLANIA_TZ ? { ...base, PLANIA_TZ: deps.tz } : base;
  const stored = await loadBriefSettings(db);
  if (!stored.enabled) return out;
  const s = resolveBriefSettings(stored, env);
  const tz = s.timezone;
  const date = localDateIn(now, tz);
  const time = hhmm(now, tz);
  if (time < stored.run_at) return out;
  const late = time >= stored.fallback_at;

  // Our own scheduled run of today: at fallback_at, stop it if it is still waiting (a build or the slot).
  if (active && active.date === date) {
    if (late && !active.controller.signal.aborted) {
      const [row] = await db.select({ status: briefRuns.status }).from(briefRuns).where(eq(briefRuns.id, active.runId)).limit(1);
      if (row?.status === "waiting") {
        active.controller.abort();
        out.ceiling = 1;
      }
    }
    return out;
  }

  // A run that died with its server is marked fail before deciding.
  if (await runningRun(db)) await markStaleRuns(db, now).catch(() => 0);

  const recent = await db
    .select({ id: briefRuns.id, startedAt: briefRuns.startedAt })
    .from(briefRuns)
    .where(and(eq(briefRuns.trigger, "schedule"), gte(briefRuns.startedAt, new Date(now.getTime() - 2 * DAY))));
  const scheduledToday = recent.filter((r) => localDateIn(r.startedAt, tz) === date);
  const briefs = await db.select({ generatedAt: morningBriefs.generatedAt }).from(morningBriefs).where(eq(morningBriefs.localDate, date));

  if (scheduledToday.length > 0) {
    // Already started today. The brief never goes missing: past fallback_at with no brief stored (the run crashed,
    // the server stopped mid-wait) and nothing running, store a facts-only one, once per process and date.
    if (late && briefs.length === 0 && !lateTried.has(date) && !(await runningRun(db))) {
      lateTried.add(date);
      const reason = ceilingText(s.language, stored.fallback_at, "the scheduled run did not finish");
      if (await start(db, date, { trigger: "schedule", factsOnly: reason }, deps, env)) out.started = out.fallback = 1;
    }
    return out;
  }

  // Generate now since run_at today already made today's brief.
  if (briefs.some((b) => hhmm(b.generatedAt, tz) >= stored.run_at)) return out;

  const settings = await loadSettings(db);
  const plan = planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride);
  const guarded = plan.state === "stopped" || plan.state === "warn";

  if (late) {
    const reason = guarded
      ? guardText(s.language, plan.five_hour_pct, plan.resets_at, tz)
      : ceilingText(s.language, stored.fallback_at, "Plania was not running at that time");
    if (await start(db, date, { trigger: "schedule", factsOnly: reason }, deps, env)) out.started = out.fallback = 1;
    else out.waiting = 1;
    return out;
  }
  if (guarded) {
    out.waiting = 1;
    return out;
  }
  const controller = new AbortController();
  if (await start(db, date, { trigger: "schedule", signal: controller.signal }, deps, env, controller)) out.started = 1;
  else out.waiting = 1;
  return out;
}

/** Starts a scheduled run. False when another run holds the lock (Generate now): the next tick tries again. */
async function start(
  db: Db,
  date: string,
  opts: Parameters<typeof startBrief>[1],
  deps: ScheduleDeps,
  env: NodeJS.ProcessEnv,
  controller = new AbortController(),
): Promise<boolean> {
  try {
    const { runId, done } = await startBrief(db, opts, { ...deps.brief, env });
    const entry: Active = {
      date,
      runId,
      controller,
      done: done.finally(() => {
        if (active?.runId === runId) active = null;
      }),
    };
    active = entry;
    return true;
  } catch (err) {
    if (err instanceof BriefRunningError) return false;
    throw err;
  }
}
