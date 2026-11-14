// PLA-I41-3: one Morning brief pass (spec §5). A read-only `claude -p` run with --json-schema, through
// the runner's pieces (supervise, childEnv, StreamReader, planView, loadSettings), never wakeClaude():
// it holds the runner slot (reservation, then waits with no cutoff until no run is live), checks the
// plan guard, runs in a scratch folder outside every repo, validates structured_output with zod and
// retries once with the zod error appended. Prompts, schemas and types come from the caller.
// Summaries never carry paths, env values or tokens.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import path from "node:path";
import type { ZodType } from "zod";
import type { Db } from "../db/client.js";
import { SYSTEM_ACTOR, type Ctx } from "../mcp/tx.js";
import { reportTokens, type ReportTokensInput } from "../mcp/usage.js";
import { denySettings } from "../runner/deny.js";
import { lastReading, loadSettings, planGuardSummary, planView, recordReading, type PlanView } from "../runner/limits.js";
import { childEnv, defaultKill, defaultSpawn, supervise, type ExitInfo, type KillFn, type SpawnFn } from "../runner/process.js";
import { defaultProbeUsage, liveRuns, releaseReservation, reserveSlot, settleRunner } from "../runner/runner.js";
import { StreamReader, parseUsageText, totalOf, type ModelTokens } from "../runner/stream.js";
import { worktreeRoot } from "../runner/worktree.js";

export type BriefPass = "brief" | "ideas";

export const BRIEF_AGENT = "morning-brief";
export const LOG_KEEP_DAYS = 14;
const MINUTE = 60_000;

// Spec §5: pass A 10 min, 30 turns; pass B 20 min, 60 turns; grace 30 s.
export const PASS_LIMITS: Record<BriefPass, { timeoutMs: number; maxTurns: number }> = {
  brief: { timeoutMs: 10 * MINUTE, maxTurns: 30 },
  ideas: { timeoutMs: 20 * MINUTE, maxTurns: 60 },
};

// Read-only Plania tools. thread_read is left out on purpose: outside agents get THREAD_FORBIDDEN
// (spec correction, 2026-11-13); thread facts go into facts.json.
export const READ_MCP_TOOLS: readonly string[] = [
  "mcp__plania__list_projects",
  "mcp__plania__get_project",
  "mcp__plania__get_resume",
  "mcp__plania__list_tasks",
  "mcp__plania__get_task",
  "mcp__plania__get_inbox",
  "mcp__plania__get_digest",
  "mcp__plania__audit",
  "mcp__plania__list_events",
  "mcp__plania__get_running",
  "mcp__plania__get_memory",
  "mcp__plania__get_doc",
];

const READ_BUILTINS = ["Read", "Grep", "Glob"];
const READ_GIT = ["Bash(git -C * log:*)", "Bash(git -C * branch:*)", "Bash(git -C * rev-list:*)", "Bash(git -C * status:*)"];
const READ_GH = ["Bash(gh pr list:*)", "Bash(gh pr view:*)"];

// Every Plania write tool, denied on top of the read-scope token (belt and braces), plus thread_read.
export const PLANIA_WRITE_TOOLS: readonly string[] = [
  "add_decision", "add_result", "answer", "answer_delegated", "ask", "assign", "attach_doc", "batch", "check_in",
  "claim", "comment", "consume", "create_company_project", "create_task", "finish", "handoff", "lease_resource",
  "propose", "record_routine_run", "register_footprint", "release_footprint", "release_resource", "report_tokens",
  "reserve_sequence", "retire_decision", "set_agent", "set_check", "set_env", "set_goal", "set_metric", "set_project",
  "set_task", "start", "thread_post", "thread_read", "waive_check", "wake_agent",
].map((name) => `mcp__plania__${name}`);

export const BRIEF_DENY: readonly string[] = [
  "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch",
  "Read(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)", "Read(~/.config/**)", "Read(~/.ssh/**)", "Read(~/.claude/**)",
  "Bash(git -C * push*)", "Bash(git -C * commit*)", "Bash(git -C * checkout*)", "Bash(git -C * reset*)", "Bash(git -C * switch*)",
  "Bash(git -C * fetch*)", "Bash(git -C * pull*)",
  "Bash(gh pr create*)", "Bash(gh pr edit*)", "Bash(gh pr close*)", "Bash(gh pr comment*)", "Bash(gh api*)",
  "Bash(rm *)", "Bash(curl *)",
];

export const briefSettings = (): { permissions: { deny: string[] } } => {
  const deny = new Set([...denySettings().permissions.deny, ...BRIEF_DENY, ...PLANIA_WRITE_TOOLS]);
  return { permissions: { deny: [...deny] } };
};

export const allowedToolsFor = (pass: BriefPass, githubMode: "gh" | string | null | undefined): string[] => [
  ...READ_MCP_TOOLS,
  ...READ_BUILTINS,
  ...READ_GIT,
  ...(pass === "brief" && githubMode === "gh" ? READ_GH : []),
];

// The file names the variable; the value only lives in the child env.
export const briefMcpConfig = (url: string) => ({
  mcpServers: { plania: { type: "http", url, headers: { Authorization: "Bearer ${PLANIA_BRIEF_TOKEN}" } } },
});

export type BriefArgsInput = {
  pass: BriefPass;
  prompt: string;
  systemPromptPath: string;
  jsonSchema: string;
  mcpConfigPath: string;
  settingsPath: string;
  maxTurns: number;
  githubMode?: string | null;
  model?: string | null;
  repoDirs?: string[];
};

export function briefArgs(input: BriefArgsInput): string[] {
  const args = [
    "-p",
    input.prompt,
    "--append-system-prompt-file",
    input.systemPromptPath,
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    input.jsonSchema,
    "--mcp-config",
    input.mcpConfigPath,
    "--strict-mcp-config",
    "--tools",
    "Read,Grep,Glob,Bash",
    "--allowedTools",
    ...allowedToolsFor(input.pass, input.githubMode),
    "--settings",
    input.settingsPath,
    "--permission-mode",
    "default",
    "--permission-prompts",
    "none",
    "--max-turns",
    String(input.maxTurns),
    "--no-session-persistence",
  ];
  if (input.model?.trim()) args.push("--model", input.model.trim());
  if (input.pass === "ideas") for (const dir of input.repoDirs ?? []) args.push("--add-dir", dir);
  return args;
}

// Parent env minus ANTHROPIC_* (childEnv) and minus every other token or secret the server holds,
// so the pass only ever sees its read token.
const SECRET_KEY = /(TOKEN|SECRET|PASSWORD|OWNER_CODE|DATABASE_URL|_KEY)$/i;
export function briefChildEnv(base: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) if (!SECRET_KEY.test(key)) kept[key] = value;
  return childEnv(kept, { PLANIA_BRIEF_TOKEN: token });
}

// Deletes Morning brief logs older than LOG_KEEP_DAYS. Returns how many went.
export function pruneBriefLogs(logDir: string, now: Date = new Date(), days = LOG_KEEP_DAYS): number {
  if (!existsSync(logDir)) return 0;
  const cutoff = now.getTime() - days * 24 * 60 * MINUTE;
  let removed = 0;
  for (const name of readdirSync(logDir)) {
    if (!/-morning-brief-.*\.jsonl$/.test(name)) continue;
    const file = path.join(logDir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) {
        rmSync(file, { force: true });
        removed += 1;
      }
    } catch {
      // gone already
    }
  }
  return removed;
}

export type SpawnPassDeps = {
  spawn?: SpawnFn;
  kill?: KillFn;
  env?: NodeJS.ProcessEnv;
  logDir?: string;
  tmpDir?: string;
  // Scratch cwd parent; default <worktreeRoot()>/_brief.
  briefRoot?: string;
  graceMs?: number;
  timeoutMs?: number;
  pollMs?: number;
  liveRuns?: () => unknown[];
  probeUsage?: () => Promise<string | null>;
  reportTokens?: (db: Db, input: ReportTokensInput, ctx: Ctx) => Promise<unknown>;
  now?: () => Date;
};

export type SpawnPassInput<T> = {
  pass: BriefPass;
  // Local date of the brief, YYYY-MM-DD: names the scratch folder.
  date: string;
  // brief_runs id (or any id): names the log file.
  runId?: string;
  prompt: string;
  systemPrompt: string;
  jsonSchema: string;
  schema: ZodType<T>;
  repoDirs?: string[];
  githubMode?: string | null;
  model?: string | null;
  // Where tokens are reported (agent morning-brief); null skips the report.
  usage?: { project: string; taskKey: string } | null;
  // Aborts the wait for the slot (the pipeline's fallback_at ceiling) or the run itself.
  signal?: AbortSignal;
};

export type PassTokens = { input: number; output: number; cacheRead: number; cacheCreate: number; total: number };

export type PassFailure = "aborted" | "no_token" | "plan_guard" | "timeout" | "stopped" | "error" | "invalid";

export type PassOutcome<T> =
  | { ok: true; data: T; attempts: number; turns: number; tokens: PassTokens; models: ModelTokens[]; logPath: string }
  | { ok: false; reason: PassFailure; summary: string; attempts: number; plan?: PlanView; logPath: string | null };

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

const home = (env: NodeJS.ProcessEnv) => env.HOME || homedir();
const commandOf = (env: NodeJS.ProcessEnv) => env.CLAUDE_CODE_BIN?.trim() || path.join(home(env), ".local", "bin", "claude");
const sysCtx: Ctx = { actor: { ...SYSTEM_ACTOR, machine: hostname() }, system: true, tool: "brief.report_tokens" };

// Short, plain zod error for the retry prompt (no values echoed back beyond the path).
export function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 20)
    .map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`)
    .join("\n");
}

export const retryPrompt = (prompt: string, issues: string): string =>
  `${prompt}\n\n---\nYour previous answer did not match the JSON schema. Fix these problems and answer again with JSON that matches the schema exactly:\n${issues}`;

// Waits, with no time cutoff, until no runner run is live. Returns false when aborted.
async function waitForFreeSlot(deps: SpawnPassDeps, signal?: AbortSignal): Promise<boolean> {
  const live = deps.liveRuns ?? liveRuns;
  await settleRunner();
  while (live().length > 0) {
    if (signal?.aborted) return false;
    await sleep(deps.pollMs ?? 5_000, signal);
  }
  return !signal?.aborted;
}

async function planGuard(db: Db, deps: SpawnPassDeps, env: NodeJS.ProcessEnv, now: Date): Promise<PlanView> {
  const settings = await loadSettings(db);
  let plan = planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride);
  if (plan.state === "unknown") {
    const probe = deps.probeUsage ?? defaultProbeUsage(env);
    const text = await probe().catch(() => null);
    const reading = text ? parseUsageText(text) : null;
    if (reading) {
      await recordReading(db, { ...reading, source: "usage_probe", at: now });
      plan = planView(await lastReading(db), settings.planGuardPct, now, settings.guardOverride);
    }
  }
  return plan;
}

type Attempt = { exit: ExitInfo; reader: StreamReader };

export async function spawnPass<T>(db: Db, input: SpawnPassInput<T>, deps: SpawnPassDeps = {}): Promise<PassOutcome<T>> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const id8 = (input.runId ?? randomUUID()).replace(/-/g, "").slice(0, 8);
  const logDir = deps.logDir ?? path.join(home(env), "Library", "Logs", "plania-runs");
  pruneBriefLogs(logDir, now());

  const token = env.PLANIA_BRIEF_TOKEN?.trim() || env.MCP_READ_TOKEN?.trim();
  if (!token) return { ok: false, reason: "no_token", summary: "Add PLANIA_BRIEF_TOKEN (read scope) to .env", attempts: 0, logPath: null };

  // Hold the slot: reserve first (no new run starts), then wait until the live ones end.
  const mine = reserveSlot(`${BRIEF_AGENT}:${input.pass}`);
  try {
    if (!(await waitForFreeSlot(deps, input.signal))) {
      return { ok: false, reason: "aborted", summary: "stopped while waiting for the current run", attempts: 0, logPath: null };
    }

    const plan = await planGuard(db, deps, env, now());
    if (plan.state === "stopped" || plan.state === "warn") {
      const summary = plan.state === "warn" ? `plan guard warn (five_hour ${plan.five_hour_pct}%)` : planGuardSummary(plan).replace(/^skipped: /, "");
      return { ok: false, reason: "plan_guard", summary, attempts: 0, plan, logPath: null };
    }

    const limits = PASS_LIMITS[input.pass];
    const cwd = path.join(deps.briefRoot ?? path.join(worktreeRoot(env), "_brief"), input.date);
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const tmp = path.join(deps.tmpDir ?? path.join(tmpdir(), "plania-brief"), `${id8}-${input.pass}-${randomUUID().slice(0, 8)}`);
    mkdirSync(tmp, { recursive: true, mode: 0o700 });
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(logDir, `${stamp}-${BRIEF_AGENT}-${input.pass}-${id8}.jsonl`);

    try {
      const systemPromptPath = path.join(tmp, "system.md");
      writeFileSync(systemPromptPath, input.systemPrompt, { mode: 0o600 });
      const settingsPath = path.join(tmp, "settings.json");
      writeFileSync(settingsPath, JSON.stringify(briefSettings()), { mode: 0o600 });
      const mcpConfigPath = path.join(tmp, "mcp.json");
      writeFileSync(mcpConfigPath, JSON.stringify(briefMcpConfig(env.PLANIA_MCP_URL || "http://127.0.0.1:3737/mcp")), { mode: 0o600 });
      const repoDirs = (input.repoDirs ?? []).filter((dir) => path.isAbsolute(dir) && existsSync(dir));
      const childEnvValue = briefChildEnv(env, token);

      const runOnce = async (prompt: string): Promise<Attempt> => {
        const readings: Promise<unknown>[] = [];
        const reader = new StreamReader((reading) => {
          readings.push(recordReading(db, { ...reading, source: "stream" }).catch(() => undefined));
        });
        const proc = supervise({
          command: commandOf(env),
          args: briefArgs({ pass: input.pass, prompt, systemPromptPath, jsonSchema: input.jsonSchema, mcpConfigPath, settingsPath, maxTurns: limits.maxTurns, githubMode: input.githubMode, model: input.model, repoDirs }),
          cwd,
          env: childEnvValue,
          logPath,
          timeoutMs: deps.timeoutMs ?? limits.timeoutMs,
          graceMs: deps.graceMs ?? 30_000,
          spawn: deps.spawn ?? defaultSpawn,
          kill: deps.kill ?? defaultKill,
          onStdout: (chunk) => reader.feed(chunk),
        });
        const onAbort = () => proc.stop("aborted");
        input.signal?.addEventListener("abort", onAbort, { once: true });
        const exit = await proc.done;
        input.signal?.removeEventListener("abort", onAbort);
        reader.end();
        await Promise.all(readings);
        return { exit, reader };
      };

      const tokens: PassTokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
      const models: ModelTokens[] = [];
      let turns = 0;
      const tally = async (attempt: Attempt, n: number) => {
        const result = attempt.reader.result;
        const used = result?.hasModelUsage ? result.models : [];
        for (const m of used) {
          tokens.input += m.input;
          tokens.output += m.output;
          tokens.cacheRead += m.cacheRead;
          tokens.cacheCreate += m.cacheCreate;
          models.push(m);
          if (input.usage) {
            await (deps.reportTokens ?? reportTokens)(
              db,
              {
                project: input.usage.project,
                agent: BRIEF_AGENT,
                task_key: input.usage.taskKey,
                run_id: `${BRIEF_AGENT}-${input.pass}-${id8}-${n}/${m.model}`.slice(0, 120),
                model: m.model,
                input: m.input,
                output: m.output,
                cache_read: m.cacheRead,
                cache_create: m.cacheCreate,
                at: now().toISOString(),
              },
              sysCtx,
            ).catch(() => undefined);
          }
        }
        if (!result?.hasModelUsage) {
          const live = attempt.reader.liveTokens;
          tokens.input += live.input;
          tokens.output += live.output;
          tokens.cacheRead += live.cacheRead;
          tokens.cacheCreate += live.cacheCreate;
        }
        tokens.total = totalOf(tokens);
        turns += result?.numTurns ?? attempt.reader.liveTurns;
      };

      let prompt = input.prompt;
      for (let n = 1; n <= 2; n += 1) {
        const attempt = await runOnce(prompt);
        await tally(attempt, n);
        const { exit, reader } = attempt;
        if (exit.timedOut) return { ok: false, reason: "timeout", summary: `pass ${input.pass} timed out`, attempts: n, logPath };
        if (exit.stoppedBy) return { ok: false, reason: exit.stoppedBy === "aborted" ? "aborted" : "stopped", summary: `pass ${input.pass} stopped (${exit.stoppedBy})`, attempts: n, logPath };
        const result = reader.result;
        if (!result) return { ok: false, reason: "error", summary: `pass ${input.pass} ended without a result (exit ${exit.code ?? exit.signal ?? "?"})`, attempts: n, logPath };
        if (result.isError || result.subtype !== "success") {
          return { ok: false, reason: "error", summary: `pass ${input.pass} failed: ${result.subtype}`, attempts: n, logPath };
        }
        let candidate: unknown = result.structuredOutput;
        if (candidate === undefined && result.resultText) {
          try {
            candidate = JSON.parse(result.resultText);
          } catch {
            candidate = undefined;
          }
        }
        const parsed = input.schema.safeParse(candidate);
        if (parsed.success) return { ok: true, data: parsed.data, attempts: n, turns, tokens, models, logPath };
        const issues = candidate === undefined ? "(root): no structured output" : zodIssues(parsed.error);
        if (n === 2) return { ok: false, reason: "invalid", summary: `pass ${input.pass} gave invalid JSON twice`, attempts: n, logPath };
        prompt = retryPrompt(input.prompt, issues);
      }
      return { ok: false, reason: "invalid", summary: `pass ${input.pass} gave invalid JSON twice`, attempts: 2, logPath };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    if (mine) releaseReservation();
  }
}
