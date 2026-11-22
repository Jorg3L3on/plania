// PLA-I29: the autonomous runner. A wake of a claude_code agent passes the checks (switches,
// coalescing, cooldown, goal, base branch, plan guard, cap), then starts one supervised
// `claude -p` in a worktree outside every repo. When it exits, its result is read: modelUsage goes
// to report_tokens per model, the turns/session/subtype to heartbeat_runs, the session to agent_sessions.
// Summaries never carry paths, env values, tokens or money.
import { commitHooks, commitInstructions } from "../camino/commits.js";
import { workPatternOf } from "../camino/store.js";
import { canvasesRoot } from "../pedidos/frames.js";
import { resolveMotor } from "./motor.js";
import { execFile } from "node:child_process";
import { projectEnvNames } from "./run-env.js";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import path from "node:path";
import { resolveClaudeBin } from "../lib/claude-bin.js";
import { defaultRunLogDir, defaultRunTmpDir } from "../lib/run-dirs.js";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { makeDb, type Db } from "../db/client.js";
import { bus } from "../events.js";
import {
  agentRuns,
  agentSessions,
  agents,
  docs,
  events,
  goals,
  heartbeatRuns,
  machineState,
  projects,
  runLocks,
  runnerReservations,
  runnerWorkers,
  tasks,
  type Agent,
  type AgentRun,
  type AdapterConfig,
  type RunTrigger,
  type Project,
} from "../db/schema.js";
import { registerFootprint, releaseFootprint } from "../mcp/footprint.js";
import { SYSTEM_ACTOR, WEB_ACTOR, writeTx, type Ctx, type Q } from "../mcp/tx.js";
import { reportTokens, type ReportTokensInput } from "../mcp/usage.js";
import { CONSULTA_DENY_RULES, QA_DENY_RULES, TRIAL_DENY_RULES, afterEditHooks, denySettings, selfRules } from "./deny.js";
import { isSelfProject, liveDatabaseName, selfRunProblem, serverRoot } from "../self/plania-self.js";
import { kitLines, skillVersion, writeKitPlugin, type KitWritten } from "./kit.js";
import { rolePrompt } from "./prompts.js";
import { mannerBlock, mannerVersion, resolvedKit } from "./skills.js";
import { lessonBlock, lessonsForRun, recordKnowledge } from "./lessons.js";
import { voiceBlock } from "../brand/voz.js";
import { addTrialCopy, setTrial, trialById, trialIdOfRun, trialKit, trialPathFor, trialPrompt, trialResult, trialScope, trialStatusOf } from "./trial.js";
import { fixedWords, lessonRoomOf } from "./lesson-watch.js";
import { consultaById, consultaPrompt } from "../pedidos/consultas.js";
import { marksPrompt, marksRequestOfRun } from "../brand/marks.js";
import { uploadDir } from "../brand/upload.js";
import { ACTIVE_STATUSES, QUEUE_CHANNEL, activeRunOn, consultaIdOfRun, insertRun, notifyQueue, setQueueKick, workKeyOf } from "./queue.js";
import { runSession } from "./run-session.js";
import {
  ADMIT_LOCK,
  agentCapOf,
  availableMemoryMb,
  bump,
  freeDiskGb,
  lockKeysOf,
  planWeight,
  projectLimits,
  readCounters,
  reapLostStarts,
  reapLostWorkers,
  releaseLocks,
  takeLocks,
  workerCapacity,
  workerId,
  type HeldCode,
  type MachineFacts,
} from "./admission.js";
import { areasOverlap, claim, setTask } from "../mcp/writes.js";
import { isShared, sharedAreasOf } from "./touched.js";
import { PREGUNTA_MARK } from "../captures/preguntas.js";
import { tallerDatabase } from "../captures/prueba.js";
import { EVENT_SUMMARY, enqueueWake, serviceAgent, wakePoIfWaiting } from "./events.js";
import { capacityFacts, capacityHold, agentFacts, agentHold, projectGoal } from "./hold.js";

export { projectGoal };
import { asistenteHome } from "./threads.js";
import { qaBriefFor } from "./qa.js";
import {
  PROMPT_DOCS,
  lastReading,
  loadSettings,
  planGuardSummary,
  planView,
  readingStale,
  recordReading,
  roleOf,
  type RunnerRole,
} from "./limits.js";
import {
  attachDetached,
  childEnv,
  defaultKill,
  defaultProbePid,
  defaultSpawn,
  exitPathOf,
  isWrapperOf,
  supervise,
  superviseDetached,
  type DetachedSpawn,
  type ExitInfo,
  type KillFn,
  type ProbePid,
  type SpawnFn,
  type Supervised,
} from "./process.js";
import { DEFAULT_START_BRANCH, startBranchOf } from "./start-branch.js";
import { isSignedOut } from "./signed-out.js";
import { StreamReader, parseStream, parseUsageText, totalOf, type PlanWindowReading } from "./stream.js";
import { clearPacks, packLines, packsInDiff, packsOf, writePacks } from "./packs.js";
import { earlyBaseOf, stackBaseOf, type StackBase } from "./stack.js";
import { velocidadOf } from "./velocidad.js";
import { cloneModules } from "../lib/clone-modules.js";
import { heavyEnv } from "./heavy.js";
import { planStepFor } from "../mcp/plan-step.js";
import { branchFor, checkBase, defaultGit, ensureReadCopy, ensureWorktree, removeWorktree, repoPathOf, scratchPathFor, worktreePathFor, worktreeRoot, carefulGit, resetGitThrottleForTests, type GitFn } from "./worktree.js";
import { taskImagePaths } from "../pedidos/images.js";
import { carryReferences, markOpened, referenceLines, type ReferenceLine } from "./references.js";
import { personalize } from "../owner.js";
import { languageLine } from "./owner-language.js";
import { storedRunnerToken } from "../install-state.js";
import { defineWords, say } from "../words.js";
import { ST } from "../state/status.js";

// PLA-I2-10: the stop reason the owner reads when they stop a run, in the install's language; the Spanish is unchanged.
export const RUNNER_WORDS = defineWords({
  es: { stoppedFromCompany: "detenido desde Compañía" },
  en: { stoppedFromCompany: "stopped from Company" },
});

export type ReadyWork = {
  project: string;
  key: string;
  title: string;
  priority: string | null;
  workType: string | null;
  ownerAgent: string | null;
};

export type RunnerDeps = {
  // PLA-I2-9: the running server's own checkout, to tell a run of Plania itself (src/self/plania-self.ts). Tests set it.
  serverRoot?: string;
  spawn?: SpawnFn;
  kill?: KillFn;
  git?: GitFn;
  probePid?: ProbePid;
  // Runs the free `claude -p /usage` and returns its result text, or null.
  probeUsage?: () => Promise<string | null>;
  reportTokens?: (db: Db, input: ReportTokensInput, ctx: Ctx) => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
  logDir?: string;
  tmpDir?: string;
  worktreeRoot?: string;
  graceMs?: number;
  timeoutMs?: number;
  liveFlushMs?: number;
  // false skips register_footprint for created worktrees (tests without a machine row).
  footprints?: boolean;
  // PLA-I60-2: free memory and disk (tests pass fixed numbers).
  machine?: () => Promise<MachineFacts> | MachineFacts;
  // PLA-I60-3: start runs through wrapper.mjs (default when spawn is not injected), and how to spawn it.
  detached?: boolean;
  spawnDetached?: DetachedSpawn;
  pollMs?: number;
  probeWrapper?: (pid: number, runId: string) => Promise<boolean>;
};

export type WakeOutcome =
  | { kind: "started"; runId: string; summary: string; taskKey: string | null }
  | { kind: "queued"; runId: string; summary: string; taskKey: string | null }
  | { kind: "coalesced"; summary: string }
  // recorded: the runner already wrote the heartbeat_runs row.
  | { kind: "skipped" | "fail"; summary: string; taskKey: string | null; recorded?: boolean };

type LiveRun = { runId: string; agentId: string; projectId: string; role: string; proc: Supervised; finished: Promise<void>; stopReason: string | null };

const live = new Map<string, LiveRun>();
let lastProbeAt = 0;
const PROBE_EVERY_MS = 5 * 60_000;
const MINUTE = 60_000;
const DONE_STATUSES = [ST.merged, ST.released, ST.done, ST.wontDo];
export const RUNNER_ADAPTER = "claude_code" as const;

// Serializes the checks and the start so two wakes never both take the last slot.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

// PLA-I41-3: a slot reservation (the Morning brief). While it is up, wakes queue instead of starting,
// drainQueue starts nothing and the heartbeat wakes no one; live runs are never stopped.
let reservation: { label: string; since: Date } | null = null;

// True when this call took the reservation; false when one is already up (its holder releases it).
// PLA-I60-2: the reservation holds one slot of the ceiling (not the whole runner). It is also written to
// runner_reservations so admission in another process counts it; this process counts its own at once.
export function reserveSlot(label: string): boolean {
  if (reservation) return false;
  reservation = { label: label.slice(0, 80), since: new Date() };
  const holder = `${workerId()}:${reservation.since.getTime()}`;
  reservationHolder = holder;
  void makeDb()
    .db.insert(runnerReservations)
    .values({ label: reservation.label, slots: 1, holder, expiresAt: new Date(Date.now() + 3 * 60 * MINUTE) })
    .catch(() => undefined);
  return true;
}

let reservationHolder: string | null = null;
export function releaseReservation(): void {
  reservation = null;
  const holder = reservationHolder;
  reservationHolder = null;
  if (holder) void makeDb().db.delete(runnerReservations).where(eq(runnerReservations.holder, holder)).catch(() => undefined);
}

export const slotReservation = (): { label: string; since: Date } | null => (reservation ? { ...reservation } : null);

// Resolves once every wake or drain already inside the serial chain has finished, so a run started
// by one of them shows in liveRuns() before the caller looks.
export const settleRunner = (): Promise<void> => serial(async () => undefined);

export const liveRuns = (): { runId: string; agentId: string; projectId: string; role: string }[] =>
  [...live.values()].map(({ runId, agentId, projectId, role }) => ({ runId, agentId, projectId, role }));

// Tests: resolves once the run's process exited and its result is stored.
export async function waitForRun(runId: string): Promise<void> {
  await live.get(runId)?.finished;
}

export async function waitForAllRuns(): Promise<void> {
  await Promise.all([...live.values()].map((run) => run.finished));
}

export function resetRunnerForTests(): void {
  live.clear();
  reservation = null;
  lastProbeAt = 0;
  chain = Promise.resolve();
  resetGitThrottleForTests();
}

const home = (env: NodeJS.ProcessEnv) => env.HOME || homedir();
// PLA-I2-4: the system's own places (src/lib/run-dirs.ts): ~/Library/Logs on macOS, the XDG dirs on Linux.
const logDirOf = (deps: RunnerDeps, env: NodeJS.ProcessEnv) => deps.logDir ?? defaultRunLogDir(env);
const tmpDirOf = (deps: RunnerDeps) => deps.tmpDir ?? defaultRunTmpDir(deps.env ?? process.env);
const rootOf = (deps: RunnerDeps, env: NodeJS.ProcessEnv) => deps.worktreeRoot ?? worktreeRoot(env);
// NEWPROJ-4: exported for the readiness list (./readiness.ts), which looks for the same binary without running it.
// PLA-I2-4: the rule itself is shared with the brief and the machine check (src/lib/claude-bin.ts): the adapter's
// variable, CLAUDE_CODE_BIN, ~/.local/bin/claude, then claude on PATH.
export function claudeCommand(config: AdapterConfig | null, env: NodeJS.ProcessEnv): string {
  return resolveClaudeBin(env, { commandEnv: config?.command_env });
}

const sysCtx = (tool: string): Ctx => ({ actor: { ...SYSTEM_ACTOR, machine: hostname() }, system: true, tool });

// ---- Context the checks read

type WakeContext = {
  agent: Agent;
  role: RunnerRole | null;
  project: Project | null;
  task: ReadyWork | null;
  taskRow: { id?: string | null; branch: string | null; base: string | null } | null;
};

// PLA-I32-5: an agent's project is its team's (project_id); Asistente's is its home project (where its runs
// are recorded). Rows from before 0041: a capability that names a project, else po-<project>.
async function projectOfAgent(db: Q, agent: Agent): Promise<Project | null> {
  if (agent.projectId) return (await db.select().from(projects).where(eq(projects.id, agent.projectId)).limit(1))[0] ?? null;
  if (roleOf(agent) === "asistente") return asistenteHome(db, process.env);
  const names = [...agent.capabilities, ...(agent.slug.startsWith("po-") ? [agent.slug.slice(3)] : [])];
  if (names.length === 0) return null;
  const [row] = await db.select().from(projects).where(inArray(projects.slug, names)).orderBy(asc(projects.slug)).limit(1);
  return row ?? null;
}

async function taskBranchInfo(db: Q, projectId: string, key: string): Promise<{ id: string | null; branch: string | null; base: string | null }> {
  const rows = await db.execute<{ id: string | null; branch: string | null; base: string | null }>(sql`
    select t.id as id, t.branch as branch, coalesce(t.base_branch, p.base_branch) as base
    from tasks t left join tasks p on p.id = t.parent_id
    where t.project_id = ${projectId} and t.key = ${key} limit 1`);
  return rows.rows[0] ?? { id: null, branch: null, base: null };
}

// PLA-89: Research and Artist are woken for an idea's stage (research, design). A wake queued for a stage the idea
// has left (it moved on, or went back) ends without a run: on MIA-IDEA4 (guided test PLA-86) two such wakes would
// have redone Research and Design after the idea had reached Plan. Returns the stage it is on now, or null to run.
const STAGE_OF_ROLE: Partial<Record<RunnerRole, string>> = { research: "research", artist: "design" };
export function stageMovedOn(role: RunnerRole | null, kind: string | null | undefined, stage: string | null | undefined): string | null {
  const want = role ? STAGE_OF_ROLE[role] : undefined;
  if (!want || kind !== "idea" || !stage) return null;
  return stage === want ? null : stage;
}
async function ideaStageOf(db: Q, projectId: string, key: string): Promise<{ kind: string; stage: string | null } | null> {
  const [t] = await db.select({ kind: tasks.kind, stage: tasks.stage }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, key))).limit(1);
  return t ?? null;
}

async function loadContext(db: Q, agent: Agent, task: ReadyWork | null): Promise<WakeContext> {
  const role = roleOf(agent);
  let project: Project | null = null;
  if (task) project = (await db.select().from(projects).where(eq(projects.slug, task.project)).limit(1))[0] ?? null;
  else project = await projectOfAgent(db, agent);
  const taskRow = task && project ? await taskBranchInfo(db, project.id, task.key) : null;
  return { agent, role, project: project ?? null, task, taskRow };
}

// ---- Checks

type Preflight = { ok: true } | { ok: false; kind: "skipped" | "fail" | "cap"; summary: string };

async function probeIfUnknown(db: Db, deps: RunnerDeps, now: Date): Promise<void> {
  if (Date.now() - lastProbeAt < PROBE_EVERY_MS) return;
  lastProbeAt = Date.now();
  const probe = deps.probeUsage ?? defaultProbeUsage(deps.env ?? process.env);
  const text = await probe().catch(() => null);
  const reading = text ? parseUsageText(text) : null;
  if (reading) await recordReading(db, { ...reading, source: "usage_probe", at: now });
}

// PLA-I40-2: skipRest and pastGuard are the owner's "start now" from the screen, for one run: the rest between
// runs is not counted, and the plan guard reads as with the override on. Every other check stands.
// noCap (PLA-I60-2): admission checks the plan and the caps itself, inside its transaction.
async function preflight(db: Q, ctx: WakeContext, now: Date, deps: RunnerDeps, opts: { fromQueue?: string; skipRest?: boolean; pastGuard?: boolean; consulta?: boolean; trial?: boolean; marks?: boolean; trigger?: RunTrigger; noCap?: boolean } = {}): Promise<Preflight> {
  const settings = await loadSettings(db);
  const { agent, role, project, task } = ctx;
  if (!project) return { ok: false, kind: "skipped", summary: "skipped: no project" };
  // PLA-I40-1: the switches, the rest and the goal are one verdict (hold.ts), the same one the screen reads.
  const facts = role || settings.companyPaused ? await agentFacts(db, { agent, role, project, settings, now }) : null;
  // PLA-I57-1: the owner's question is answered between runs, and needs no project goal.
  // PLA-I60-4: the rest paces only the agent's own periodic wakes (trigger cadence). Events, the owner's asks,
  // questions, retries, QA and the brief never wait for it.
  const rests = (opts.trigger ?? "cadence") === "cadence" && !opts.skipRest && !opts.consulta;
  const own = facts ? agentHold(rests ? facts : { ...facts, cooldownMinutes: 0 }) : null;
  if (own?.scope === "company") return { ok: false, kind: "skipped", summary: "skipped: company paused" };
  if (!role) return { ok: false, kind: "skipped", summary: "skipped: no runner role" };
  if (own?.code === "paused") return { ok: false, kind: "skipped", summary: `skipped: project ${project.slug} paused` };
  if (own?.code === "rest") return { ok: false, kind: "skipped", summary: "skipped: cooldown" };
  // PLA-I67-6: a skill trial is the owner's own ask, about a delivery already made: no goal and no ticket needed.
  // PLA-118: logo marks (Artist, «[marcas <id>]») are the owner's own ask too: no ticket and no goal needed.
  if (own?.code === "no_goal" && !opts.consulta && !opts.trial && !opts.marks) return { ok: false, kind: "skipped", summary: "skipped: no goal" };
  if (!task && role !== "product-owner" && role !== "asistente" && !opts.trial && !opts.marks) return { ok: false, kind: "skipped", summary: "no ready work" };

  if (task) {
    // PLA-I2-5: the project's start branch is the only base (settings.start_branch, never a protected one).
    const start = startBranchOf(project.settings);
    const base = checkBase(ctx.taskRow?.branch ?? branchFor(task.key, await workPatternOf(db, project.id)), ctx.taskRow?.base ?? null, start);
    if (!base.ok) return { ok: false, kind: "fail", summary: "fail: base not allowed" };
  }

  if (opts.noCap) return { ok: true };
  const guard = opts.pastGuard ? { ...settings, guardOverride: true } : settings;
  // PLA-50: a question counts against its own lane, not the general cap.
  const lane = opts.consulta ? "consulta" : "work";
  let capacity = await capacityFacts(db, guard, now, lane);
  if (capacity.plan.state === "unknown") {
    await probeIfUnknown(db as Db, deps, now);
    capacity = await capacityFacts(db, guard, now, lane);
  }
  const full = capacityHold(capacity);
  if (full?.code === "usage") return { ok: false, kind: "skipped", summary: planGuardSummary(capacity.plan) };
  // PLA-I41-3: while the Morning brief holds the slot, a wake queues and the queue waits.
  if (reservation) return { ok: false, kind: "cap", summary: opts.fromQueue ? "queued" : `queued: slot reserved (${reservation.label})` };
  if (full?.code === "slot") return { ok: false, kind: "cap", summary: opts.fromQueue ? "queued" : "queued: cap reached" };
  return { ok: true };
}

// ---- Wake

function outcomeOf(r: AdmitResult, runId: string, taskKey: string | null): WakeOutcome {
  const o = r.outcomes.get(runId);
  if (!o) return { kind: "queued", runId, summary: "queued", taskKey };
  if (o.kind === "started") return o.outcome;
  if (o.kind === "held") return { kind: "queued", runId, summary: o.summary, taskKey };
  return { kind: o.status, summary: o.summary, taskKey, recorded: true };
}

export async function wakeClaude(
  db: Db,
  input: { agent: Agent; task: ReadyWork | null; now: Date; trigger?: RunTrigger },
  deps: RunnerDeps = {},
): Promise<WakeOutcome> {
  return serial(async () => {
    const ctx = await loadContext(db, input.agent, input.task);
    const taskKey = input.task?.key ?? null;
    // Coalescing (PLA-I60-1): a wake for work this agent already has queued or live writes nothing.
    if (ctx.project && (await activeRunOn(db, input.agent.id, ctx.project.id, workKeyOf(taskKey)))) return { kind: "coalesced", summary: "coalesced" };

    const pre = await preflight(db, ctx, input.now, deps, { trigger: input.trigger ?? "cadence" });
    if (!pre.ok && pre.kind !== "cap") return { kind: pre.kind, summary: pre.summary, taskKey };
    const settings = await loadSettings(db);
    const out = await insertRun(db, {
      agent: input.agent,
      project: ctx.project!,
      role: ctx.role!,
      taskKey,
      trigger: input.trigger ?? "cadence",
      summary: pre.ok ? "starting" : pre.summary,
      queuedAt: input.now,
      reserveTokens: settings.reserveTokens,
    });
    if (out.kind === "coalesced") return { kind: "coalesced", summary: "coalesced" };
    // PLA-I60-2: it starts through admission like every run (caps, lock keys, plan projection).
    return outcomeOf(await admit(db, input.now, deps, { only: out.run.id }), out.run.id, taskKey);
  });
}

// PLA-I67-6: the owner's «Probar». The trial's run is queued and admitted like any run (caps, plan guard); the
// trial row follows it (queued while it waits, skipped or failed when it cannot start).
export async function startTrial(db: Db, input: { agent: Agent; trialId: string; now: Date }, deps: RunnerDeps = {}): Promise<WakeOutcome> {
  return serial(async () => {
    const trial = await trialById(db, input.trialId);
    if (!trial) return { kind: "fail", summary: "fail: no such trial", taskKey: null };
    const [project] = await db.select().from(projects).where(eq(projects.id, trial.projectId)).limit(1);
    const role = roleOf(input.agent);
    if (!project || !role) {
      await setTrial(db, trial.id, { status: "skipped", summary: "skipped: no runner role", finishedAt: input.now });
      return { kind: "skipped", summary: "skipped: no runner role", taskKey: null };
    }
    const settings = await loadSettings(db);
    const out = await insertRun(db, { agent: input.agent, project, role, taskKey: null, trialId: trial.id, trigger: "trial", summary: "starting", queuedAt: input.now, reserveTokens: settings.reserveTokens });
    if (out.kind === "coalesced") return { kind: "coalesced", summary: "coalesced" };
    await setTrial(db, trial.id, { runId: out.run.id });
    const outcome = outcomeOf(await admit(db, input.now, deps, { only: out.run.id }), out.run.id, null);
    if (outcome.kind === "queued") await setTrial(db, trial.id, { status: "queued", summary: outcome.summary });
    return outcome;
  });
}

// PLA-I40-2: the owner's "Que empiece ya". Starts this agent's queued run now, or, with none queued, one run on
// the Ready work given. The rest between runs is skipped for this run only (nothing is stored, so the next run
// waits its full rest); pastGuard also lets it past the plan guard. The switches, the goal, the base branch and
// the cap all stand: with every slot taken the run stays queued and takes the next one.
export type ForcedStart =
  | { kind: "started" | "queued"; runId: string; taskKey: string | null; summary: string }
  | { kind: "busy" | "idle" }
  | { kind: "held" | "fail"; summary: string };

export async function startNow(
  db: Db,
  input: { agent: Agent; task: ReadyWork | null; pastGuard?: boolean; now: Date; reason?: string },
  deps: RunnerDeps = {},
): Promise<ForcedStart> {
  return serial(async () => {
    // PLA-I60-1: an agent may have several runs, one per work item. With a task given, that task's run is the one;
    // without, the oldest queued run.
    const mine = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, input.agent.id), inArray(agentRuns.status, [...ACTIVE_STATUSES])))
      .orderBy(asc(agentRuns.queuedAt));
    const onTask = input.task ? mine.filter((r) => r.workKey === workKeyOf(input.task!.key)) : mine;
    if (input.task ? onTask.some((r) => r.status !== "queued") : mine.length > 0 && mine.every((r) => r.status !== "queued")) return { kind: "busy" };
    const queued = onTask.find((r) => r.status === "queued") ?? null;
    if (!queued && !input.task) return { kind: "idle" };
    const task = queued ? (queued.taskKey ? await readyWorkOf(db, queued.projectId, queued.taskKey) : null) : input.task;
    const ctx = await loadContext(db, input.agent, task);
    if (!ctx.project && queued) ctx.project = (await db.select().from(projects).where(eq(projects.id, queued.projectId)).limit(1))[0] ?? null;
    const marksRun = !task && ctx.role === "artist" && queued?.lane === "work" && !!ctx.project && !!marksRequestOfRun(ctx.project.slug, queued.reason);
    const pre = await preflight(db, ctx, input.now, deps, { skipRest: true, pastGuard: input.pastGuard, consulta: queued?.lane === "consulta", marks: marksRun });
    if (!pre.ok && pre.kind !== "cap") return { kind: "held", summary: pre.summary };
    let run = queued;
    if (!run) {
      const out = await insertRun(db, {
        agent: input.agent,
        project: ctx.project!,
        role: ctx.role!,
        taskKey: task?.key ?? null,
        trigger: "owner",
        // PLA-I49-5: the reason goes to the prompt; the summary is display text.
        reason: input.reason ?? null,
        summary: input.reason ? `${EVENT_SUMMARY} ${input.reason}` : pre.ok ? "starting" : "queued: cap reached",
        queuedAt: input.now,
        reserveTokens: (await loadSettings(db)).reserveTokens,
      });
      if (out.kind === "coalesced") return { kind: "busy" };
      run = out.run;
    }
    const admitted = outcomeOf(await admit(db, input.now, deps, { only: run.id, skipRest: true, pastGuard: input.pastGuard }), run.id, run.taskKey);
    if (admitted.kind === "queued") return { kind: "queued", runId: run.id, taskKey: run.taskKey, summary: admitted.summary };
    if (admitted.kind !== "started") return { kind: "fail", summary: admitted.summary };
    const out = admitted;
    await db.insert(events).values({
      projectId: ctx.project!.id,
      taskKey: run.taskKey,
      type: "wake.forced",
      actor: WEB_ACTOR,
      payload: { agent: input.agent.slug, role: ctx.role, run_id: run.id, past_guard: !!input.pastGuard },
    });
    return { kind: "started", runId: run.id, taskKey: run.taskKey, summary: out.summary };
  });
}

// PLA-18: would a wake of this agent on this ticket start now? The same checks the queue runs. A full cap
// and an agent inside its cooldown count as yes: a queued event wake waits for those instead of being dropped.
export async function canStart(db: Db, agent: Agent, projectId: string, taskKey: string, now: Date, deps: RunnerDeps = {}): Promise<{ ok: boolean; summary: string }> {
  const task = await readyWorkOf(db, projectId, taskKey);
  if (!task) return { ok: false, summary: "skipped: no such ticket" };
  const pre = await preflight(db, await loadContext(db, agent, task), now, deps, { trigger: "retry" });
  if (pre.ok) return { ok: true, summary: "" };
  return { ok: pre.kind === "cap" || pre.summary === "skipped: cooldown", summary: pre.summary };
}

// ---- Admission (PLA-I60-2)
//
// Queued runs start here, from any process: one short transaction under ADMIT_LOCK decides which runs start
// (status starting, their lock keys taken, worker and lease set); the processes spawn after it commits. Checks, in
// order: the run's own verdict (switches, goal, base branch, the rest for cadence runs), the company ceiling minus
// reserved slots, this worker's capacity and the machine's free memory and disk, the start rate, the plan guard (a
// stopped plan ends the run as before; a projection that would cross the guard holds it), the project's lane cap,
// the agent's cap, the lock keys, and overlapping areas for code runs. A run that waits keeps a held_code the screen
// reads. `only` admits one run (a wake or the owner's «Que empiece ya»); skipRest and pastGuard apply to it alone.
export type AdmitOptions = { only?: string; skipRest?: boolean; pastGuard?: boolean };
export type AdmitResult = {
  // How long the admission transaction held ADMIT_LOCK (the load test's number).
  txMs?: number;
  // How long it waited for another admitter to let go of the lock.
  waitMs?: number;
  started: number;
  dropped: number;
  outcomes: Map<string, { kind: "started"; outcome: WakeOutcome } | { kind: "held"; code: HeldCode; summary: string } | { kind: "ended"; status: "skipped" | "fail"; summary: string }>;
};

const HOLD_SUMMARY: Record<HeldCode, string> = {
  project_cap: "queued: project cap reached",
  agent_cap: "queued: agent cap reached",
  ceiling: "queued: cap reached",
  machine: "queued: machine is low on memory or disk",
  start_rate: "queued: start rate",
  plan: "queued: plan projection over the guard",
  rest: "queued: cooldown",
  lock: "queued: same branch or ticket is busy",
  areas: "queued: same files are busy",
  seat_paused: "queued: the owner paused this seat",
};

async function machineFacts(deps: RunnerDeps, env: NodeJS.ProcessEnv): Promise<MachineFacts> {
  if (deps.machine) return deps.machine();
  // Tests turn the real memory and disk reading off (helpers.ts); a test that needs it passes deps.machine.
  if (process.env.PLANIA_MACHINE_CHECK === "0") return { freeMb: Number.POSITIVE_INFINITY, freeDiskGb: Number.POSITIVE_INFINITY };
  return { freeMb: await availableMemoryMb(), freeDiskGb: await freeDiskGb(rootOf(deps, env)) };
}

export async function admit(db: Db, now: Date, deps: RunnerDeps = {}, opts: AdmitOptions = {}): Promise<AdmitResult> {
  const env = deps.env ?? process.env;
  const result: AdmitResult = { started: 0, dropped: 0, outcomes: new Map() };
  const settings = await loadSettings(db);
  // The free /usage probe runs outside the transaction.
  // PLA-144: probe whenever the last reading is stale, also with the override on (state "ok" there), so the screen's
  // meter gets a fresh figure without waiting for a run to start.
  if (readingStale(await lastReading(db), now)) await probeIfUnknown(db, deps, now);
  const machine = await machineFacts(deps, env);
  const worker = workerId(env);
  const capacity = workerCapacity(env);
  const minFreeMb = env.PLANIA_MIN_FREE_MB !== undefined ? Number(env.PLANIA_MIN_FREE_MB) : settings.minFreeMb;
  const root = rootOf(deps, env);

  type Admitted = { run: AgentRun; ctx: WakeContext };
  const txStart = performance.now();
  let lockedAt = txStart;
  const admitted: Admitted[] = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMIT_LOCK})`);
    lockedAt = performance.now();
    await reapLostStarts(tx, now);
    await reapLostWorkers(tx, worker, now);
    await tx.delete(runnerReservations).where(sql`${runnerReservations.expiresAt} <= ${now.toISOString()}::timestamptz`);
    const c = await readCounters(tx, now, reservation ? 1 : 0);
    const reading = await lastReading(tx);
    const queued = await tx
      .select({ run: agentRuns, priority: tasks.priority, slug: projects.slug })
      .from(agentRuns)
      .innerJoin(projects, eq(projects.id, agentRuns.projectId))
      .leftJoin(tasks, and(eq(tasks.projectId, agentRuns.projectId), eq(tasks.key, agentRuns.taskKey)))
      .where(and(eq(agentRuns.status, "queued"), opts.only ? eq(agentRuns.id, opts.only) : sql`true`, sql`(${agentRuns.notBefore} is null or ${agentRuns.notBefore} <= ${now.toISOString()}::timestamptz)`))
      .orderBy(
        sql`(${agentRuns.lane} = 'consulta') desc`,
        sql`(${agentRuns.trigger} = 'owner') desc`,
        sql`coalesce(array_position(array['P0','P1','P2','P3'], ${tasks.priority}), 9)`,
        asc(agentRuns.queuedAt),
      )
      .limit(1000);
    // Round-robin over projects, starting after the one admitted last, so a busy project never starves the others.
    const [rr] = await tx.select().from(machineState).where(eq(machineState.key, "runner.rr")).limit(1);
    const lastProject = (rr?.value as { project?: string } | undefined)?.project ?? "";
    const byProject = new Map<string, typeof queued>();
    for (const q of queued) byProject.set(q.slug, [...(byProject.get(q.slug) ?? []), q]);
    // Projects in the order of their first candidate (oldest, most urgent work first); the project admitted last
    // goes to the end, so the next admission serves the others first.
    const order = [...byProject.keys()];
    const rotated = order.includes(lastProject) ? [...order.filter((x) => x !== lastProject), lastProject] : order;
    const ordered: typeof queued = [];
    for (let round = 0; ordered.length < queued.length; round++) for (const slug of rotated) { const q = byProject.get(slug)![round]; if (q) ordered.push(q); }

    const out: Admitted[] = [];
    const hold = async (run: AgentRun, code: HeldCode, detail: Record<string, unknown>) => {
      result.outcomes.set(run.id, { kind: "held", code, summary: HOLD_SUMMARY[code] });
      // Written when the reason changes (the numbers in it move every pass; the screen reads live counts anyway).
      // PLA-58: an areas hold names the ticket and files, so a different one is written too.
      const moved = run.heldCode !== code || (code === "areas" && JSON.stringify(run.heldDetail ?? {}) !== JSON.stringify(detail));
      if (moved) await tx.update(agentRuns).set({ heldCode: code, heldDetail: detail }).where(eq(agentRuns.id, run.id));
    };
    const holdRest = async (from: number, code: HeldCode, detail: Record<string, unknown>, lane?: string) => {
      const rest = ordered.slice(from).filter((q) => (!lane || q.run.lane === lane) && !result.outcomes.has(q.run.id));
      for (const q of rest) result.outcomes.set(q.run.id, { kind: "held", code, summary: HOLD_SUMMARY[code] });
      const ids = rest.filter((q) => q.run.heldCode !== code).map((q) => q.run.id);
      if (ids.length) await tx.update(agentRuns).set({ heldCode: code, heldDetail: detail }).where(inArray(agentRuns.id, ids));
    };
    const stopped = new Set<string>(); // lanes a plan projection stopped
    let lastAdmitted: string | null = null;

    const agentIds = [...new Set(ordered.map((q) => q.run.agentId))];
    const agentById = new Map((agentIds.length ? await tx.select().from(agents).where(inArray(agents.id, agentIds)) : []).map((a) => [a.id, a]));
    const projectIds = [...new Set(ordered.map((q) => q.run.projectId))];
    const projectById = new Map((projectIds.length ? await tx.select().from(projects).where(inArray(projects.id, projectIds)) : []).map((p) => [p.id, p]));
    for (const [n, q] of ordered.entries()) {
      const run = q.run;
      if (result.outcomes.has(run.id) || stopped.has(run.lane)) continue;
      // A full ceiling (or a slot reserved for the Morning brief) leaves the work queue as it is. The ceiling counts
      // work runs; questions have their own slots per project (PLA-50) and wait only while the brief holds its slot.
      const ceiling = settings.maxConcurrent - c.reserved;
      if (run.lane === "work" && c.work >= ceiling) {
        await holdRest(n, "ceiling", { running: c.work, cap: settings.maxConcurrent, reserved: c.reserved }, "work");
        // PLA-I41-3: the wake says the Morning brief holds the slot.
        if (c.reserved > 0) for (const id of ordered.slice(n).filter((x) => x.run.lane === "work").map((x) => x.run.id)) result.outcomes.set(id, { kind: "held", code: "ceiling", summary: `queued: slot reserved (${reservation?.label ?? "reserved"})` });
        stopped.add("work");
        continue;
      }
      if (run.lane === "consulta" && c.reserved > 0) {
        await hold(run, "ceiling", { running: c.work, cap: settings.maxConcurrent, reserved: c.reserved });
        result.outcomes.set(run.id, { kind: "held", code: "ceiling", summary: `queued: slot reserved (${reservation?.label ?? "reserved"})` });
        continue;
      }
      // The caps first: they need no query, and most of a long queue waits on them (load test, PLA-I60-6).
      const agent = agentById.get(run.agentId);
      if (!agent) continue;
      // PLA-I71-3: a seat the owner paused starts nothing; its runs wait in the queue until it is resumed.
      if (agent.pausedAt) {
        await hold(run, "seat_paused", {});
        continue;
      }
      {
        const ps = projectById.get(run.projectId)?.settings;
        const lim = projectLimits(ps?.runner);
        // PLA-I73-5: lanes. Unless the owner set the project's caps by hand, a project runs settings.velocidad.carriles
        // work runs at once (2 by default) and its Taller seat that many steps; areas still never overlap (below).
        const carriles = velocidadOf(ps).carriles;
        const workCap = ps?.runner?.max_concurrent ?? Math.max(lim.maxConcurrent, carriles);
        if (run.lane === "consulta" || agent.projectId) {
          const used = c.byProjectLane.get(`${run.projectId}:${run.lane}`) ?? 0;
          const cap = run.lane === "consulta" ? lim.consultaSlots : workCap;
          if (used >= cap) {
            await hold(run, "project_cap", { running: used, cap, lane: run.lane });
            continue;
          }
        }
        if (run.lane === "work") {
          const used = c.byAgent.get(agent.id) ?? 0;
          const cap = run.role === "taller" && agent.maxParallel == null && ps?.runner?.max_per_agent == null ? Math.max(agentCapOf(agent, lim), carriles) : agentCapOf(agent, lim);
          if (used >= cap) {
            await hold(run, "agent_cap", { running: used, cap });
            continue;
          }
        }
      }
      const task = run.taskKey ? await readyWorkOf(tx, run.projectId, run.taskKey) : null;
      const ctx = await loadContext(tx, agent, task);
      if (!ctx.project) ctx.project = (await tx.select().from(projects).where(eq(projects.id, run.projectId)).limit(1))[0] ?? null;
      const mine = opts.only === run.id;
      // PLA-118: a task-less Artist run woken for a marks request still drawing.
      const marksRun = !task && ctx.role === "artist" && run.lane === "work" && !!ctx.project && !!marksRequestOfRun(ctx.project.slug, run.reason);
      const pre = await preflight(tx, ctx, now, deps, { fromQueue: run.id, consulta: run.lane === "consulta", trial: run.trigger === "trial", marks: marksRun, trigger: run.trigger, skipRest: mine && opts.skipRest, noCap: true });
      if (!pre.ok && pre.summary === "skipped: cooldown") {
        await hold(run, "rest", {});
        continue;
      }
      if (!pre.ok) {
        await endWithoutProcess(tx, run, pre.kind === "fail" ? "fail" : "skipped", pre.summary, now);
        result.outcomes.set(run.id, { kind: "ended", status: pre.kind === "fail" ? "fail" : "skipped", summary: pre.summary });
        result.dropped += 1;
        continue;
      }
      if (run.lane === "work" && run.taskKey && ctx.role && STAGE_OF_ROLE[ctx.role]) {
        const t = await ideaStageOf(tx, run.projectId, run.taskKey);
        const now_ = stageMovedOn(ctx.role, t?.kind, t?.stage);
        if (now_) {
          const summary = `skipped: the idea moved on (stage ${now_})`;
          await endWithoutProcess(tx, run, "skipped", summary, now);
          result.outcomes.set(run.id, { kind: "ended", status: "skipped", summary });
          result.dropped += 1;
          continue;
        }
      }
      // The plan: a stopped (or unknown) plan ends the run as it always did; requeueHeld queues it again later.
      const view = planView(reading, settings.planGuardPct, now, settings.guardOverride || (mine && !!opts.pastGuard));
      if (view.state === "unknown" || view.state === "stopped") {
        const summary = planGuardSummary(view);
        await endWithoutProcess(tx, run, "skipped", summary, now);
        result.outcomes.set(run.id, { kind: "ended", status: "skipped", summary });
        result.dropped += 1;
        continue;
      }

      const onWorker = c.byWorker.get(worker) ?? 0;
      if (onWorker >= capacity || (onWorker > 0 && (machine.freeMb < minFreeMb || machine.freeDiskGb < settings.minFreeDiskGb))) {
        await holdRest(n, "machine", { free_mb: Math.round(machine.freeMb), free_disk_gb: Math.round(machine.freeDiskGb), running: onWorker, capacity });
        break;
      }
      if (c.startsLastMinute >= settings.maxStartsPerMinute) {
        await holdRest(n, "start_rate", { per_minute: settings.maxStartsPerMinute });
        break;
      }
      const motor = await motorOfRun(tx, agent, run);
      const weight = planWeight(motor.model, motor.effort, settings.estPctPerRun);
      if (!view.override && view.five_hour_pct != null) {
        const projected = view.five_hour_pct + c.weightSince(reading?.at ?? null) + weight;
        if (projected >= view.guard_pct) {
          await holdRest(n, "plan", { pct: view.five_hour_pct, projected: Math.round(projected), guard: view.guard_pct });
          stopped.add("work");
          stopped.add("consulta");
          continue;
        }
      }
      const limits = projectLimits(ctx.project?.settings?.runner);
      const team = !!agent.projectId;
      const project = ctx.project!;
      const branch = task ? ctx.taskRow?.branch?.trim() || branchFor(task.key, await workPatternOf(db, project.id)) : null;
      const trialId = trialIdOfRun(run);
      const cwd = run.lane === "consulta" ? null : trialId ? safePath(() => trialPathFor(root, project.slug, trialId)) : task ? safePath(() => worktreePathFor(root, project.slug, task.key)) : scratchPathFor(root, project.slug, agent.slug);
      const keys = lockKeysOf({ projectId: project.id, taskKey: run.taskKey, branch: run.lane === "consulta" ? null : branch, cwd });
      const taken = await takeLocks(tx, run.id, run.lane === "consulta" ? keys.filter((k) => !k.startsWith("task:")) : keys);
      if (!taken.ok) {
        await hold(run, "lock", { keys: taken.held });
        continue;
      }
      const clash = limits.serializeAreas && ctx.role === "taller" && task ? await areasClash(tx, project.id, task.key, sharedAreasOf(project.settings?.runner)) : null;
      if (clash) {
        await releaseLocks(tx, run.id);
        await hold(run, "areas", clash);
        continue;
      }
      const [updated] = await tx
        .update(agentRuns)
        .set({ status: "starting", workerId: worker, leaseUntil: new Date(now.getTime() + 2 * MINUTE), startedAt: now, heldCode: null, heldDetail: null, planWeight: weight })
        .where(and(eq(agentRuns.id, run.id), eq(agentRuns.status, "queued")))
        .returning();
      if (!updated) {
        await releaseLocks(tx, run.id);
        continue;
      }
      bump(c, { projectId: run.projectId, lane: run.lane, agentId: agent.id, team, weight }, worker, now);
      out.push({ run: updated, ctx });
      lastAdmitted = q.slug;
    }
    if (lastAdmitted) {
      await tx
        .insert(machineState)
        .values({ key: "runner.rr", value: { project: lastAdmitted } })
        .onConflictDoUpdate({ target: machineState.key, set: { value: { project: lastAdmitted }, updatedAt: sql`now()` } });
    }
    return out;
  });

  result.txMs = performance.now() - lockedAt;
  result.waitMs = lockedAt - txStart;
  // Spawn outside the transaction, concurrently; git on one repo is serialized by its own lock (start).
  await Promise.all(
    admitted.map(async ({ run, ctx }) => {
      const outcome = await start(db, run, ctx, deps).catch(async (e: unknown) => {
        const summary = `fail: start (${String((e as Error)?.message ?? e).slice(0, 80)})`;
        await endWithoutProcess(db, run, "fail", summary, new Date());
        return { kind: "fail", summary, taskKey: run.taskKey, recorded: true } as WakeOutcome;
      });
      result.outcomes.set(run.id, outcome.kind === "started" ? { kind: "started", outcome } : { kind: "ended", status: outcome.kind === "skipped" ? "skipped" : "fail", summary: outcome.summary });
      if (outcome.kind === "started") result.started += 1;
    }),
  );
  return result;
}

async function withRepoLock<T>(db: Db, repo: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`git:${repo}`}))`);
    return fn();
  });
}

const safePath = (fn: () => string): string | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

// A code run waits while a live code run in the same project lists areas that overlap its ticket's.
// PLA-58: the live run's areas include what it really changed (sweepTouched). And shared paths (shadcn's
// components/ui, package.json, lockfiles…) are everyone's: while a live run touches one, every other code run
// waits; a ticket that declares one waits for any live code run. The hold names the other ticket and the files.
export async function areasClash(tx: Q, projectId: string, key: string, shared: string[] = []): Promise<{ with: string; files: string[] } | null> {
  const [mine] = await tx.select({ areas: tasks.areas }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.key, key))).limit(1);
  const a = mine?.areas ?? [];
  const others = await tx
    .select({ key: tasks.key, areas: tasks.areas })
    .from(agentRuns)
    .innerJoin(tasks, and(eq(tasks.projectId, agentRuns.projectId), eq(tasks.key, agentRuns.taskKey)))
    .where(and(eq(agentRuns.projectId, projectId), inArray(agentRuns.status, ["starting", "running"]), eq(agentRuns.role, "taller"), sql`${agentRuns.taskKey} <> ${key}`));
  const mineShared = a.filter((y) => isShared(y, shared));
  for (const o of others) {
    const theirs = o.areas ?? [];
    const files = [
      ...theirs.filter((x) => a.some((y) => areasOverlap(x, y))),
      ...theirs.filter((x) => isShared(x, shared)),
      ...mineShared,
    ];
    if (files.length) return { with: o.key, files: [...new Set(files)].slice(0, 3) };
  }
  return null;
}

// The motor a run would start with (for its plan weight).
async function motorOfRun(tx: Q, agent: Agent, run: AgentRun): Promise<{ model: string | null; effort: string | null }> {
  const settings = await loadSettings(tx);
  const m = resolveMotor({
    consulta: run.lane === "consulta",
    seat: { model: agent.motorModel, effort: agent.motorEffort, consultaModel: agent.consultaModel, consultaEffort: agent.consultaEffort },
    company: { model: settings.defaultModel, effort: settings.defaultEffort },
  });
  return { model: m.model, effort: m.effort };
}

// PLA-I60-2: admission a moment after something is queued or finishes, instead of at the next heartbeat tick. Every
// insertRun and finishRun sends NOTIFY plania_runs on commit; this process LISTENs and admits (debounced). The heartbeat
// job still drains every minute as the fallback. Only the server with jobs on starts this.
let admitTimer: NodeJS.Timeout | null = null;
export function startAdmissionLoop(db: Db, deps: RunnerDeps = {}, log: (line: string) => void = () => {}): () => void {
  const soon = () => {
    if (admitTimer) return;
    admitTimer = setTimeout(() => {
      admitTimer = null;
      void drainQueue(db, new Date(), deps).then(
        (r) => r.started && log(`[runner] admitted ${r.started}`),
        (e: unknown) => log(`[runner] admit failed: ${e instanceof Error ? e.message : String(e)}`),
      );
    }, 250);
  };
  setQueueKick(soon);
  const timers = [
    setInterval(() => void renewWorker(db, deps.env ?? process.env).catch(() => undefined), 30_000),
    setInterval(() => void actOnStopRequests(db).catch(() => undefined), 5_000),
  ];
  void renewWorker(db, deps.env ?? process.env).catch(() => undefined);
  let client: pg.Client | null = null;
  let stopped = false;
  const listen = async () => {
    if (stopped) return;
    try {
      client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      client.on("notification", soon);
      client.on("error", () => {
        client = null;
        setTimeout(() => void listen(), 5_000);
      });
      await client.connect();
      await client.query(`LISTEN ${QUEUE_CHANNEL}`);
    } catch {
      client = null;
      setTimeout(() => void listen(), 5_000);
    }
  };
  void listen();
  return () => {
    stopped = true;
    timers.forEach((t) => clearInterval(t));
    setQueueKick(() => {});
    void client?.end().catch(() => undefined);
  };
}

// Queued runs, through admission. Kept under its old name for the heartbeat job and the tests.
export async function drainQueue(db: Db, now: Date, deps: RunnerDeps = {}): Promise<{ started: number; dropped: number }> {
  return serial(async () => {
    const r = await admit(db, now, deps);
    return { started: r.started, dropped: r.dropped };
  });
}

async function readyWorkOf(db: Q, projectId: string, key: string): Promise<ReadyWork | null> {
  const [row] = await db
    .select({ project: projects.slug, key: tasks.key, title: tasks.title, priority: tasks.priority, workType: tasks.workType, ownerAgent: tasks.ownerAgent })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.key, key)))
    .limit(1);
  return row ?? null;
}

async function endWithoutProcess(db: Q, run: AgentRun, status: "skipped" | "fail", summary: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(agentRuns).set({ status, summary: summary.slice(0, 500), endedAt: now, heldCode: null }).where(eq(agentRuns.id, run.id));
    await releaseLocks(tx, run.id);
    // PLA-I67-6: a trial that never started says why (the plan guard, a paused project, its copy could not be made).
    const trialId = trialIdOfRun(run);
    if (trialId) await setTrial(tx, trialId, { status: trialStatusOf(status), summary, finishedAt: now });
  });
  await db.insert(heartbeatRuns).values({
    agentId: run.agentId,
    startedAt: run.queuedAt,
    endedAt: now,
    status,
    adapter: RUNNER_ADAPTER,
    summary: summary.slice(0, 500),
    taskKey: run.taskKey,
  });
}

// ---- Start

// PLA-71: the owner's request for changes (thread-actions changes) that is newer than the ticket's last move to In
// review: the request this run has to answer. Null when the ticket was not sent back since it was last delivered.
// PLA-I2-10: the request is the note's owner_changes field. LEGACY_CHANGES_LIKE / LEGACY_CHANGES_PREFIX read notes
// written before that field existed (Spanish only); they are the one documented fallback (test/i2-10-server.test.ts).
export const LEGACY_CHANGES_LIKE = "Cambios que pide %";
export const LEGACY_CHANGES_PREFIX = /^Cambios que pide [^:\n]{1,80}:\s*/;
export async function ownerChangesOf(db: Db, projectId: string, taskKey: string): Promise<string | null> {
  const rows = await db.execute<{ text: string | null; changes: string | null }>(sql`
    select e.payload->>'text' as text, e.payload->>'owner_changes' as changes from events e
    where e.project_id = ${projectId} and e.task_key = ${taskKey} and e.type = 'note'
      and (e.payload ? 'owner_changes' or e.payload->>'text' like ${LEGACY_CHANGES_LIKE})
      and e.id > coalesce((select max(s.id) from events s where s.project_id = ${projectId} and s.task_key = ${taskKey}
                            and s.type = 'task.status' and s.payload->>'to' = ${ST.inReview}), 0)
    order by e.id desc limit 1`);
  const row = rows.rows[0];
  const text = row?.changes ?? (row?.text ? row.text.replace(LEGACY_CHANGES_PREFIX, "") : null);
  return text ? text.trim().slice(0, 1500) || null : null;
}

export function userPrompt(input: {
  agent: string;
  role: string;
  // PLA-I2-5: startBranch is settings.start_branch through startBranchOf; absent reads as the default.
  project: { slug: string; title: string; startBranch?: string };
  goal: { title: string; why: string } | null;
  task: { key: string; title: string } | null;
  workspace: { path: string; branch: string | null } | null;
  sessionId: string;
  reason?: string | null;
  // PLA-I46-12: the skill packs this role carries, their one line and where the body was written.
  packs?: { name: string; when: string; file: string }[];
  // PLA-I54-2: absolute paths of the pictures the owner attached to the request (src/pedidos/images.ts).
  images?: string[];
  // AUDIT-3: the same packs delivered as a plugin outside the worktree (src/runner/kit.ts).
  kit?: KitWritten[];
  // AUDIT-1: the project's checks (settings.qa.verify), named so the builder runs them before it delivers.
  verify?: { name: string; command: string }[];
  // AUDIT-7: a fresh session on work that was already started, and why.
  handoff?: string | null;
  // PLA-71: what the owner asked to change when he sent this delivery back (his words), newest first.
  changes?: string | null;
  // PLA-I67-4: the seat's references, copied into the run's temp folder (src/runner/references.ts).
  references?: ReferenceLine[];
  // PLA-I73-2: the delivered step this one is stacked on (its branch is this worktree's starting point).
  stackedOn?: { key: string; title: string; branch: string } | null;
}): string {
  const company = input.role === "asistente";
  const startBranch = input.project.startBranch ?? DEFAULT_START_BRANCH;
  const lines = [
    company
      ? `You are ${input.agent} (asistente), the company's chief of staff, woken by the Plania runner. Your runs are recorded in project ${input.project.slug}.`
      : `You are ${input.agent} (${input.role}) for project ${input.project.slug} (${input.project.title}), woken by the Plania runner.`,
    input.goal ? `Project goal: ${input.goal.title}${input.goal.why ? ` (why: ${input.goal.why})` : ""}` : "Project goal: none set.",
    input.task ? `Ticket: ${input.task.key}: ${input.task.title}` : "Ticket: none. Read the project in Plania (get_resume) and take the next step toward the goal.",
  ];
  if (company) lines.splice(1, 2, input.task ? `Ticket: ${input.task.key}: ${input.task.title}` : "Ticket: none. Read the company thread (thread_read company) first.");
  if (input.reason) lines.push(`Why you woke: ${input.reason}.`);
  // PLA-71: a delivery the owner sent back. Without this line a fresh session saw only «ticket ready», took the work
  // for unfinished, re-ran the checks and delivered the same thing again.
  if (input.changes)
    lines.push(
      `The owner sent your last delivery of this ticket back. Their words: «${input.changes}». Do exactly that before you call finish again; re-running the checks alone does not answer them. If what they ask is in your muestra (the views Plania shows them), fix the muestra.`,
    );
  // PLA-I32-3/5: the conversation is where the owner reads you.
  lines.push(
    company
      ? "Answer the owner in the company thread with thread_post (thread company); write in a project's thread when it is about that project. Never merge anything."
      : `End the run with one line in your project's thread (thread_post, thread ${input.project.slug}): what you did, with a link to it, and what you need.`,
    languageLine(),
  );
  if (input.workspace) {
    lines.push(`Workspace: ${input.workspace.path}${input.workspace.branch ? ` on branch ${input.workspace.branch}` : ""}, base ${startBranch}.`);
  }
  if (input.stackedOn) {
    const b = input.stackedOn;
    lines.push(
      `This step is stacked on ${b.key} «${b.title}», delivered and still in review: your branch starts from ${b.branch}, so its code is already here. Build on it, do not redo it. Your PR still goes into ${startBranch}; until ${b.key} merges it also shows that step's commits, which is expected. If ${b.key} is sent back and changes, rebase onto origin/${b.branch} before you deliver.`,
    );
  }
  lines.push(...packLines(input.packs ?? []));
  lines.push(...kitLines(input.kit ?? []));
  if (input.handoff) {
    lines.push(
      `This is a fresh session on work that was already started (${input.handoff}). Before you change anything: read the ticket and its notes (start returns them), then run git status and git log --oneline origin/sandbox..HEAD in the workspace to see what exists. Continue from there; do not start over.`,
    );
  }
  if (input.verify?.length && input.task && !/-IDEA\d+$/.test(input.task.key)) {
    lines.push(
      "Checks Plania runs on your delivery. Run them in the workspace and fix what fails before you call finish; finish runs them again and refuses a delivery that fails one:",
      ...input.verify.map((v) => `- ${v.name}: \`${v.command}\``),
    );
  }
  if (input.images?.length) {
    lines.push("Pictures the owner attached to this request (open each one with the Read tool before you answer):", ...input.images.map((p) => `- ${p}`));
  }
  lines.push(...referenceLines(input.references ?? []));
  // PLA-I49-6: an idea (PREFIX-IDEA<n>) is not a ticket and start refuses it. Research and Artist woken on an idea's
  // stage work on the idea itself: read it, write the stage doc on it, move its stage.
  const idea = !!input.task && /-IDEA\d+$/.test(input.task.key);
  lines.push(
    idea
      ? `This is an idea, not a ticket: do not call start or claim on it. Read it with get_task, deliver your stage with deliver_stage (key ${input.task!.key}; it checks the content and writes the stage doc), then move its stage with set_task.`
      : `Plania first: open the ticket with start (actor session_id ${input.sessionId}, that workspace) before you touch code.`,
    `Never main: commit on your branch, open PRs into ${startBranch} only, never merge. Stop when the ticket is In review or when only the owner can decide (ask).`,
  );
  // PLA-I61-2 (La idea abierta): the owner sees the design on the screen only through its frames in Plania.
  if (idea && input.role === "artist") {
    lines.push(
      `Draw the canvas under ${canvasesRoot()}/${input.task!.key}/, export one PNG per frame, and put them on the idea with attach_frames (key ${input.task!.key}): each frame's id (T, A1, B3), name, group, what it does (hace) and why (porque), in order. The owner sees the design only through those frames, then deliver the Design stage with deliver_stage as usual.`,
    );
  }
  return personalize(lines.join("\n")); // PLA-I2-14: "the owner" reads as the display name
}

// AUDIT-2: the role prompt and its version, "<doc version>:<first 12 of its sha256>". The Plania doc is the live copy;
// with no doc the repo's kit/roles/<role>.md is used and the version reads "git:<sha>".
export async function promptDoc(db: Db, role: RunnerRole, env: NodeJS.ProcessEnv): Promise<{ markdown: string; version: string } | null> {
  // NEWPROJ-2: the lookup is shared with project creation and the hire sheet (src/runner/prompts.ts).
  const prompt = await rolePrompt(db, role, env);
  return prompt ? { markdown: prompt.markdown, version: prompt.version } : null;
}

// AUDIT-9: what the owner keeps about a project that cannot be found by reading its repo: three project docs,
// appended to the role prompt on a session's first run. Cut at CONTEXT_MAX_LINES so it stays a map.
export const CONTEXT_DOCS = ["Context: Glossary", "Context: Commands", "Context: Map"] as const;
export const CONTEXT_MAX_LINES = 200;
export async function projectContext(db: Db, projectId: string): Promise<string | null> {
  const rows = await db
    .select({ title: docs.title, markdown: docs.markdown })
    .from(docs)
    .where(and(eq(docs.projectId, projectId), isNull(docs.taskId), inArray(docs.title, [...CONTEXT_DOCS])));
  const parts = CONTEXT_DOCS.map((title) => rows.find((r) => r.title === title))
    .filter((r): r is { title: string; markdown: string } => !!r && !!r.markdown.trim())
    .map((r) => `## ${r.title.replace(/^Context:\s*/, "")}\n\n${r.markdown.trim()}`);
  if (parts.length === 0) return null;
  const lines = parts.join("\n\n").split("\n");
  const body = lines.length > CONTEXT_MAX_LINES ? [...lines.slice(0, CONTEXT_MAX_LINES), `(cut at ${CONTEXT_MAX_LINES} lines)`] : lines;
  return `# Project context\n\nKept by the owner in Plania. It holds only what reading the repo does not tell you.\n\n${body.join("\n")}`;
}

// PLA-147: the owner's pinned rules ride with every role prompt. Idea-stage runs (Research, Artist) never call
// start, so before this a pinned «everything local» never reached Research, which recommended a hosted store.
// Live only: retired and superseded decisions are left out. Newest first, capped so the prompt stays short.
export const PINNED_MAX = 25;
export async function pinnedDecisionsBlock(db: Db, projectId: string): Promise<string | null> {
  const rows = await db.execute<{ line: string }>(sql`
    select d.line from decisions d
    where d.project_id = ${projectId} and d.pinned and d.retired_at is null
      and not exists (select 1 from decision_supersessions s where s.supersedes_id = d.id)
    order by d.created_at desc limit ${PINNED_MAX}`);
  if (rows.rows.length === 0) return null;
  return [
    "# Pinned decisions",
    "",
    "The owner's standing rules for this project. Follow them. An option that breaks one is flagged as breaking it and is never your recommendation; if one blocks the work, ask the owner.",
    "",
    ...rows.rows.map((r) => `- ${r.line.replace(/\s+/g, " ").trim()}`),
  ].join("\n");
}

// AUDIT-7: resume the session, or start clean with a handoff? A session that failed, whose delivery QA sent back, or
// that grew past PLANIA_RESUME_MAX_CONTEXT tokens carries its dead ends; a fresh one reads the ticket and git instead.
// PLANIA_RETRY_FRESH: "1" (default) fresh in those cases, "0" always resume, "ab" fresh for every other such run, so
// agent_runs.resumed splits them evenly and the scoreboard can compare both.
export async function freshReason(db: Db, run: AgentRun, env: NodeJS.ProcessEnv): Promise<string | null> {
  const mode = env.PLANIA_RETRY_FRESH ?? "1";
  if (mode === "0") return null;
  const [prior] = await db
    .select({ status: agentRuns.status, context: agentRuns.contextTokens })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, run.agentId), eq(agentRuns.projectId, run.projectId), eq(agentRuns.workKey, run.workKey), inArray(agentRuns.status, ["ok", "fail", "stopped"])))
    .orderBy(desc(sql`coalesce(${agentRuns.endedAt}, ${agentRuns.queuedAt})`))
    .limit(1);
  const max = Number(env.PLANIA_RESUME_MAX_CONTEXT) > 0 ? Number(env.PLANIA_RESUME_MAX_CONTEXT) : 120_000;
  let why: string | null = null;
  if (prior?.status === "fail") why = "the last run on it failed";
  else if (prior?.context != null && prior.context > max) why = "the earlier session grew too long";
  if (!why && run.taskKey) {
    const returned = await db.execute<{ returned: boolean }>(sql`
      select l.returned from qa_lanes l where l.project_id = ${run.projectId} and l.task_key = ${run.taskKey} order by l.created_at desc limit 1`);
    if (returned.rows[0]?.returned) why = "QA sent the delivery back";
  }
  if (!why) return null;
  if (mode === "ab" && parseInt(run.id.replace(/-/g, "").slice(-2), 16) % 2 === 1) return null;
  return why;
}

export type ClaudeArgsInput = {
  prompt: string;
  settingsPath: string;
  mcpConfigPath: string;
  systemPromptPath: string | null;
  maxTurns: number;
  resume: string | null;
  // PLA-I46-9: a QA review of a small change runs on a smaller model. PLA-I59-1: every run's motor (motor.ts).
  model?: string | null;
  effort?: string | null;
  // AUDIT-3: the run's kit (a plugin folder in its temp dir); also granted for reading, so a run can open a skill's file.
  pluginDir?: string | null;
  // PLA-I67-4: more folders the run may read (its references).
  addDirs?: string[];
  // AUDIT-3 (PLANIA_RUN_ISOLATION): "project" loads no user-level settings, skills or CLAUDE.md of the account the
  // server runs as; "bare" skips every auto-discovery. Unset: as before, the CLI's defaults.
  isolation?: string | null;
  // AUDIT-6: a JSON Schema the run's final answer must match (the QA report).
  jsonSchema?: unknown;
};

export const isolationOf = (env: NodeJS.ProcessEnv): "project" | "bare" | null => {
  const v = env.PLANIA_RUN_ISOLATION?.trim().toLowerCase();
  return v === "project" || v === "bare" ? v : null;
};

export function claudeArgs(input: ClaudeArgsInput): string[] {
  const args = [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "auto",
    "--permission-prompts",
    "none",
    "--settings",
    input.settingsPath,
    "--mcp-config",
    input.mcpConfigPath,
    "--strict-mcp-config",
    "--max-turns",
    String(input.maxTurns),
  ];
  // The role prompt goes on a session's first run only; a resumed session already has it.
  if (input.systemPromptPath && !input.resume) args.push("--append-system-prompt-file", input.systemPromptPath);
  if (input.resume) args.push("--resume", input.resume);
  if (input.model) args.push("--model", input.model);
  if (input.effort) args.push("--effort", input.effort);
  if (input.pluginDir) args.push("--plugin-dir", input.pluginDir, "--add-dir", input.pluginDir);
  for (const dir of input.addDirs ?? []) args.push("--add-dir", dir);
  if (input.isolation === "project") args.push("--setting-sources", "project,local");
  if (input.isolation === "bare") args.push("--bare");
  if (input.jsonSchema) args.push("--json-schema", JSON.stringify(input.jsonSchema));
  return args;
}

// Plania only. The token stays in the child env; the file names the variable, never the value.
// AUDIT-6: browser adds a second server for a QA run that walks through the app (settings.qa.browser).
export type McpStdio = { command: string; args: string[] };
// timeout: finish may run the project's checks before it answers (AUDIT-1) and sends nothing while it does. Claude Code
// drops an HTTP tool call that is silent for five minutes whatever MCP_TOOL_TIMEOUT says, and the server would go on
// and commit a delivery the run was told had failed. The per-server timeout lifts that for Plania alone.
// PLA-82 (F-12): X-Plania-Run names the run, so its writes are its roster agent's even when it invents a session_id.
export const PLANIA_TOOL_TIMEOUT_MS = 30 * 60_000;
export const mcpConfig = (url: string, browser: McpStdio | null = null, run: string | null = null) => ({
  mcpServers: {
    plania: {
      type: "http",
      url,
      headers: { Authorization: "Bearer ${PLANIA_RUNNER_TOKEN}", ...(run ? { "X-Plania-Run": run } : {}) },
      timeout: PLANIA_TOOL_TIMEOUT_MS,
    },
    ...(browser ? { browser } : {}),
  },
});

// The browser tools a QA walk-through uses: Playwright's MCP server, headless, with a profile it throws away.
// PLANIA_BROWSER_MCP replaces the command (the first word is the program, the rest its arguments).
export function browserServer(env: NodeJS.ProcessEnv): McpStdio {
  const words = (env.PLANIA_BROWSER_MCP?.trim() || "npx -y @playwright/mcp@latest --headless --isolated").split(/\s+/);
  return { command: words[0]!, args: words.slice(1) };
}

// The stream's running totals reach agent_runs every few seconds while the run is live.
function liveFlusher(db: Db, runId: string, reader: StreamReader, every: number): (chunk: string) => void {
  let last = 0;
  return (chunk) => {
    reader.feed(chunk);
    if (Date.now() - last < every) return;
    last = Date.now();
    const t = reader.liveTokens;
    void db
      .update(agentRuns)
      .set({ turns: reader.liveTurns, inputTokens: t.input, outputTokens: t.output, cacheReadTokens: t.cacheRead, cacheCreateTokens: t.cacheCreate, tokensTotal: totalOf(t) })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")))
      .catch(() => undefined);
  };
}

async function start(db: Db, run: AgentRun, ctx: WakeContext, deps: RunnerDeps): Promise<WakeOutcome> {
  const env = deps.env ?? process.env;
  const project = ctx.project!;
  const role = ctx.role!;
  const taskKey = run.taskKey;
  const fail = async (summary: string): Promise<WakeOutcome> => {
    await endWithoutProcess(db, run, "fail", summary, new Date());
    // NEWPROJ-5: a run that never started writes no event, so open screens kept showing the step as about to
    // start until their next poll. Tell them now.
    bus.publish({ type: "task", project: project.slug, ...(taskKey ? { key: taskKey } : {}) });
    return { kind: "fail", summary, taskKey, recorded: true };
  };

  // PLA-I2-2: .env first, else the token first start stored.
  const token = storedRunnerToken(env);
  if (!token) return fail("fail: missing env PLANIA_RUNNER_TOKEN");
  const settings = await loadSettings(db);
  const root = rootOf(deps, env);
  // PLA-I57-1: a question from Preguntar. Read-only, in the project's own checkout, fresh session, no packs.
  const consultaId = consultaIdOfRun(run);
  const consulta = consultaId ? await consultaById(db, consultaId) : null;
  // PLA-I67-6: a skill trial, in its own throwaway copy (src/runner/trial.ts).
  const trialId = trialIdOfRun(run);
  const trial = trialId ? await trialById(db, trialId) : null;
  if (trialId && !trial) return fail("fail: no such trial");

  // Where the run works: the ticket's worktree, or a scratch folder for a PO with no ticket.
  let cwd: string;
  let worktree: string | null = null;
  let stacked: StackBase | null = null;
  let branch: string | null = null;
  let readCopy: { branch: string | null; commit: string | null; fallback?: string } | null = null;
  if (trial) {
    const repo = repoPathOf(project.slug, project.settings, env);
    const target = trialPathFor(root, project.slug, trial.id);
    const made = await withRepoLock(db, repo, () => addTrialCopy({ repo, target, base: trial.baseCommit ?? "" }, carefulGit(deps.git ?? defaultGit)));
    if (!made.ok) return fail(made.summary);
    cwd = target;
    worktree = target;
  } else if (ctx.task) {
    const repo = repoPathOf(project.slug, project.settings, env);
    const wanted = ctx.taskRow?.branch?.trim() || branchFor(ctx.task.key, await workPatternOf(db, project.id));
    // PLA-I60-2: one git writer per repo across processes (a Postgres advisory lock), with lock errors retried.
    // PLA-I73-2: a step stacked on a delivered one starts from that step's branch.
    stacked = ctx.taskRow?.id ? await stackBaseOf(db, ctx.taskRow.id) : null;
    // PLA-I73-6: step 1 starts from the skeleton built early on the idea's branch.
    const early = !stacked && ctx.taskRow?.id ? await earlyBaseOf(db, ctx.taskRow.id) : null;
    const from = stacked?.branch ?? early?.branch;
    const made = await withRepoLock(db, repo, () => ensureWorktree({ repo, root, project: project.slug, key: ctx.task!.key, branch: wanted, base: startBranchOf(project.settings), ...(from ? { from } : {}) }, carefulGit(deps.git ?? defaultGit)));
    if (!made.ok) {
      if (made.summary === "fail: no repo" && role !== "taller") {
        cwd = scratchPathFor(root, project.slug, ctx.agent.slug);
        mkdirSync(cwd, { recursive: true });
      } else return fail(made.summary.startsWith("fail: base") ? "fail: base not allowed" : made.summary);
    } else {
      cwd = made.path;
      worktree = made.path;
      branch = made.branch;
      // PLA-I73-4: a new worktree gets the checkout's modules as an instant clone when the lockfile matches.
      if (made.created) await cloneModules(repo, made.path).catch(() => false);
      if (made.created && deps.footprints !== false) {
        await registerFootprint(
          db,
          {
            project: project.slug,
            kind: "worktree",
            locator: made.path,
            purpose: `Runner worktree for ${ctx.task.key} (${ctx.agent.slug})`,
            teardown: `git -C ${repo} worktree remove ${made.path}`,
            task_key: ctx.task.key,
          },
          { ...sysCtx("runner.worktree"), actor: { ...sysCtx("runner.worktree").actor, session_id: `runner-${ctx.agent.slug}` } },
        ).catch(() => undefined);
      }
    }
  } else if (consulta && existsSync(repoPathOf(project.slug, project.settings, env))) {
    // PLA-66: a fresh read-only copy at origin/sandbox; the owner's checkout only if that copy cannot be made.
    const repo = repoPathOf(project.slug, project.settings, env);
    const copy = await withRepoLock(db, repo, () => ensureReadCopy({ repo, root, project: project.slug, base: startBranchOf(project.settings) }, carefulGit(deps.git ?? defaultGit)));
    if (copy.ok) {
      cwd = copy.path;
      readCopy = { branch: copy.branch, commit: copy.commit };
      if (copy.created && deps.footprints !== false) {
        await registerFootprint(
          db,
          { project: project.slug, kind: "worktree", locator: copy.path, purpose: `Read copy for Preguntar (${project.slug}), moved to origin/sandbox before each question`, teardown: `git -C ${repo} worktree remove --force ${copy.path}` },
          { ...sysCtx("runner.worktree"), actor: { ...sysCtx("runner.worktree").actor, session_id: `runner-${ctx.agent.slug}` } },
        ).catch(() => undefined);
      }
    } else {
      cwd = repo;
      readCopy = { branch: null, commit: null, fallback: copy.summary };
    }
  } else {
    cwd = scratchPathFor(root, project.slug, ctx.agent.slug);
    mkdirSync(cwd, { recursive: true });
  }

  // Resume this agent's session in this project, only in the folder it ran in.
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.agentId, ctx.agent.id), eq(agentSessions.projectId, project.id), eq(agentSessions.workKey, run.workKey)))
    .limit(1);
  // PLA-I46-9: a QA run is always a fresh session, so its review has not seen anyone's earlier reasoning.
  const qa = role === "qa" ? await qaBriefFor(db, run.id, cwd) : null;
  const resumable = !qa && !consulta && !trial && session && session.cwd === cwd ? session.claudeSessionId : null;
  // AUDIT-7: a session that failed, was sent back or grew long is not resumed; the run starts clean with a handoff.
  const handoff = resumable ? await freshReason(db, run, env).catch(() => null) : null;
  const resume = handoff ? null : resumable;

  const tmp = path.join(tmpDirOf(deps), run.id);
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  let systemPromptPath: string | null = null;
  let promptVersion: string | null = null;
  let mannerStamp: string | null = null;
  if (!resume) {
    const doc = await promptDoc(db, role, env);
    if (!doc) {
      rmSync(tmp, { recursive: true, force: true });
      return fail(`fail: no prompt doc (${PROMPT_DOCS[role]})`);
    }
    promptVersion = doc.version;
    // AUDIT-9: the project's own context rides with the role prompt (not for the company's Asistente or a QA review,
    // which judges the change on its own).
    const own = role === "asistente" || qa ? null : await projectContext(db, project.id).catch(() => null);
    const pinned = role === "asistente" || qa ? null : await pinnedDecisionsBlock(db, project.id).catch(() => null);
    const base = own && pinned ? `${own}\n\n${pinned}` : (own ?? pinned);
    // PLA-I68-4: the commit rules chosen in Camino, the text the page shows, for the builder.
    const commitsText = role === "taller" ? await commitInstructions(db, project).catch(() => null) : null;
    const context = base && commitsText ? `${base}\n\n${commitsText}` : (base ?? (commitsText ? `# Project context\n\n${commitsText}` : null));
    systemPromptPath = path.join(tmp, "role-prompt.md");
    // PLA-I67-2: «tu manera», the owner's text for this agent, after the role prompt and the context (not for QA or
    // a question from Preguntar, which run on the role alone).
    const manner = qa || consulta ? null : mannerBlock(ctx.agent.manner);
    if (manner) mannerStamp = mannerVersion(ctx.agent.manner);
    const parts = [doc.markdown.trimEnd(), context, manner].filter((x): x is string => !!x);
    writeFileSync(systemPromptPath, parts.length > 1 ? `${parts.join("\n\n")}\n` : doc.markdown, { mode: 0o600 });
  }
  const settingsPath = path.join(tmp, "settings.json");
  // PLA-I52-6: a run that answers the owner's question about a delivery reads only, like QA.
  const asks = (run.reason ?? "").includes(PREGUNTA_MARK);
  if (asks) {
    const h = await (deps.git ?? defaultGit)(["rev-parse", "HEAD"], cwd).catch(() => null);
    askHeads.set(run.id, h && h.code === 0 ? h.stdout.trim() : null);
  }
  // PLA-I66-5: Artist drawing logo marks reads only (its scratch folder) and answers with deliver_marks.
  const marksReq = !consulta && !trial && role === "artist" && !ctx.task ? marksRequestOfRun(project.slug, run.reason) : null;
  const readOnly = !!consulta || role === "qa" || asks || !!marksReq;
  // AUDIT-1: a builder's run formats or type-checks after each edit when the project names a command for it.
  const editHooks = !readOnly && role === "taller" ? afterEditHooks(project.settings?.qa?.after_edit) : undefined;
  // PLA-I68-4: Camino's commit rules, checked before a builder's run pushes or opens a PR (and after each commit when
  // the owner asked); only once the owner chose them in Camino.
  const commitHook = !readOnly && role === "taller" ? await commitHooks(db, project, tmp, startBranchOf(project.settings)).catch(() => null) : null;
  const hooks =
    editHooks || commitHook
      ? { ...(commitHook?.PreToolUse ? { PreToolUse: commitHook.PreToolUse } : {}), ...(editHooks?.PostToolUse || commitHook?.PostToolUse ? { PostToolUse: [...(editHooks?.PostToolUse ?? []), ...(commitHook?.PostToolUse ?? [])] } : {}) }
      : undefined;
  // PLA-I2-9: a run of Plania itself also may not reach the live database or apply a migration.
  const self = isSelfProject(repoPathOf(project.slug, project.settings, env), deps.serverRoot ?? serverRoot());
  const laneRules = consulta ? CONSULTA_DENY_RULES : trial ? TRIAL_DENY_RULES : marksReq ? QA_DENY_RULES : role === "qa" || asks ? QA_DENY_RULES : [];
  writeFileSync(settingsPath, JSON.stringify({ ...denySettings(self ? [...laneRules, ...selfRules(liveDatabaseName(env.DATABASE_URL))] : laneRules), ...(hooks ? { hooks } : {}) }), { mode: 0o600 });
  const mcpConfigPath = path.join(tmp, "mcp.json");
  // PLA-I67-6: a trial reaches no Plania server at all, so it cannot write to the delivery's ticket.
  writeFileSync(mcpConfigPath, JSON.stringify(trial ? { mcpServers: {} } : mcpConfig(env.PLANIA_MCP_URL || "http://127.0.0.1:3737/mcp", qa?.browser ? browserServer(env) : null, runSession(run.id))), { mode: 0o600 });

  // PLA-I46-12: only this role's packs, written fresh (whatever an earlier run left is cleared first).
  // AUDIT-3: by default they go in a plugin in the run's temp folder, loaded with --plugin-dir, and the worktree is
  // left alone (whatever an older run left there is cleared). PLANIA_KIT_MODE=worktree keeps the older delivery.
  // PLA-I67-2: the factory kit merged with the owner's skills in scope (src/runner/skills.ts).
  const carried = consulta ? [] : trial ? await trialKit(db, ctx.agent, trial, env, role) : await resolvedKit(db, ctx.agent, env, role);
  const inWorktree = env.PLANIA_KIT_MODE === "worktree";
  const packs = inWorktree ? writePacks(cwd, carried) : [];
  if (!inWorktree && !consulta) clearPacks(cwd);
  const kitDir = path.join(tmp, "kit");
  const kit = inWorktree ? [] : writeKitPlugin(kitDir, carried);
  // AUDIT-1: the builder is told the checks its delivery will meet.
  const verify = role === "taller" && ctx.task ? (project.settings?.qa?.verify ?? []).map((v) => ({ name: v.name, command: v.command })) : [];

  // PLA-I67-4: the seat's references, copied into this run's temp folder and recorded as carried. Not for a question
  // (Preguntar) or a QA review, which judge on their own.
  const refsDir = path.join(tmp, "refs");
  const references = consulta || qa || trial ? [] : await carryReferences(db, { projectId: project.id, agentId: ctx.agent.id, runId: run.id, dir: refsDir }).catch(() => [] as ReferenceLine[]);

  const goal = await projectGoal(db, project.id);
  const planiaSession = runSession(run.id);
  const prompt = trial
    ? trialPrompt({ agent: ctx.agent.name, role, project: { slug: project.slug, title: project.title }, trial, scope: await trialScope(db, trial.projectId, trial.taskKey).catch(() => null), cwd, kit })
    : consulta
    ? consultaPrompt({ agent: ctx.agent.name, project: { slug: project.slug, title: project.title }, consulta, cwd, sessionId: planiaSession, copy: readCopy })
    : marksReq
      ? marksPrompt({ agent: ctx.agent.name, project: { slug: project.slug, title: project.title }, request: marksReq, sessionId: planiaSession, imageDir: uploadDir(project.slug) })
      : qa?.prompt ?? userPrompt({
    agent: ctx.agent.name,
    role,
    project: { slug: project.slug, title: project.title, startBranch: startBranchOf(project.settings) },
    goal,
    task: ctx.task ? { key: ctx.task.key, title: ctx.task.title } : null,
    workspace: { path: cwd, branch },
    stackedOn: stacked,
    sessionId: planiaSession,
    reason: run.reason?.trim() || null,
    packs,
    kit,
    verify,
    handoff,
    changes: ctx.task ? await ownerChangesOf(db, project.id, ctx.task.key).catch(() => null) : null,
    images: ctx.task ? await taskImagePaths(db, project.id, ctx.task.key).catch(() => []) : [],
    references,
  });
  // PLA-I67-3: the owner's approved lessons ride in the prompt, bounded (not for QA, a question, or a delivery question).
  // PLA-I67-5: within what the always-on budget leaves after the role prompt, «tu manera» and the skill list.
  const carriedLessons = consulta || qa || asks ? [] : await lessonsForRun(db, ctx.agent, lessonRoomOf(await fixedWords(db, ctx.agent, carried, env))).catch(() => []);
  const lessonText = lessonBlock(carriedLessons);
  // PLA-I69-5, PLA-130: how the app addresses people (Marca → Estilo → Trato) rides in every run that writes for it.
  const voiceText = consulta || qa ? "" : voiceBlock(project.slug);
  // PLA-I59-1: the motor this run asks for (QA lane > the seat, or its Preguntar values > the company > none).
  // PLA-I73-6: a Taller step's own effort from the plan.
  const stepRow = role === "taller" && ctx.taskRow?.id ? (await db.select({ projectId: tasks.projectId, parentId: tasks.parentId, phase: tasks.phase }).from(tasks).where(eq(tasks.id, ctx.taskRow.id)).limit(1))[0] : null;
  const stepEffort = stepRow ? ((await planStepFor(db, stepRow).catch(() => null))?.effort ?? null) : null;
  const motor = resolveMotor({
    stepEffort,
    qaModel: qa?.model ?? null,
    consulta: !!consulta,
    seat: { model: ctx.agent.motorModel, effort: ctx.agent.motorEffort, consultaModel: ctx.agent.consultaModel, consultaEffort: ctx.agent.consultaEffort },
    company: { model: settings.defaultModel, effort: settings.defaultEffort },
  });
  const args = claudeArgs({
    prompt: [prompt, lessonText, voiceText].filter(Boolean).join("\n\n"),
    settingsPath,
    mcpConfigPath,
    systemPromptPath,
    maxTurns: consulta ? Math.min(settings.maxTurns, 40) : settings.maxTurns,
    resume,
    model: motor.model,
    effort: motor.effort,
    pluginDir: kit.length ? kitDir : null,
    addDirs: references.some((r) => r.path) ? [refsDir] : [],
    isolation: isolationOf(env),
    // AUDIT-6: the QA report comes back as validated JSON (the fenced block in its brief stays as the fallback).
    jsonSchema: qa?.jsonSchema ?? null,
  });
  const command = claudeCommand(ctx.agent.adapterConfig, env);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDirOf(deps, env), `${stamp}-${ctx.agent.slug}-${run.id.slice(0, 8)}.jsonl`);
  const startedAt = new Date();

  // Plan readings are written as they stream; the run's end waits for them, so the next wake reads them.
  const readings: Promise<unknown>[] = [];
  const reader = new StreamReader((reading) => {
    readings.push(recordReading(db, { ...reading, source: "stream", runId: run.id }).catch(() => undefined));
  });
  const onStdout = liveFlusher(db, run.id, reader, deps.liveFlushMs ?? 5_000);
  // PLA-I60-3: the real runner starts the run through wrapper.mjs, detached, so it outlives a server restart. Tests
  // that inject spawn keep the piped child.
  // AUDIT-1: finish may run the project's checks before it answers, so a Plania tool call may take minutes.
  // PLA-I2-13: an allow-list; the project's settings.runner.env names the extra variables its runs get.
  // PLA-158 (F-31): a builder's run on a project whose copies have their own bases works on <db>_taller, never the
  // app's database: the variable goes in the process environment, which wins over the app's env files.
  let tallerEnv: Record<string, string> = {};
  if (role === "taller" && run.lane === "work" && !trial && !readOnly) {
    const made = await tallerDatabase(db, project);
    if (made && !made.ok) return fail(`fail: no taller database (${made.error})`);
    if (made) tallerEnv = made.env;
  }
  // PLA-I73-5: Taller's heavy commands take turns through the heavy-work queue.
  const heavy = role === "taller" && run.lane === "work" && !trial && !readOnly ? heavyEnv(root, env) : {};
  const runEnvValue = childEnv(env, { ...tallerEnv, ...heavy, PLANIA_RUNNER_TOKEN: token, ...(env.MCP_TOOL_TIMEOUT ? {} : { MCP_TOOL_TIMEOUT: String(30 * MINUTE) }) }, projectEnvNames(project.settings));
  // PLA-I2-9: the check behind the deny rules: a run of Plania itself never starts pointed at the live database.
  const selfProblem = self ? selfRunProblem(runEnvValue, cwd, env.DATABASE_URL) : null;
  if (selfProblem) return fail(`fail: ${selfProblem}`);
  const supervised = {
    command,
    args,
    cwd,
    env: runEnvValue,
    logPath,
    timeoutMs: deps.timeoutMs ?? settings.timeoutMinutes * MINUTE,
    graceMs: deps.graceMs ?? 30_000,
    kill: deps.kill ?? defaultKill,
    onStdout,
  };
  const proc = (deps.detached ?? !deps.spawn)
    ? superviseDetached({ ...supervised, runId: run.id, spawnDetached: deps.spawnDetached, pollMs: deps.pollMs })
    : supervise({ ...supervised, spawn: deps.spawn ?? defaultSpawn });

  await db
    .update(agentRuns)
    .set({
      status: "running",
      summary: "running",
      pid: proc.pid,
      resumed: !!resume,
      claudeSessionId: resume,
      cwd,
      worktreePath: worktree,
      branch,
      logPath,
      startedAt,
      requestedModel: motor.model,
      requestedEffort: motor.effort,
      // AUDIT-2: what this run was given (a resumed session keeps the prompt it started with, so none is named).
      promptVersion,
      skills: carried.map(skillVersion),
      mannerVersion: mannerStamp,
    })
    .where(eq(agentRuns.id, run.id));
  // PLA-I67-3: one row per skill, lesson and manner version this run carried.
  // PLA-I67-6: not for a trial, so the seat's counts read only real work.
  if (!trial) await recordKnowledge(db, run.id, { skills: carried, manner: mannerStamp, lessons: carriedLessons }).catch(() => undefined);
  else await setTrial(db, trial.id, { status: "running", summary: "running", afterSkills: carried.map(skillVersion) });

  const entry: LiveRun = { runId: run.id, agentId: ctx.agent.id, projectId: project.id, role, proc, finished: Promise.resolve(), stopReason: null };
  entry.finished = proc.done
    .then(async (exit) => {
      await Promise.all(readings);
      return exit;
    })
    .then((exit) => finishRun(db, { run: { ...run, startedAt }, agent: ctx.agent, project, reader, exit, stopReason: entry.stopReason, cwd }, deps))
    .catch(() => undefined)
    .finally(() => {
      live.delete(run.id);
      rmSync(tmp, { recursive: true, force: true });
      if (!consulta) clearPacks(cwd);
    });
  live.set(run.id, entry);
  return { kind: "started", runId: run.id, summary: `started${resume ? " (resumed)" : ""}`, taskKey };
}

// ---- Finish

type FinishInput = {
  run: AgentRun;
  agent: Agent;
  project: Project;
  reader: StreamReader;
  exit: ExitInfo;
  stopReason: string | null;
  cwd: string;
};

// PLA-I52-6: the head a question run started at, checked again when it ends (it must not have moved).
const askHeads = new Map<string, string | null>();
export async function askHeadCheck(runId: string, cwd: string, git: GitFn): Promise<{ before: string | null; after: string | null; moved: boolean } | null> {
  if (!askHeads.has(runId)) return null;
  const before = askHeads.get(runId) ?? null;
  askHeads.delete(runId);
  const h = await git(["rev-parse", "HEAD"], cwd).catch(() => null);
  const after = h && h.code === 0 ? h.stdout.trim() : null;
  return { before, after, moved: !!before && !!after && before !== after };
}
export const markAskHead = (runId: string, head: string | null) => askHeads.set(runId, head);

export async function finishRun(db: Db, input: FinishInput, deps: RunnerDeps = {}): Promise<void> {
  const { run, agent, project, reader, exit } = input;
  const heads = await askHeadCheck(run.id, input.cwd, deps.git ?? defaultGit);
  if (heads?.moved) {
    await db
      .insert(events)
      .values({ projectId: project.id, taskKey: run.taskKey, type: "probador.answer_moved_head", actor: { agent: "plania", session_id: "plania-probador" }, payload: { run_id: run.id, before: heads.before, after: heads.after } })
      .catch(() => undefined);
  }
  reader.end();
  const result = reader.result;
  const endedAt = new Date();
  let status: "ok" | "fail" | "stopped";
  let summary: string;
  let tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  let usageKnown = true;
  let turns = reader.liveTurns;
  const stopped = input.stopReason && input.stopReason !== "timeout" ? input.stopReason : null;

  if (result) {
    for (const m of result.models) {
      tokens.input += m.input;
      tokens.output += m.output;
      tokens.cacheRead += m.cacheRead;
      tokens.cacheCreate += m.cacheCreate;
    }
    // A result with turns but no modelUsage spent tokens nobody can count: unknown, which blocks.
    // PLA-I2-12: a signed-out Claude spent nothing; its missing usage must not block the next run.
    const signedOut = isSignedOut(result);
    usageKnown = result.hasModelUsage || result.numTurns === 0 || signedOut;
    if (!usageKnown) tokens = reader.liveTokens;
    turns = result.numTurns;
    const sid = result.sessionId ? `, session ${result.sessionId.slice(0, 8)}` : "";
    if (stopped) {
      status = "stopped";
      summary = `stopped: ${stopped} (${result.subtype}, ${turns} turns${sid})`;
    } else if (signedOut) {
      status = "fail";
      summary = `fail: signed out (${turns} turns${sid})`;
    } else if (result.isError || result.subtype !== "success") {
      status = "fail";
      summary = `fail: ${result.subtype} (${turns} turns${sid})`;
    } else {
      status = "ok";
      summary = `ok: ${result.subtype}, ${turns} turns${sid}`;
    }
    const report = deps.reportTokens ?? reportTokens;
    if (run.taskKey && usageKnown) {
      for (const m of result.models) {
        await report(
          db,
          {
            project: project.slug,
            agent: agent.slug,
            task_key: run.taskKey,
            run_id: `${run.id}/${m.model}`.slice(0, 120),
            model: m.model,
            input: m.input,
            output: m.output,
            cache_read: m.cacheRead,
            cache_create: m.cacheCreate,
            at: endedAt.toISOString(),
          },
          sysCtx("runner.report_tokens"),
        ).catch(() => undefined);
      }
    }
  } else {
    // No result event (exit 143 after SIGTERM, a crash): 0 tokens reported, not an error.
    // The week's usage still counts what the stream showed so far.
    tokens = reader.liveTokens;
    status = stopped ? "stopped" : "fail";
    summary = stopped ? `stopped: ${stopped} (no result)` : "fail: no result";
  }
  if (exit.timedOut && status !== "ok") summary = `${summary} after timeout`.slice(0, 500);

  // PLA-I46-12: a skill pack never reaches the app repo. One in the branch diff (or staged) fails the run.
  const consultaRun = run.lane === "consulta";
  const leaked = consultaRun ? [] : await packsInDiff(input.cwd, deps.git ?? defaultGit, startBranchOf(project.settings)).catch(() => [] as string[]);
  if (leaked.length > 0) {
    status = "fail";
    summary = `fail: pack file in the diff (${leaked.slice(0, 3).join(", ")}${leaked.length > 3 ? ", …" : ""})`;
  }

  const sessionId = result?.sessionId ?? reader.sessionId;
  // PLA-I60-6: the end and the lock release in one transaction (the load test saw a finished run holding keys).
  const finished = await db.transaction(async (tx) => {
    const rows = await tx
    .update(agentRuns)
    .set({
      status,
      summary: summary.slice(0, 500),
      endedAt,
      turns,
      claudeSessionId: sessionId,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheCreateTokens: tokens.cacheCreate,
      tokensTotal: totalOf(tokens),
      usageKnown,
      exitCode: exit.code,
      stopReason: input.stopReason,
      // AUDIT-2 / AUDIT-7: the skills the stream showed it using, and how much context its last turn carried.
      skillsUsed: [...reader.skillsUsed].sort().slice(0, 40),
      contextTokens: reader.contextTokens,
    })
    .where(and(eq(agentRuns.id, run.id), inArray(agentRuns.status, ["starting", "running"])))
    .returning({ id: agentRuns.id, absorbed: agentRuns.absorbed });
    if (rows.length) await releaseLocks(tx, run.id);
    return rows;
  });
  // PLA-I60-3: finishing is idempotent: a run another path already finished writes nothing more.
  if (finished.length === 0) return;
  // PLA-I67-4: which of the references it carried the run opened.
  await markOpened(db, run.id, reader.filesRead).catch(() => 0);

  // PLA-I67-6: a trial keeps its answer and what it changed in its copy, then the copy goes. Nothing else follows.
  const trialId = trialIdOfRun(run);
  if (trialId) {
    const git = deps.git ?? defaultGit;
    const diff = await trialResult(git, repoPathOf(project.slug, project.settings, deps.env ?? process.env), input.cwd).catch(() => null);
    await setTrial(db, trialId, { status: trialStatusOf(status), summary, afterOutput: result?.resultText?.trim().slice(0, 6000) || null, afterDiff: diff, finishedAt: endedAt });
    await db.insert(heartbeatRuns).values({ agentId: agent.id, startedAt: run.startedAt ?? run.queuedAt, endedAt, status: status === "stopped" ? "skipped" : status, adapter: RUNNER_ADAPTER, summary: summary.slice(0, 500), taskKey: null });
    await notifyQueue(db);
    return;
  }
  // PLA-I57-1: a question's run never replaces the PO's own session (it ran elsewhere, with a different prompt).
  if (sessionId && !consultaRun) {
    await db
      .insert(agentSessions)
      .values({ agentId: agent.id, projectId: project.id, workKey: run.workKey, claudeSessionId: sessionId, cwd: input.cwd, runs: 1 })
      .onConflictDoUpdate({
        target: [agentSessions.agentId, agentSessions.projectId, agentSessions.workKey],
        set: { claudeSessionId: sessionId, cwd: input.cwd, runs: sql`${agentSessions.runs} + 1`, updatedAt: sql`now()` },
      });
  }

  await db.insert(heartbeatRuns).values({
    agentId: agent.id,
    startedAt: run.startedAt ?? run.queuedAt,
    endedAt,
    status: status === "stopped" ? "skipped" : status,
    adapter: RUNNER_ADAPTER,
    summary: summary.slice(0, 500),
    taskKey: run.taskKey,
  });
  // PLA-155: a PO that wrote code on a «Hacerlo ya» ticket cannot commit it (its deny rules) and leaves it In progress.
  if (roleOf(agent) === "product-owner" && run.taskKey && !consultaRun) await handPoCodeToTaller(db, project, run.taskKey, input.cwd, deps.git ?? defaultGit).catch(() => null);
  // PLA-I40-6: a PO that ends well with another request waiting gets one wake for it. PLA-104: Taller too, for its
  // oldest unblocked Ready ticket.
  if (status === "ok") await wakePoIfWaiting(db, agent, { id: project.id, slug: project.slug }, run.taskKey, deps.env ?? process.env).catch(() => null);
  // PLA-I60-1: wakes that arrived for this work while it ran get one more run (a stopped run's work is the owner's call).
  const absorbed = finished[0]!.absorbed?.trim();
  if (absorbed && status !== "stopped") {
    await enqueueWake(db, {
      agent,
      project: { id: project.id, slug: project.slug },
      taskKey: run.taskKey,
      consultaId: consultaIdOfRun(run),
      reason: `events while you worked: ${absorbed}`.slice(0, 2000),
      trigger: "retry",
    }).catch(() => null);
  }
  await notifyQueue(db);
}

// PLA-155 (guided test 3): a PO run on a «Hacerlo ya» ticket wrote the code itself instead of handing it to Taller;
// its deny rules blocked the commit, the push and the PR, and the run ended «ok» with the ticket In progress and the
// change uncommitted in the ticket's worktree, which nobody could finish. When a PO run ends with its ticket still
// In progress and uncommitted changes there, the ticket goes to Taller (Ready, owned by Taller, with a note); the
// worktree is per ticket, so Taller finds the change and finishes it.
export async function handPoCodeToTaller(db: Db, project: Project, key: string, cwd: string, git: GitFn): Promise<boolean> {
  const [t] = await db
    .select({ key: tasks.key, kind: tasks.kind, status: tasks.status, owner: tasks.owner })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.key, key)))
    .limit(1);
  if (!t || t.kind !== "ticket" || t.status !== ST.inProgress || !t.owner?.session_id) return false;
  const st = await git(["status", "--porcelain"], cwd);
  const changed = st.code === 0 ? st.stdout.split("\n").filter((l) => l.trim()).map((l) => l.slice(3)) : [];
  if (changed.length === 0) return false;
  const ref = { id: project.id, slug: project.slug };
  const taller = await serviceAgent(db, "taller", ref);
  if (!taller) return false;
  // The run's own session gives the ticket back (In progress → Ready), as an expired runner lease does.
  const base = sysCtx("runner.po_code");
  await claim(db, { project: project.slug, key, action: "release" } as never, { ...base, system: false, actor: { ...t.owner, machine: hostname() } } as Ctx);
  const [now] = await db.select({ version: tasks.version }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, key))).limit(1);
  await setTask(
    db,
    {
      project: project.slug,
      key,
      version: now!.version,
      owner_agent: taller.slug,
      note: `El PO escribió el cambio pero no puede confirmarlo: pasa a Taller. En el worktree del ticket quedan sin confirmar: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ", …" : ""}. Revísalo, pruébalo, confírmalo y abre el PR.`,
    } as never,
    base,
  );
  await enqueueWake(db, { agent: taller, project: ref, taskKey: key, reason: "the PO left code it cannot commit", trigger: "event" });
  return true;
}

// ---- Stop live runs (kill switches)

// SIGINT now (the run saves its branch), SIGTERM and SIGKILL follow if it does not exit.
export function stopLive(filter: (run: { agentId: string; projectId: string; role: string }) => boolean, reason: string): number {
  let n = 0;
  for (const run of live.values()) {
    if (run.stopReason || !filter(run)) continue;
    run.stopReason = reason;
    run.proc.stop(reason);
    n += 1;
  }
  return n;
}

// PLA-I36-9: stop one run (Detener on Compañía), not its project. false when it is not live in this process.
export function stopRun(runId: string, reason = say(RUNNER_WORDS).stoppedFromCompany): boolean {
  const run = live.get(runId);
  // PLA-I60-3: a run another process supervises is stopped by that process (stop_requested, actOnStopRequests).
  if (!run) {
    void makeDb()
      .db.update(agentRuns)
      .set({ stopRequested: reason.slice(0, 200) })
      .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ["starting", "running"])))
      .catch(() => undefined);
    return false;
  }
  if (run.stopReason) return false;
  run.stopReason = reason;
  run.proc.stop(reason);
  return true;
}

// NEWPROJ-7: deleting a project stops every run of it this process supervises (the asistente's too) and waits
// until each has exited and written its end, so the rows go only after the processes are gone. A run that ignores
// SIGINT gets SIGTERM and SIGKILL from its supervisor; waitMs caps the wait. Returns how many were signalled.
export async function stopProjectRuns(projectId: string, reason: string, waitMs = 30_000): Promise<number> {
  const runs = [...live.values()].filter((run) => run.projectId === projectId);
  const n = stopLive((run) => run.projectId === projectId, reason);
  if (runs.length === 0) return n;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(runs.map((run) => run.finished)), new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  clearTimeout(timer);
  return n;
}

// Each tick: switches off stop the live runs in their scope. No token budgets (PLA-21).
export async function enforceLive(db: Db, _now: Date): Promise<number> {
  if (live.size === 0) return 0;
  const settings = await loadSettings(db);
  if (settings.companyPaused) return stopLive(() => true, "company paused");
  let n = 0;
  const projectIds = [...new Set([...live.values()].map((run) => run.projectId))];
  const rows = await db.select({ id: projects.id, slug: projects.slug, paused: projects.runsPaused }).from(projects).where(inArray(projects.id, projectIds));
  for (const p of rows) if (p.paused) n += stopLive((run) => run.projectId === p.id && run.role !== "asistente", `project ${p.slug} paused`);

  return n;
}

// ---- Server start: runs left by an earlier server (PLA-I60-3)
//
// A run this worker started through wrapper.mjs keeps going while the server restarts. At boot, each live row of
// this worker (or with no worker, from before 0060):
//   the wrapper wrote its exit file    finish it from the log and that file
//   the wrapper is still alive         attach to it: tail the log from the start, finish when it ends
//   neither                            the old rule: its process group gets SIGINT then SIGKILL, and the row ends
//                                      as fail: orphaned (tokens from the log's result event when there is one)
// Rows of another worker are that worker's. Queued rows stay queued: admission takes them as it always would.
export async function sweepOrphans(db: Db, deps: RunnerDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const me = workerId(env);
  const rows = await db.select().from(agentRuns).where(inArray(agentRuns.status, ["starting", "running"]));
  const kill = deps.kill ?? defaultKill;
  const probe = deps.probePid ?? defaultProbePid;
  const probeWrapper = deps.probeWrapper ?? isWrapperOf;
  const settings = await loadSettings(db);
  let n = 0;
  for (const run of rows) {
    if (live.has(run.id)) continue;
    if (run.workerId && run.workerId !== me) continue;
    const exitFile = run.logPath ? exitPathOf(run.logPath) : null;
    if (run.status === "running" && run.logPath && exitFile && (existsSync(exitFile) || (run.pid && (await probeWrapper(run.pid, run.id))))) {
      if (await reattach(db, run, deps, settings.timeoutMinutes * MINUTE)) {
        n += 1;
        continue;
      }
    }
    if (run.pid && (await probe(run.pid))) {
      kill(run.pid, "SIGINT");
      await new Promise((r) => setTimeout(r, deps.graceMs ?? 5_000));
      if (await probe(run.pid)) kill(run.pid, "SIGKILL");
    }
    let parsed: StreamReader | null = null;
    if (run.logPath && existsSync(run.logPath)) {
      try {
        parsed = parseStream(readFileSync(run.logPath, "utf8"));
      } catch {
        parsed = null;
      }
    }
    const result = parsed?.result ?? null;
    const tokens = result?.hasModelUsage
      ? result.models.reduce((a, m) => ({ input: a.input + m.input, output: a.output + m.output, cacheRead: a.cacheRead + m.cacheRead, cacheCreate: a.cacheCreate + m.cacheCreate }), {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreate: 0,
        })
      : (parsed?.liveTokens ?? { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
    const known = !!result?.hasModelUsage;
    const summary = run.status === "starting" ? "fail: start lost" : known ? "fail: orphaned (result kept)" : "fail: orphaned (usage unknown)";
    // PLA-I46-12: the dead run's packs leave its folder too.
    if (run.cwd && existsSync(run.cwd)) clearPacks(run.cwd);
    const ended = await db.transaction(async (tx) => {
      const rows = await tx
      .update(agentRuns)
      .set({
        status: "fail",
        summary,
        endedAt: new Date(),
        usageKnown: known,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheCreateTokens: tokens.cacheCreate,
        tokensTotal: totalOf(tokens),
        stopReason: "orphaned",
      })
      .where(and(eq(agentRuns.id, run.id), inArray(agentRuns.status, ["starting", "running"])))
      .returning({ id: agentRuns.id });
      if (rows.length) await releaseLocks(tx, run.id);
      return rows;
    });
    if (ended.length === 0) continue;
    await db.insert(heartbeatRuns).values({
      agentId: run.agentId,
      startedAt: run.startedAt ?? run.queuedAt,
      endedAt: new Date(),
      status: "fail",
      adapter: RUNNER_ADAPTER,
      summary,
      taskKey: run.taskKey,
    });
    n += 1;
  }
  return n;
}

// Follow a run found live (or already ended) after a restart, and finish it like any other.
async function reattach(db: Db, run: AgentRun, deps: RunnerDeps, timeoutMs: number): Promise<boolean> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1);
  if (!agent || !project || !run.logPath) return false;
  const reader = new StreamReader((reading) => {
    void recordReading(db, { ...reading, source: "stream", runId: run.id }).catch(() => undefined);
  });
  const left = Math.max(60_000, timeoutMs - (Date.now() - (run.startedAt ?? run.queuedAt).getTime()));
  const proc = attachDetached({ pid: run.pid, logPath: run.logPath, timeoutMs: left, graceMs: deps.graceMs ?? 30_000, pollMs: deps.pollMs, onStdout: liveFlusher(db, run.id, reader, deps.liveFlushMs ?? 5_000), kill: deps.kill ?? defaultKill });
  const cwd = run.cwd ?? "";
  const entry: LiveRun = { runId: run.id, agentId: agent.id, projectId: project.id, role: run.role, proc, finished: Promise.resolve(), stopReason: run.stopRequested };
  entry.finished = proc.done
    .then((exit) => finishRun(db, { run, agent, project, reader, exit, stopReason: entry.stopReason, cwd }, deps))
    .catch(() => undefined)
    .finally(() => {
      live.delete(run.id);
      rmSync(path.join(tmpDirOf(deps), run.id), { recursive: true, force: true });
      if (run.lane !== "consulta" && cwd && existsSync(cwd)) clearPacks(cwd);
    });
  live.set(run.id, entry);
  await db.update(agentRuns).set({ workerId: workerId(deps.env ?? process.env), leaseUntil: new Date(Date.now() + 2 * MINUTE) }).where(eq(agentRuns.id, run.id));
  return true;
}

// PLA-I60-3: every 30 s this worker says it is alive and renews the lease of each live run it supervises; every
// few seconds it acts on stops asked from any process (stop_requested). Lost workers are reaped in admission.
export async function renewWorker(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const me = workerId(env);
  await db
    .insert(runnerWorkers)
    .values({ id: me, machine: hostname(), capacity: workerCapacity(env), seenAt: new Date() })
    .onConflictDoUpdate({ target: runnerWorkers.id, set: { capacity: workerCapacity(env), seenAt: new Date(), machine: hostname() } });
  const ids = [...live.keys()];
  if (ids.length) await db.update(agentRuns).set({ leaseUntil: new Date(Date.now() + 2 * MINUTE), workerId: me }).where(and(inArray(agentRuns.id, ids), inArray(agentRuns.status, ["starting", "running"])));
}

export async function actOnStopRequests(db: Db): Promise<number> {
  const ids = [...live.keys()];
  if (ids.length === 0) return 0;
  const rows = await db.select({ id: agentRuns.id, why: agentRuns.stopRequested }).from(agentRuns).where(and(inArray(agentRuns.id, ids), sql`${agentRuns.stopRequested} is not null`));
  let n = 0;
  for (const r of rows) if (stopRun(r.id, r.why ?? "detenido")) n += 1;
  return n;
}

// ---- Worktree cleanup

// A runner worktree whose ticket is Merged, Released, Done or Won't do (and no run is live in it)
// is removed and its footprint released.
export async function cleanupWorktrees(db: Db, deps: RunnerDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const rows = await db.execute<{ path: string; slug: string; settings: Project["settings"]; key: string }>(sql`
    select distinct r.worktree_path as path, p.slug as slug, p.settings as settings, r.task_key as key
    from agent_runs r
    join projects p on p.id = r.project_id
    join tasks t on t.project_id = r.project_id and t.key = r.task_key
    where r.worktree_path is not null
      and t.status in (${sql.join(DONE_STATUSES.map((s) => sql`${s}`), sql`, `)})
      and not exists (select 1 from agent_runs x where x.worktree_path = r.worktree_path and x.status in ('queued', 'running'))`);
  let n = 0;
  for (const row of rows.rows) {
    if (!existsSync(row.path)) continue;
    const repo = repoPathOf(row.slug, row.settings, env);
    clearPacks(row.path);
    // PLA-I60-2: under the repo's git lock, and never while a run holds this folder.
    const removed = await withRepoLock(db, repo, async () => {
      const [busy] = await db.select({ k: runLocks.lockKey }).from(runLocks).where(eq(runLocks.lockKey, `cwd:${row.path}`)).limit(1);
      return busy ? false : removeWorktree({ repo, path: row.path }, carefulGit(deps.git ?? defaultGit));
    });
    if (!removed) continue;
    if (deps.footprints !== false) {
      await releaseFootprint(db, { project: row.slug, kind: "worktree", locator: row.path }, { ...sysCtx("runner.worktree"), actor: { ...sysCtx("runner.worktree").actor, session_id: `runner-cleanup` } }).catch(
        () => undefined,
      );
    }
    n += 1;
  }
  return n;
}

// ---- PLA-I60-6: run logs (and their exit files) older than 14 days go, except the newest 500.
export function pruneRunLogs(dir: string, now = new Date(), keep = 500, days = 14): number {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }
  const files = names.map((f) => ({ f, at: statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.at - a.at);
  const cutoff = now.getTime() - days * 24 * 60 * MINUTE;
  let n = 0;
  for (const { f, at } of files.slice(keep)) {
    if (at >= cutoff) continue;
    rmSync(path.join(dir, f), { force: true });
    rmSync(path.join(dir, `${f}.exit.json`), { force: true });
    n += 1;
  }
  return n;
}
export const runLogDir = (deps: RunnerDeps = {}): string => logDirOf(deps, deps.env ?? process.env);

// ---- The free /usage probe

export function defaultProbeUsage(env: NodeJS.ProcessEnv = process.env): () => Promise<string | null> {
  return () =>
    new Promise((resolve) => {
      const command = claudeCommand(null, env);
      const cwd = defaultRunTmpDir(env);
      mkdirSync(cwd, { recursive: true });
      execFile(command, ["-p", "/usage", "--output-format", "json", "--strict-mcp-config"], { cwd, env: childEnv(env), timeout: 60_000 }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed = JSON.parse(String(stdout)) as { result?: unknown; num_turns?: unknown };
          resolve(typeof parsed.result === "string" ? parsed.result : null);
        } catch {
          resolve(null);
        }
      });
    });
}

export const newRunId = (): string => randomUUID();
export type { PlanWindowReading };

// PLA-I73-4: a Taller step waiting in the queue (lanes full, or the machine busy) gets its worktree made now, with its
// modules cloned and, when stacked, cut from the step under it, so the run starts on a ready checkout. At most `limit`
// per tick; the footprint is the one start would register.
export async function prewarmQueued(db: Db, deps: RunnerDeps = {}, limit = 2): Promise<string[]> {
  const env = deps.env ?? process.env;
  const root = rootOf(deps, env);
  const rows = await db
    .select({ taskKey: agentRuns.taskKey, projectId: agentRuns.projectId, agentId: agentRuns.agentId })
    .from(agentRuns)
    .where(and(eq(agentRuns.status, "queued"), eq(agentRuns.role, "taller"), sql`${agentRuns.taskKey} is not null`))
    .orderBy(asc(agentRuns.queuedAt))
    .limit(20);
  const made: string[] = [];
  for (const r of rows) {
    if (made.length >= limit) break;
    const [project] = await db.select().from(projects).where(eq(projects.id, r.projectId)).limit(1);
    if (!project) continue;
    const [t] = await db.select({ id: tasks.id, key: tasks.key, branch: tasks.branch, status: tasks.status }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.key, r.taskKey!))).limit(1);
    if (!t || t.status !== ST.ready) continue;
    const target = worktreePathFor(root, project.slug, t.key);
    if (existsSync(target)) continue;
    const repo = repoPathOf(project.slug, project.settings, env);
    if (!existsSync(repo)) continue;
    const [agent] = await db.select({ slug: agents.slug }).from(agents).where(eq(agents.id, r.agentId)).limit(1);
    const stacked = await stackBaseOf(db, t.id);
    const from = stacked?.branch ?? (await earlyBaseOf(db, t.id))?.branch;
    const branch = t.branch?.trim() || branchFor(t.key, await workPatternOf(db, project.id));
    const out = await withRepoLock(db, repo, () =>
      ensureWorktree({ repo, root, project: project.slug, key: t.key, branch, base: startBranchOf(project.settings), ...(from ? { from } : {}) }, carefulGit(deps.git ?? defaultGit)),
    ).catch(() => null);
    if (!out?.ok || !out.created) continue;
    await cloneModules(repo, out.path).catch(() => false);
    if (deps.footprints !== false) {
      await registerFootprint(
        db,
        { project: project.slug, kind: "worktree", locator: out.path, purpose: `Runner worktree for ${t.key} (${agent?.slug ?? "taller"})`, teardown: `git -C ${repo} worktree remove ${out.path}`, task_key: t.key },
        { ...sysCtx("runner.worktree"), actor: { ...sysCtx("runner.worktree").actor, session_id: `runner-${agent?.slug ?? "taller"}` } },
      ).catch(() => undefined);
    }
    made.push(t.key);
  }
  return made;
}
