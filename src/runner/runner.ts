// PLA-I29: the autonomous runner. A wake of a claude_code agent passes the checks (switches,
// coalescing, cooldown, goal, base branch, budgets, plan guard, cap), then starts one supervised
// `claude -p` in a worktree outside every repo. When it exits, its result is read: modelUsage goes
// to report_tokens per model, the turns/session/subtype to heartbeat_runs, the session to agent_sessions.
// Summaries never carry paths, env values, tokens or money.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  agentRuns,
  agentSessions,
  agents,
  docs,
  goals,
  heartbeatRuns,
  projects,
  tasks,
  type Agent,
  type AgentRun,
  type AdapterConfig,
  type Project,
} from "../db/schema.js";
import { registerFootprint, releaseFootprint } from "../mcp/footprint.js";
import { SYSTEM_ACTOR, writeTx, type Ctx } from "../mcp/tx.js";
import { reportTokens, type ReportTokensInput } from "../mcp/usage.js";
import { denySettings } from "./deny.js";
import { EVENT_SUMMARY } from "./events.js";
import { asistenteHome } from "./threads.js";
import {
  PROMPT_DOCS,
  budgetGate,
  budgetLimit,
  budgetState,
  budgetUsage,
  budgetView,
  lastReading,
  loadSettings,
  planGuardSummary,
  planView,
  recordReading,
  roleOf,
  scopeWhere,
  weekBounds,
  type RunnerRole,
} from "./limits.js";
import { childEnv, defaultKill, defaultProbePid, defaultSpawn, supervise, type ExitInfo, type KillFn, type ProbePid, type SpawnFn, type Supervised } from "./process.js";
import { StreamReader, parseStream, parseUsageText, totalOf, type PlanWindowReading } from "./stream.js";
import { branchFor, checkBase, defaultGit, ensureWorktree, removeWorktree, repoPathOf, scratchPathFor, worktreeRoot, type GitFn } from "./worktree.js";

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
  lastProbeAt = 0;
  chain = Promise.resolve();
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
async function projectOfAgent(db: Db, agent: Agent): Promise<Project | null> {
  if (agent.projectId) return (await db.select().from(projects).where(eq(projects.id, agent.projectId)).limit(1))[0] ?? null;
  if (roleOf(agent) === "asistente") return asistenteHome(db, process.env);
  const names = [...agent.capabilities, ...(agent.slug.startsWith("po-") ? [agent.slug.slice(3)] : [])];
  if (names.length === 0) return null;
  const [row] = await db.select().from(projects).where(inArray(projects.slug, names)).orderBy(asc(projects.slug)).limit(1);
  return row ?? null;
}

async function taskBranchInfo(db: Db, projectId: string, key: string): Promise<{ branch: string | null; base: string | null }> {
  const rows = await db.execute<{ branch: string | null; base: string | null }>(sql`
    select t.branch as branch, coalesce(t.base_branch, p.base_branch) as base
    from tasks t left join tasks p on p.id = t.parent_id
    where t.project_id = ${projectId} and t.key = ${key} limit 1`);
  return rows.rows[0] ?? { branch: null, base: null };
}

export async function projectGoal(db: Db, projectId: string): Promise<{ title: string; why: string } | null> {
  const [row] = await db
    .select({ title: goals.title, why: goals.why })
    .from(goals)
    .where(and(eq(goals.projectId, projectId), eq(goals.status, "active")))
    .orderBy(asc(goals.position), asc(goals.createdAt))
    .limit(1);
  return row ?? null;
}

async function loadContext(db: Db, agent: Agent, task: ReadyWork | null): Promise<WakeContext> {
  const role = roleOf(agent);
  let project: Project | null = null;
  if (task) project = (await db.select().from(projects).where(eq(projects.slug, task.project)).limit(1))[0] ?? null;
  else project = await projectOfAgent(db, agent);
  const taskRow = task && project ? await taskBranchInfo(db, project.id, task.key) : null;
  return { agent, role, project: project ?? null, task, taskRow };
}

// ---- Checks

type Preflight = { ok: true; warn: { scope: string; pct: number }[]; reserve: number } | { ok: false; kind: "skipped" | "fail" | "cap"; summary: string };

async function probeIfUnknown(db: Db, deps: RunnerDeps, now: Date): Promise<void> {
  if (Date.now() - lastProbeAt < PROBE_EVERY_MS) return;
  lastProbeAt = Date.now();
  const probe = deps.probeUsage ?? defaultProbeUsage(deps.env ?? process.env);
  const text = await probe().catch(() => null);
  const reading = text ? parseUsageText(text) : null;
  if (reading) await recordReading(db, { ...reading, source: "usage_probe", at: now });
}

async function runningCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(eq(agentRuns.status, "running"));
  return row?.n ?? 0;
}

async function preflight(db: Db, ctx: WakeContext, now: Date, deps: RunnerDeps, opts: { fromQueue?: string } = {}): Promise<Preflight> {
  const settings = await loadSettings(db);
  const { agent, role, project, task } = ctx;
  if (!project) return { ok: false, kind: "skipped", summary: "skipped: no project" };
  if (settings.companyPaused) return { ok: false, kind: "skipped", summary: "skipped: company paused" };
  if (!role) return { ok: false, kind: "skipped", summary: "skipped: no runner role" };
  // Asistente works for the company: only the company switch holds it, not its home project's.
  if (project.runsPaused && role !== "asistente") return { ok: false, kind: "skipped", summary: `skipped: project ${project.slug} paused` };

  if (settings.cooldownMinutes > 0) {
    const [last] = await db
      .select({ endedAt: agentRuns.endedAt })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, agent.id), sql`${agentRuns.endedAt} is not null`, sql`${agentRuns.status} <> 'skipped'`))
      .orderBy(desc(agentRuns.endedAt))
      .limit(1);
    if (last?.endedAt && now.getTime() - last.endedAt.getTime() < settings.cooldownMinutes * MINUTE) {
      return { ok: false, kind: "skipped", summary: "skipped: cooldown" };
    }
  }

  if (role === "product-owner" && !(await projectGoal(db, project.id))) return { ok: false, kind: "skipped", summary: "skipped: no goal" };
  if (!task && role !== "product-owner" && role !== "asistente") return { ok: false, kind: "skipped", summary: "no ready work" };

  if (task) {
    const base = checkBase(ctx.taskRow?.branch ?? branchFor(task.key), ctx.taskRow?.base ?? null);
    if (!base.ok) return { ok: false, kind: "fail", summary: "fail: base not allowed" };
  }

  const { startsAt } = await weekBounds(db, now);
  const reserve = settings.reserveTokens;
  // PLA-I32-5: one budget per run: Asistente's own, or the project's (its team shares it). Role caps are retired.
  const budget = budgetGate(
    role === "asistente"
      ? [{ label: "asistente", view: await budgetView(db, { kind: "asistente" }, startsAt) }]
      : [{ label: `project ${project.slug}`, view: await budgetView(db, { kind: "project", projectId: project.id }, startsAt) }],
    reserve,
  );
  if (!budget.ok) return { ok: false, kind: "skipped", summary: budget.summary };

  let plan = planView(await lastReading(db), settings.planGuardPct, now);
  if (plan.state === "unknown") {
    await probeIfUnknown(db, deps, now);
    plan = planView(await lastReading(db), settings.planGuardPct, now);
  }
  if (plan.state === "unknown" || plan.state === "stopped") return { ok: false, kind: "skipped", summary: planGuardSummary(plan) };

  const running = await runningCount(db);
  if (running >= settings.maxConcurrent) return { ok: false, kind: "cap", summary: opts.fromQueue ? "queued" : "queued: cap reached" };
  return { ok: true, warn: budget.warn, reserve };
}

// ---- Wake

export async function wakeClaude(
  db: Db,
  input: { agent: Agent; task: ReadyWork | null; now: Date },
  deps: RunnerDeps = {},
): Promise<WakeOutcome> {
  return serial(async () => {
    const ctx = await loadContext(db, input.agent, input.task);
    const taskKey = input.task?.key ?? null;
    // Coalescing: a wake while this agent has a live or queued run writes nothing.
    const [busy] = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, input.agent.id), inArray(agentRuns.status, ["queued", "running"])))
      .limit(1);
    if (busy) return { kind: "coalesced", summary: "coalesced" };

    const pre = await preflight(db, ctx, input.now, deps);
    if (!pre.ok && pre.kind !== "cap") return { kind: pre.kind, summary: pre.summary, taskKey };
    const settings = await loadSettings(db);
    const [row] = await db
      .insert(agentRuns)
      .values({
        agentId: input.agent.id,
        projectId: ctx.project!.id,
        taskKey,
        role: ctx.role!,
        status: "queued",
        summary: pre.ok ? "starting" : "queued: cap reached",
        queuedAt: input.now,
        reserveTokens: settings.reserveTokens,
      })
      .returning();
    if (!pre.ok) return { kind: "queued", runId: row!.id, summary: "queued: cap reached", taskKey };
    return start(db, row!, ctx, pre.warn, deps);
  });
}

// PLA-18: would a wake of this agent on this ticket start now? The same checks the queue runs. A full cap
// and an agent inside its cooldown count as yes: a queued event wake waits for those instead of being dropped.
export async function canStart(db: Db, agent: Agent, projectId: string, taskKey: string, now: Date, deps: RunnerDeps = {}): Promise<{ ok: boolean; summary: string }> {
  const task = await readyWorkOf(db, projectId, taskKey);
  if (!task) return { ok: false, summary: "skipped: no such ticket" };
  const pre = await preflight(db, await loadContext(db, agent, task), now, deps);
  if (pre.ok) return { ok: true, summary: "" };
  return { ok: pre.kind === "cap" || pre.summary === "skipped: cooldown", summary: pre.summary };
}

// Queued runs, oldest first, while there is a free slot. A run whose checks now say no is dropped
// (skipped, with the reason); the cadence queues it again later.
export async function drainQueue(db: Db, now: Date, deps: RunnerDeps = {}): Promise<{ started: number; dropped: number }> {
  return serial(async () => {
    const out = { started: 0, dropped: 0 };
    const queued = await db.select().from(agentRuns).where(eq(agentRuns.status, "queued")).orderBy(asc(agentRuns.queuedAt));
    for (const run of queued) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
      if (!agent) continue;
      const task = run.taskKey ? await readyWorkOf(db, run.projectId, run.taskKey) : null;
      const ctx = await loadContext(db, agent, task);
      if (!ctx.project) ctx.project = (await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1))[0] ?? null;
      const pre = await preflight(db, ctx, now, deps, { fromQueue: run.id });
      if (!pre.ok && pre.kind === "cap") break;
      // PLA-I31-1: an event wake inside the agent's cooldown waits for it to end instead of being
      // dropped, so events that arrive during the cooldown coalesce into this one run.
      if (!pre.ok && pre.summary === "skipped: cooldown" && run.summary.startsWith(EVENT_SUMMARY)) continue;
      if (!pre.ok) {
        await endWithoutProcess(db, run, pre.kind === "fail" ? "fail" : "skipped", pre.summary, now);
        out.dropped += 1;
        continue;
      }
      await start(db, run, ctx, pre.warn, deps);
      out.started += 1;
    }
    return out;
  });
}

async function readyWorkOf(db: Db, projectId: string, key: string): Promise<ReadyWork | null> {
  const [row] = await db
    .select({ project: projects.slug, key: tasks.key, title: tasks.title, priority: tasks.priority, workType: tasks.workType, ownerAgent: tasks.ownerAgent })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.key, key)))
    .limit(1);
  return row ?? null;
}

async function endWithoutProcess(db: Db, run: AgentRun, status: "skipped" | "fail", summary: string, now: Date): Promise<void> {
  await db.update(agentRuns).set({ status, summary: summary.slice(0, 500), endedAt: now }).where(eq(agentRuns.id, run.id));
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

export function userPrompt(input: {
  agent: string;
  role: string;
  project: { slug: string; title: string };
  goal: { title: string; why: string } | null;
  task: { key: string; title: string } | null;
  workspace: { path: string; branch: string | null } | null;
  sessionId: string;
  reason?: string | null;
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
  const appRepo = ["filmia", "micasa", "zigzag", "workia"].includes(input.project.slug);
  lines.push(
    `Plania first: open the ticket with start (actor session_id ${input.sessionId}, that workspace) before you touch code.`,
    appRepo
      ? "Commit on your branch and open the PR into sandbox. Merge it only with pnpm merge-gate <owner/repo> <pr> --merge squash --record <TICKET>. Never merge any other way."
      : "Never main: commit on your branch, open PRs into sandbox only, never merge. Stop when the ticket is In review or when only Jorge can decide (ask).",
  );
  return lines.join("\n");
}

async function promptDoc(db: Db, role: RunnerRole, env: NodeJS.ProcessEnv): Promise<string | null> {
  const slug = env.PLANIA_PROMPTS_PROJECT || "plania";
  const rows = await db
    .select({ markdown: docs.markdown })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .where(and(eq(projects.slug, slug), isNull(docs.taskId), eq(docs.title, PROMPT_DOCS[role])))
    .limit(1);
  return rows[0]?.markdown ?? null;
}

export type ClaudeArgsInput = {
  prompt: string;
  settingsPath: string;
  mcpConfigPath: string;
  systemPromptPath: string | null;
  maxTurns: number;
  resume: string | null;
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
  return args;
}

// Plania only. The token stays in the child env; the file names the variable, never the value.
export const mcpConfig = (url: string) => ({
  mcpServers: { plania: { type: "http", url, headers: { Authorization: "Bearer ${PLANIA_RUNNER_TOKEN}" } } },
});

async function start(db: Db, run: AgentRun, ctx: WakeContext, warn: { scope: string; pct: number }[], deps: RunnerDeps): Promise<WakeOutcome> {
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

  // Where the run works: the ticket's worktree, or a scratch folder for a PO with no ticket.
  let cwd: string;
  let worktree: string | null = null;
  let branch: string | null = null;
  if (ctx.task) {
    const repo = repoPathOf(project.slug, project.settings, env);
    const wanted = ctx.taskRow?.branch?.trim() || branchFor(ctx.task.key);
    const made = await ensureWorktree({ repo, root, project: project.slug, key: ctx.task.key, branch: wanted }, deps.git ?? defaultGit);
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
  } else {
    cwd = scratchPathFor(root, project.slug, ctx.agent.slug);
    mkdirSync(cwd, { recursive: true });
  }

  // Resume this agent's session in this project, only in the folder it ran in.
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.agentId, ctx.agent.id), eq(agentSessions.projectId, project.id)))
    .limit(1);
  const resume = session && session.cwd === cwd ? session.claudeSessionId : null;

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
  writeFileSync(settingsPath, JSON.stringify(denySettings()), { mode: 0o600 });
  const mcpConfigPath = path.join(tmp, "mcp.json");
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig(env.PLANIA_MCP_URL || "http://127.0.0.1:3737/mcp")), { mode: 0o600 });

  const goal = await projectGoal(db, project.id);
  const planiaSession = `run-${run.id.slice(0, 8)}`;
  const prompt = userPrompt({
    agent: ctx.agent.name,
    role,
    project: { slug: project.slug, title: project.title },
    goal,
    task: ctx.task ? { key: ctx.task.key, title: ctx.task.title } : null,
    workspace: { path: cwd, branch },
    sessionId: planiaSession,
    reason: run.summary.startsWith(EVENT_SUMMARY) ? run.summary.slice(EVENT_SUMMARY.length).trim() || null : null,
  });
  const args = claudeArgs({ prompt, settingsPath, mcpConfigPath, systemPromptPath, maxTurns: settings.maxTurns, resume });
  const command = claudeCommand(ctx.agent.adapterConfig, env);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDirOf(deps, env), `${stamp}-${ctx.agent.slug}-${run.id.slice(0, 8)}.jsonl`);
  const startedAt = new Date();

  for (const w of warn) {
    await writeTx(db, project, sysCtx("runner.budget"), (_tx, emit) =>
      emit("budget.warning", null, { scope: w.scope, pct: w.pct, agent: ctx.agent.slug, run_id: run.id }),
    );
  }

  let lastFlush = 0;
  const flushEvery = deps.liveFlushMs ?? 5_000;
  // Plan readings are written as they stream; the run's end waits for them, so the next wake reads them.
  const readings: Promise<unknown>[] = [];
  const reader = new StreamReader((reading) => {
    readings.push(recordReading(db, { ...reading, source: "stream", runId: run.id }).catch(() => undefined));
  });
  const proc = supervise({
    command,
    args,
    cwd,
    env: childEnv(env, { PLANIA_RUNNER_TOKEN: token }),
    logPath,
    timeoutMs: deps.timeoutMs ?? settings.timeoutMinutes * MINUTE,
    graceMs: deps.graceMs ?? 30_000,
    spawn: deps.spawn ?? defaultSpawn,
    kill: deps.kill ?? defaultKill,
    onStdout: (chunk) => {
      reader.feed(chunk);
      if (Date.now() - lastFlush < flushEvery) return;
      lastFlush = Date.now();
      const t = reader.liveTokens;
      void db
        .update(agentRuns)
        .set({ turns: reader.liveTurns, inputTokens: t.input, outputTokens: t.output, cacheReadTokens: t.cacheRead, cacheCreateTokens: t.cacheCreate, tokensTotal: totalOf(t) })
        .where(and(eq(agentRuns.id, run.id), eq(agentRuns.status, "running")))
        .catch(() => undefined);
    },
  });

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
    })
    .where(eq(agentRuns.id, run.id));

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

export async function finishRun(db: Db, input: FinishInput, deps: RunnerDeps = {}): Promise<void> {
  const { run, agent, project, reader, exit } = input;
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
    // The budget still counts what the stream showed so far.
    tokens = reader.liveTokens;
    status = stopped ? "stopped" : "fail";
    summary = stopped ? `stopped: ${stopped} (no result)` : "fail: no result";
  }
  if (exit.timedOut && status !== "ok") summary = `${summary} after timeout`.slice(0, 500);

  const sessionId = result?.sessionId ?? reader.sessionId;
  if (sessionId) {
    await db
      .insert(agentSessions)
      .values({ agentId: agent.id, projectId: project.id, claudeSessionId: sessionId, cwd: input.cwd, runs: 1 })
      .onConflictDoUpdate({
        target: [agentSessions.agentId, agentSessions.projectId],
        set: { claudeSessionId: sessionId, cwd: input.cwd, runs: sql`${agentSessions.runs} + 1`, updatedAt: sql`now()` },
      });
  }

  await db
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
    })
    .where(eq(agentRuns.id, run.id));

  await db.insert(heartbeatRuns).values({
    agentId: agent.id,
    startedAt: run.startedAt ?? run.queuedAt,
    endedAt,
    status: status === "stopped" ? "skipped" : status,
    adapter: RUNNER_ADAPTER,
    summary: summary.slice(0, 500),
    taskKey: run.taskKey,
  });
}

// ---- Stop live runs (kill switches, budgets)

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
  if (!run || run.stopReason) return false;
  run.stopReason = reason;
  run.proc.stop(reason);
  return true;
}

// Each tick: switches off and budgets at 100% stop the live runs in their scope.
// Budgets here count real tokens only (a run's own reserve never stops it).
export async function enforceLive(db: Db, now: Date): Promise<number> {
  if (live.size === 0) return 0;
  const settings = await loadSettings(db);
  if (settings.companyPaused) return stopLive(() => true, "company paused");
  let n = 0;
  const projectIds = [...new Set([...live.values()].map((run) => run.projectId))];
  const rows = await db.select({ id: projects.id, slug: projects.slug, paused: projects.runsPaused }).from(projects).where(inArray(projects.id, projectIds));
  for (const p of rows) if (p.paused) n += stopLive((run) => run.projectId === p.id && run.role !== "asistente", `project ${p.slug} paused`);

  const { startsAt } = await weekBounds(db, now);
  const realUsage = async (scope: { kind: "project"; projectId: string } | { kind: "asistente" }) => {
    const limit = await budgetLimit(db, scope);
    const r = await db.execute<{ used: string }>(sql`
      select coalesce(sum(r.tokens_total), 0)::bigint as used from agent_runs r
      where ${scopeWhere(scope)} and r.status in ('running', 'ok', 'fail', 'stopped')
        and coalesce(r.started_at, r.queued_at) >= ${startsAt.toISOString()}::timestamptz`);
    return budgetState(Number(r.rows[0]?.used ?? 0), limit, 0);
  };
  // PLA-I32-5: no role caps. A project's budget stops its team's live runs; Asistente's stops Asistente's.
  if ([...live.values()].some((run) => run.role === "asistente")) {
    const view = await realUsage({ kind: "asistente" });
    if (view.limit != null && view.used >= view.limit) n += stopLive((run) => run.role === "asistente", "BUDGET_STOPPED asistente");
  }
  for (const p of rows) {
    const view = await realUsage({ kind: "project", projectId: p.id });
    if (view.limit != null && view.used >= view.limit) n += stopLive((run) => run.projectId === p.id && run.role !== "asistente", `BUDGET_STOPPED project ${p.slug}`);
  }
  return n;
}

// ---- Server start: orphans

// Runs marked running that this process does not supervise were left by an earlier server.
// Their process group gets SIGINT, then SIGKILL; the row ends as fail: orphaned. Tokens come from
// the log's result event when it has one; otherwise the usage is unknown, which blocks the scope
// until Jorge acknowledges it on screen (or the week resets).
export async function sweepOrphans(db: Db, deps: RunnerDeps = {}): Promise<number> {
  const rows = await db.select().from(agentRuns).where(eq(agentRuns.status, "running"));
  const kill = deps.kill ?? defaultKill;
  const probe = deps.probePid ?? defaultProbePid;
  let n = 0;
  for (const run of rows) {
    if (live.has(run.id)) continue;
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
    const summary = known ? "fail: orphaned (result kept)" : "fail: orphaned (usage unknown)";
    await db
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
      .where(eq(agentRuns.id, run.id));
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
  // Queued rows from an earlier server are dropped too: the cadence queues them again.
  await db
    .update(agentRuns)
    .set({ status: "skipped", summary: "skipped: server restarted", endedAt: new Date() })
    .where(eq(agentRuns.status, "queued"));
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
    if (!(await removeWorktree({ repo, path: row.path }, deps.git ?? defaultGit))) continue;
    if (deps.footprints !== false) {
      await releaseFootprint(db, { project: row.slug, kind: "worktree", locator: row.path }, { ...sysCtx("runner.worktree"), actor: { ...sysCtx("runner.worktree").actor, session_id: `runner-cleanup` } }).catch(
        () => undefined,
      );
    }
    n += 1;
  }
  return n;
}

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
