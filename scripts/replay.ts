// AUDIT-10: the replay set. Runs past tickets again, from the commit they started on, to tell whether a change to a
// role prompt, a kit or a model makes the agents build better or worse.
//
// Usage:
//   tsx scripts/replay.ts [--case id]... [--trials k] [--role-prompt path] [--kit dir] [--model m]
//                         [--max-turns n] [--timeout-minutes n] [--dry-run]
//   tsx scripts/replay.ts --compare a.json b.json
//
// Per case and trial:
//   1. a temporary git worktree of the case's repo at base_sha, in the system temp folder (outside every repo)
//   2. one `claude -p` there, with the role prompt appended (kit/roles/<role>.md when it exists), the kit folder as
//      --plugin-dir when given, a prompt made from the ticket's title, scope and checks, and a turn cap. No MCP
//      server and none of Plania's env: a replay never reads or writes the plan
//   3. the case's verify commands in that worktree
//   4. the worktree is removed, whatever happened
// A trial passes when the run ended without an error and every verify command passed. The run writes
// replay/results/<stamp>.json and prints pass rate per case, pass^k (every trial passed) and totals.
// --dry-run prints the commands and starts nothing. The Claude binary is CLAUDE_CODE_BIN, like the runner.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveClaudeBin } from "../src/lib/claude-bin.js";
import { denySettings } from "../src/runner/deny.js";
import { childEnv } from "../src/runner/process.js";
import { defaultGit, expandHome, type GitFn } from "../src/runner/worktree.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type VerifyItem = { name: string; command: string; timeout_minutes?: number };
export type ReplayCase = { id: string; project: string; repo: string; base_sha: string; role: string; title: string; scope: string; checks: string[]; verify: VerifyItem[] };

export type VerifyResult = { name: string; ok: boolean; exit_code: number | null; duration_s: number; tail: string };
export type TrialResult = {
  n: number;
  passed: boolean;
  claude: { ok: boolean; exit_code: number | null; subtype: string | null; timed_out: boolean };
  verify: VerifyResult[];
  turns: number;
  tokens: { input: number; output: number; total: number };
  duration_s: number;
  error: string | null;
};
export type CaseResult = { id: string; project: string; trials: TrialResult[]; passed: number; pass_rate: number; pass_k: boolean };
export type ReplayResult = {
  stamp: string;
  started_at: string;
  options: { trials: number; role_prompt: string | null; kit: string | null; model: string | null; max_turns: number };
  cases: CaseResult[];
  totals: { cases: number; trials: number; passed: number; pass_rate: number | null; pass_k_cases: number; turns: number; tokens: number; duration_s: number };
};

export type ReplayOptions = {
  cases?: string[];
  trials?: number;
  rolePrompt?: string;
  kit?: string;
  model?: string;
  maxTurns?: number;
  timeoutMinutes?: number;
  dryRun?: boolean;
  casesDir?: string;
  resultsDir?: string;
  tmpDir?: string;
};
export type ReplayDeps = { env?: NodeJS.ProcessEnv; git?: GitFn; log?: (line: string) => void; now?: () => Date };

const CASE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SHA = /^[0-9a-f]{7,40}$/;

export function parseCase(raw: unknown, file: string): ReplayCase {
  const c = raw as Partial<ReplayCase>;
  const bad = (what: string): never => {
    throw new Error(`${file}: ${what}`);
  };
  if (!c || typeof c !== "object") bad("not a JSON object");
  if (typeof c.id !== "string" || !CASE_ID.test(c.id)) bad("id must be lowercase letters, digits, dots and dashes");
  for (const k of ["project", "repo", "role", "title", "scope"] as const) if (typeof c[k] !== "string" || !c[k]) bad(`${k} is missing`);
  if (typeof c.base_sha !== "string" || !SHA.test(c.base_sha)) bad("base_sha must be a commit sha");
  if (!Array.isArray(c.checks) || c.checks.some((x) => typeof x !== "string")) bad("checks must be a list of strings");
  if (!Array.isArray(c.verify) || c.verify.length === 0) bad("verify is empty: there is nothing to grade the run with");
  for (const v of c.verify!) if (!v || typeof v.name !== "string" || typeof v.command !== "string" || !v.command.trim()) bad("each verify item needs a name and a command");
  return c as ReplayCase;
}

export function loadCases(dir: string, only: string[] = []): ReplayCase[] {
  if (!existsSync(dir)) return [];
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => parseCase(JSON.parse(readFileSync(path.join(dir, f), "utf8")), f));
  const missing = only.filter((id) => !all.some((c) => c.id === id));
  if (missing.length) throw new Error(`no such case: ${missing.join(", ")}`);
  return only.length ? all.filter((c) => only.includes(c.id)) : all;
}

// What the run is asked to do: the ticket as it was written, and where the work must stay.
export function promptOf(c: ReplayCase): string {
  const checks = c.checks.length ? `\n\n## Done when\n${c.checks.map((x) => `- ${x}`).join("\n")}` : "";
  return `# ${c.title}\n\n${c.scope.trim()}${checks}\n\nWork only in this folder. Make the change and run the project's own checks before you stop. Do not push, open a pull request or write outside this folder.`;
}

// The runner's rule (src/lib/claude-bin.ts): CLAUDE_CODE_BIN, ~/.local/bin/claude, then claude on PATH.
export const claudeBin = (env: NodeJS.ProcessEnv): string => resolveClaudeBin(env);

// A script given as the binary (the tests' fake) is started with node, so it also runs where a shebang does not.
const launch = (bin: string, args: string[]): [string, string[]] => (/\.[cm]?js$/.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args]);

export function claudeArgs(input: { prompt: string; settingsPath: string; mcpConfigPath: string; maxTurns: number; rolePrompt: string | null; kit: string | null; model: string | null }): string[] {
  const args = ["-p", input.prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "auto", "--permission-prompts", "none", "--settings", input.settingsPath, "--mcp-config", input.mcpConfigPath, "--strict-mcp-config", "--max-turns", String(input.maxTurns)];
  if (input.rolePrompt) args.push("--append-system-prompt-file", input.rolePrompt);
  if (input.kit) args.push("--plugin-dir", input.kit);
  if (input.model) args.push("--model", input.model);
  return args;
}

// The run's env: the run allow-list (childEnv, PLA-I2-13: Claude's own sign-in kept, Plania's secrets dropped),
// and to be sure, nothing that opens Plania.
export function replayEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = childEnv(base);
  for (const k of Object.keys(out)) if (/^(PLANIA_|MCP_|DATABASE_URL$|SESSION_SECRET$|GITHUB_TOKEN$|GH_TOKEN$)/.test(k)) delete out[k];
  return out;
}

type Ran = { code: number | null; stdout: string; stderr: string; timedOut: boolean };
function run(command: string, args: string[] | null, opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    // args null: a shell line (a verify command), run by the platform's shell.
    const child = args ? spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] }) : spawn(command, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" ? true : "/bin/sh" });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout!.on("data", (d) => (stdout += String(d)));
    child.stderr!.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + e.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

// The stream's result line: how the run ended, its turns and its tokens.
export function readResult(stdout: string): { subtype: string | null; isError: boolean; turns: number; input: number; output: number } {
  let result: Record<string, unknown> | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.includes('"result"')) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (o.type === "result") result = o;
    } catch {
      // a partial or non-JSON line: not the result
    }
  }
  if (!result) return { subtype: null, isError: true, turns: 0, input: 0, output: 0 };
  let input = 0;
  let output = 0;
  for (const u of Object.values((result.modelUsage ?? {}) as Record<string, { inputTokens?: number; outputTokens?: number }>)) {
    input += Number(u.inputTokens ?? 0);
    output += Number(u.outputTokens ?? 0);
  }
  return { subtype: typeof result.subtype === "string" ? result.subtype : null, isError: result.is_error === true, turns: Number(result.num_turns ?? 0), input, output };
}

const tail = (text: string): string => text.trim().split("\n").slice(-15).join("\n").slice(-1200);
const quote = (a: string): string => (/^[A-Za-z0-9_./:=@-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
const seconds = (ms: number): number => Math.round(ms / 100) / 10;

function resolved(options: ReplayOptions, c: ReplayCase): { rolePrompt: string | null; kit: string | null } {
  const byRole = path.join(ROOT, "kit", "roles", `${c.role}.md`);
  return { rolePrompt: options.rolePrompt ? path.resolve(options.rolePrompt) : existsSync(byRole) ? byRole : null, kit: options.kit ? path.resolve(options.kit) : null };
}

async function trial(c: ReplayCase, n: number, options: Required<Pick<ReplayOptions, "maxTurns" | "timeoutMinutes">> & ReplayOptions, deps: Required<ReplayDeps>, tmpRoot: string): Promise<TrialResult> {
  const started = Date.now();
  const repo = path.resolve(expandHome(c.repo));
  const scratch = mkdtempSync(path.join(tmpRoot, `${c.id}-t${n}-`));
  const worktree = path.join(scratch, "wt");
  const out: TrialResult = { n, passed: false, claude: { ok: false, exit_code: null, subtype: null, timed_out: false }, verify: [], turns: 0, tokens: { input: 0, output: 0, total: 0 }, duration_s: 0, error: null };
  let added = false;
  try {
    if (!existsSync(repo)) throw new Error(`repo not found: ${c.repo}`);
    const add = await deps.git(["worktree", "add", "--detach", worktree, c.base_sha], repo);
    if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim().split("\n")[0]}`);
    added = true;

    const settingsPath = path.join(scratch, "settings.json");
    const mcpConfigPath = path.join(scratch, "mcp.json");
    // The runner's deny rules, and nothing that leaves the machine: a replay never pushes or opens a pull request.
    writeFileSync(settingsPath, JSON.stringify(denySettings(["Bash(git push*)", "Bash(git -C * push*)", "Bash(gh *)"])));
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));
    const { rolePrompt, kit } = resolved(options, c);
    const [bin, args] = launch(claudeBin(deps.env), claudeArgs({ prompt: promptOf(c), settingsPath, mcpConfigPath, maxTurns: options.maxTurns, rolePrompt, kit, model: options.model ?? null }));
    const ran = await run(bin, args, { cwd: worktree, env: replayEnv(deps.env), timeoutMs: options.timeoutMinutes * 60_000 });
    const r = readResult(ran.stdout);
    out.claude = { ok: ran.code === 0 && !ran.timedOut && !r.isError, exit_code: ran.code, subtype: r.subtype, timed_out: ran.timedOut };
    out.turns = r.turns;
    out.tokens = { input: r.input, output: r.output, total: r.input + r.output };

    // The verify list always runs, also after a failed run: what broke is worth reading.
    for (const v of c.verify) {
      const at = Date.now();
      const vr = await run(v.command, null, { cwd: worktree, env: replayEnv(deps.env), timeoutMs: (v.timeout_minutes ?? 15) * 60_000 });
      out.verify.push({ name: v.name, ok: vr.code === 0 && !vr.timedOut, exit_code: vr.code, duration_s: seconds(Date.now() - at), tail: tail(`${vr.stdout}\n${vr.stderr}`) });
    }
    out.passed = out.claude.ok && out.verify.every((v) => v.ok);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (added) {
      await deps.git(["worktree", "remove", "--force", worktree], repo);
      await deps.git(["worktree", "prune"], repo);
    }
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
  out.duration_s = seconds(Date.now() - started);
  return out;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padLeft = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const pctOf = (n: number | null): string => (n === null ? "—" : `${Math.round(n * 100)} %`);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((cell, i) => (i === 0 ? pad(cell, widths[i]!) : padLeft(cell, widths[i]!))).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

export function formatResult(r: ReplayResult): string {
  const rows = r.cases.map((c) => [
    c.id,
    String(c.trials.length),
    String(c.passed),
    pctOf(c.pass_rate),
    c.pass_k ? "yes" : "no",
    avg(c.trials.map((t) => t.turns)).toFixed(1),
    String(Math.round(avg(c.trials.map((t) => t.tokens.total)))),
    `${avg(c.trials.map((t) => t.duration_s)).toFixed(1)} s`,
  ]);
  const t = r.totals;
  rows.push(["total", String(t.trials), String(t.passed), pctOf(t.pass_rate), `${t.pass_k_cases}/${t.cases}`, String(t.turns), String(t.tokens), `${t.duration_s.toFixed(1)} s`]);
  const failed = r.cases.flatMap((c) => c.trials.filter((x) => !x.passed).map((x) => `  ${c.id} trial ${x.n}: ${x.error ?? ([!x.claude.ok ? `run ${x.claude.timed_out ? "timed out" : (x.claude.subtype ?? `exit ${x.claude.exit_code}`)}` : null, ...x.verify.filter((v) => !v.ok).map((v) => `${v.name} failed`)].filter(Boolean).join(", ") || "failed")}`));
  return [table(["case", "trials", "passed", "pass rate", "pass^k", "turns", "tokens", "time"], rows), ...(failed.length ? ["", "failed trials:", ...failed] : [])].join("\n");
}

export function summarize(stamp: string, startedAt: Date, options: ReplayResult["options"], cases: { c: ReplayCase; trials: TrialResult[] }[]): ReplayResult {
  const out = cases.map(({ c, trials }): CaseResult => {
    const passed = trials.filter((t) => t.passed).length;
    return { id: c.id, project: c.project, trials, passed, pass_rate: trials.length ? passed / trials.length : 0, pass_k: trials.length > 0 && passed === trials.length };
  });
  const all = out.flatMap((c) => c.trials);
  const passed = all.filter((t) => t.passed).length;
  return {
    stamp,
    started_at: startedAt.toISOString(),
    options,
    cases: out,
    totals: {
      cases: out.length,
      trials: all.length,
      passed,
      pass_rate: all.length ? passed / all.length : null,
      pass_k_cases: out.filter((c) => c.pass_k).length,
      turns: all.reduce((n, t) => n + t.turns, 0),
      tokens: all.reduce((n, t) => n + t.tokens.total, 0),
      duration_s: seconds(all.reduce((n, t) => n + t.duration_s * 1000, 0)),
    },
  };
}

export async function runReplay(options: ReplayOptions = {}, deps: ReplayDeps = {}): Promise<{ result: ReplayResult | null; file: string | null }> {
  const d: Required<ReplayDeps> = { env: deps.env ?? process.env, git: deps.git ?? defaultGit, log: deps.log ?? ((line) => console.log(line)), now: deps.now ?? (() => new Date()) };
  const trials = options.trials ?? 1;
  if (!Number.isInteger(trials) || trials < 1 || trials > 20) throw new Error("--trials must be between 1 and 20");
  const o = { ...options, maxTurns: options.maxTurns ?? 60, timeoutMinutes: options.timeoutMinutes ?? 30 };
  if (!Number.isInteger(o.maxTurns) || o.maxTurns < 1) throw new Error("--max-turns must be a positive number");
  if (options.rolePrompt && !existsSync(options.rolePrompt)) throw new Error(`role prompt not found: ${options.rolePrompt}`);
  if (options.kit && !existsSync(options.kit)) throw new Error(`kit folder not found: ${options.kit}`);
  const cases = loadCases(options.casesDir ?? path.join(ROOT, "replay", "cases"), options.cases);
  if (cases.length === 0) throw new Error("no cases: capture one with scripts/replay-capture.ts <project> <ticket key>");
  const tmpRoot = path.resolve(options.tmpDir ?? path.join(tmpdir(), "plania-replay"));

  if (options.dryRun) {
    for (const c of cases) {
      const { rolePrompt, kit } = resolved(options, c);
      const worktree = path.join(tmpRoot, `${c.id}-t<n>-<random>`, "wt");
      const scratch = path.dirname(worktree);
      const [bin, args] = launch(claudeBin(d.env), claudeArgs({ prompt: "<prompt>", settingsPath: path.join(scratch, "settings.json"), mcpConfigPath: path.join(scratch, "mcp.json"), maxTurns: o.maxTurns, rolePrompt, kit, model: options.model ?? null }));
      d.log(`# ${c.id} (${c.project}, ${c.role}), ${trials} trial${trials === 1 ? "" : "s"}`);
      d.log(`git -C ${quote(path.resolve(expandHome(c.repo)))} worktree add --detach ${quote(worktree)} ${c.base_sha}`);
      d.log(`(cd ${quote(worktree)} && ${[bin, ...args].map(quote).join(" ")})`);
      for (const v of c.verify) d.log(`(cd ${quote(worktree)} && ${v.command})  # verify: ${v.name}`);
      d.log(`git -C ${quote(path.resolve(expandHome(c.repo)))} worktree remove --force ${quote(worktree)}`);
      d.log(`<prompt> =\n${promptOf(c).split("\n").map((l) => `  ${l}`).join("\n")}`);
      d.log("");
    }
    d.log("dry run: nothing was started and no result was written");
    return { result: null, file: null };
  }

  // The worktrees must not sit inside a repository: a nested checkout would read the outer one's config and hooks.
  mkdirSync(tmpRoot, { recursive: true });
  const inside = await d.git(["rev-parse", "--show-toplevel"], tmpRoot);
  if (inside.code === 0 && inside.stdout.trim()) throw new Error(`the temp folder ${tmpRoot} is inside a git repository (${inside.stdout.trim()}): pass --tmp-dir`);

  const startedAt = d.now();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const done: { c: ReplayCase; trials: TrialResult[] }[] = [];
  for (const c of cases) {
    const results: TrialResult[] = [];
    for (let n = 1; n <= trials; n++) {
      const t = await trial(c, n, o, d, tmpRoot);
      results.push(t);
      d.log(`${c.id} trial ${n}/${trials}: ${t.passed ? "pass" : "fail"} (${t.turns} turns, ${t.tokens.total} tokens, ${t.duration_s.toFixed(1)} s)`);
    }
    done.push({ c, trials: results });
  }
  const first = cases[0]!;
  const result = summarize(stamp, startedAt, { trials, role_prompt: options.rolePrompt ? path.resolve(options.rolePrompt) : resolved(options, first).rolePrompt, kit: options.kit ? path.resolve(options.kit) : null, model: options.model ?? null, max_turns: o.maxTurns }, done);
  const dir = options.resultsDir ?? path.join(ROOT, "replay", "results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  d.log("");
  d.log(formatResult(result));
  d.log("");
  d.log(`written: ${file}`);
  return { result, file };
}

// The difference between two result files: per case that either has, and the totals.
export function compareResults(a: ReplayResult, b: ReplayResult): string {
  const ids = [...new Set([...a.cases.map((c) => c.id), ...b.cases.map((c) => c.id)])].sort();
  const signed = (n: number, digits = 0) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
  const points = (x: number | null, y: number | null) => (x === null || y === null ? "—" : `${signed((y - x) * 100)} pts`);
  const rows = ids.map((id) => {
    const x = a.cases.find((c) => c.id === id);
    const y = b.cases.find((c) => c.id === id);
    if (!x || !y) return [id, x ? pctOf(x.pass_rate) : "—", y ? pctOf(y.pass_rate) : "—", x ? "only in a" : "only in b", "", "", ""];
    const turns = avg(y.trials.map((t) => t.turns)) - avg(x.trials.map((t) => t.turns));
    const tokens = avg(y.trials.map((t) => t.tokens.total)) - avg(x.trials.map((t) => t.tokens.total));
    return [id, pctOf(x.pass_rate), pctOf(y.pass_rate), points(x.pass_rate, y.pass_rate), `${x.pass_k ? "yes" : "no"} → ${y.pass_k ? "yes" : "no"}`, signed(turns, 1), signed(Math.round(tokens))];
  });
  rows.push([
    "total",
    pctOf(a.totals.pass_rate),
    pctOf(b.totals.pass_rate),
    points(a.totals.pass_rate, b.totals.pass_rate),
    `${a.totals.pass_k_cases}/${a.totals.cases} → ${b.totals.pass_k_cases}/${b.totals.cases}`,
    signed(b.totals.turns - a.totals.turns),
    signed(b.totals.tokens - a.totals.tokens),
  ]);
  const what = (r: ReplayResult) => `${r.stamp} (trials ${r.options.trials}, model ${r.options.model ?? "default"}, role prompt ${r.options.role_prompt ? path.basename(r.options.role_prompt) : "none"}, kit ${r.options.kit ? path.basename(r.options.kit) : "none"})`;
  return [`a: ${what(a)}`, `b: ${what(b)}`, "", table(["case", "a", "b", "pass rate", "pass^k", "turns", "tokens"], rows), "", "turns and tokens: per-trial average for a case, the sum for the total (b minus a)"].join("\n");
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      case: { type: "string", multiple: true },
      trials: { type: "string" },
      "role-prompt": { type: "string" },
      kit: { type: "string" },
      model: { type: "string" },
      "max-turns": { type: "string" },
      "timeout-minutes": { type: "string" },
      "tmp-dir": { type: "string" },
      "dry-run": { type: "boolean" },
      compare: { type: "boolean" },
    },
  });
  if (values.compare) {
    if (positionals.length !== 2) throw new Error("Usage: replay.ts --compare a.json b.json");
    const [a, b] = positionals.map((f) => JSON.parse(readFileSync(f, "utf8")) as ReplayResult);
    console.log(compareResults(a!, b!));
    return;
  }
  if (positionals.length) throw new Error(`unexpected argument: ${positionals[0]}`);
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const { result } = await runReplay({
    cases: values.case,
    trials: num(values.trials),
    rolePrompt: values["role-prompt"],
    kit: values.kit,
    model: values.model,
    maxTurns: num(values["max-turns"]),
    timeoutMinutes: num(values["timeout-minutes"]),
    tmpDir: values["tmp-dir"],
    dryRun: values["dry-run"],
  });
  // Like a test run: a replay that did not pass everywhere ends non-zero.
  if (result && result.totals.passed < result.totals.trials) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
