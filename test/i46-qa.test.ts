// PLA-I46-9: the QA lane. A code delivery on a project with a QA teammate gets the verify list, captures, a fresh
// review and the PO's check-list marks before the floor shows it; a failing pass goes back to Taller once; a usage
// hold stops the QA run; nothing is written to the app repo. Every process is fake (git, the verify commands, the
// app, Chrome, claude); throwaway DB; nothing reaches a real repo or a real claude.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const writes = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const runner = await import("../src/runner/runner.js");
const qa = await import("../src/runner/qa.js");
const { decisionsRead } = await import("../src/api/company-decisions.js");
const { resolveThread } = await import("../src/runner/threads.js");
const { worktreePathFor } = await import("../src/runner/worktree.js");
const { DENY_RULES, QA_DENY_RULES, deniedBy } = await import("../src/runner/deny.js");
const { parseQaSettings, modelFor } = await import("../src/runner/qa-settings.js");

type Db = ReturnType<typeof makeDb>["db"];
type Json = Record<string, any>;
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i46-qa-"));
const ROOT = path.join(scratch, "worktrees");
const REPO = path.join(scratch, "repo");
const A = { actor: { agent: "test-agent", session_id: "s-i46-qa" } };
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const SHA1 = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHA2 = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(text = "OK"): void {
    const result = { type: "result", subtype: "success", is_error: false, num_turns: 3, session_id: "sess-qa", result: text, modelUsage: { "claude-sonnet-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}

// The delivery's checkout: git answers from this state, and every call is kept (nothing may write).
const repo = { head: SHA1, branch: "jl/zig-01", calls: [] as string[][] };
const git = async (args: string[], _cwd: string) => {
  repo.calls.push(args);
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: `${repo.branch}\n`, stderr: "" };
  if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: `${repo.head}\n`, stderr: "" };
  if (args[0] === "diff" && args[1] === "--shortstat") return { code: 0, stdout: " 2 files changed, 10 insertions(+), 3 deletions(-)\n", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

// The verify commands: what each prints and its exit code.
let verifyOut: Record<string, { code: number; out: string }> = {};
const execCalls: { command: string; cwd: string; env?: NodeJS.ProcessEnv }[] = [];
const exec = async (command: string, opts: { cwd: string; env?: NodeJS.ProcessEnv }) => {
  execCalls.push({ command, cwd: opts.cwd, env: opts.env });
  const r = verifyOut[command] ?? { code: 0, out: "" };
  return { code: r.code, stdout: r.out, stderr: "" };
};
const appStarts: { command: string; url: string }[] = [];
let appStops = 0;
const startApp = async (input: { command: string; url: string }) => {
  appStarts.push(input);
  return { ok: true, error: null, stop: async () => void appStops++ };
};
const capture = async (_db: Db, input: { project: string; task_key?: string; commit?: string; base_url?: string }) => ({
  run_id: "11111111-1111-4111-8111-111111111111",
  project: input.project,
  task_key: input.task_key ?? null,
  commit: input.commit ?? null,
  branch: null,
  base_url: input.base_url ?? "",
  ok: 2,
  failed: 0,
  stills: [
    { page: "inicio", viewport: "desktop" as const, status: "ok" as const, id: "22222222-2222-4222-8222-222222222222" },
    { page: "inicio", viewport: "phone" as const, status: "ok" as const, id: "33333333-3333-4333-8333-333333333333" },
  ],
});

function runnerFakes() {
  const spawned: { args: string[]; cwd: string; child: FakeChild }[] = [];
  let pid = 70_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: ROOT,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git,
    spawn: (_command: string, args: string[], options: { cwd: string }) => {
      const child = new FakeChild(++pid);
      spawned.push({ args, cwd: options.cwd, child });
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}
let rf = runnerFakes();
const qaDeps = () => ({ exec, git, env: rf.deps.env, worktreeRoot: ROOT, startApp, capture, freePort: async () => 4455, runner: rf.deps as never, publicUrl: "http://127.0.0.1:3737" }) as never;

const pid = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
const lane = async (key: string) => (await raw.query(`select * from qa_lanes where task_key = $1 order by created_at desc limit 1`, [key])).rows[0];
const ticket = async (key: string) => (await raw.query(`select status, version from tasks where key = $1`, [key])).rows[0];
const runs = async () => (await raw.query(`select a.slug, r.status, r.task_key, r.summary from agent_runs r join agents a on a.id = r.agent_id order by r.queued_at`)).rows;
const card = async (key: string) => (await decisionsRead(db)).find((d) => d.ref === key && (d.kind === "pr" || d.kind === "deliverable")) ?? null;
const promptOf = (s: { args: string[] }) => s.args[s.args.indexOf("-p") + 1]!;
const report = (review: "pass" | "fail", marks: ("pass" | "fail")[], notes = "Hace lo que pide el ticket.") =>
  `Revisé el cambio.\n\`\`\`qa-report\n${JSON.stringify({ review: { verdict: review, notes }, checklist: marks.map((mark, i) => ({ n: i + 1, mark, note: `revisado ${i + 1}` })) })}\n\`\`\``;

// A Taller delivery: the ticket In review with its PR, the PR row at head, and Taller's message with the PR.
async function deliver(key: string, head: string, prNumber: number) {
  const url = `https://github.com/jorg3l3on/zigzag/pull/${prNumber}`;
  const t = await ticket(key);
  if (t.status !== "In review") await raw.query(`update tasks set status = 'In review', status_changed_at = now(), pr_url = $2, branch = $3 where key = $1`, [key, url, `jl/${key.toLowerCase()}`]);
  // Taller ticked its Done when before delivering.
  await raw.query(`update checks set done = true, done_at = now() where task_id = (select id from tasks where key = $1)`, [key]);
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, task_id, state, head_sha, head_branch, base_branch, ci_state)
     values ($1, 'jorg3l3on/zigzag', $2, $3, (select id from tasks where key = $4), 'open', $5, $6, 'sandbox', 'none')
     on conflict (project_id, repo, number) do update set head_sha = excluded.head_sha, updated_at = now()`,
    [await pid("zigzag"), prNumber, url, key, head, `jl/${key.toLowerCase()}`],
  );
  const { thread } = await resolveThread(db, "zigzag");
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'taller-zz', 'taller', $2, $3)`, [
    thread.id,
    `Listo ${key}: PR #${prNumber}`,
    JSON.stringify([
      { kind: "ticket", ref: key, title: `Paso ${key}` },
      { kind: "pr", ref: url, title: `PR #${prNumber}` },
    ]),
  ]);
  repo.head = head;
  repo.branch = `jl/${key.toLowerCase()}`;
  mkdirSync(worktreePathFor(ROOT, "zigzag", key), { recursive: true });
}

async function newTicket(title: string): Promise<string> {
  const out = (await writes.createTask(db, { project: "zigzag", title, scope: "Formulario de registro con correo.", checks: ["El formulario guarda el correo"], work_type: "code", status: "Ready" } as never, A)) as Json;
  return out.key;
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  mkdirSync(REPO, { recursive: true });
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Taller", "Prompt: QA"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [await pid("micasa"), title, `# ${title}\nNever main.`, actor]);
  }
  const z = await pid("zigzag");
  await raw.query(
    `insert into agents (slug, name, role, kind, adapter, project_id, role_template) values
       ('taller-zz', 'Taller', 'engineer', 'coder', 'claude_code', $1, 'taller'),
       ('qa-zz', 'QA Zigzag', 'qa', 'bot', 'claude_code', $1, 'qa')`,
    [z],
  );
  // QA has run before in this checkout: its session must not be resumed (a fresh review).
  const p = await findProject(db, "zigzag");
  await setProject(
    db,
    {
      project: "zigzag",
      version: p.version,
      settings: {
        qa: { verify: [{ name: "test", command: "pnpm test" }, { name: "typecheck", command: "pnpm typecheck" }] },
        capture: { start_command: "pnpm dev --port {port}", port: 3000, pages: [{ key: "inicio", path: "/", label: "Inicio" }] },
      },
    } as never,
    A,
  );
  await raw.query(`update projects set settings = settings || $2::jsonb where slug = $1`, ["zigzag", JSON.stringify({ local: { repo_path: REPO } })]);
});

beforeEach(async () => {
  await qa.waitForQa();
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  rf = runnerFakes();
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 2, cooldown_minutes = 0, plan_guard_pct = 70`);
  await raw.query(`update projects set runs_paused = false where slug = 'zigzag'`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
  await raw.query(`delete from agent_runs`);
  execCalls.length = 0;
  repo.calls.length = 0;
  verifyOut = { "pnpm test": { code: 0, out: "ℹ tests 14\nℹ pass 14\nℹ fail 0\n" }, "pnpm typecheck": { code: 0, out: "" } };
});

after(async () => {
  await qa.waitForQa();
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

// One heartbeat's worth of QA: open/run the checks, then the review run through the runner.
async function tick() {
  const out = await qa.sweepQa(db, new Date(), qaDeps());
  await qa.waitForQa();
  return out;
}

test("I46-9 settings: settings.qa is validated by set_project; the review model follows the size of the change", async () => {
  assert.equal(parseQaSettings({ verify: [{ name: "test", command: "pnpm test" }] }).ok, true);
  const bad = parseQaSettings({ verify: [{ name: "test", command: "a" }, { name: "test", command: "b" }] });
  assert.equal(bad.ok, false);
  const p = await findProject(db, "zigzag");
  await assert.rejects(setProject(db, { project: "zigzag", version: p.version, settings: { qa: { verify: "pnpm test" } } } as never, A), /INVALID_FILTER/);
  assert.equal(modelFor({ verify: [] }, 13), "sonnet");
  assert.equal(modelFor({ verify: [], small_lines: 10 }, 13), null);
  assert.equal(modelFor({ verify: [], model: "opus" }, 900), "opus");
  assert.deepEqual(qa.parseCounts("ℹ tests 3\nℹ pass 2\nℹ fail 1\n"), { pass: 2, fail: 1 });
  assert.deepEqual(qa.parseCounts(" Test Files  1 passed (1)\n      Tests  1 failed | 13 passed (14)\n"), { pass: 13, fail: 1 });
  assert.deepEqual(qa.parseCounts("Found 0 errors."), { pass: null, fail: null });
  assert.equal(qa.parseReport(report("pass", ["pass"]), [1, 2]), null, "every check-list item must be marked");
});

test("I46-9 #1 #4: a code delivery gets tests, captures, a fresh review and check-list marks before Te toca; nothing is written to the repo", async () => {
  const key = await newTicket("Formulario de registro");
  await qa.setPoChecks(db, { project: "zigzag", key, items: ["El correo se guarda", "Se ve bien a 390", "Muestra el error si falta el correo"] }, A.actor);
  await deliver(key, SHA1, 11);
  const [qaAgent] = (await raw.query(`select id from agents where slug = 'qa-zz'`)).rows;
  await raw.query(`insert into agent_sessions (agent_id, project_id, claude_session_id, cwd, runs) values ($1, $2, 'old-session', $3, 1)`, [qaAgent.id, await pid("zigzag"), worktreePathFor(ROOT, "zigzag", key)]);

  // Before QA: the floor shows no card for it (not the owner's turn yet).
  assert.equal(await card(key), null);
  const first = await tick();
  assert.deepEqual([first.opened, first.started], [1, 1]);
  let l = await lane(key);
  assert.equal(l.status, "reviewing");
  assert.equal(l.commit, SHA1);
  assert.equal(l.diff_lines, 13);
  assert.equal(l.model, "sonnet", "a 13-line change reviews on the smaller model");
  assert.deepEqual(l.verify.map((v: Json) => [v.name, v.ok, v.pass, v.fail]), [["test", true, 14, 0], ["typecheck", true, null, null]]);
  assert.deepEqual(l.capture.still_ids.length, 2);
  // The verify commands ran in the delivery's checkout with the shell basics only (never Plania's env).
  assert.deepEqual(execCalls.map((c) => c.command), ["pnpm test", "pnpm typecheck"]);
  assert.equal(execCalls[0]!.cwd, worktreePathFor(ROOT, "zigzag", key));
  assert.equal(execCalls[0]!.env!.DATABASE_URL, undefined);
  assert.deepEqual([appStarts.at(-1)!.command, appStops], ["pnpm dev --port 4455", 1]);
  assert.equal(await card(key), null, "still QA's turn");

  // The review: one QA run, queued through the runner, fresh session, read-only, on the smaller model.
  await tick();
  assert.deepEqual((await runs()).map((r) => [r.slug, r.status, r.task_key]), [["qa-zz", "queued", key]]);
  await runner.drainQueue(db, new Date(), rf.deps as never);
  assert.equal(rf.spawned.length, 1);
  const args = rf.spawned[0]!.args;
  assert.equal(args.includes("--resume"), false, "never resumes: it has not seen anyone's reasoning");
  assert.equal(args[args.indexOf("--model") + 1], "sonnet");
  const prompt = promptOf(rf.spawned[0]!);
  assert.match(prompt, /You are the QA reviewer/);
  assert.match(prompt, /Do not read the project thread, the ticket's notes or its log/);
  assert.match(prompt, /1\. El correo se guarda\n2\. Se ve bien a 390\n3\. Muestra el error si falta el correo/);
  assert.match(prompt, /test \(`pnpm test`\): ok, 14 de 14/);
  assert.match(prompt, /```qa-report/);
  assert.doesNotMatch(prompt, /open the ticket with start/);
  const settings = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(args[args.indexOf("--settings") + 1]!, "utf8"))).permissions.deny as string[];
  for (const rule of ["Edit", "Write", "Bash(git commit*)", "Bash(git push*)", "mcp__plania__set_task", "Bash(gh pr merge*)"]) assert.ok(settings.includes(rule), rule);
  assert.equal(deniedBy("Bash", "git add -A && git commit -m x", settings), "Bash(git commit*)");
  assert.equal(deniedBy("Bash", "git diff origin/sandbox...HEAD", settings), null);
  rf.spawned[0]!.child.finish(report("pass", ["pass", "pass", "pass"]));
  await runner.waitForAllRuns();

  const done = await tick();
  assert.equal(done.concluded, 1);
  l = await lane(key);
  assert.equal(l.status, "pass");
  assert.equal(l.head_after, SHA1, "the branch did not move");
  assert.deepEqual(l.marks.map((m: Json) => m.mark), ["pass", "pass", "pass"]);
  assert.equal((await ticket(key)).status, "In review");
  // Nothing written: no git call that commits, pushes, resets or moves a branch.
  assert.equal(repo.calls.some((a) => ["commit", "push", "reset", "checkout", "switch", "rebase", "add", "stash"].includes(a[0]!)), false, JSON.stringify(repo.calls));

  // Results on the ticket, the QA summary last.
  const results = (await raw.query(`select kind, verdict, cite, counts, attachments, commit from results where task_id = (select id from tasks where key = $1) order by created_at`, [key])).rows;
  assert.deepEqual(results.map((r) => [r.kind, r.verdict]), [["test", "pass"], ["visual", "pass"], ["subagent", "pass"], ["verify", "pass"]]);
  assert.deepEqual(results[0].counts, { pass: 14, fail: 0 });
  assert.equal(results[1].attachments[0], "http://127.0.0.1:3737/api/projects/zigzag/captures/22222222-2222-4222-8222-222222222222.png");
  assert.match(results[3].cite, /QA pasa \(intento 1\) · pruebas 14 de 14 · revisión pasa · check list 3 de 3 · 2 capturas/);
  assert.equal(results[3].commit, SHA1);

  // Now it is the owner's turn: the card shows, with no QA hold.
  const c = await card(key);
  assert.ok(c, "the delivery reaches the floor");
  assert.equal(c!.kind, "pr");
  assert.equal(c!.hold, null);
  assert.deepEqual(c!.actions.slice(0, 2), ["fusionar", "cambios"]);

  // The evidence read for the floor card.
  const res = await app.request(`/api/projects/zigzag/qa/${key}`, { headers: jorge() });
  assert.equal(res.status, 200);
  const ev = (await res.json()) as Json;
  assert.equal(ev.state, "pass");
  assert.deepEqual(ev.tests, {
    pass: 14,
    total: 14,
    verdict: "pass",
    items: [
      { name: "test", command: "pnpm test", ok: true, exit_code: 0, pass: 14, fail: 0, duration_s: 0 },
      { name: "typecheck", command: "pnpm typecheck", ok: true, exit_code: 0, pass: null, fail: null, duration_s: 0 },
    ],
  });
  assert.deepEqual(ev.review, { verdict: "pass", notes: "Hace lo que pide el ticket.", model: "sonnet" });
  assert.deepEqual(ev.checklist.map((x: Json) => [x.n, x.text, x.mark]), [[1, "El correo se guarda", "pass"], [2, "Se ve bien a 390", "pass"], [3, "Muestra el error si falta el correo", "pass"]]);
  assert.deepEqual(ev.captures.ids, ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]);
  assert.equal(ev.captures.image_urls[0], "/api/projects/zigzag/captures/22222222-2222-4222-8222-222222222222.png");
  assert.deepEqual([ev.lane.attempt, ev.lane.commit, ev.lane.head_after, ev.lane.returned], [1, SHA1, SHA1, false]);
  assert.equal((await app.request(`/api/projects/zigzag/qa/${key}`)).status, 401, "screen cookie only");
  assert.equal((await app.request(`/api/projects/zigzag/qa/ZIG-999`, { headers: jorge() })).status, 404);

  // A second tick on the same head opens nothing new.
  assert.equal((await tick()).opened, 0);
});

test("I46-9 #2: a failing lane returns the ticket to Taller with exact notes, once; the second failure comes to the owner", async () => {
  const key = await newTicket("Lista de invitados");
  await qa.setPoChecks(db, { project: "zigzag", key, items: ["La lista muestra a los invitados"] }, A.actor);
  verifyOut["pnpm test"] = { code: 1, out: "ℹ tests 14\nℹ pass 12\nℹ fail 2\nnot ok 3 - guarda el correo\n" };
  await deliver(key, SHA1, 12);
  await tick();
  let l = await lane(key);
  assert.equal(l.status, "fail", "a failing verify list needs no review run");
  assert.equal(l.returned, true);
  assert.equal(rf.spawned.length, 0);
  assert.deepEqual((await runs()).filter((r) => r.slug === "qa-zz").length, 0, "no tokens spent on a red test run");
  // Back to Taller, with the exact notes, and Taller is woken.
  assert.equal((await ticket(key)).status, "Ready");
  const note = (await raw.query(`select payload from events where task_key = $1 and type = 'note' order by created_at desc limit 1`, [key])).rows[0]?.payload.text as string;
  assert.match(note, /^QA devolvió la entrega \(a1b2c3d\), intento 1:\n- test falló: 2 de 14 fallan\. `pnpm test`/);
  assert.match(note, /not ok 3 - guarda el correo/);
  assert.ok((await runs()).some((r) => r.slug === "taller-zz" && r.status === "queued" && r.task_key === key), "Taller wakes on it");
  // Not the owner's turn: the card reads as sent back, with no buttons.
  const back = await card(key);
  assert.ok(back);
  assert.deepEqual([back!.actions, back!.state?.action, back!.state?.result.by], [[], "cambios", "qa"]);

  // Taller fixes it and delivers again on a new commit; this time the review fails: it stays for the owner.
  await raw.query(`delete from agent_runs`);
  verifyOut["pnpm test"] = { code: 0, out: "ℹ pass 14\nℹ fail 0\n" };
  await deliver(key, SHA2, 12);
  assert.equal(await card(key).then((c) => c?.actions.length ?? 0), 0, "pending QA again: no buttons yet");
  await tick();
  l = await lane(key);
  assert.deepEqual([l.attempt, l.status, l.commit], [2, "reviewing", SHA2]);
  await tick();
  await runner.drainQueue(db, new Date(), rf.deps as never);
  rf.spawned[0]!.child.finish(report("fail", ["fail"], "src/invitados.ts:12 no filtra los invitados borrados."));
  await runner.waitForAllRuns();
  await tick();
  l = await lane(key);
  assert.deepEqual([l.status, l.returned], ["fail", false]);
  assert.match(l.notes, /Revisión aparte: src\/invitados\.ts:12 no filtra/);
  assert.match(l.notes, /Check list 1 «La lista muestra a los invitados»: no se cumple\. revisado 1/);
  assert.equal((await ticket(key)).status, "In review", "the second failure is not sent back");
  const c = await card(key);
  assert.ok(c);
  assert.ok(c!.actions.includes("fusionar"));
  assert.ok(c!.hold, "held for the owner");
  const ev = (await (await app.request(`/api/projects/zigzag/qa/${key}`, { headers: jorge() })).json()) as Json;
  assert.equal(ev.state, "fail");
  assert.deepEqual(ev.history.map((h: Json) => [h.attempt, h.status, h.returned]), [[2, "fail", false], [1, "fail", true]]);
  assert.equal(ev.review.verdict, "fail");
  assert.deepEqual(ev.checklist.map((x: Json) => x.mark), ["fail"]);
});

test("I46-9 #3: a usage hold stops the QA run like any other run; it starts once the hold lifts", async () => {
  const key = await newTicket("Panel del equipo");
  await deliver(key, SHA1, 13);
  await tick();
  assert.equal((await lane(key)).status, "reviewing");
  // Over the plan guard: the review is not queued, and the lane says why.
  await raw.query(`update plan_readings set five_hour_pct = 95`);
  await tick();
  let l = await lane(key);
  assert.equal(l.run_id, null);
  assert.match(l.hold, /plan|guard|usage|uso|%/i);
  assert.equal((await runs()).length, 0);
  // A run already queued when the hold comes is dropped by the runner's own checks, and the lane waits again.
  await raw.query(`update plan_readings set five_hour_pct = 10`);
  await tick();
  assert.equal((await runs()).at(-1)?.status, "queued");
  await raw.query(`update plan_readings set five_hour_pct = 95`);
  await runner.drainQueue(db, new Date(), rf.deps as never);
  assert.equal(rf.spawned.length, 0, "never spawned under the hold");
  assert.equal((await runs()).at(-1)?.status, "skipped");
  await tick();
  l = await lane(key);
  assert.deepEqual([l.status, l.run_id], ["reviewing", null]);
  assert.equal(await card(key), null, "the floor still waits for QA");
  // A paused project holds the checks too.
  await raw.query(`update plan_readings set five_hour_pct = 10`);
  await raw.query(`update projects set runs_paused = true where slug = 'zigzag'`);
  const other = await newTicket("Otra entrega");
  await deliver(other, SHA2, 14);
  const out = await tick();
  assert.equal((await lane(other)).status, "queued");
  assert.equal((await lane(other)).hold, "El proyecto está en pausa");
  assert.ok(out.held >= 1);
  // The hold lifts: the review runs.
  await raw.query(`update projects set runs_paused = false where slug = 'zigzag'`);
  await tick();
  await runner.drainQueue(db, new Date(), rf.deps as never);
  assert.ok(rf.spawned.length >= 1);
  for (const s of rf.spawned) s.child.finish(report("pass", []));
  await runner.waitForAllRuns();
});

test("I46-9: without a QA teammate a delivery reaches the floor as before; the check list is editable from the screen", async () => {
  await raw.query(`update agents set status = 'retired' where slug = 'qa-zz'`);
  try {
    const key = await newTicket("Sin QA");
    await deliver(key, SHA1, 15);
    const c = await card(key);
    assert.ok(c);
    assert.ok(c!.actions.includes("fusionar"));
    assert.equal((await qa.sweepQa(db, new Date(), qaDeps())).opened, 0);
    const res = await app.request(`/api/projects/zigzag/qa/${key}`, { headers: jorge() });
    const ev = (await res.json()) as Json;
    assert.deepEqual([ev.enabled, ev.state, ev.lane], [false, "off", null]);

    const put = await app.request(`/api/projects/zigzag/qa/${key}/checklist`, { method: "PUT", headers: jorge(), body: JSON.stringify({ items: ["Uno", "Dos"] }) });
    assert.equal(put.status, 200);
    assert.deepEqual(((await put.json()) as Json).items, [{ n: 1, text: "Uno" }, { n: 2, text: "Dos" }]);
    const four = await app.request(`/api/projects/zigzag/qa/${key}/checklist`, { method: "PUT", headers: jorge(), body: JSON.stringify({ items: ["1", "2", "3", "4"] }) });
    assert.equal(four.status, 400);
    const written = (await raw.query(`select written_by from po_checks where task_id = (select id from tasks where key = $1) order by n`, [key])).rows;
    assert.equal(written[0].written_by.agent, "jorge");
  } finally {
    await raw.query(`update agents set status = 'idle' where slug = 'qa-zz'`);
  }
  assert.ok(DENY_RULES.length > 0 && QA_DENY_RULES.includes("Edit"));
});
