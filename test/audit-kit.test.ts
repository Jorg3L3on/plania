// AUDIT-1/2/3/7/9: the runner's kit. Skills from a kit folder, delivered as a plugin in the run's temp folder; the
// prompt version and the skills stamped on the run; the project's checks named in the builder's prompt and run by
// finish; a fresh session after a failure; the project's context docs appended to the role prompt; the kit script.
// Fake child and fake git (no real claude), a kit folder in a temp dir, and the throwaway test database.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-kit-test-"));
const kitDir = path.join(scratch, "kit");
process.env.PLANIA_KIT_DIR = kitDir;
useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");
const surface = await import("../src/mcp/agent-surface.js");
const { wakeAgent } = await import("../src/jobs/heartbeat.js");
const runner = await import("../src/runner/runner.js");
const kit = await import("../src/runner/kit.js");
const packs = await import("../src/runner/packs.js");
const { parseStream } = await import("../src/runner/stream.js");
const { verifyPlan, runVerifyList, tailOf } = await import("../src/runner/verify.js");
const { kitExport, kitStatus, kitSync } = await import("../scripts/kit.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const wtRoot = path.join(scratch, "worktrees");
const repo = path.join(scratch, "repos", "micasa");
const ctx = { actor: { agent: "test-agent", session_id: "s-audit-kit" } };

const TDD = "---\nname: tdd\ndescription: Builds behaviour test first. Use before changing code that has or should have tests.\n---\n\n# TDD\n\nSee one test fail, then make it pass.\n";

function writeKit(): void {
  rmSync(kitDir, { recursive: true, force: true });
  mkdirSync(path.join(kitDir, "skills", "tdd"), { recursive: true });
  writeFileSync(path.join(kitDir, "skills", "tdd", "SKILL.md"), TDD);
  writeFileSync(path.join(kitDir, "skills", "tdd", "mocking.md"), "Mock only at the system's edge.\n");
  mkdirSync(path.join(kitDir, "skills", "no-description"), { recursive: true });
  writeFileSync(path.join(kitDir, "skills", "no-description", "SKILL.md"), "---\nname: no-description\n---\nbody\n");
  writeFileSync(path.join(kitDir, "kits.json"), JSON.stringify({ taller: ["tdd", "gone"], research: [] }));
}

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  // error: the run ends with an error result (a failed run). skill: the stream shows that skill being used.
  exit(code: number, opts: { error?: boolean; skill?: string } = {}): void {
    if (opts.skill) {
      this.stdout.write(
        `${JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { id: `m-${this.pid}`, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 90 }, content: [{ type: "tool_use", name: "Skill", input: { skill: `plania:${opts.skill}` } }] } })}\n`,
      );
    }
    this.stdout.write(
      `${JSON.stringify({ type: "result", subtype: opts.error ? "error_max_turns" : "success", is_error: !!opts.error, num_turns: 1, session_id: `sess-${this.pid}`, result: "OK", modelUsage: { m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })}\n`,
    );
    this.stdout.end();
    setImmediate(() => this.emit("exit", code, null));
  }
}

type Seen = { cwd: string; args: string[]; prompt: string; child: FakeChild; env: NodeJS.ProcessEnv; settings: Record<string, unknown>; rolePrompt: string | null; pluginSkills: string[]; inWorktree: boolean };
const argAfter = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);

function fakes(extraEnv: Record<string, string> = {}) {
  const spawned: Seen[] = [];
  let pid = 60_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_KIT_DIR: kitDir, ...extraEnv } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: wtRoot,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") {
        const target = args.find((a) => a.startsWith(wtRoot))!;
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, ".git"), "gitdir: fake\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "jl/feature\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: (_command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
      pid += 1;
      const child = new FakeChild(pid);
      const plugin = argAfter(args, "--plugin-dir");
      const sys = argAfter(args, "--append-system-prompt-file");
      const skillsDir = plugin ? path.join(plugin, "skills") : null;
      spawned.push({
        cwd: options.cwd,
        args,
        prompt: args[args.indexOf("-p") + 1]!,
        child,
        env: options.env,
        settings: JSON.parse(readFileSync(argAfter(args, "--settings")!, "utf8")),
        rolePrompt: sys ? readFileSync(sys, "utf8") : null,
        pluginSkills: skillsDir && existsSync(skillsDir) ? ["tdd", "pruebas-primero"].filter((s) => existsSync(path.join(skillsDir, s, "SKILL.md"))) : [],
        inWorktree: existsSync(path.join(options.cwd, packs.PACK_DIR)),
      });
      return child;
    },
    kill: () => undefined,
    reportTokens: async (_db: unknown, input: unknown) => input,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

const projectId = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
const ready = (key: string) => writes.createTask(db, { project: "micasa", key, title: "Kit ticket", scope: "Scope", checks: ["Done"], status: "Ready" } as never, ctx);
const wake = (slug: string, deps: unknown, taskKey: string) => wakeAgent(db, { agent: slug, taskKey, now: new Date() }, { runner: deps as never });
const lastRun = async (slug: string) =>
  (
    await raw.query(
      `select r.status, r.resumed, r.prompt_version, r.skills, r.skills_used, r.context_tokens from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1 order by r.queued_at desc limit 1`,
      [slug],
    )
  ).rows[0] as { status: string; resumed: boolean; prompt_version: string | null; skills: string[]; skills_used: string[]; context_tokens: string | null };
const setSettings = (settings: Record<string, unknown> = {}) => raw.query(`update projects set settings = $1::jsonb where slug = 'micasa'`, [JSON.stringify({ local: { repo_path: repo }, ...settings })]);

before(async () => {
  writeKit();
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  await raw.query(`update agents set heartbeat_minutes = null, adapter = 'none', adapter_config = '{}'::jsonb`);
  await raw.query(`update agents set adapter = 'claude_code' where slug in ('taller', 'research')`);
  await raw.query(`update agents set project_id = $1 where slug in ('taller', 'research')`, [await projectId("micasa")]);
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  const micasa = await projectId("micasa");
  for (const title of ["Prompt: Taller", "Prompt: Research"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [micasa, title, `# ${title}\nNever main.`, actor]);
  }
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Pack: Pruebas primero', $2, $3)`, [micasa, "# Pruebas primero\n\nCuándo: antes de cambiar código.\n\n1. Rojo.\n", actor]);
  await raw.query(`insert into goals (project_id, title, why) values ($1, 'Ship the MiCasa beta', '')`, [micasa]);
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  writeKit();
  await raw.query(`delete from qa_lanes`);
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from agent_sessions`);
  await raw.query(`delete from heartbeat_runs`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 2, cooldown_minutes = 0, plan_guard_pct = 70, guard_override = false, reserve_tokens = 1000`);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await setSettings();
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, seven_day_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, 19, now() + interval '3 hours')`);
  await raw.query(`update agents set skill_packs = '{}'`);
  await raw.query(`delete from docs where title like 'Context: %'`);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("AUDIT-2: a skill folder is a pack; the repo wins over a doc with the same slug; a role's default kit applies to a seat with none", async () => {
  assert.deepEqual(kit.frontmatter("---\nname: x\ndescription: >\n  first line\n  second line\n---\nbody\n").fields, { name: "x", description: "first line second line" });
  const skills = kit.repoSkills();
  assert.deepEqual(skills.map((s) => s.slug), ["tdd"], "a folder without a description is not a skill");
  assert.match(skills[0]!.sha, /^[0-9a-f]{8}$/);
  writeFileSync(path.join(kitDir, "skills", "tdd", "mocking.md"), "changed\n");
  assert.notEqual(kit.repoSkills()[0]!.sha, skills[0]!.sha, "a supporting file changes the version");

  const list = await packs.listPacks(db);
  assert.deepEqual(list.map((p) => [p.slug, p.source]), [["tdd", "kit"], ["pruebas-primero", "doc"]]);
  assert.deepEqual(kit.defaultSkills("taller"), ["tdd", "gone"]);
  assert.deepEqual((await packs.packsOf(db, { skillPacks: [] }, process.env, "taller")).map((p) => p.slug), ["tdd"], "a default that does not exist is skipped");
  assert.deepEqual((await packs.packsOf(db, { skillPacks: ["pruebas-primero"] }, process.env, "taller")).map((p) => p.slug), ["pruebas-primero"], "the seat's own list wins");
  assert.deepEqual(await packs.packsOf(db, { skillPacks: [] }, { ...process.env, PLANIA_DEFAULT_KITS: "0" }, "taller"), []);
  assert.deepEqual(await packs.packsOf(db, { skillPacks: [] }, process.env), [], "no role, no defaults");
});

test("AUDIT-3: the run's kit is a plugin in its temp folder; the worktree is left alone; the run is stamped with what it was given and used", async () => {
  await raw.query(`update agents set skill_packs = '{tdd,pruebas-primero}' where slug = 'taller'`);
  await ready("KIT-1");
  const f = fakes();
  assert.equal((await wake("taller", f.deps, "KIT-1")).reason, "ok");
  const run = f.spawned[0]!;
  const plugin = argAfter(run.args, "--plugin-dir")!;
  assert.ok(plugin.startsWith(path.join(scratch, "tmp")), "outside every repo");
  assert.equal(argAfter(run.args, "--add-dir"), plugin);
  assert.deepEqual(run.pluginSkills, ["tdd", "pruebas-primero"]);
  assert.equal(run.inWorktree, false, "nothing is written into the app's worktree");
  assert.match(run.prompt, /- plania:tdd \(.*SKILL\.md\): Builds behaviour test first/);
  assert.match(run.prompt, /- plania:pruebas-primero \(.*SKILL\.md\): antes de cambiar código\./);
  assert.doesNotMatch(run.prompt, /\.plania-packs/);
  assert.ok(!run.args.includes("--bare") && !run.args.includes("--setting-sources"), "isolation is off unless asked for");
  assert.equal(run.env.MCP_TOOL_TIMEOUT, String(30 * 60_000));
  assert.equal(JSON.parse(readFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name, "plania");
  assert.equal(readFileSync(path.join(plugin, "skills", "tdd", "mocking.md"), "utf8"), "Mock only at the system's edge.\n", "supporting files come along");
  assert.match(readFileSync(path.join(plugin, "skills", "pruebas-primero", "SKILL.md"), "utf8"), /^---\nname: pruebas-primero\ndescription: "antes de cambiar código\."\n---\n\n# Pruebas primero/);

  run.child.exit(0, { skill: "tdd" });
  await runner.waitForAllRuns();
  const row = await lastRun("taller");
  assert.equal(row.status, "ok");
  assert.match(row.prompt_version!, /^1:[0-9a-f]{12}$/);
  assert.deepEqual(row.skills.map((s) => s.replace(/@[0-9a-f]{8}$/, "@sha")), ["tdd@sha", "pruebas-primero@sha"]);
  assert.deepEqual(row.skills_used, ["tdd"]);
  assert.equal(Number(row.context_tokens), 1000);
  assert.equal(existsSync(plugin), false, "the kit leaves with the run");
});

test("AUDIT-3: PLANIA_RUN_ISOLATION adds the flag that keeps the server account's own Claude folder out", async () => {
  assert.equal(runner.isolationOf({ PLANIA_RUN_ISOLATION: "Project" }), "project");
  assert.equal(runner.isolationOf({ PLANIA_RUN_ISOLATION: "anything" }), null);
  const base = { prompt: "p", settingsPath: "s", mcpConfigPath: "m", systemPromptPath: null, maxTurns: 5, resume: null };
  assert.deepEqual(runner.claudeArgs({ ...base, isolation: "project" }).slice(-2), ["--setting-sources", "project,local"]);
  assert.equal(runner.claudeArgs({ ...base, isolation: "bare" }).at(-1), "--bare");
  assert.deepEqual(runner.claudeArgs({ ...base, jsonSchema: { type: "object" } }).slice(-2), ["--json-schema", '{"type":"object"}']);
  await ready("KIT-ISO");
  const f = fakes({ PLANIA_RUN_ISOLATION: "project" });
  await wake("taller", f.deps, "KIT-ISO");
  assert.equal(argAfter(f.spawned[0]!.args, "--setting-sources"), "project,local");
  f.spawned[0]!.child.exit(0);
});

test("AUDIT-1: the builder's prompt names the project's checks, and its settings carry the after-edit hook; other roles get neither", async () => {
  await setSettings({ qa: { verify: [{ name: "test", command: "pnpm test" }, { name: "types", command: "pnpm tsc --noEmit" }], after_edit: { command: "pnpm prettier --write .", timeout_seconds: 20 } } });
  await ready("KIT-V");
  const f = fakes();
  await wake("taller", f.deps, "KIT-V");
  const taller = f.spawned[0]!;
  assert.match(taller.prompt, /finish runs them again and refuses a delivery that fails one:\n- test: `pnpm test`\n- types: `pnpm tsc --noEmit`/);
  assert.deepEqual(taller.settings.hooks, { PostToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "pnpm prettier --write .", timeout: 20 }] }] });
  assert.ok(Array.isArray((taller.settings.permissions as { deny: string[] }).deny), "the deny rules are still there");
  taller.child.exit(0);
  await runner.waitForAllRuns();
  await wake("research", f.deps, "KIT-V");
  const research = f.spawned[1]!;
  assert.doesNotMatch(research.prompt, /Checks Plania runs/);
  assert.equal(research.settings.hooks, undefined);
  research.child.exit(0);
});

test("AUDIT-7: after a failed run the next one starts a fresh session with a handoff; a clean run resumes; PLANIA_RETRY_FRESH=0 always resumes", async () => {
  await ready("KIT-R");
  const f = fakes();
  await wake("taller", f.deps, "KIT-R");
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  await wake("taller", f.deps, "KIT-R");
  assert.equal(argAfter(f.spawned[1]!.args, "--resume"), `sess-${f.spawned[0]!.child.pid}`, "a run that ended well is resumed");
  assert.doesNotMatch(f.spawned[1]!.prompt, /fresh session/);
  f.spawned[1]!.child.exit(1, { error: true });
  await runner.waitForAllRuns();
  assert.equal((await lastRun("taller")).status, "fail");

  await wake("taller", f.deps, "KIT-R");
  const third = f.spawned[2]!;
  assert.equal(argAfter(third.args, "--resume"), null);
  assert.match(third.prompt, /This is a fresh session on work that was already started \(the last run on it failed\)/);
  assert.ok(third.rolePrompt, "a fresh session gets the role prompt again");
  third.child.exit(1, { error: true });
  await runner.waitForAllRuns();
  assert.equal((await lastRun("taller")).resumed, false);

  const keep = fakes({ PLANIA_RETRY_FRESH: "0" });
  await wake("taller", keep.deps, "KIT-R");
  assert.equal(argAfter(keep.spawned[0]!.args, "--resume"), `sess-${third.child.pid}`);
  keep.spawned[0]!.child.exit(0);
});

test("AUDIT-7: a delivery QA sent back, or a session that grew long, is not resumed either", async () => {
  await ready("KIT-Q");
  const f = fakes();
  await wake("taller", f.deps, "KIT-Q");
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  const micasa = await projectId("micasa");
  const taskId = (await raw.query(`select id from tasks where key = 'KIT-Q'`)).rows[0].id;
  await raw.query(`insert into qa_lanes (project_id, task_id, task_key, status, returned) values ($1, $2, 'KIT-Q', 'fail', true)`, [micasa, taskId]);
  await wake("taller", f.deps, "KIT-Q");
  assert.match(f.spawned[1]!.prompt, /\(QA sent the delivery back\)/);
  f.spawned[1]!.child.exit(0);
  await runner.waitForAllRuns();

  await raw.query(`delete from qa_lanes`);
  await raw.query(`update agent_runs set context_tokens = 150000 where id = (select id from agent_runs order by queued_at desc limit 1)`);
  await wake("taller", f.deps, "KIT-Q");
  assert.match(f.spawned[2]!.prompt, /\(the earlier session grew too long\)/);
  f.spawned[2]!.child.exit(0);
});

test("AUDIT-9: the project's context docs ride with the role prompt, in a fixed order and cut at 200 lines", async () => {
  const micasa = await projectId("micasa");
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Context: Commands', 'Test: pnpm test', $2), ($1, 'Context: Glossary', 'Sucursal: a branch office.', $2)`, [micasa, actor]);
  await ready("KIT-C");
  const f = fakes();
  await wake("taller", f.deps, "KIT-C");
  const text = f.spawned[0]!.rolePrompt!;
  assert.match(text, /^# Prompt: Taller\nNever main\.\n\n# Project context\n/);
  assert.ok(text.indexOf("## Glossary") < text.indexOf("## Commands"));
  assert.match(text, /## Commands\n\nTest: pnpm test/);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();

  await raw.query(`update docs set markdown = $1 where title = 'Context: Glossary'`, [Array.from({ length: 300 }, (_, i) => `term ${i}`).join("\n")]);
  const long = (await runner.projectContext(db, micasa))!;
  assert.match(long, /\(cut at 200 lines\)$/);
  assert.equal(long.split("\n").length, 4 + 200 + 1);
});

test("PLA-147: the project's pinned live decisions ride with the role prompt; retired and superseded ones do not", async () => {
  const micasa = await projectId("micasa");
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  const ins = async (line: string, pinned = true, retired = false) =>
    (await raw.query(`insert into decisions (project_id, line, pinned, retired_at, actor) values ($1, $2, $3, ${retired ? "now()" : "null"}, $4) returning id`, [micasa, line, pinned, actor])).rows[0].id as string;
  await ins("Everything runs locally: no hosting.");
  await ins("Not pinned, stays out.", false);
  await ins("Retired rule.", true, true);
  const old = await ins("Old rule, reversed.");
  const fresh = await ins("New rule that reverses it.");
  await raw.query(`insert into decision_supersessions (decision_id, supersedes_id) values ($1, $2)`, [fresh, old]);
  const block = (await runner.pinnedDecisionsBlock(db, micasa))!;
  assert.match(block, /^# Pinned decisions\n/);
  assert.match(block, /- Everything runs locally: no hosting\./);
  assert.match(block, /- New rule that reverses it\./);
  for (const gone of ["Not pinned", "Retired rule", "Old rule, reversed"]) assert.ok(!block.includes(gone), gone);
  assert.equal(await runner.pinnedDecisionsBlock(db, "00000000-0000-0000-0000-000000000000"), null, "no pinned decisions: no block");

  await ready("KIT-P");
  const f = fakes();
  await wake("research", f.deps, "KIT-P");
  assert.match(f.spawned[0]!.rolePrompt!, /# Pinned decisions\n[\s\S]*Everything runs locally/);
  f.spawned[0]!.child.exit(0);
  await runner.waitForAllRuns();
  await raw.query(`delete from decision_supersessions`);
  await raw.query(`delete from decisions where project_id = $1`, [micasa]);
});

test("AUDIT-2: with no prompt doc the repo's role file is used, and the version says so", async () => {
  assert.equal(await runner.promptDoc(db, "qa", process.env), null);
  mkdirSync(path.join(kitDir, "roles"), { recursive: true });
  writeFileSync(path.join(kitDir, "roles", "qa.md"), "# QA\nJudge the change on its own.\n");
  const doc = (await runner.promptDoc(db, "qa", process.env))!;
  assert.equal(doc.markdown, "# QA\nJudge the change on its own.");
  assert.match(doc.version, /^git:[0-9a-f]{12}$/);
  assert.match((await runner.promptDoc(db, "taller", process.env))!.version, /^1:[0-9a-f]{12}$/);
});

test("AUDIT-2: the stream names the skills a run used, by the Skill tool or by reading the file", () => {
  const lines = [
    { type: "assistant", parent_tool_use_id: null, message: { id: "a", usage: { input_tokens: 5, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 500 }, content: [{ type: "tool_use", name: "Skill", input: { skill: "plania:tdd" } }] } },
    { type: "assistant", parent_tool_use_id: "toolu_1", message: { id: "b", usage: { input_tokens: 5, cache_read_input_tokens: 9 }, content: [{ type: "tool_use", name: "Read", input: { file_path: "/tmp/run/kit/skills/pr/SKILL.md" } }] } },
    { type: "assistant", parent_tool_use_id: null, message: { id: "c", usage: { input_tokens: 7, cache_read_input_tokens: 41_000, cache_creation_input_tokens: 0 }, content: [{ type: "tool_use", name: "Read", input: { file_path: "C:\\tmp\\kit\\skills\\diagnosing-bugs\\SKILL.md" } }, { type: "tool_use", name: "Read", input: { file_path: "src/app.ts" } }] } },
  ];
  const r = parseStream(lines.map((l) => JSON.stringify(l)).join("\n"));
  assert.deepEqual([...r.skillsUsed].sort(), ["diagnosing-bugs", "pr", "tdd"]);
  assert.equal(r.contextTokens, 41_007, "the last top-level turn; a subagent's turn does not count");
});

test("AUDIT-1: finish runs the project's checks in the ticket's workspace and refuses a failing delivery with its last lines", async () => {
  const workspace = path.join(scratch, "ws-finish");
  mkdirSync(workspace, { recursive: true });
  const me = { actor: { agent: "taller", session_id: "s-finish" } };
  await writes.createTask(db, { project: "micasa", key: "KIT-F", title: "Finish ticket", scope: "Scope", checks: ["Done"], status: "Ready", work_type: "code" } as never, me);
  await surface.start(db, { project: "micasa", key: "KIT-F", workspace: { worktree_path: workspace, branch: "jl/kit-f" } }, me as never);
  await setSettings({ qa: { verify: [{ name: "types", command: "tsc" }, { name: "test", command: "pnpm test" }, { name: "lint", command: "eslint ." }] } });
  const input = { project: "micasa", key: "KIT-F", result: { kind: "unit", verdict: "pass", cite: "pnpm test: 3 pass", check_ns: [1] }, pr_url: "https://github.com/jorge/micasa/pull/9", branch: "jl/kit-f" };

  const ran: string[] = [];
  const failing = async (command: string, opts: { cwd: string }) => {
    ran.push(`${command} @ ${opts.cwd}`);
    return command === "pnpm test" ? { code: 1, stdout: `${"noise\n".repeat(60)}\x1b[31m✖ sucursales.test.ts: expected 2, got 3\x1b[0m\n`, stderr: "1 failing\n" } : { code: 0, stdout: "ok", stderr: "" };
  };
  await assert.rejects(surface.finish(db, input as never, me as never, { exec: failing }), (e: { code: string; detail: { failed: { name: string; exit_code: number; tail: string }; passed: string[]; hint: string } }) => {
    assert.equal(e.code, "VERIFY_FAILED");
    assert.equal(e.detail.failed.name, "test");
    assert.equal(e.detail.failed.exit_code, 1);
    assert.match(e.detail.failed.tail, /✖ sucursales\.test\.ts: expected 2, got 3\n1 failing$/);
    assert.ok(e.detail.failed.tail.split("\n").length <= 40 && !e.detail.failed.tail.includes("\x1b"), "short and plain");
    assert.deepEqual(e.detail.passed, ["types"]);
    assert.match(e.detail.hint, /`pnpm test` fails in the workspace/);
    return true;
  });
  assert.deepEqual(ran, [`tsc @ ${workspace}`, `pnpm test @ ${workspace}`], "in order, stopping at the first failure");
  assert.equal((await raw.query(`select status from tasks where key = 'KIT-F'`)).rows[0].status, "In progress", "a refused finish writes nothing");

  // Another session's finish does not run the checks (the write refuses it on its own).
  assert.deepEqual(verifyPlan({ settings: { qa: { verify: [{ name: "t", command: "t" }] } } } as never, { kind: "ticket", workType: "code", workspace: { worktree_path: workspace }, owner: { session_id: "someone-else" } } as never, "s-finish"), { run: false });

  const passing = async () => ({ code: 0, stdout: "all good", stderr: "" });
  const out = (await surface.finish(db, input as never, me as never, { exec: passing })) as { status: string; verified: { name: string; ok: boolean }[] };
  assert.equal(out.status, "In review");
  assert.deepEqual(out.verified.map((v) => [v.name, v.ok]), [["types", true], ["test", true], ["lint", true]]);
});

test("AUDIT-1: finish skips the checks, and says so, when the project turned them off or the workspace is not here", async () => {
  const owner = { session_id: "s" };
  const ticket = { kind: "ticket", workType: "bug", workspace: { worktree_path: "/gone" }, owner } as never;
  const verify = [{ name: "test", command: "pnpm test" }];
  assert.deepEqual(verifyPlan({ settings: { qa: { verify } } } as never, ticket, "s", () => false), { run: false, warning: "checks not run at finish: the workspace folder is not on this machine" });
  assert.deepEqual(verifyPlan({ settings: { qa: { verify } } } as never, ticket, "s", () => true), { run: true, cwd: "/gone", items: verify });
  assert.deepEqual(verifyPlan({ settings: { qa: { verify, verify_on_finish: false } } } as never, ticket, "s", () => true), { run: false });
  assert.deepEqual(verifyPlan({ settings: { qa: { verify: [] } } } as never, ticket, "s", () => true), { run: false });
  assert.deepEqual(verifyPlan({ settings: { qa: { verify } } } as never, { ...(ticket as object), workType: "research" } as never, "s", () => true), { run: false });
  assert.deepEqual(verifyPlan({ settings: { qa: { verify } } } as never, { ...(ticket as object), workspace: { worktree_path: "/x", machine: "another-mac" } } as never, "s", () => true), { run: false, warning: "checks not run at finish: the workspace is on another-mac" });
  assert.equal(tailOf("a\n\n\nb  \n"), "a\nb");
  const one = await runVerifyList("/x", verify, async () => ({ code: 0, stdout: "long output", stderr: "" }));
  assert.equal(one[0]!.tail, "", "a passing check says nothing");
});

test("AUDIT-2: the kit script exports the live prompts, syncs the repo's, and leaves a doc edited in Plania alone", async () => {
  rmSync(path.join(kitDir, "roles"), { recursive: true, force: true });
  await raw.query(`delete from machine_state where key = 'kit.synced'`);
  const stateOf = async (role: string) => (await kitStatus(db)).find((r) => r.role === role)!.state;
  assert.equal(await stateOf("taller"), "doc_only");
  assert.equal(await stateOf("qa"), "missing");

  const wrote = await kitExport(db);
  assert.deepEqual(wrote.roles.sort(), ["research", "taller"]);
  assert.deepEqual(wrote.skills, ["pruebas-primero"], "a pack doc becomes a skill folder");
  assert.equal(readFileSync(path.join(kitDir, "roles", "taller.md"), "utf8"), "# Prompt: Taller\nNever main.\n");
  assert.equal(await stateOf("taller"), "same");
  assert.deepEqual((await packs.listPacks(db)).map((p) => [p.slug, p.source]), [["pruebas-primero", "kit"], ["tdd", "kit"]]);

  // The repo moves: sync writes it.
  writeFileSync(path.join(kitDir, "roles", "taller.md"), "# Prompt: Taller\nNever main. Run the checks.\n");
  assert.equal(await stateOf("taller"), "repo_newer");
  assert.deepEqual((await kitSync(db)).written, ["taller"]);
  const doc = (await raw.query(`select markdown, version from docs where title = 'Prompt: Taller'`)).rows[0];
  assert.equal(doc.markdown, "# Prompt: Taller\nNever main. Run the checks.\n");
  assert.equal(doc.version, 2);
  assert.equal(await stateOf("taller"), "same");

  // Plania moves and the repo too: sync leaves it alone unless forced.
  await raw.query(`update docs set markdown = '# Prompt: Taller\nEdited on screen.', version = version + 1 where title = 'Prompt: Taller'`);
  assert.equal(await stateOf("taller"), "doc_newer");
  writeFileSync(path.join(kitDir, "roles", "taller.md"), "# Prompt: Taller\nEdited in the repo.\n");
  assert.equal(await stateOf("taller"), "both_changed");
  const held = await kitSync(db);
  assert.deepEqual([held.written, held.drift], [[], ["taller"]]);
  assert.match((await raw.query(`select markdown from docs where title = 'Prompt: Taller'`)).rows[0].markdown, /Edited on screen/);
  assert.deepEqual((await kitSync(db, { force: true })).written, ["taller"]);
  assert.match((await raw.query(`select markdown from docs where title = 'Prompt: Taller'`)).rows[0].markdown, /Edited in the repo/);

  // A role only in the repo gets its doc.
  writeFileSync(path.join(kitDir, "roles", "qa.md"), "# QA\nJudge the change on its own.\n");
  assert.equal(await stateOf("qa"), "repo_only");
  assert.deepEqual((await kitSync(db)).written, ["qa"]);
  assert.equal((await raw.query(`select count(*)::int as n from docs where title = 'Prompt: QA'`)).rows[0].n, 1);
});

test("AUDIT-6: a QA walk-through adds the browser tools to that run's servers; an idea is delivered with deliver_stage", () => {
  assert.deepEqual(Object.keys(runner.mcpConfig("http://x/mcp").mcpServers), ["plania"]);
  // A finish that runs the project's checks is silent for minutes; without this Claude Code drops the call at five.
  assert.equal(runner.mcpConfig("http://x/mcp").mcpServers.plania.timeout, 30 * 60_000);
  assert.deepEqual(runner.browserServer({}), { command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless", "--isolated"] });
  const cfg = runner.mcpConfig("http://x/mcp", runner.browserServer({ PLANIA_BROWSER_MCP: "node  /opt/browser.js --headless" }));
  assert.deepEqual(cfg.mcpServers.browser, { command: "node", args: ["/opt/browser.js", "--headless"] });
  const idea = runner.userPrompt({ agent: "Research", role: "research", project: { slug: "micasa", title: "MiCasa" }, goal: null, task: { key: "MIC-IDEA3", title: "Sucursales" }, workspace: null, sessionId: "run-1", verify: [{ name: "test", command: "pnpm test" }] });
  assert.match(idea, /deliver your stage with deliver_stage \(key MIC-IDEA3/);
  assert.doesNotMatch(idea, /Checks Plania runs/, "an idea has no delivery to check");
});
