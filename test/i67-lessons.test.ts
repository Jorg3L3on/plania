// PLA-I67-3: lessons with the owner's approval. A request for changes becomes one feedback event and one reflector pass
// (an injected claude process) that yields at most one proposal with the owner's words; a proposal rides in no run, an
// approved lesson rides in the next run of that agent in that project only; «solo esa vez» and reject stick; the teach
// bar's rule is active at once; the reflector cannot make a lesson active and only the owner decides; each run records
// the lesson versions it carried. Fake child and fake git (no real claude), and the throwaway test database.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-lessons-test-"));
const kitDir = path.join(scratch, "kit");
process.env.PLANIA_KIT_DIR = kitDir;
useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");
const { wakeAgent } = await import("../src/jobs/heartbeat.js");
const runner = await import("../src/runner/runner.js");
const lessonsMod = await import("../src/runner/lessons.js");
const { claudeReflect, lessonsTick, reflectorArgs } = await import("../src/runner/reflector.js");
const { webCtx } = await import("../src/mcp/tx.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const scriptsRoot = path.join(scratch, "worktrees");
const repo = path.join(scratch, "repos", "micasa");
const ctx = { actor: { agent: "test-agent", session_id: "s-i67-3" } };
const jorge = { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${createSession()}` };
const TDD = "---\nname: tdd\ndescription: Builds behaviour test first.\n---\n\n# TDD\n\nSee one test fail.\n";

function writeKit(): void {
  rmSync(kitDir, { recursive: true, force: true });
  mkdirSync(path.join(kitDir, "skills", "tdd"), { recursive: true });
  writeFileSync(path.join(kitDir, "skills", "tdd", "SKILL.md"), TDD);
  writeFileSync(path.join(kitDir, "skills", "tdd", "mocking.md"), "Mock only at the edge.\n");
  writeFileSync(path.join(kitDir, "kits.json"), JSON.stringify({ taller: ["tdd"], research: [] }));
}

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  exit(code: number): void {
    this.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: `sess-${this.pid}`, result: "OK", modelUsage: { m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } })}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", code, null));
  }
}

type Seen = { args: string[]; child: FakeChild; rolePrompt: string | null; plugin: Record<string, string> };
// The reflector's process: answers with structured output, like claude -p --json-schema.
function reflectorSpawn(answer: unknown, seen: string[][] = []) {
  let pid = 90_000;
  return {
    seen,
    spawn: (_c: string, args: string[]) => {
      seen.push(args);
      pid += 1;
      const child = new FakeChild(pid);
      setImmediate(() => {
        child.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, session_id: "r", result: JSON.stringify(answer), structured_output: answer })}\n`);
        child.stdout.end();
        setImmediate(() => child.emit("exit", 0, null));
      });
      return child;
    },
  };
}
const argAfter = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);

// Every file of the plugin, read at spawn time (the folder leaves with the run).
function readTree(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(out, readTree(full, base));
    else out[path.relative(base, full)] = readFileSync(full, "utf8");
  }
  return out;
}

function fakes() {
  const spawned: Seen[] = [];
  let pid = 70_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_KIT_DIR: kitDir } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: scriptsRoot,
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async (args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") {
        const target = args.find((a) => a.startsWith(scriptsRoot))!;
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, ".git"), "gitdir: fake\n");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") return { code: 1, stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { code: 0, stdout: "jl/feature\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: (_command: string, args: string[]) => {
      pid += 1;
      const child = new FakeChild(pid);
      const plugin = argAfter(args, "--plugin-dir");
      const sys = argAfter(args, "--append-system-prompt-file");
      spawned.push({ args, child, rolePrompt: sys ? readFileSync(sys, "utf8") : null, plugin: plugin ? readTree(path.join(plugin, "skills")) : {} });
      return child;
    },
    kill: () => undefined,
    reportTokens: async (_db: unknown, input: unknown) => input,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

const projectId = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
const agentRow = async (slug: string) => (await raw.query(`select * from agents where slug = $1`, [slug])).rows[0];
const agentOf = async (slug: string) => {
  const r = await agentRow(slug);
  return { ...r, projectId: r.project_id, roleTemplate: r.role_template, skillPacks: r.skill_packs, capabilities: r.capabilities, manner: r.manner } as never;
};
let n = 0;
const ready = async () => {
  n += 1;
  const key = `LES-${n}`;
  await writes.createTask(db, { project: "micasa", key, title: "Skill ticket", scope: "Scope", checks: ["Done"], status: "Ready" } as never, ctx);
  return key;
};
const runOnce = async (slug: string) => {
  const f = fakes();
  const key = await ready();
  assert.equal((await wakeAgent(db, { agent: slug, taskKey: key, now: new Date() }, { runner: f.deps as never })).reason, "ok");
  const seen = f.spawned[0]!;
  seen.child.exit(0);
  await runner.waitForAllRuns();
  const row = (await raw.query(`select r.id, r.skills, r.manner_version from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1 order by r.queued_at desc limit 1`, [slug])).rows[0] as { id: string; skills: string[]; manner_version: string | null };
  const knowledge = (await raw.query(`select kind, item, version from run_knowledge where run_id = $1 order by kind, item`, [row.id])).rows as { kind: string; item: string; version: string }[];
  return { seen, row, prompt: seen.args[seen.args.indexOf("-p") + 1]!, knowledge };
};
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = jorge) =>
  app.request(`/api/company/projects/micasa/team/${url}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const micasaRun = async (slug: string, key: string) =>
  raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, queued_at, started_at, ended_at) select a.id, a.project_id, $2, 'taller', 'ok', now() - interval '1 hour', now() - interval '1 hour', now() - interval '50 minutes' from agents a where a.slug = $1`,
    [slug, key],
  );
const sendBack = (key: string, text: string) => writes.setTask(db, { project: "micasa", key, note: `Changes the owner asks for: ${text}`, owner_changes: text } as never, { ...webCtx, tool: "test" });
const lessonRows = async () => (await raw.query(`select id, state, text, owner_words, task_key, proposed_by, version from lessons order by created_at`)).rows as { id: string; state: string; text: string; owner_words: string; task_key: string; proposed_by: string; version: number }[];
const NEW_LESSON = { verdict: "new", lesson: "Un solo botón principal por pantalla, abajo a la derecha.", applies_when: "pantallas", why: "pide lo mismo para todas" };

before(async () => {
  writeKit();
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  const micasa = await projectId("micasa");
  await raw.query(`update agents set heartbeat_minutes = null, adapter = 'none', adapter_config = '{}'::jsonb`);
  await raw.query(`update agents set adapter = 'claude_code', project_id = $1 where slug in ('taller', 'research')`, [micasa]);
  await raw.query(
    `insert into agents (slug, name, role, kind, capabilities, project_id, role_template, adapter) values ('taller-workia', 'Taller', 'taller', 'bot', '{engineering}', $1, 'taller', 'claude_code')`,
    [await projectId("workia")],
  );
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Taller", "Prompt: Research"]) await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [micasa, title, `# ${title}\nNever main.`, actor]);
  await raw.query(`update projects set settings = $1::jsonb where slug in ('micasa', 'workia')`, [JSON.stringify({ local: { repo_path: repo } })]);
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  writeKit();
  await raw.query(`delete from lessons`);
  await raw.query(`delete from feedback_events`);
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from agent_sessions`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 4, cooldown_minutes = 0, plan_guard_pct = 70, guard_override = false, reserve_tokens = 1000`);
  await raw.query(`update projects set runs_paused = false`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, seven_day_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, 19, now() + interval '3 hours')`);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("PLA-I67-3: sending a delivery back queues one reflector pass (a tool-less claude process) and yields one proposal with the owner's words", async () => {
  const key = await ready();
  await micasaRun("taller", key);
  await sendBack(key, "Hay tres botones blancos y no sé cuál es el importante. Deja uno, abajo a la derecha.");
  const r = reflectorSpawn(NEW_LESSON);
  const reflect = claudeReflect({ spawn: r.spawn as never, env: { PATH: "/usr/bin", CLAUDE_CODE_BIN: "/fake/claude", PLANIA_KIT_DIR: path.resolve(import.meta.dirname, "../kit") } });
  const tick = await lessonsTick(db, new Date(), reflect);
  assert.equal(tick.captured, 1);
  assert.equal(tick.done, 1);
  assert.equal(r.seen.length, 1, "one reflector pass");
  const args = r.seen[0]!;
  assert.equal(args[args.indexOf("--tools") + 1], "", "no tools at all");
  assert.ok(args.includes("--strict-mcp-config") && args.includes("--no-session-persistence"));
  assert.match(args[args.indexOf("-p") + 1]!, /<<<\nHay tres botones blancos[\s\S]*>>>/);
  const rows = await lessonRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.state, "proposed");
  assert.equal(rows[0]!.task_key, key);
  assert.match(rows[0]!.owner_words, /Hay tres botones blancos/);
  // The same correction is never read twice.
  const again = await lessonsTick(db, new Date(), reflect);
  assert.equal(again.captured, 0);
  assert.equal(r.seen.length, 1);
  assert.equal((await lessonRows()).length, 1);
  // The page shows it waiting, with the delivery.
  const page = (await (await call("GET", "taller/lessons")).json()) as { lessons: { state: string; task_title: string; owner_words: string }[] };
  assert.equal(page.lessons[0]!.state, "proposed");
  assert.equal(page.lessons[0]!.task_title, "Skill ticket");
});

test("PLA-I67-3: a proposal rides in no run; approved, it rides in the next run of that agent in that project only, and the run records its version", async () => {
  const key = await ready();
  await micasaRun("taller", key);
  await sendBack(key, "Deja un solo botón principal.");
  await lessonsTick(db, new Date(), async () => NEW_LESSON);
  const [l] = await lessonRows();
  assert.doesNotMatch((await runOnce("taller")).prompt, /Un solo botón principal/, "a proposal is in no prompt");
  const res = await call("POST", `taller/lessons/${l!.id}/decide`, { action: "approve", text: "Un solo botón principal por pantalla, abajo a la derecha, como en las otras." });
  assert.equal(res.status, 200);
  const approved = (await res.json()) as { state: string; version: number };
  assert.equal(approved.state, "active");
  assert.equal(approved.version, 2, "edited then approved: a new version");
  const next = await runOnce("taller");
  assert.match(next.prompt, /Lessons the owner approved for you[\s\S]*- Un solo botón principal por pantalla, abajo a la derecha, como en las otras\. \(when: pantallas\)/);
  assert.deepEqual(next.knowledge.filter((k) => k.kind === "lesson"), [{ kind: "lesson", item: l!.id, version: "2" }]);
  assert.ok(next.knowledge.some((k) => k.kind === "skill" && k.item === "tdd"), "skills are recorded too");
  assert.doesNotMatch((await runOnce("taller-workia")).prompt, /Un solo botón principal/, "not in another project");
  assert.doesNotMatch((await runOnce("research")).prompt, /Un solo botón principal/, "not another seat");
  // Retired, it leaves the next run.
  await call("POST", `taller/lessons/${l!.id}/decide`, { action: "retire" });
  assert.doesNotMatch((await runOnce("taller")).prompt, /Un solo botón principal/);
});

test("PLA-I67-3: «solo esa vez» and reject store the verdict, and the same correction is not proposed again", async () => {
  const k1 = await ready();
  const k2 = await ready();
  await micasaRun("taller", k1);
  await micasaRun("taller", k2);
  await sendBack(k1, "El botón quedó muy chico.");
  await sendBack(k2, "Usa los colores de la marca.");
  await lessonsTick(db, new Date(), async () => NEW_LESSON);
  const [a, b] = await lessonRows();
  assert.equal(((await (await call("POST", `taller/lessons/${a!.id}/decide`, { action: "one-off" })).json()) as { state: string }).state, "one-off");
  // From Te toca, the same as the page.
  const decisions = (await (await app.request("/api/company", { headers: jorge })).json()) as { decisions: { id: string; kind: string; actions: string[]; detail: string }[] };
  const row = decisions.decisions.find((d) => d.id === `l-${b!.id}`)!;
  assert.equal(row.kind, "leccion");
  assert.deepEqual(row.actions, ["aprobar", "solo_una_vez", "rechazar"]);
  assert.match(row.detail, /Usa los colores de la marca/);
  const acted = await app.request(`/api/company/decisions/l-${b!.id}`, { method: "POST", headers: jorge, body: JSON.stringify({ action: "rechazar" }) });
  assert.equal(acted.status, 200);
  assert.deepEqual((await lessonRows()).map((l) => l.state).sort(), ["one-off", "rejected"]);
  // Nothing comes back: the corrections were read, and a decided lesson cannot be decided again.
  const tick = await lessonsTick(db, new Date(), async () => NEW_LESSON);
  assert.equal(tick.captured + tick.done, 0);
  assert.equal((await lessonRows()).length, 2);
  assert.equal((await call("POST", `taller/lessons/${a!.id}/decide`, { action: "approve" })).status, 409);
});

test("PLA-I67-3: a rule typed in the teach bar is active at once and marked as the owner's", async () => {
  const res = await call("POST", "taller/lessons", { text: "Los textos van en español sencillo.", applies_when: "textos para la clienta" });
  assert.equal(res.status, 201);
  const l = (await res.json()) as { state: string; proposedBy: string };
  assert.equal(l.state, "active");
  assert.equal(l.proposedBy, "owner");
  assert.match((await runOnce("taller")).prompt, /- Los textos van en español sencillo\. \(when: textos para la clienta\)/);
  // Never a rule that relaxes a check, nor one holding a secret.
  assert.equal(((await (await call("POST", "taller/lessons", { text: "Salta las pruebas cuando haya prisa." })).json()) as { error: string }).error, "LESSON_NOT_ALLOWED");
  assert.equal(((await (await call("POST", "taller/lessons", { text: "Usa la llave sk-live_ABCDEFGHIJKLMNOPQRSTUV" })).json()) as { error: string }).error, "LESSON_NOT_ALLOWED");
});

test("PLA-I67-3: the reflector cannot make a lesson active, nothing but the owner decides, and no agent token reaches the routes", async () => {
  const key = await ready();
  await micasaRun("taller", key);
  await sendBack(key, "Que no se corte la lista.");
  await lessonsTick(db, new Date(), async () => ({ ...NEW_LESSON, state: "active", lesson: "La lista se ve entera en el teléfono." }));
  const [l] = await lessonRows();
  assert.equal(l!.state, "proposed", "whatever the answer says, it starts proposed");
  await assert.rejects(lessonsMod.decideLesson(db, l!.id, "approve", { owner: false }), (e: { code?: string }) => e.code === "LESSON_OWNER_ONLY");
  await assert.rejects(lessonsMod.teachRule(db, "micasa", "taller", { text: "Una regla" }, { owner: false }), (e: { code?: string }) => e.code === "LESSON_OWNER_ONLY");
  const bearer = { "Content-Type": "application/json", Authorization: "Bearer runner-token" };
  assert.equal((await call("POST", `taller/lessons/${l!.id}/decide`, { action: "approve" }, bearer)).status, 403);
  assert.equal((await app.request(`/api/company/decisions/l-${l!.id}`, { method: "POST", headers: bearer, body: JSON.stringify({ action: "aprobar" }) })).status, 403);
  assert.equal((await lessonRows())[0]!.state, "proposed");
  // A proposal that would relax a check is never made.
  const k2 = await ready();
  await micasaRun("taller", k2);
  await sendBack(k2, "Esta vez no hacía falta tanto.");
  await lessonsTick(db, new Date(), async () => ({ verdict: "new", lesson: "Omite las pruebas en cambios chicos.", why: "x" }));
  assert.equal((await lessonRows()).length, 1);
});

test("PLA-I67-3: the block is bounded, newest confirmed first; a proposal nobody looked at in four weeks expires", async () => {
  for (let i = 0; i < 20; i += 1) {
    await call("POST", "taller/lessons", { text: `Regla número ${i} ${"x".repeat(150)}` });
    await raw.query(`update lessons set last_confirmed_at = now() - make_interval(mins => $1) where text like $2`, [100 - i, `Regla número ${i} %`]);
  }
  const carried = await lessonsMod.lessonsForRun(db, (await agentOf("taller")) as never);
  assert.ok(carried.length < 20 && carried.length <= lessonsMod.LESSONS_MAX);
  assert.ok(lessonsMod.lessonBlock(carried)!.length <= lessonsMod.LESSON_BLOCK_MAX + 200);
  assert.match(carried[0]!.text, /^Regla número 19 /, "newest confirmed first");
  await raw.query(`delete from lessons`);
  const key = await ready();
  await micasaRun("taller", key);
  await sendBack(key, "Que se vea entera.");
  await lessonsTick(db, new Date(), async () => NEW_LESSON);
  await raw.query(`update lessons set created_at = now() - interval '29 days'`);
  assert.equal(await lessonsMod.expireProposals(db, new Date()), 1);
  assert.equal((await lessonRows())[0]!.state, "expired");
});

test("PLA-I67-3: «Dile algo» and an idea sent back are read as corrections of the seat that did the work", async () => {
  const key = await ready();
  await micasaRun("taller", key);
  const { noteForAgent } = await import("../src/api/company-runs.js");
  await noteForAgent(db, "micasa", key, "Siempre corre las pruebas antes de entregar.");
  assert.equal(await lessonsMod.captureFeedback(db, new Date()), 1);
  const fb = (await raw.query(`select kind, words, a.slug from feedback_events f join agents a on a.id = f.agent_id`)).rows;
  assert.deepEqual(fb, [{ kind: "dile", words: "Siempre corre las pruebas antes de entregar.", slug: "taller" }]);
  assert.deepEqual(reflectorArgs({ prompt: "p", systemPromptPath: "s", settingsPath: "x", mcpConfigPath: "m", model: "haiku" }).slice(-2), ["--model", "haiku"]);
});

test("PLA-I67-3: migration 0069 is safe to run twice", async () => {
  const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0069_lessons.sql"), "utf8");
  await raw.query(sql);
  await raw.query(sql);
});
