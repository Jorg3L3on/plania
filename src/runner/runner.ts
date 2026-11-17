// PLA-I29: the autonomous runner. A wake of a claude_code agent passes the checks (switches,
// coalescing, cooldown, goal, base branch, plan guard, cap), then starts one supervised
// `claude -p` in a worktree outside every repo. When it exits, its result is read: modelUsage goes
// to report_tokens per model, the turns/session/subtype to heartbeat_runs, the session to agent_sessions.
// Summaries never carry paths, env values, tokens or money.
import { canvasesRoot } from "../pedidos/frames.js";
import { resolveMotor } from "./motor.js";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import path from "node:path";
import { makeDb, type Db } from "../db/client.js";
import type { Agent, AgentRun, AdapterConfig, RunTrigger, Project } from "../db/schema.js";
import { registerFootprint, releaseFootprint } from "../mcp/footprint.js";
import { SYSTEM_ACTOR, WEB_ACTOR, type Ctx, type Q } from "../mcp/tx.js";
import { reportTokens, type ReportTokensInput } from "../mcp/usage.js";
import { storeOf, readerOf } from "../store/port.js";
import { lte, ne, notNull } from "../store/types.js";
import type { UnitOfWork } from "../store/types.js";
import { CONSULTA_DENY_RULES, QA_DENY_RULES, denySettings } from "./deny.js";
import { consultaById, consultaPrompt } from "../pedidos/consultas.js";
import { ACTIVE_STATUSES, activeRunOn, consultaIdOfRun, insertRun, notifyQueue, setQueueKick, workKeyOf } from "./queue.js";
import { runSession } from "./run-session.js";
import {
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
import { areasOverlap } from "../mcp/writes.js";
import { PREGUNTA_MARK } from "../captures/preguntas.js";
import { EVENT_SUMMARY, enqueueWake, wakePoIfWaiting } from "./events.js";
import { capacityFacts, capacityHold, agentFacts, agentHold, projectGoal } from "./hold.js";

export { projectGoal };
import { asistenteHome } from "./threads.js";
import { qaBriefFor } from "./qa.js";
import {
  COMPANY,
  PROMPT_DOCS,
  lastReading,
  loadSettings,
  planGuardSummary,
  planView,
  recordReading,
  roleOf,
  writeVia,
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
import { StreamReader, parseStream, parseUsageText, totalOf, type PlanWindowReading } from "./stream.js";
import { clearPacks, packLines, packsInDiff, packsOf, writePacks } from "./packs.js";
import { branchFor, checkBase, defaultGit, ensureWorktree, removeWorktree, repoPathOf, scratchPathFor, worktreePathFor, worktreeRoot, carefulGit, resetGitThrottleForTests, type GitFn } from "./worktree.js";
import { taskImagePaths } from "../pedidos/images.js";

export type ReadyWork = {
  project: string;
  key: string;
  title: string;
  priority: string | null;
  workType: string | null;
  ownerAgent: string | null;
};

export type RunnerDeps = {
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
const DONE_STATUSES = ["Merged", "Released", "Done", "Won't do"];
export const RUNNER_ADAPTER = "claude_code" as const;

// Serializes the checks and the start so two wakes never both take the last slot.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

// A company row written in the background (a reservation, a stop asked for a run another worker supervises): a
// write of its own that never fails its caller, also when no store is open.
const backgroundWrite = (fn: (uow: UnitOfWork) => Promise<unknown>): void => {
  void Promise.resolve()
    .then(() => storeOf(makeDb().db).write(COMPANY, {}, fn))
    .catch(() => undefined);
};

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
  const row = { label: reservation.label, slots: 1, holder, expiresAt: new Date(Date.now() + 3 * 60 * MINUTE) };
  backgroundWrite((uow) => uow.insert("runnerReservations", row));
  return true;
}

let reservationHolder: string | null = null;
export function releaseReservation(): void {
  reservation = null;
  const holder = reservationHolder;
  reservationHolder = null;
  if (holder) backgroundWrite((uow) => uow.delete("runnerReservations", { holder }));
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
  repoChains.clear();
  resetGitThrottleForTests();
}

const home = (env: NodeJS.ProcessEnv) => env.HOME || homedir();
const logDirOf = (deps: RunnerDeps, env: NodeJS.ProcessEnv) => deps.logDir ?? path.join(home(env), "Library", "Logs", "plania-runs");
const tmpDirOf = (deps: RunnerDeps) => deps.tmpDir ?? path.join(tmpdir(), "plania-runs");
const rootOf = (deps: RunnerDeps, env: NodeJS.ProcessEnv) => deps.worktreeRoot ?? worktreeRoot(env);
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

function claudeCommand(config: AdapterConfig | null, env: NodeJS.ProcessEnv): string {
  const named = config?.command_env;
  if (typeof named === "string" && ENV_NAME.test(named) && env[named]?.trim()) return env[named]!.trim();
  if (env.CLAUDE_CODE_BIN?.trim()) return env.CLAUDE_CODE_BIN.trim();
  return path.join(home(env), ".local", "bin", "claude");
}

const sysCtx = (tool: string): Ctx => ({ actor: { ...SYSTEM_ACTOR, machine: hostname() }, system: true, tool });

// A run's rows change in a serialized store write under the run's project: the write the handle is already in
// (admission), else one of their own.
const runWrite = <T>(q: Q, run: Pick<AgentRun, "projectId">, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> => writeVia(q, fn, run.projectId);

// ---- Context the checks read

type WakeContext = {
  agent: Agent;
  role: RunnerRole | null;
  project: Project | null;
  task: ReadyWork | null;
  taskRow: { branch: string | null; base: string | null } | null;
};

// PLA-I32-5: an agent's project is its team's (project_id); Asistente's is its home project (where its runs
// are recorded). Rows from before 0041: a capability that names a project, else po-<project>.
async function projectOfAgent(db: Q, agent: Agent): Promise<Project | null> {
  const r = readerOf(db);
  if (agent.projectId) return (await r.get("projects", { id: agent.projectId })) ?? null;
  if (roleOf(agent) === "asistente") return asistenteHome(db, process.env);
  const names = [...agent.capabilities, ...(agent.slug.startsWith("po-") ? [agent.slug.slice(3)] : [])];
  if (names.length === 0) return null;
  const [row] = await r.find("projects", { slug: names }, { orderBy: [{ column: "slug" }], limit: 1 });
  return row ?? null;
}

// The ticket's branch, and its base: its own, else its initiative's.
async function taskBranchInfo(db: Q, projectId: string, key: string): Promise<{ branch: string | null; base: string | null }> {
  const r = readerOf(db);
  const t = await r.get("tasks", { projectId, key });
  if (!t) return { branch: null, base: null };
  const parent = t.parentId ? await r.get("tasks", { id: t.parentId }) : undefined;
  return { branch: t.branch, base: t.baseBranch ?? parent?.baseBranch ?? null };
}

async function loadContext(db: Q, agent: Agent, task: ReadyWork | null): Promise<WakeContext> {
  const role = roleOf(agent);
  let project: Project | null = null;
  if (task) project = (await readerOf(db).get("projects", { slug: task.project })) ?? null;
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
// noCap (PLA-I60-2): admission checks the plan and the caps itself, inside its write.
async function preflight(db: Q, ctx: WakeContext, now: Date, deps: RunnerDeps, opts: { fromQueue?: string; skipRest?: boolean; pastGuard?: boolean; consulta?: boolean; trigger?: RunTrigger; noCap?: boolean } = {}): Promise<Preflight> {
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
  if (own?.code === "no_goal" && !opts.consulta) return { ok: false, kind: "skipped", summary: "skipped: no goal" };
  if (!task && role !== "product-owner" && role !== "asistente") return { ok: false, kind: "skipped", summary: "no ready work" };

  if (task) {
    const base = checkBase(ctx.taskRow?.branch ?? branchFor(task.key), ctx.taskRow?.base ?? null);
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
    const r = readerOf(db);
    const mine = await r.find("agentRuns", { agentId: input.agent.id, status: [...ACTIVE_STATUSES] }, { orderBy: [{ column: "queuedAt" }] });
    const onTask = input.task ? mine.filter((x) => x.workKey === workKeyOf(input.task!.key)) : mine;
    if (input.task ? onTask.some((x) => x.status !== "queued") : mine.length > 0 && mine.every((x) => x.status !== "queued")) return { kind: "busy" };
    const queued = onTask.find((x) => x.status === "queued") ?? null;
    if (!queued && !input.task) return { kind: "idle" };
    const task = queued ? (queued.taskKey ? await readyWorkOf(db, queued.projectId, queued.taskKey) : null) : input.task;
    const ctx = await loadContext(db, input.agent, task);
    if (!ctx.project && queued) ctx.project = (await r.get("projects", { id: queued.projectId })) ?? null;
    const pre = await preflight(db, ctx, input.now, deps, { skipRest: true, pastGuard: input.pastGuard, consulta: queued?.lane === "consulta" });
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
    const forced = run;
    await runWrite(db, { projectId: ctx.project!.id }, (uow) =>
      uow.insert("events", {
        projectId: ctx.project!.id,
        taskKey: forced.taskKey,
        type: "wake.forced",
        actor: WEB_ACTOR,
        payload: { agent: input.agent.slug, role: ctx.role, run_id: forced.id, past_guard: !!input.pastGuard },
      }),
    );
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
// Queued runs start here, from any process: one serialized store write decides which runs start (status starting,
// their lock keys taken, worker and lease set); the processes spawn after it commits. Checks, in order: the run's own
// verdict (switches, goal, base branch, the rest for cadence runs), the company ceiling minus reserved slots, this
// worker's capacity and the Mac's free memory and disk, the start rate, the plan guard (a stopped plan ends the run as
// before; a projection that would cross the guard holds it), the project's lane cap, the agent's cap, the lock keys,
// and overlapping areas for code runs. A run that waits keeps a held_code the screen reads. `only` admits one run (a
// wake or the owner's «Que empiece ya»); skipRest and pastGuard apply to it alone.
export type AdmitOptions = { only?: string; skipRest?: boolean; pastGuard?: boolean };
export type AdmitResult = {
  // How long the admission write ran (the load test's number).
  txMs?: number;
  // How long it waited in the store's write queue for other writes to finish.
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
};

// Queue order: questions first, then the owner's own asks, then the ticket's priority (none last), then the oldest.
const PRIORITY_ORDER = ["P0", "P1", "P2", "P3"];
const priorityRank = (p: string | null): number => {
  const i = PRIORITY_ORDER.indexOf(p ?? "");
  return i === -1 ? 9 : i + 1;
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
  // The free /usage probe runs outside the write.
  if (planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride).state === "unknown") await probeIfUnknown(db, deps, now);
  const machine = await machineFacts(deps, env);
  const worker = workerId(env);
  const capacity = workerCapacity(env);
  const minFreeMb = env.PLANIA_MIN_FREE_MB !== undefined ? Number(env.PLANIA_MIN_FREE_MB) : settings.minFreeMb;
  const root = rootOf(deps, env);

  type Admitted = { run: AgentRun; ctx: WakeContext };
  type Decided = { admitted: Admitted[]; outcomes: AdmitResult["outcomes"]; dropped: number };
  const txStart = performance.now();
  let lockedAt = txStart;
  // On main this was one transaction under an advisory lock. Here it is one serialized store write: every count,
  // check and lock key it reads cannot change before it writes. After a commit conflict the store runs it again, so
  // it starts from nothing each time and its result is used only once it committed.
  const decided = await storeOf(db).write(COMPANY, {}, async (uow): Promise<Decided> => {
    lockedAt = performance.now();
    const tx = uow.sql;
    const outcomes: AdmitResult["outcomes"] = new Map();
    let dropped = 0;
    await reapLostStarts(tx, now);
    await reapLostWorkers(tx, worker, now);
    await uow.delete("runnerReservations", { expiresAt: lte(now) });
    const c = await readCounters(tx, now, reservation ? 1 : 0);
    const reading = await lastReading(tx);

    // Queued runs (one, with `only`) whose not_before has passed, of a project that exists, with their ticket's
    // priority; at most 1000, in queue order.
    const projectById = new Map((await uow.find("projects")).map((p) => [p.id, p]));
    const waiting = (await uow.find("agentRuns", opts.only ? { status: "queued", id: opts.only } : { status: "queued" })).filter(
      (run) => projectById.has(run.projectId) && (!run.notBefore || run.notBefore.getTime() <= now.getTime()),
    );
    const keyed = waiting.filter((run) => run.taskKey !== null);
    const taskByKey = new Map(
      (keyed.length ? await uow.find("tasks", { projectId: [...new Set(keyed.map((run) => run.projectId))], key: [...new Set(keyed.map((run) => run.taskKey!))] }) : []).map((t) => [`${t.projectId}:${t.key}`, t]),
    );
    const queued = waiting
      .map((run) => ({ run, priority: run.taskKey ? (taskByKey.get(`${run.projectId}:${run.taskKey}`)?.priority ?? null) : null, slug: projectById.get(run.projectId)!.slug }))
      .sort(
        (a, b) =>
          Number(b.run.lane === "consulta") - Number(a.run.lane === "consulta") ||
          Number(b.run.trigger === "owner") - Number(a.run.trigger === "owner") ||
          priorityRank(a.priority) - priorityRank(b.priority) ||
          a.run.queuedAt.getTime() - b.run.queuedAt.getTime(),
      )
      .slice(0, 1000);
    // Round-robin over projects, starting after the one admitted last, so a busy project never starves the others.
    const rr = await uow.get("machineState", { key: "runner.rr" });
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
      outcomes.set(run.id, { kind: "held", code, summary: HOLD_SUMMARY[code] });
      // Written when the reason changes (the numbers in it move every pass; the screen reads live counts anyway).
      if (run.heldCode !== code) await uow.update("agentRuns", { id: run.id }, { heldCode: code, heldDetail: detail });
    };
    const holdRest = async (from: number, code: HeldCode, detail: Record<string, unknown>, lane?: string) => {
      const rest = ordered.slice(from).filter((q) => (!lane || q.run.lane === lane) && !outcomes.has(q.run.id));
      for (const q of rest) outcomes.set(q.run.id, { kind: "held", code, summary: HOLD_SUMMARY[code] });
      const ids = rest.filter((q) => q.run.heldCode !== code).map((q) => q.run.id);
      if (ids.length) await uow.update("agentRuns", { id: ids }, { heldCode: code, heldDetail: detail });
    };
    const stopped = new Set<string>(); // lanes a plan projection stopped
    let lastAdmitted: string | null = null;

    const agentIds = [...new Set(ordered.map((q) => q.run.agentId))];
    const agentById = new Map((agentIds.length ? await uow.find("agents", { id: agentIds }) : []).map((a) => [a.id, a]));
    for (const [n, q] of ordered.entries()) {
      const run = q.run;
      if (outcomes.has(run.id) || stopped.has(run.lane)) continue;
      // A full ceiling (or a slot reserved for the Morning brief) leaves the work queue as it is. The ceiling counts
      // work runs; questions have their own slots per project (PLA-50) and wait only while the brief holds its slot.
      const ceiling = settings.maxConcurrent - c.reserved;
      if (run.lane === "work" && c.work >= ceiling) {
        await holdRest(n, "ceiling", { running: c.work, cap: settings.maxConcurrent, reserved: c.reserved }, "work");
        // PLA-I41-3: the wake says the Morning brief holds the slot.
        if (c.reserved > 0) for (const id of ordered.slice(n).filter((x) => x.run.lane === "work").map((x) => x.run.id)) outcomes.set(id, { kind: "held", code: "ceiling", summary: `queued: slot reserved (${reservation?.label ?? "reserved"})` });
        stopped.add("work");
        continue;
      }
      if (run.lane === "consulta" && c.reserved > 0) {
        await hold(run, "ceiling", { running: c.work, cap: settings.maxConcurrent, reserved: c.reserved });
        outcomes.set(run.id, { kind: "held", code: "ceiling", summary: `queued: slot reserved (${reservation?.label ?? "reserved"})` });
        continue;
      }
      // The caps first: they need no read, and most of a long queue waits on them (load test, PLA-I60-6).
      const agent = agentById.get(run.agentId);
      if (!agent) continue;
      {
        const lim = projectLimits(projectById.get(run.projectId)?.settings?.runner);
        if (run.lane === "consulta" || agent.projectId) {
          const used = c.byProjectLane.get(`${run.projectId}:${run.lane}`) ?? 0;
          const cap = run.lane === "consulta" ? lim.consultaSlots : lim.maxConcurrent;
          if (used >= cap) {
            await hold(run, "project_cap", { running: used, cap, lane: run.lane });
            continue;
          }
        }
        if (run.lane === "work") {
          const used = c.byAgent.get(agent.id) ?? 0;
          const cap = agentCapOf(agent, lim);
          if (used >= cap) {
            await hold(run, "agent_cap", { running: used, cap });
            continue;
          }
        }
      }
      const task = run.taskKey ? await readyWorkOf(tx, run.projectId, run.taskKey) : null;
      const ctx = await loadContext(tx, agent, task);
      if (!ctx.project) ctx.project = (await uow.get("projects", { id: run.projectId })) ?? null;
      const mine = opts.only === run.id;
      const pre = await preflight(tx, ctx, now, deps, { fromQueue: run.id, consulta: run.lane === "consulta", trigger: run.trigger, skipRest: mine && opts.skipRest, noCap: true });
      if (!pre.ok && pre.summary === "skipped: cooldown") {
        await hold(run, "rest", {});
        continue;
      }
      if (!pre.ok) {
        await endWithoutProcess(tx, run, pre.kind === "fail" ? "fail" : "skipped", pre.summary, now);
        outcomes.set(run.id, { kind: "ended", status: pre.kind === "fail" ? "fail" : "skipped", summary: pre.summary });
        dropped += 1;
        continue;
      }
      // The plan: a stopped (or unknown) plan ends the run as it always did; requeueHeld queues it again later.
      const view = planView(reading, settings.planGuardPct, now, settings.guardOverride || (mine && !!opts.pastGuard));
      if (view.state === "unknown" || view.state === "stopped") {
        const summary = planGuardSummary(view);
        await endWithoutProcess(tx, run, "skipped", summary, now);
        outcomes.set(run.id, { kind: "ended", status: "skipped", summary });
        dropped += 1;
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
      const branch = task ? ctx.taskRow?.branch?.trim() || branchFor(task.key) : null;
      const cwd = run.lane === "consulta" ? null : task ? safePath(() => worktreePathFor(root, project.slug, task.key)) : scratchPathFor(root, project.slug, agent.slug);
      const keys = lockKeysOf({ projectId: project.id, taskKey: run.taskKey, branch: run.lane === "consulta" ? null : branch, cwd });
      // The run_locks primary key on main: a key another live run holds stops this one (takeLocks reads and inserts
      // in this same write).
      const taken = await takeLocks(tx, run.id, run.lane === "consulta" ? keys.filter((k) => !k.startsWith("task:")) : keys);
      if (!taken.ok) {
        await hold(run, "lock", { keys: taken.held });
        continue;
      }
      if (limits.serializeAreas && ctx.role === "taller" && task && (await areasClash(tx, project.id, task.key))) {
        await releaseLocks(tx, run.id);
        await hold(run, "areas", {});
        continue;
      }
      const [updated] = await uow.update(
        "agentRuns",
        { id: run.id, status: "queued" },
        { status: "starting", workerId: worker, leaseUntil: new Date(now.getTime() + 2 * MINUTE), startedAt: now, heldCode: null, heldDetail: null, planWeight: weight },
      );
      if (!updated) {
        await releaseLocks(tx, run.id);
        continue;
      }
      bump(c, { projectId: run.projectId, lane: run.lane, agentId: agent.id, team, weight }, worker, now);
      out.push({ run: updated, ctx });
      lastAdmitted = q.slug;
    }
    if (lastAdmitted) {
      const value = { project: lastAdmitted };
      if (rr) await uow.update("machineState", { key: "runner.rr" }, { value, updatedAt: uow.now });
      else await uow.insert("machineState", { key: "runner.rr", value });
    }
    return { admitted: out, outcomes, dropped };
  });

  result.txMs = performance.now() - lockedAt;
  result.waitMs = lockedAt - txStart;
  result.outcomes = decided.outcomes;
  result.dropped = decided.dropped;
  // Spawn outside the write, concurrently; git on one repo is serialized by its own lock (start).
  await Promise.all(
    decided.admitted.map(async ({ run, ctx }) => {
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

// One git writer per repo. On main a Postgres advisory lock held it across processes; the store has no such lock, so
// this serializes the git work of this process on each repo (carefulGit still retries git's own lock errors).
const repoChains = new Map<string, Promise<unknown>>();
async function withRepoLock<T>(_db: Db, repo: string, fn: () => Promise<T>): Promise<T> {
  const next = (repoChains.get(repo) ?? Promise.resolve()).then(fn, fn);
  const tail = next.catch(() => undefined);
  repoChains.set(repo, tail);
  void tail.then(() => {
    if (repoChains.get(repo) === tail) repoChains.delete(repo);
  });
  return next;
}

const safePath = (fn: () => string): string | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

// A code run waits while a live code run in the same project lists areas that overlap its ticket's.
async function areasClash(tx: Q, projectId: string, key: string): Promise<boolean> {
  const r = readerOf(tx);
  const a = (await r.get("tasks", { projectId, key }))?.areas ?? [];
  if (a.length === 0) return false;
  for (const o of await r.find("agentRuns", { projectId, status: ["starting", "running"], role: "taller", taskKey: ne(key) })) {
    const t = await r.get("tasks", { projectId: o.projectId, key: o.taskKey! });
    if (t && (t.areas ?? []).some((x) => a.some((y) => areasOverlap(x, y)))) return true;
  }
  return false;
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
// insertRun and finishRun kicks the queue (notifyQueue); this process admits (debounced). The heartbeat job still
// drains every minute as the fallback. Only the server with jobs on starts this.
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
  return () => {
    timers.forEach((t) => clearInterval(t));
    setQueueKick(() => {});
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
  const r = readerOf(db);
  const t = await r.get("tasks", { projectId, key });
  const p = t ? await r.get("projects", { id: t.projectId }) : undefined;
  if (!t || !p) return null;
  return { project: p.slug, key: t.key, title: t.title, priority: t.priority, workType: t.workType, ownerAgent: t.ownerAgent };
}

// The run ends, its lock keys go and its heartbeat row is written, in one write (admission's, when it ends there).
async function endWithoutProcess(db: Q, run: AgentRun, status: "skipped" | "fail", summary: string, now: Date): Promise<void> {
  await runWrite(db, run, async (uow) => {
    await uow.update("agentRuns", { id: run.id }, { status, summary: summary.slice(0, 500), endedAt: now, heldCode: null });
    await releaseLocks(uow.sql, run.id);
    await uow.insert("heartbeatRuns", {
      agentId: run.agentId,
      startedAt: run.queuedAt,
      endedAt: now,
      status,
      adapter: RUNNER_ADAPTER,
      summary: summary.slice(0, 500),
      taskKey: run.taskKey,
    });
  });
}

// ---- Start

export function userPrompt(input: {
  agent: string;
  role: string;
  project: { slug: string; title: string };
  goal: { title: string; why: string } | null;
  task: { key: string; title: string } | null;
  workspace: { path: string; branch: string | null } | null;
  sessionId: string;
  reason?: string | null;
  // PLA-I46-12: the skill packs this role carries, their one line and where the body was written.
  packs?: { name: string; when: string; file: string }[];
  // PLA-I54-2: absolute paths of the pictures Jorge attached to the request (src/pedidos/images.ts).
  images?: string[];
}): string {
  const company = input.role === "asistente";
  const lines = [
    company
      ? `You are ${input.agent} (asistente), the company's chief of staff, woken by the Plania runner. Your runs are recorded in project ${input.project.slug}.`
      : `You are ${input.agent} (${input.role}) for project ${input.project.slug} (${input.project.title}), woken by the Plania runner.`,
    input.goal ? `Project goal: ${input.goal.title}${input.goal.why ? ` (why: ${input.goal.why})` : ""}` : "Project goal: none set.",
    input.task ? `Ticket: ${input.task.key}: ${input.task.title}` : "Ticket: none. Read the project in Plania (get_resume) and take the next step toward the goal.",
  ];
  if (company) lines.splice(1, 2, input.task ? `Ticket: ${input.task.key}: ${input.task.title}` : "Ticket: none. Read the company thread (thread_read company) first.");
  if (input.reason) lines.push(`Why you woke: ${input.reason}.`);
  // PLA-I32-3/5: the conversation is where Jorge reads you.
  lines.push(
    company
      ? "Answer Jorge in the company thread with thread_post (thread company); write in a project's thread when it is about that project. Never merge anything."
      : `End the run with one line in your project's thread (thread_post, thread ${input.project.slug}): what you did, with a link to it, and what you need.`,
  );
  if (input.workspace) {
    lines.push(`Workspace: ${input.workspace.path}${input.workspace.branch ? ` on branch ${input.workspace.branch}` : ""}, base sandbox.`);
  }
  lines.push(...packLines(input.packs ?? []));
  if (input.images?.length) {
    lines.push("Pictures Jorge attached to this request (open each one with the Read tool before you answer):", ...input.images.map((p) => `- ${p}`));
  }
  // PLA-I49-6: an idea (PREFIX-IDEA<n>) is not a ticket and start refuses it. Research and Artist woken on an idea's
  // stage work on the idea itself: read it, write the stage doc on it, move its stage.
  const idea = !!input.task && /-IDEA\d+$/.test(input.task.key);
  lines.push(
    idea
      ? `This is an idea, not a ticket: do not call start or claim on it. Read it with get_task, write your stage doc on it with attach_doc (key ${input.task!.key}), then move its stage with set_task.`
      : `Plania first: open the ticket with start (actor session_id ${input.sessionId}, that workspace) before you touch code.`,
    "Never main: commit on your branch, open PRs into sandbox only, never merge. Stop when the ticket is In review or when only Jorge can decide (ask).",
  );
  // PLA-I61-2 (La idea abierta): the owner sees the design on the screen only through its frames in Plania.
  if (idea && input.role === "artist") {
    lines.push(
      `Draw the canvas under ${canvasesRoot()}/${input.task!.key}/, export one PNG per frame, and put them on the idea with attach_frames (key ${input.task!.key}): each frame's id (T, A1, B3), name, group, what it does (hace) and why (porque), in order. Jorge sees the design only through those frames, then writes the Design doc with attach_doc as usual.`,
    );
  }
  return lines.join("\n");
}

async function promptDoc(db: Db, role: RunnerRole, env: NodeJS.ProcessEnv): Promise<string | null> {
  const slug = env.PLANIA_PROMPTS_PROJECT || "plania";
  const r = readerOf(db);
  const p = await r.get("projects", { slug });
  const doc = p ? await r.get("docs", { projectId: p.id, taskId: null, title: PROMPT_DOCS[role] }) : undefined;
  return doc?.markdown ?? null;
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
  return args;
}

// Plania only. The token stays in the child env; the file names the variable, never the value.
export const mcpConfig = (url: string) => ({
  mcpServers: { plania: { type: "http", url, headers: { Authorization: "Bearer ${PLANIA_RUNNER_TOKEN}" } } },
});

// The stream's running totals reach agent_runs every few seconds while the run is live.
function liveFlusher(db: Db, run: Pick<AgentRun, "id" | "projectId">, reader: StreamReader, every: number): (chunk: string) => void {
  let last = 0;
  return (chunk) => {
    reader.feed(chunk);
    if (Date.now() - last < every) return;
    last = Date.now();
    const t = reader.liveTokens;
    // Only while the row still says running: a run that already ended keeps its final counts.
    void runWrite(db, run, (uow) =>
      uow.update(
        "agentRuns",
        { id: run.id, status: "running" },
        { turns: reader.liveTurns, inputTokens: t.input, outputTokens: t.output, cacheReadTokens: t.cacheRead, cacheCreateTokens: t.cacheCreate, tokensTotal: totalOf(t) },
      ),
    ).catch(() => undefined);
  };
}

async function start(db: Db, run: AgentRun, ctx: WakeContext, deps: RunnerDeps): Promise<WakeOutcome> {
  const env = deps.env ?? process.env;
  const project = ctx.project!;
  const role = ctx.role!;
  const taskKey = run.taskKey;
  const fail = async (summary: string): Promise<WakeOutcome> => {
    await endWithoutProcess(db, run, "fail", summary, new Date());
    return { kind: "fail", summary, taskKey, recorded: true };
  };

  const token = env.PLANIA_RUNNER_TOKEN?.trim();
  if (!token) return fail("fail: missing env PLANIA_RUNNER_TOKEN");
  const settings = await loadSettings(db);
  const root = rootOf(deps, env);
  // PLA-I57-1: a question from Preguntar. Read-only, in the project's own checkout, fresh session, no packs.
  const consultaId = consultaIdOfRun(run);
  const consulta = consultaId ? await consultaById(db, consultaId) : null;

  // Where the run works: the ticket's worktree, or a scratch folder for a PO with no ticket.
  let cwd: string;
  let worktree: string | null = null;
  let branch: string | null = null;
  if (ctx.task) {
    const repo = repoPathOf(project.slug, project.settings, env);
    const wanted = ctx.taskRow?.branch?.trim() || branchFor(ctx.task.key);
    // PLA-I60-2: one git writer per repo (withRepoLock), with lock errors retried.
    const made = await withRepoLock(db, repo, () => ensureWorktree({ repo, root, project: project.slug, key: ctx.task!.key, branch: wanted }, carefulGit(deps.git ?? defaultGit)));
    if (!made.ok) {
      if (made.summary === "fail: no repo" && role !== "taller") {
        cwd = scratchPathFor(root, project.slug, ctx.agent.slug);
        mkdirSync(cwd, { recursive: true });
      } else return fail(made.summary.startsWith("fail: base") ? "fail: base not allowed" : made.summary);
    } else {
      cwd = made.path;
      worktree = made.path;
      branch = made.branch;
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
    cwd = repoPathOf(project.slug, project.settings, env);
  } else {
    cwd = scratchPathFor(root, project.slug, ctx.agent.slug);
    mkdirSync(cwd, { recursive: true });
  }

  // Resume this agent's session on this work in this project, only in the folder it ran in.
  const session = await readerOf(db).get("agentSessions", { agentId: ctx.agent.id, projectId: project.id, workKey: run.workKey });
  // PLA-I46-9: a QA run is always a fresh session, so its review has not seen anyone's earlier reasoning.
  const qa = role === "qa" ? await qaBriefFor(db, run.id, cwd) : null;
  const resume = !qa && !consulta && session && session.cwd === cwd ? session.claudeSessionId : null;

  const tmp = path.join(tmpDirOf(deps), run.id);
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  let systemPromptPath: string | null = null;
  if (!resume) {
    const markdown = await promptDoc(db, role, env);
    if (!markdown) {
      rmSync(tmp, { recursive: true, force: true });
      return fail(`fail: no prompt doc (${PROMPT_DOCS[role]})`);
    }
    systemPromptPath = path.join(tmp, "role-prompt.md");
    writeFileSync(systemPromptPath, markdown, { mode: 0o600 });
  }
  const settingsPath = path.join(tmp, "settings.json");
  // PLA-I52-6: a run that answers the owner's question about a delivery reads only, like QA.
  const asks = (run.reason ?? "").includes(PREGUNTA_MARK);
  if (asks) {
    const h = await (deps.git ?? defaultGit)(["rev-parse", "HEAD"], cwd).catch(() => null);
    askHeads.set(run.id, h && h.code === 0 ? h.stdout.trim() : null);
  }
  writeFileSync(settingsPath, JSON.stringify(denySettings(consulta ? CONSULTA_DENY_RULES : role === "qa" || asks ? QA_DENY_RULES : [])), { mode: 0o600 });
  const mcpConfigPath = path.join(tmp, "mcp.json");
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig(env.PLANIA_MCP_URL || "http://127.0.0.1:3737/mcp")), { mode: 0o600 });

  // PLA-I46-12: only this role's packs, written fresh (whatever an earlier run left is cleared first).
  const packs = consulta ? [] : writePacks(cwd, await packsOf(db, ctx.agent, env));

  const goal = await projectGoal(db, project.id);
  const planiaSession = runSession(run.id);
  const prompt = consulta
    ? consultaPrompt({ agent: ctx.agent.name, project: { slug: project.slug, title: project.title }, consulta, cwd, sessionId: planiaSession })
    : qa?.prompt ?? userPrompt({
    agent: ctx.agent.name,
    role,
    project: { slug: project.slug, title: project.title },
    goal,
    task: ctx.task ? { key: ctx.task.key, title: ctx.task.title } : null,
    workspace: { path: cwd, branch },
    sessionId: planiaSession,
    reason: run.reason?.trim() || null,
    packs,
    images: ctx.task ? await taskImagePaths(db, project.id, ctx.task.key).catch(() => []) : [],
  });
  // PLA-I59-1: the motor this run asks for (QA lane > the seat, or its Preguntar values > the company > none).
  const motor = resolveMotor({
    qaModel: qa?.model ?? null,
    consulta: !!consulta,
    seat: { model: ctx.agent.motorModel, effort: ctx.agent.motorEffort, consultaModel: ctx.agent.consultaModel, consultaEffort: ctx.agent.consultaEffort },
    company: { model: settings.defaultModel, effort: settings.defaultEffort },
  });
  const args = claudeArgs({ prompt, settingsPath, mcpConfigPath, systemPromptPath, maxTurns: consulta ? Math.min(settings.maxTurns, 40) : settings.maxTurns, resume, model: motor.model, effort: motor.effort });
  const command = claudeCommand(ctx.agent.adapterConfig, env);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDirOf(deps, env), `${stamp}-${ctx.agent.slug}-${run.id.slice(0, 8)}.jsonl`);
  const startedAt = new Date();

  // Plan readings are written as they stream; the run's end waits for them, so the next wake reads them.
  const readings: Promise<unknown>[] = [];
  const reader = new StreamReader((reading) => {
    readings.push(recordReading(db, { ...reading, source: "stream", runId: run.id }).catch(() => undefined));
  });
  const onStdout = liveFlusher(db, run, reader, deps.liveFlushMs ?? 5_000);
  // PLA-I60-3: the real runner starts the run through wrapper.mjs, detached, so it outlives a server restart. Tests
  // that inject spawn keep the piped child.
  const supervised = {
    command,
    args,
    cwd,
    env: childEnv(env, { PLANIA_RUNNER_TOKEN: token }),
    logPath,
    timeoutMs: deps.timeoutMs ?? settings.timeoutMinutes * MINUTE,
    graceMs: deps.graceMs ?? 30_000,
    kill: deps.kill ?? defaultKill,
    onStdout,
  };
  const proc = (deps.detached ?? !deps.spawn)
    ? superviseDetached({ ...supervised, runId: run.id, spawnDetached: deps.spawnDetached, pollMs: deps.pollMs })
    : supervise({ ...supervised, spawn: deps.spawn ?? defaultSpawn });

  await runWrite(db, run, (uow) =>
    uow.update(
      "agentRuns",
      { id: run.id },
      {
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
      },
    ),
  );

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
    await runWrite(db, run, (uow) =>
      uow.insert("events", { projectId: project.id, taskKey: run.taskKey, type: "probador.answer_moved_head", actor: { agent: "plania", session_id: "plania-probador" }, payload: { run_id: run.id, before: heads.before, after: heads.after } }),
    ).catch(() => undefined);
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
    usageKnown = result.hasModelUsage || result.numTurns === 0;
    if (!usageKnown) tokens = reader.liveTokens;
    turns = result.numTurns;
    const sid = result.sessionId ? `, session ${result.sessionId.slice(0, 8)}` : "";
    if (stopped) {
      status = "stopped";
      summary = `stopped: ${stopped} (${result.subtype}, ${turns} turns${sid})`;
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
  const leaked = consultaRun ? [] : await packsInDiff(input.cwd, deps.git ?? defaultGit).catch(() => [] as string[]);
  if (leaked.length > 0) {
    status = "fail";
    summary = `fail: pack file in the diff (${leaked.slice(0, 3).join(", ")}${leaked.length > 3 ? ", …" : ""})`;
  }

  const sessionId = result?.sessionId ?? reader.sessionId;
  // PLA-I60-6: the end and the lock release in one write (the load test saw a finished run holding keys); the
  // session and the heartbeat row go in that same write.
  const finished = await runWrite(db, run, async (uow) => {
    const rows = await uow.update(
      "agentRuns",
      // PLA-I60-3: finishing is idempotent: a run another path already finished writes nothing more.
      { id: run.id, status: ["starting", "running"] },
      {
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
      },
    );
    if (rows.length === 0) return rows;
    await releaseLocks(uow.sql, run.id);
    // PLA-I57-1: a question's run never replaces the PO's own session (it ran elsewhere, with a different prompt).
    if (sessionId && !consultaRun) {
      const key = { agentId: agent.id, projectId: project.id, workKey: run.workKey };
      const session = await uow.get("agentSessions", key);
      if (session) await uow.update("agentSessions", key, { claudeSessionId: sessionId, cwd: input.cwd, runs: session.runs + 1, updatedAt: uow.now });
      else await uow.insert("agentSessions", { ...key, claudeSessionId: sessionId, cwd: input.cwd, runs: 1 });
    }
    await uow.insert("heartbeatRuns", {
      agentId: agent.id,
      startedAt: run.startedAt ?? run.queuedAt,
      endedAt,
      status: status === "stopped" ? "skipped" : status,
      adapter: RUNNER_ADAPTER,
      summary: summary.slice(0, 500),
      taskKey: run.taskKey,
    });
    return rows;
  });
  if (finished.length === 0) return;

  // PLA-I40-6: a PO that ends well with another request waiting gets one wake for it.
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
export function stopRun(runId: string, reason = "detenido desde Compañía"): boolean {
  const run = live.get(runId);
  // PLA-I60-3: a run another process supervises is stopped by that process (stop_requested, actOnStopRequests).
  if (!run) {
    backgroundWrite((uow) => uow.update("agentRuns", { id: runId, status: ["starting", "running"] }, { stopRequested: reason.slice(0, 200) }));
    return false;
  }
  if (run.stopReason) return false;
  run.stopReason = reason;
  run.proc.stop(reason);
  return true;
}

// Each tick: switches off stop the live runs in their scope. No token budgets (PLA-21).
export async function enforceLive(db: Db, _now: Date): Promise<number> {
  if (live.size === 0) return 0;
  const settings = await loadSettings(db);
  if (settings.companyPaused) return stopLive(() => true, "company paused");
  let n = 0;
  const projectIds = [...new Set([...live.values()].map((run) => run.projectId))];
  const rows = await readerOf(db).find("projects", { id: projectIds });
  for (const p of rows) if (p.runsPaused) n += stopLive((run) => run.projectId === p.id && run.role !== "asistente", `project ${p.slug} paused`);

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
  const rows = await readerOf(db).find("agentRuns", { status: ["starting", "running"] });
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
    // The end, the lock release and the heartbeat row in one write, only while the row is still live.
    const ended = await runWrite(db, run, async (uow) => {
      const rows = await uow.update(
        "agentRuns",
        { id: run.id, status: ["starting", "running"] },
        {
          status: "fail",
          summary,
          endedAt: uow.now,
          usageKnown: known,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          cacheReadTokens: tokens.cacheRead,
          cacheCreateTokens: tokens.cacheCreate,
          tokensTotal: totalOf(tokens),
          stopReason: "orphaned",
        },
      );
      if (rows.length === 0) return rows;
      await releaseLocks(uow.sql, run.id);
      await uow.insert("heartbeatRuns", {
        agentId: run.agentId,
        startedAt: run.startedAt ?? run.queuedAt,
        endedAt: uow.now,
        status: "fail",
        adapter: RUNNER_ADAPTER,
        summary,
        taskKey: run.taskKey,
      });
      return rows;
    });
    if (ended.length === 0) continue;
    n += 1;
  }
  return n;
}

// Follow a run found live (or already ended) after a restart, and finish it like any other.
async function reattach(db: Db, run: AgentRun, deps: RunnerDeps, timeoutMs: number): Promise<boolean> {
  const r = readerOf(db);
  const agent = await r.get("agents", { id: run.agentId });
  const project = await r.get("projects", { id: run.projectId });
  if (!agent || !project || !run.logPath) return false;
  const reader = new StreamReader((reading) => {
    void recordReading(db, { ...reading, source: "stream", runId: run.id }).catch(() => undefined);
  });
  const left = Math.max(60_000, timeoutMs - (Date.now() - (run.startedAt ?? run.queuedAt).getTime()));
  const proc = attachDetached({ pid: run.pid, logPath: run.logPath, timeoutMs: left, graceMs: deps.graceMs ?? 30_000, pollMs: deps.pollMs, onStdout: liveFlusher(db, run, reader, deps.liveFlushMs ?? 5_000), kill: deps.kill ?? defaultKill });
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
  await runWrite(db, run, (uow) => uow.update("agentRuns", { id: run.id }, { workerId: workerId(deps.env ?? process.env), leaseUntil: new Date(uow.now.getTime() + 2 * MINUTE) }));
  return true;
}

// PLA-I60-3: every 30 s this worker says it is alive and renews the lease of each live run it supervises; every
// few seconds it acts on stops asked from any process (stop_requested). Lost workers are reaped in admission.
export async function renewWorker(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const me = workerId(env);
  await storeOf(db).write(COMPANY, {}, async (uow) => {
    const seen = { machine: hostname(), capacity: workerCapacity(env), seenAt: uow.now };
    if (await uow.get("runnerWorkers", { id: me })) await uow.update("runnerWorkers", { id: me }, seen);
    else await uow.insert("runnerWorkers", { id: me, ...seen });
    const ids = [...live.keys()];
    if (ids.length) await uow.update("agentRuns", { id: ids, status: ["starting", "running"] }, { leaseUntil: new Date(uow.now.getTime() + 2 * MINUTE), workerId: me });
  });
}

export async function actOnStopRequests(db: Db): Promise<number> {
  const ids = [...live.keys()];
  if (ids.length === 0) return 0;
  const rows = await readerOf(db).find("agentRuns", { id: ids, stopRequested: notNull() });
  let n = 0;
  for (const r of rows) if (stopRun(r.id, r.stopRequested ?? "detenido")) n += 1;
  return n;
}

// ---- Worktree cleanup

// A runner worktree whose ticket is Merged, Released, Done or Won't do (and no run is live in it)
// is removed and its footprint released.
export async function cleanupWorktrees(db: Db, deps: RunnerDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  // Each worktree of a run whose ticket is closed, once per (worktree, project, ticket), unless a queued or
  // running run uses it.
  const r = readerOf(db);
  const runs = await r.find("agentRuns");
  const busy = new Set(runs.filter((x) => x.worktreePath !== null && (x.status === "queued" || x.status === "running")).map((x) => x.worktreePath));
  const seen = new Set<string>();
  const rows: { path: string; slug: string; settings: Project["settings"]; key: string }[] = [];
  for (const run of runs) {
    if (run.worktreePath === null || run.taskKey === null || busy.has(run.worktreePath)) continue;
    const p = await r.get("projects", { id: run.projectId });
    const t = p ? await r.get("tasks", { projectId: run.projectId, key: run.taskKey }) : undefined;
    if (!p || !t || !DONE_STATUSES.includes(t.status)) continue;
    const id = JSON.stringify([run.worktreePath, p.slug, run.taskKey]);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ path: run.worktreePath, slug: p.slug, settings: p.settings, key: run.taskKey });
  }
  let n = 0;
  for (const row of rows) {
    if (!existsSync(row.path)) continue;
    const repo = repoPathOf(row.slug, row.settings, env);
    clearPacks(row.path);
    // PLA-I60-2: under the repo's git lock, and never while a run holds this folder.
    const removed = await withRepoLock(db, repo, async () => {
      const held = await readerOf(db).get("runLocks", { lockKey: `cwd:${row.path}` });
      return held ? false : removeWorktree({ repo, path: row.path }, carefulGit(deps.git ?? defaultGit));
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
      const cwd = path.join(tmpdir(), "plania-runs");
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
