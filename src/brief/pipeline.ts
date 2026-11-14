// PLA-I41-5: the Morning brief pipeline (spec §4, §5 "Lock, waiting and logs", §11).
// startBrief(db, opts) takes the single-run lock (pg_try_advisory_lock(hashtext('morning_brief')) on a connection of
// its own, held for the whole run) and writes a brief_runs row (waiting). A second trigger while one holds the lock
// gets BriefRunningError (409 BRIEF_RUNNING with the run id). The run then: reserves the runner slot and waits, with
// no time cutoff, until no run is live (the caller's AbortSignal is the fallback_at ceiling) -> running -> facts ->
// pass A -> pass B -> merge -> store the morning_briefs row -> the 0-token "Brief de hoy" projection (asistente.brief
// event, so GET /api/company keeps working) -> prune checks unseen for 30 days -> ok / partial / fallback; a crash
// is fail. Stale rows (a run that died with the server) are marked fail by markStaleRuns.
//
// The 07:00 schedule, the fallback_at timer and waiting out the plan guard are in schedule.ts (PLA-I41-6).
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type pg from "pg";
import type { Db } from "../db/client.js";
import { briefChecks, briefPlanRequests, briefRuns, morningBriefs, projects, tasks, type BriefPassRecord, type BriefRunStatus } from "../db/schema.js";
import { writeTx } from "../mcp/tx.js";
import { buildBrief as defaultBuildBrief, ASISTENTE_ACTOR } from "../runner/asistente.js";
import { liveRuns as defaultLiveRuns, releaseReservation, reserveSlot, settleRunner } from "../runner/runner.js";
import { asistenteHome } from "../runner/threads.js";
import { BRIEF_AGENT, spawnPass as defaultSpawnPass, type BriefPass, type PassOutcome, type SpawnPassDeps, type SpawnPassInput } from "./claude.js";
import { briefWindow, buildFacts, type Facts } from "./facts.js";
import { mergeBrief, projectionLines, type OpenIdea, type PassResult, type WaitingPaused } from "./merge.js";
import { loadPassPrompts, readSchemaText, type SystemVars } from "./prompts.js";
import { loadBriefProjects, loadBriefSettings, resolveBriefSettings } from "./settings.js";
import { BriefPassOutput, Idea, IdeasPassOutput, type BriefData } from "./types.js";

export const LOCK_KEY = "morning_brief";
export const CHECK_KEEP_DAYS = 30;
const MINUTE = 60_000;
const DAY = 24 * 3600_000;

export type BriefTrigger = "schedule" | "manual" | "cli";

export class BriefRunningError extends Error {
  readonly code = "BRIEF_RUNNING";
  constructor(readonly runId: string | null) {
    super(runId ? `a Morning brief is already running (${runId})` : "a Morning brief is already running");
    this.name = "BriefRunningError";
  }
}

export type RunBriefOptions = {
  trigger: BriefTrigger;
  // Which Claude passes run. Default both (pass B only when ideas_enabled).
  passes?: BriefPass[];
  // Store a facts-only brief right away with this plain reason (no Claude run).
  factsOnly?: string;
  // Aborted = the fallback_at ceiling: stop waiting (or the pass) and store a facts-only brief.
  signal?: AbortSignal;
  // The text after "because" when the signal fires, e.g. "a build was still running". Default from the state.
  ceilingLabel?: string;
};

export type RunBriefDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  spawnPass?: <T>(db: Db, input: SpawnPassInput<T>, deps?: SpawnPassDeps) => Promise<PassOutcome<T>>;
  spawnDeps?: SpawnPassDeps;
  buildBrief?: (db: Db, now: Date) => Promise<string[]>;
  liveRuns?: () => unknown[];
  pollMs?: number;
  // Parent of the per-run folder that holds facts.json (0700 folder, 0600 file). Default <tmpdir>/plania-brief.
  tmpDir?: string;
  // Where pass tokens are reported (reportTokens needs an existing task key). Default PLANIA_BRIEF_TASK_KEY; none skips.
  usageTaskKey?: string | null;
};

export type RunBriefResult = { runId: string; status: BriefRunStatus; briefId: string | null; mode: BriefData["mode"] | null; summary: string };

// ---- Time in the brief's zone

/** ISO 8601 with the zone's offset, e.g. "2026-11-13T07:04:12-06:00". */
export function isoInZone(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const local = Date.UTC(+get("year"), +get("month") - 1, +get("day"), +get("hour") % 24, +get("minute"), +get("second"));
  const off = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / MINUTE);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${get("year")}-${get("month")}-${get("day")}T${pad(+get("hour") % 24)}:${get("minute")}:${get("second")}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
export const localDateIn = (d: Date, tz: string): string => isoInZone(d, tz).slice(0, 10);

// ---- Lock

/** The lock lives on a connection of its own: it is session-scoped and dies with the connection (a crash frees it). */
async function tryLock(db: Db): Promise<pg.PoolClient | null> {
  const pool = (db as unknown as { $client: pg.Pool }).$client;
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(hashtext($1)) as ok`, [LOCK_KEY]);
    if (rows[0]?.ok) return client;
  } catch (err) {
    client.release();
    throw err;
  }
  client.release();
  return null;
}

async function unlock(client: pg.PoolClient): Promise<void> {
  try {
    await client.query(`select pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]);
    client.release();
  } catch {
    client.release(true);
  }
}

/** The live run's id, for the 409. */
export async function runningRun(db: Db): Promise<{ id: string; status: BriefRunStatus; started_at: Date } | null> {
  const [row] = await db
    .select({ id: briefRuns.id, status: briefRuns.status, started_at: briefRuns.startedAt })
    .from(briefRuns)
    .where(inArray(briefRuns.status, ["waiting", "running"]))
    .orderBy(desc(briefRuns.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * §5: a running row older than the pass timeouts + 5 min is marked fail. When nobody holds the lock, every waiting or
 * running row is left over from a server that stopped mid-run and is marked fail too. Returns how many it marked.
 */
export async function markStaleRuns(db: Db, now: Date = new Date(), timeouts?: { brief: number; ideas: number }): Promise<number> {
  const t = timeouts ?? (await loadBriefSettings(db)).pass_timeouts;
  const cutoff = new Date(now.getTime() - (t.brief + t.ideas + 5) * MINUTE);
  const lock = await tryLock(db);
  try {
    const where = lock ? inArray(briefRuns.status, ["waiting", "running"]) : and(eq(briefRuns.status, "running"), lt(briefRuns.startedAt, cutoff));
    const rows = await db
      .update(briefRuns)
      .set({ status: "fail", endedAt: now, summary: "did not finish: stale run (the server stopped or the run hung)" })
      .where(where)
      .returning({ id: briefRuns.id });
    return rows.length;
  } finally {
    if (lock) await unlock(lock);
  }
}

// ---- Checks

/** Deletes checks whose id is in no brief of the last 30 days (and that are older than that themselves). */
export async function pruneChecks(db: Db, now: Date = new Date(), days = CHECK_KEEP_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * DAY).toISOString();
  const res = await db.execute(sql`
    delete from brief_checks c
    where c.checked_at < ${cutoff}::timestamptz
      and not exists (
        select 1 from morning_briefs b
        where b.generated_at >= ${cutoff}::timestamptz
          and (b.data->'items' @> jsonb_build_array(jsonb_build_object('id', c.item_id))
               or b.data->'ideas' @> jsonb_build_array(jsonb_build_object('id', c.item_id))))`);
  return res.rowCount ?? 0;
}

// ---- What the merge needs from the DB

const IDEA_KEY = /-IDEA\d+$/i;

async function openIdeas(db: Db, slugs: string[]): Promise<OpenIdea[]> {
  if (!slugs.length) return [];
  const rows = await db
    .select({ slug: projects.slug, key: tasks.key, title: tasks.title, summary: tasks.summary })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(inArray(projects.slug, slugs), eq(tasks.kind, "idea"), eq(tasks.status, "Open"), isNull(tasks.promotedTo)))
    .orderBy(desc(tasks.createdAt));
  return rows.filter((r) => IDEA_KEY.test(r.key)).map((r) => ({ app: r.slug, key: r.key, title: r.title, summary: r.summary || null }));
}

/** The newest brief of an earlier local date: its ideas the owner did not check. */
async function yesterdayIdeas(db: Db, today: string): Promise<Idea[]> {
  const [prev] = await db.select({ data: morningBriefs.data }).from(morningBriefs).where(lt(morningBriefs.localDate, today)).orderBy(desc(morningBriefs.localDate), desc(morningBriefs.generatedAt)).limit(1);
  const raw = Array.isArray(prev?.data?.ideas) ? (prev!.data.ideas as unknown[]) : [];
  const ideas = raw.flatMap((r) => {
    const p = Idea.safeParse(r);
    return p.success ? [p.data] : [];
  });
  if (!ideas.length) return [];
  // PLA-I41-6: inArray, not any(${array}::text[]): drizzle spreads an array param into a list, which broke the cast.
  const checked = await db.select({ item_id: briefChecks.itemId }).from(briefChecks).where(inArray(briefChecks.itemId, ideas.map((i) => i.id)));
  const seen = new Set(checked.map((r) => r.item_id));
  return ideas.filter((i) => !seen.has(i.id));
}

/** D7: Send to Plania targets waiting because their project's runs are paused (still paused per the facts). */
async function waitingPaused(db: Db, facts: Facts | null): Promise<WaitingPaused[]> {
  const rows = await db.select({ targets: briefPlanRequests.targets }).from(briefPlanRequests).where(eq(briefPlanRequests.status, "open"));
  const stillPaused = (slug: string) => {
    const p = facts?.projects.find((x) => x.slug === slug);
    return p ? p.runs_paused : true;
  };
  return rows.flatMap((r) => r.targets.filter((t) => t.state === "waiting_paused" && stillPaused(t.slug)).map((t) => ({ slug: t.slug, codes: t.codes })));
}

/** Ticket keys named in the items that are settled (Done, Won't do). */
async function settledKeys(db: Db, items: unknown[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const i of items) {
    const ref = (i as { ref?: unknown })?.ref;
    if (typeof ref === "string") for (const k of ref.toUpperCase().match(/\b[A-Z][A-Z0-9]*-[A-Z0-9-]*[0-9]\b/g) ?? []) keys.add(k);
  }
  if (!keys.size) return new Set();
  const rows = await db
    .select({ key: tasks.key })
    .from(tasks)
    .where(and(inArray(tasks.key, [...keys]), or(eq(tasks.status, "Done"), eq(tasks.status, "Won't do"))));
  return new Set(rows.map((r) => r.key.toUpperCase()));
}

// ---- Brief de hoy

/** The 0-token "Brief de hoy" on Compañía: an asistente.brief event that GET /api/company already reads. */
export async function writeProjection(db: Db, brief: { id: string; localDate: string; data: BriefData }, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const home = await asistenteHome(db, env);
  const lines = projectionLines(brief.data);
  if (!home) return lines;
  const ctx = { actor: { ...ASISTENTE_ACTOR, session_id: BRIEF_AGENT, machine: hostname() }, tool: "brief.projection", requestId: `morning_brief:projection:${brief.id}` };
  await writeTx(db, home, ctx, async (_tx, emit) => {
    await emit("asistente.brief", null, {
      date: brief.localDate,
      lines,
      generated_at: brief.data.generatedAt,
      source: "morning_brief",
      brief_id: brief.id,
      mode: brief.data.mode,
      link: "/brief",
    });
  });
  return lines;
}

// ---- The run

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

const passRecord = (o: PassOutcome<unknown>): BriefPassRecord => {
  const log_file = o.logPath ? path.basename(o.logPath) : undefined;
  return o.ok ? { status: "ok", turns: o.turns, tokens: o.tokens.total, ...(log_file ? { log_file } : {}) } : { status: o.reason, ...(log_file ? { log_file } : {}) };
};

// Reasons that mean Claude could not run at all: the brief is facts only, not partial (§11).
const FACTS_ONLY_REASONS = new Set(["no_token", "plan_guard", "aborted"]);

/**
 * Takes the lock and writes the waiting row, then runs in the background. Throws BriefRunningError when a run holds
 * the lock. `done` never rejects: a crash is stored as status fail.
 */
export async function startBrief(db: Db, opts: RunBriefOptions, deps: RunBriefDeps = {}): Promise<{ runId: string; done: Promise<RunBriefResult> }> {
  const lock = await tryLock(db);
  if (!lock) throw new BriefRunningError((await runningRun(db))?.id ?? null);
  const now = deps.now ?? (() => new Date());
  try {
    // We hold the lock, so any waiting or running row is left from a run that died with its server.
    await db
      .update(briefRuns)
      .set({ status: "fail", endedAt: now(), summary: "did not finish: stale run (the server stopped or the run hung)" })
      .where(inArray(briefRuns.status, ["waiting", "running"]));
    const [row] = await db.insert(briefRuns).values({ trigger: opts.trigger, status: "waiting", startedAt: now() }).returning({ id: briefRuns.id });
    const runId = row!.id;
    const done = execute(db, runId, opts, deps)
      .catch(async (err: unknown) => {
        const summary = `fail: ${err instanceof Error ? err.message : String(err)}`.replace(/\/Users\/[^\s/]+/g, "~").slice(0, 300);
        await db.update(briefRuns).set({ status: "fail", endedAt: now(), summary }).where(eq(briefRuns.id, runId)).catch(() => undefined);
        return { runId, status: "fail" as const, briefId: null, mode: null, summary };
      })
      .finally(() => unlock(lock));
    return { runId, done };
  } catch (err) {
    await unlock(lock);
    throw err;
  }
}

/** startBrief and wait for the end. */
export async function runBrief(db: Db, opts: RunBriefOptions, deps: RunBriefDeps = {}): Promise<RunBriefResult> {
  return (await startBrief(db, opts, deps)).done;
}

async function execute(db: Db, runId: string, opts: RunBriefOptions, deps: RunBriefDeps): Promise<RunBriefResult> {
  const env = deps.env ?? deps.spawnDeps?.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const spawn = deps.spawnPass ?? defaultSpawnPass;
  const live = deps.liveRuns ?? deps.spawnDeps?.liveRuns ?? defaultLiveRuns;
  const stored = await loadBriefSettings(db);
  const s = resolveBriefSettings(stored, env);
  const bps = await loadBriefProjects(db, stored);
  const included = bps.filter((p) => p.include);

  const wanted = new Set<BriefPass>(opts.passes ?? ["brief", "ideas"]);
  if (!s.ideas_enabled || !included.some((p) => p.include_ideas)) wanted.delete("ideas");
  let factsOnly: string | null = opts.factsOnly ?? null;
  const passes: Record<string, BriefPassRecord> = {};
  const setRun = (patch: Partial<typeof briefRuns.$inferInsert>) => db.update(briefRuns).set(patch).where(eq(briefRuns.id, runId));

  // Hold the slot from before pass A to after pass B, and wait (no cutoff) until no run is live.
  const claude = !factsOnly && wanted.size > 0;
  const mine = claude ? reserveSlot(`${BRIEF_AGENT}`) : false;
  const dir = path.join(deps.tmpDir ?? path.join(tmpdir(), "plania-brief"), `${runId.replace(/-/g, "").slice(0, 8)}-${randomUUID().slice(0, 8)}`);
  try {
    if (claude) {
      await settleRunner();
      while (live().length > 0 && !opts.signal?.aborted) await sleep(deps.pollMs ?? 5_000, opts.signal);
      if (opts.signal?.aborted) factsOnly = ceilingText(s.language, stored.fallback_at, opts.ceilingLabel ?? (live().length ? "a build was still running" : "Claude was not free"));
    }
    await setRun({ status: "running", startedAt: now() });

    // 1. Facts (0 tokens).
    const at = now();
    const [last] = await db.select({ at: morningBriefs.generatedAt }).from(morningBriefs).orderBy(desc(morningBriefs.generatedAt)).limit(1);
    const window = briefWindow(last?.at ?? null, at);
    const facts = await buildFacts(db, window, { settings: stored, env });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const factsPath = path.join(dir, "facts.json");
    writeFileSync(factsPath, JSON.stringify(facts, null, 1), { mode: 0o600 });

    const localDate = localDateIn(at, s.timezone);
    const repoDirs = facts.projects.filter((p) => bps.find((b) => b.slug === p.slug)?.include_ideas && p.repo_path).map((p) => p.repo_path);
    const promptProjects = (ideasOnly: boolean): SystemVars["projects"] =>
      facts.projects
        .filter((p) => !ideasOnly || bps.find((b) => b.slug === p.slug)?.include_ideas)
        .map((p) => ({ id: p.slug, name: p.name, keyPrefix: p.key_prefix, repoPath: p.repo_path || null, githubRepo: p.github_repo }));
    const vars = (ideasOnly: boolean) => ({
      ownerName: s.owner_name,
      language: s.language,
      timezone: s.timezone,
      timezoneLabel: s.timezone_label,
      hiddenRefs: s.hidden_refs,
      projects: promptProjects(ideasOnly),
      localDate,
      windowStart: isoInZone(window.from, s.timezone),
      now: isoInZone(at, s.timezone),
      factsPath,
      maxItemsPerApp: s.max_items_per_app,
      ideasPerProject: s.ideas_per_project,
    });
    const taskKey = deps.usageTaskKey !== undefined ? deps.usageTaskKey : env.PLANIA_BRIEF_TASK_KEY?.trim() || null;
    const home = await asistenteHome(db, env);
    const usage = taskKey && home ? { project: home.slug, taskKey } : null;
    const run = async <T>(pass: BriefPass, schema: SpawnPassInput<T>["schema"]): Promise<PassOutcome<T>> => {
      const p = await loadPassPrompts(db, pass, vars(pass === "ideas"), env);
      const out = await spawn<T>(
        db,
        {
          pass,
          date: localDate,
          runId,
          prompt: p.prompt,
          systemPrompt: p.system,
          jsonSchema: readSchemaText(pass),
          schema,
          repoDirs: pass === "ideas" ? repoDirs : [],
          githubMode: s.github_mode,
          model: s.model,
          usage,
          signal: opts.signal,
        },
        { ...deps.spawnDeps, env, timeoutMs: deps.spawnDeps?.timeoutMs ?? s.pass_timeouts[pass] * MINUTE },
      );
      passes[pass] = passRecord(out as PassOutcome<unknown>);
      await setRun({ passes: { ...passes } });
      return out;
    };

    // 2-3. Pass A, then pass B (never in parallel). When Claude cannot run at all, pass B is not tried.
    let brief: PassResult<{ items: unknown[] }> = null;
    let ideas: PassResult<{ ideas: unknown[] }> = null;
    if (!factsOnly && wanted.has("brief")) {
      const a = await run("brief", BriefPassOutput);
      if (a.ok) brief = { ok: true, data: a.data };
      else if (FACTS_ONLY_REASONS.has(a.reason)) factsOnly = a.reason === "aborted" ? ceilingText(s.language, stored.fallback_at, opts.ceilingLabel ?? "the run was stopped") : a.summary;
      else brief = { ok: false, summary: a.summary };
    }
    if (!factsOnly && wanted.has("ideas")) {
      const b = await run("ideas", IdeasPassOutput);
      if (b.ok) ideas = { ok: true, data: b.data };
      else ideas = { ok: false, summary: b.summary };
    }

    // 4. Merge.
    const serverLines = factsOnly ? await (deps.buildBrief ?? defaultBuildBrief)(db, at).catch(() => []) : [];
    const data = mergeBrief({
      settings: s,
      projects: bps,
      facts,
      generatedAt: isoInZone(at, s.timezone),
      window: { from: isoInZone(window.from, s.timezone), to: isoInZone(window.to, s.timezone) },
      brief,
      ideas,
      factsOnly,
      serverLines,
      openIdeas: await openIdeas(db, included.filter((p) => p.include_ideas).map((p) => p.slug)),
      yesterdayIdeas: await yesterdayIdeas(db, localDate),
      waitingPaused: await waitingPaused(db, facts),
      settledKeys: await settledKeys(db, brief?.ok ? brief.data.items : []),
    });

    // 5. Store, project, prune.
    const [row] = await db
      .insert(morningBriefs)
      .values({ localDate, generatedAt: at, trigger: opts.trigger, mode: data.mode, data: data as unknown as Record<string, unknown>, runId })
      .returning({ id: morningBriefs.id });
    await writeProjection(db, { id: row!.id, localDate, data }, env);
    await pruneChecks(db, at);

    const status: BriefRunStatus = data.mode === "full" ? "ok" : data.mode === "partial" ? "partial" : "fallback";
    const summary = runSummary(data, factsOnly, brief, ideas);
    await setRun({ status, endedAt: now(), passes: { ...passes }, summary });
    return { runId, status, briefId: row!.id, mode: data.mode, summary };
  } finally {
    if (mine) releaseReservation();
    rmSync(dir, { recursive: true, force: true });
  }
}

export function ceilingText(lang: string, fallbackAt: string, because: string): string {
  return lang === "es"
    ? `El brief completo no corrió antes de las ${fallbackAt} porque ${because}. Pulsa Generar ahora cuando esté libre.`
    : `The full brief didn't run by ${fallbackAt} because ${because}. Press Generate now when it's free.`;
}

function runSummary(data: BriefData, factsOnly: string | null, brief: PassResult<unknown>, ideas: PassResult<unknown>): string {
  const counts = `${data.items.length} items, ${data.ideas.length} ideas`;
  if (factsOnly) return `facts only: ${factsOnly}`.slice(0, 300);
  const failed = [brief && !brief.ok ? `brief: ${brief.summary}` : "", ideas && !ideas.ok ? `ideas: ${ideas.summary}` : ""].filter(Boolean).join("; ");
  return (failed ? `${data.mode} (${counts}); ${failed}` : `${data.mode} (${counts})`).slice(0, 300);
}
