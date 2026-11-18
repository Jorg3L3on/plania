// AUDIT-10: the replay set (scripts/replay.ts, scripts/replay-capture.ts). A dry run prints the commands and starts
// nothing; a real run, with a fake Claude and a throwaway git repo, makes a worktree at the base commit outside the
// repo, runs Claude and the verify commands there, removes the worktree and writes the result; two results compare;
// a case is captured from the throwaway database. Nothing reaches a real repo or a real claude.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb, resetPool } = await import("../src/db/client.js");
const replay = await import("../scripts/replay.js");
const { captureCase, writeCase } = await import("../scripts/replay-capture.js");
type ReplayCase = import("../scripts/replay.js").ReplayCase;
type ReplayResult = import("../scripts/replay.js").ReplayResult;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(HERE, "fixtures", "fake-claude.mjs");
const scratch = mkdtempSync(path.join(tmpdir(), "plania-replay-test-"));
const REPO = path.join(scratch, "repo");
const CASES = path.join(scratch, "cases");
const RESULTS = path.join(scratch, "results");
const TMP = path.join(scratch, "tmp");
const KIT = path.join(scratch, "kit");
const ROLE_PROMPT = path.join(scratch, "taller.md");
const RECORD = path.join(scratch, "record.json");
const RECORDER = path.join(scratch, "recording-claude.mjs");
let BASE = "";
let HEAD = "";

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
const PASS = `node -e "process.exit(0)"`;
const FAIL = `node -e "process.exit(1)"`;

const theCase = (id: string, verify: ReplayCase["verify"], patch: Partial<ReplayCase> = {}): ReplayCase => ({
  id,
  project: "zigzag",
  repo: REPO,
  base_sha: BASE,
  role: "taller",
  title: "The login page remembers the last email",
  scope: "Keep the last email that logged in and fill the field with it.",
  checks: ["The field is filled on a second visit", "Nothing is stored for a failed login"],
  verify,
  ...patch,
});
function setCases(...cases: ReplayCase[]): void {
  rmSync(CASES, { recursive: true, force: true });
  mkdirSync(CASES, { recursive: true });
  for (const c of cases) writeFileSync(path.join(CASES, `${c.id}.json`), JSON.stringify(c, null, 2));
}
const collect = () => {
  const lines: string[] = [];
  return { lines, log: (l: string) => void lines.push(l), text: () => lines.join("\n") };
};
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...process.env, CLAUDE_CODE_BIN: FAKE_CLAUDE, FAKE_MS: "30", ...extra });

before(() => {
  mkdirSync(REPO, { recursive: true });
  mkdirSync(KIT, { recursive: true });
  writeFileSync(ROLE_PROMPT, "You build.\n");
  git("init", "-q", "-b", "sandbox");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(REPO, "a.txt"), "base\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  BASE = git("rev-parse", "HEAD");
  writeFileSync(path.join(REPO, "b.txt"), "the change the ticket made\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the ticket");
  HEAD = git("rev-parse", "HEAD");
  // A stand-in that shows where it ran and with what: it leaves a file in its folder and a record outside it.
  writeFileSync(
    RECORDER,
    `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const after = (flag) => argv[argv.indexOf(flag) + 1];
writeFileSync("made.txt", "made by the run\\n");
writeFileSync(process.env.REPLAY_RECORD, JSON.stringify({
  argv, cwd: process.cwd(), a: existsSync("a.txt"), b: existsSync("b.txt"),
  settings: JSON.parse(readFileSync(after("--settings"), "utf8")), mcp: JSON.parse(readFileSync(after("--mcp-config"), "utf8")),
  rolePrompt: readFileSync(after("--append-system-prompt-file"), "utf8"), env: Object.keys(process.env),
}));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 7, result: "OK", modelUsage: { m1: { inputTokens: 100, outputTokens: 20 }, m2: { inputTokens: 5, outputTokens: 1 } } }));
`,
  );
});

after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

test("a case is checked when it is read: an id, a commit, and something to grade with", () => {
  assert.equal(replay.parseCase(theCase("ok", [{ name: "test", command: PASS }]), "ok.json").id, "ok");
  assert.throws(() => replay.parseCase(theCase("no-verify", []), "x.json"), /x\.json: verify is empty/);
  assert.throws(() => replay.parseCase(theCase("bad-sha", [{ name: "t", command: PASS }], { base_sha: "main" }), "x.json"), /base_sha must be a commit sha/);
  assert.throws(() => replay.parseCase(theCase("Bad Id", [{ name: "t", command: PASS }]), "x.json"), /id must be/);
  assert.throws(() => replay.parseCase({ ...theCase("no-scope", [{ name: "t", command: PASS }]), scope: "" }, "x.json"), /scope is missing/);
});

test("the prompt is the ticket: title, scope and checks, and where the work must stay", () => {
  const p = replay.promptOf(theCase("p", [{ name: "t", command: PASS }]));
  assert.match(p, /^# The login page remembers the last email\n\nKeep the last email/);
  assert.match(p, /## Done when\n- The field is filled on a second visit\n- Nothing is stored for a failed login/);
  assert.match(p, /Do not push, open a pull request or write outside this folder\./);
  assert.ok(!replay.promptOf(theCase("p", [{ name: "t", command: PASS }], { checks: [] })).includes("Done when"));
});

test("--dry-run prints every command and starts nothing", async () => {
  setCases(theCase("one", [{ name: "test", command: "pnpm test" }, { name: "typecheck", command: "pnpm exec tsc --noEmit" }]), theCase("two", [{ name: "test", command: "pnpm test" }]));
  const out = collect();
  // A binary that does not exist and a repo that is not there: a dry run must not need either.
  const r = await replay.runReplay(
    { dryRun: true, cases: ["one"], trials: 3, rolePrompt: ROLE_PROMPT, kit: KIT, model: "sonnet", maxTurns: 25, casesDir: CASES, resultsDir: RESULTS, tmpDir: TMP },
    { env: { CLAUDE_CODE_BIN: path.join(scratch, "no-such-claude") }, log: out.log, git: async () => assert.fail("git was called in a dry run") },
  );
  assert.deepEqual(r, { result: null, file: null });
  const text = out.text();
  assert.match(text, /# one \(zigzag, taller\), 3 trials/);
  assert.ok(!text.includes("# two"));
  assert.ok(text.includes(`worktree add --detach`) && text.includes(BASE));
  assert.ok(text.includes("no-such-claude"));
  for (const flag of ["-p '<prompt>'", "--output-format stream-json", "--strict-mcp-config", "--max-turns 25", "--append-system-prompt-file", "--plugin-dir", "--model sonnet"]) assert.ok(text.includes(flag), flag);
  assert.ok(text.includes("pnpm test)  # verify: test") && text.includes("# verify: typecheck"));
  assert.ok(text.includes("worktree remove --force"));
  assert.match(text, /<prompt> =\n {2}# The login page remembers the last email/);
  assert.match(text, /dry run: nothing was started and no result was written/);
  assert.ok(!existsSync(RESULTS) && !existsSync(TMP));
});

test("without a role prompt, a kit or a model, none of their flags is passed", async () => {
  setCases(theCase("plain", [{ name: "test", command: PASS }]));
  const out = collect();
  await replay.runReplay({ dryRun: true, casesDir: CASES, tmpDir: TMP }, { env: {}, log: out.log });
  // kit/roles/taller.md is another track's file: when it exists it is the default, and only then.
  const hasRole = existsSync(path.join(HERE, "..", "kit", "roles", "taller.md"));
  assert.equal(out.text().includes("--append-system-prompt-file"), hasRole);
  assert.ok(!out.text().includes("--plugin-dir") && !out.text().includes("--model"));
  assert.ok(out.text().includes("--max-turns 60"));
});

test("a run with the fake Claude: worktree at the base commit, verify graded, worktree removed, result written", async () => {
  setCases(theCase("green", [{ name: "test", command: PASS }, { name: "lint", command: PASS }]), theCase("red", [{ name: "test", command: PASS }, { name: "lint", command: FAIL }]));
  const out = collect();
  const { result, file } = await replay.runReplay({ trials: 2, casesDir: CASES, resultsDir: RESULTS, tmpDir: TMP }, { env: env(), log: out.log });
  assert.ok(result && file);
  assert.equal(path.dirname(file), RESULTS);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), result);

  const [green, red] = result.cases as ReplayResult["cases"];
  assert.deepEqual([green!.id, green!.passed, green!.pass_rate, green!.pass_k], ["green", 2, 1, true]);
  assert.deepEqual([red!.id, red!.passed, red!.pass_rate, red!.pass_k], ["red", 0, 0, false]);
  for (const t of [...green!.trials, ...red!.trials]) {
    assert.equal(t.turns, 3);
    assert.deepEqual(t.tokens, { input: 30, output: 15, total: 45 });
    assert.deepEqual(t.claude, { ok: true, exit_code: 0, subtype: "success", timed_out: false });
    assert.equal(t.error, null);
    assert.ok(t.duration_s > 0);
  }
  assert.deepEqual(red!.trials[0]!.verify.map((v) => [v.name, v.ok, v.exit_code]), [["test", true, 0], ["lint", false, 1]]);
  assert.deepEqual(result.totals, { cases: 2, trials: 4, passed: 2, pass_rate: 0.5, pass_k_cases: 1, turns: 12, tokens: 180, duration_s: result.totals.duration_s });
  assert.deepEqual(result.options, { trials: 2, role_prompt: result.options.role_prompt, kit: null, model: null, max_turns: 60 });

  // The table: pass rate per case, pass^k, totals, and what failed.
  const text = out.text();
  assert.match(text, /green\s+2\s+2\s+100 %\s+yes/);
  assert.match(text, /red\s+2\s+0\s+0 %\s+no/);
  assert.match(text, /total\s+4\s+2\s+50 %\s+1\/2\s+12\s+180/);
  assert.match(text, /red trial 1: lint failed/);

  // Nothing is left behind, and the repo is as it was.
  assert.deepEqual(readdirSync(TMP), []);
  assert.equal(git("worktree", "list", "--porcelain").match(/^worktree /gm)?.length, 1);
  assert.equal(git("rev-parse", "HEAD"), HEAD);
  assert.equal(git("status", "--porcelain"), "");
});

test("the run happens in the worktree at base_sha, with the role prompt, the kit and no way into Plania", async () => {
  setCases(theCase("recorded", [{ name: "made", command: `node -e "require('fs').accessSync('made.txt')"` }]));
  const { result } = await replay.runReplay(
    { rolePrompt: ROLE_PROMPT, kit: KIT, model: "haiku", maxTurns: 5, casesDir: CASES, resultsDir: RESULTS, tmpDir: TMP },
    { env: env({ CLAUDE_CODE_BIN: RECORDER, REPLAY_RECORD: RECORD, PLANIA_RUNNER_TOKEN: "runner-secret", ANTHROPIC_API_KEY: "sk-ant-secret", DATABASE_URL: "postgres://x", MCP_BEARER_TOKEN: "bearer-secret" }), log: () => undefined },
  );
  const t = result!.cases[0]!.trials[0]!;
  // The verify command found the file the run made: same folder.
  assert.equal(t.passed, true);
  assert.equal(t.turns, 7);
  assert.deepEqual(t.tokens, { input: 105, output: 21, total: 126 });

  const rec = JSON.parse(readFileSync(RECORD, "utf8")) as { argv: string[]; cwd: string; a: boolean; b: boolean; settings: { permissions: { deny: string[] } }; mcp: unknown; rolePrompt: string; env: string[] };
  // The base commit: a.txt is there, the ticket's own change is not.
  assert.deepEqual([rec.a, rec.b], [true, false]);
  assert.ok(path.resolve(rec.cwd).toLowerCase().startsWith(path.resolve(TMP).toLowerCase()) || rec.cwd.includes("plania-replay-test-"), rec.cwd);
  assert.ok(!path.resolve(rec.cwd).toLowerCase().startsWith(path.resolve(REPO).toLowerCase()));
  const arg = (flag: string) => rec.argv[rec.argv.indexOf(flag) + 1];
  assert.match(arg("-p")!, /^# The login page remembers the last email/);
  assert.equal(arg("--max-turns"), "5");
  assert.equal(arg("--model"), "haiku");
  assert.equal(arg("--plugin-dir"), KIT);
  assert.equal(arg("--append-system-prompt-file"), ROLE_PROMPT);
  assert.equal(rec.rolePrompt, "You build.\n");
  assert.ok(rec.argv.includes("--strict-mcp-config"));
  assert.deepEqual(rec.mcp, { mcpServers: {} });
  assert.ok(rec.settings.permissions.deny.includes("Bash(git push*)") && rec.settings.permissions.deny.includes("Bash(gh *)"));
  for (const secret of ["PLANIA_RUNNER_TOKEN", "ANTHROPIC_API_KEY", "DATABASE_URL", "MCP_BEARER_TOKEN"]) assert.ok(!rec.env.includes(secret), secret);
  assert.deepEqual(readdirSync(TMP), []);
});

test("a run that ends in an error is a failed trial even when the checks pass; a missing commit is reported, not thrown", async () => {
  setCases(theCase("crashed", [{ name: "test", command: PASS }]), theCase("gone", [{ name: "test", command: PASS }], { base_sha: "0000000000000000000000000000000000000000" }));
  const out = collect();
  const { result } = await replay.runReplay({ casesDir: CASES, resultsDir: RESULTS, tmpDir: TMP }, { env: env({ FAKE_EXIT: "1" }), log: out.log });
  const [crashed, gone] = result!.cases;
  assert.equal(crashed!.trials[0]!.passed, false);
  assert.equal(crashed!.trials[0]!.claude.ok, false);
  assert.equal(crashed!.trials[0]!.verify[0]!.ok, true);
  assert.equal(gone!.trials[0]!.passed, false);
  assert.match(gone!.trials[0]!.error!, /git worktree add failed/);
  assert.match(out.text(), /crashed trial 1: run success/);
  assert.match(out.text(), /gone trial 1: git worktree add failed/);
  assert.deepEqual(readdirSync(TMP), []);
  assert.equal(git("worktree", "list", "--porcelain").match(/^worktree /gm)?.length, 1);
});

test("bad options are refused before anything starts", async () => {
  setCases(theCase("one", [{ name: "test", command: PASS }]));
  const opts = { casesDir: CASES, resultsDir: RESULTS, tmpDir: TMP };
  await assert.rejects(replay.runReplay({ ...opts, cases: ["nope"] }, { env: env() }), /no such case: nope/);
  await assert.rejects(replay.runReplay({ ...opts, trials: 0 }, { env: env() }), /--trials/);
  await assert.rejects(replay.runReplay({ ...opts, rolePrompt: path.join(scratch, "missing.md") }, { env: env() }), /role prompt not found/);
  await assert.rejects(replay.runReplay({ ...opts, kit: path.join(scratch, "missing-kit") }, { env: env() }), /kit folder not found/);
  await assert.rejects(replay.runReplay({ ...opts, casesDir: path.join(scratch, "empty") }, { env: env() }), /no cases/);
  // A temp folder inside a repository is refused: the worktrees stay outside every repo.
  await assert.rejects(replay.runReplay({ ...opts, tmpDir: path.join(REPO, "tmp") }, { env: env(), log: () => undefined }), /inside a git repository/);
  rmSync(path.join(REPO, "tmp"), { recursive: true, force: true });
});

const trialOf = (passed: boolean, turns: number, tokens: number) => ({ n: 1, passed, claude: { ok: true, exit_code: 0, subtype: "success", timed_out: false }, verify: [], turns, tokens: { input: tokens, output: 0, total: tokens }, duration_s: 1, error: null });
const resultOf = (stamp: string, model: string | null, cases: Record<string, ReturnType<typeof trialOf>[]>): ReplayResult =>
  replay.summarize(stamp, new Date("2026-11-17T00:00:00Z"), { trials: 2, role_prompt: null, kit: null, model, max_turns: 60 }, Object.entries(cases).map(([id, trials]) => ({ c: theCase(id, [{ name: "t", command: PASS }]), trials })));

test("--compare prints the difference per case and in total", async () => {
  const a = resultOf("before", null, { login: [trialOf(true, 10, 1000), trialOf(false, 20, 3000)], pay: [trialOf(false, 30, 5000), trialOf(false, 30, 5000)], old: [trialOf(true, 1, 1), trialOf(true, 1, 1)] });
  const b = resultOf("after", "sonnet", { login: [trialOf(true, 8, 900), trialOf(true, 10, 1100)], pay: [trialOf(true, 30, 5000), trialOf(false, 34, 6000)], fresh: [trialOf(true, 1, 1), trialOf(true, 1, 1)] });
  const text = replay.compareResults(a, b);
  assert.match(text, /a: before \(trials 2, model default, role prompt none, kit none\)/);
  assert.match(text, /b: after \(trials 2, model sonnet/);
  assert.match(text, /login\s+50 %\s+100 %\s+\+50 pts\s+no → yes\s+-6\.0\s+-1000/);
  assert.match(text, /pay\s+0 %\s+50 %\s+\+50 pts\s+no → no\s+\+2\.0\s+\+500/);
  assert.match(text, /fresh\s+—\s+100 %\s+only in b/);
  assert.match(text, /old\s+100 %\s+—\s+only in a/);
  assert.match(text, /total\s+50 %\s+83 %\s+\+33 pts\s+1\/3 → 2\/3/);

  // The same through the command line.
  const fa = path.join(scratch, "a.json");
  const fb = path.join(scratch, "b.json");
  writeFileSync(fa, JSON.stringify(a));
  writeFileSync(fb, JSON.stringify(b));
  const cli = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    execFile(process.execPath, ["--import", "tsx", path.join(HERE, "..", "scripts", "replay.ts"), "--compare", fa, fb], { cwd: path.join(HERE, "..") }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    ),
  );
  assert.equal(cli.code, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), text);
});

// ---- replay-capture: a case from the database

let raw: pg.Client;
const SHA_HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHA_MERGE = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";
const SHA_BEFORE = "c3d4e5f60718293a4b5c6d7e8f90123456789012";
const SHA_BASE = "d4e5f60718293a4b5c6d7e8f9012345678901234";

test("replay-capture: scope, checks, the PR's base commit and the project's verify list", async () => {
  raw = await resetTestDb();
  const { db } = makeDb();
  try {
    const home = path.join(scratch, "home");
    const projects = path.join(home, "Developer");
    mkdirSync(path.join(projects, "zigzag"), { recursive: true });
    const captureEnv = { HOME: home, PLANIA_PROJECTS_ROOT: projects } as NodeJS.ProcessEnv;
    const pid = (await raw.query("select id from projects where slug = 'zigzag'")).rows[0].id as string;
    await raw.query("update projects set settings = $1 where id = $2", [JSON.stringify({ qa: { verify: [{ name: "test", command: "pnpm test", timeout_minutes: 10 }, { name: "typecheck", command: "pnpm exec tsc --noEmit" }] } }), pid]);
    const tid = (await raw.query("insert into tasks (project_id, kind, key, title, status, scope, work_type) values ($1, 'ticket', 'ZIG-12', 'The login page remembers the last email', 'Merged', 'Keep the last email.', 'code') returning id", [pid])).rows[0].id as string;
    await raw.query("insert into checks (task_id, n, position, text) values ($1, 1, 2, 'Second check'), ($1, 2, 1, 'First check')", [tid]);
    await raw.query("insert into checks (task_id, n, position, text, waived_at, waive_reason) values ($1, 3, 3, 'Waived check', now(), 'not needed')", [tid]);
    await raw.query("insert into pull_requests (project_id, repo, number, url, task_id, state, head_sha, base_branch, merge_sha, merged_at) values ($1, 'o/zigzag', 7, 'https://github.com/o/zigzag/pull/7', $2, 'merged', $3, 'sandbox', $4, now())", [pid, tid, SHA_HEAD, SHA_MERGE]);

    const calls: string[][] = [];
    const fakeGit = async (args: string[], cwd: string) => {
      calls.push(args);
      assert.equal(cwd, path.join(projects, "zigzag"));
      if (args[0] === "rev-parse" && args.at(-1) === `${SHA_MERGE}^1`) return { code: 0, stdout: `${SHA_BEFORE}\n`, stderr: "" };
      if (args[0] === "merge-base" && args[1] === SHA_HEAD && args[2] === SHA_BEFORE) return { code: 0, stdout: `${SHA_BASE}\n`, stderr: "" };
      return { code: 1, stdout: "", stderr: "unknown revision" };
    };
    const c = await captureCase(db, { project: "zigzag", key: "ZIG-12" }, { git: fakeGit, env: captureEnv });
    assert.deepEqual(c, {
      id: "zigzag-zig-12",
      project: "zigzag",
      repo: "~/Developer/zigzag",
      base_sha: SHA_BASE,
      role: "taller",
      title: "The login page remembers the last email",
      scope: "Keep the last email.",
      checks: ["First check", "Second check"],
      verify: [{ name: "test", command: "pnpm test", timeout_minutes: 10 }, { name: "typecheck", command: "pnpm exec tsc --noEmit" }],
    });
    assert.deepEqual(calls.map((a) => a[0]), ["rev-parse", "merge-base"]);

    // The file it writes is one replay.ts reads; a second write needs --force.
    const file = writeCase(c, CASES);
    assert.equal(path.basename(file), "zigzag-zig-12.json");
    assert.ok(replay.loadCases(CASES).some((x: ReplayCase) => x.id === "zigzag-zig-12"));
    assert.throws(() => writeCase(c, CASES), /exists: pass --force/);
    assert.equal(writeCase({ ...c, role: "research" }, CASES, true), file);

    // --base-sha skips git; a role and an id can be given.
    const given = await captureCase(db, { project: "zigzag", key: "ZIG-12", baseSha: SHA_HEAD, role: "research", id: "login-email" }, { git: async () => assert.fail("git was called"), env: captureEnv });
    assert.deepEqual([given.id, given.role, given.base_sha], ["login-email", "research", SHA_HEAD]);

    // What cannot be graded or replayed is refused with the reason.
    await assert.rejects(captureCase(db, { project: "zigzag", key: "ZIG-99" }, { git: fakeGit, env: captureEnv }), /ZIG-99 is not a ticket of zigzag/);
    await raw.query("insert into tasks (project_id, kind, key, title, status, scope, work_type) values ($1, 'ticket', 'ZIG-13', 'No PR', 'Ready', 'Something.', 'code')", [pid]);
    await assert.rejects(captureCase(db, { project: "zigzag", key: "ZIG-13" }, { git: fakeGit, env: captureEnv }), /no pull request on record: pass --base-sha/);
    await assert.rejects(captureCase(db, { project: "zigzag", key: "ZIG-12" }, { git: async () => ({ code: 1, stdout: "", stderr: "bad object" }), env: captureEnv }), /could not be worked out/);
    await raw.query("update projects set settings = '{}' where id = $1", [pid]);
    await assert.rejects(captureCase(db, { project: "zigzag", key: "ZIG-12", baseSha: SHA_HEAD }, { env: captureEnv }), /no verify list/);
  } finally {
    await raw.end();
    await resetPool();
  }
});
