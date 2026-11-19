// PLA-I57-1: Preguntar en Pedir. A question keeps a consulta and creates no task; the PO's run on it is read-only and
// works in the project's own checkout; only that PO (or its run) may answer with answer_consulta; the side page reads
// the state, the trail and the answer; «Pedirlo» carries the answer into the request. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const runner = await import("../src/runner/runner.js");
const consultas = await import("../src/pedidos/consultas.js");
const { CONSULTA_DENY_RULES } = await import("../src/runner/deny.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i57-"));
const repo = path.join(scratch, "repo-micasa");
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (url: string, body: Json) => app.request(url, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const ask = async (body: Json, slug = "micasa") => {
  const res = await post(`/api/company/projects/${slug}/ask`, body);
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as Json;
};
const list = async (slug = "micasa") => {
  const res = await app.request(`/api/company/projects/${slug}/consultas`, { headers: jorge() });
  assert.equal(res.status, 200);
  return ((await res.json()) as Json).consultas as Json[];
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  finish(lines: object[] = []): void {
    for (const l of lines) this.stdout.write(`${JSON.stringify(l)}\n`);
    const result = { type: "result", subtype: "success", is_error: false, num_turns: 2, session_id: "sess-i57", result: "OK", modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
    this.stdout.write(`${JSON.stringify(result)}\n`);
    this.stdout.end();
    setImmediate(() => this.emit("exit", 0, null));
  }
}
function fakes() {
  const spawned: (FakeChild & { args: string[]; cwd: string; settings: string; env: NodeJS.ProcessEnv })[] = [];
  let n = 80_000;
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_EVENT_WAKES: "1",
      // PLA-I2-13: Plania's secrets (never passed) and the machine's Claude key (passed unchanged).
      DATABASE_URL: "postgres://plania-secret", MCP_BEARER_TOKEN: "bearer-secret", SESSION_SECRET: "s", GITHUB_TOKEN: "g", VAPID_PRIVATE_KEY: "v", ANTHROPIC_API_KEY: "sk-ant-buyer" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    // PLA-66: a question reads its own copy, made with `git worktree add --detach <path> origin/sandbox`.
    git: async (args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") mkdirSync(args[3]!, { recursive: true });
      if (args[0] === "rev-parse" && args[1] === "--short") return { code: 0, stdout: "92111e1\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: (_bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
      const child = new FakeChild(++n) as FakeChild & { args: string[]; cwd: string; settings: string; env: NodeJS.ProcessEnv };
      child.args = args;
      child.cwd = opts.cwd;
      child.env = opts.env;
      child.settings = readFileSync(args[args.indexOf("--settings") + 1]!, "utf8");
      spawned.push(child);
      return child;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
  };
  return { deps, spawned };
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  mkdirSync(repo, { recursive: true });
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Product owner', '# PO', $2)`, [await id("projects", "micasa"), actor]);
  await raw.query(`update projects set settings = coalesce(settings, '{}'::jsonb) || $1::jsonb where slug = 'micasa'`, [JSON.stringify({ local: { repo_path: repo } })]);
});

beforeEach(async () => {
  await runner.waitForAllRuns();
  runner.resetRunnerForTests();
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from consultas`);
  await raw.query(`delete from agent_sessions`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 2, cooldown_minutes = 0`);
  await raw.query(`update projects set runs_paused = (slug <> 'micasa')`);
  await raw.query(`delete from plan_readings`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
});

after(async () => {
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("I57-1 #1: Preguntar keeps a consulta, creates no task, and queues the PO marked [pregunta] [consulta id]", async () => {
  const tasksBefore = Number((await raw.query(`select count(*) from tasks`)).rows[0].count);
  const out = await ask({ text: "¿Por qué se recarga toda la página al cambiar de sección?", mode: "pregunta" });
  assert.equal(out.mode, "pregunta");
  assert.equal(out.key, "");
  assert.equal(out.wake, "queued");
  assert.match(out.consulta, /^[0-9a-f-]{36}$/);
  assert.equal(Number((await raw.query(`select count(*) from tasks`)).rows[0].count), tasksBefore, "a question creates no task");
  const q = (await raw.query(`select r.id, r.task_key, r.summary from agent_runs r join agents a on a.id = r.agent_id where a.slug = 'po-micasa' and r.status = 'queued'`)).rows;
  assert.equal(q.length, 1);
  assert.equal(q[0].task_key, null);
  assert.match(q[0].summary, /\[pregunta\]/);
  assert.equal(consultas.consultaIdOf(q[0].summary), out.consulta);
  const row = (await raw.query(`select run_id, text from consultas where id = $1`, [out.consulta])).rows[0];
  assert.equal(row.run_id, q[0].id);
  const [c] = await list();
  assert.equal(c!.state, "cola", "PLA-69: queued is in line, not reading");
  assert.equal(c!.text, "¿Por qué se recarga toda la página al cambiar de sección?");
});

test("I57-1 #2 (PLA-66): the question's run is read-only, works in a fresh copy of origin/sandbox, gets the question prompt and keeps no session", async () => {
  const out = await ask({ text: "¿Dónde se guarda el teléfono?", mode: "pregunta" });
  const f = fakes();
  const d = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(d.started, 1, JSON.stringify((await raw.query(`select status, summary from agent_runs`)).rows));
  const child = f.spawned[0]!;
  const copy = path.join(scratch, "worktrees", "micasa", "_consulta");
  assert.equal(child.cwd, copy);
  assert.match(child.args[1]!, /read-only copy of the project at origin\/sandbox 92111e1/);
  const deny = (JSON.parse(child.settings) as { permissions: { deny: string[] } }).permissions.deny;
  for (const rule of ["Edit", "Write", "Bash(git commit*)", "Bash(rm*)", "Bash(pnpm*)", "mcp__plania__create_task"]) assert.ok(deny.includes(rule), rule);
  const prompt = child.args[1]!;
  assert.match(prompt, /answer one question from Jorge/);
  assert.match(prompt, /«¿Dónde se guarda el teléfono\?»/);
  assert.match(prompt, new RegExp(`answer_consulta \\{project: "micasa", id: "${out.consulta}"`));
  assert.ok(!prompt.includes("Plania first: open the ticket"), "not the ticket prompt");
  assert.ok(!child.args.includes("--resume"));
  // PLA-I2-13 #1 #2: a Preguntar run gets the same allow-list: no Plania secret, Claude's key unchanged.
  for (const k of ["DATABASE_URL", "MCP_BEARER_TOKEN", "SESSION_SECRET", "GITHUB_TOKEN", "VAPID_PRIVATE_KEY"]) assert.equal(child.env[k], undefined, k);
  assert.equal(child.env.ANTHROPIC_API_KEY, "sk-ant-buyer");
  assert.equal(child.env.PLANIA_RUNNER_TOKEN, "runner-token");
  child.finish([{ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: path.join(copy, "src/app/page.tsx") } }, { type: "tool_use", name: "Grep", input: { pattern: "telefono" } }] } }]);
  await runner.waitForAllRuns();
  assert.equal(Number((await raw.query(`select count(*) from agent_sessions`)).rows[0].count), 0, "the PO's session is left alone");
  const [c] = await list();
  assert.equal(c!.state, "sin_respuesta", "the run ended without answer_consulta");
  assert.deepEqual(c!.trail, ["Abrió src/app/page.tsx", "Buscó «telefono»"]);
});

test("I57-1 #3: answer_consulta takes the PO's (or its run's) answer and refuses anyone else", async () => {
  const out = await ask({ text: "¿Qué pasa si dos sucursales registran a la misma novia?", mode: "pregunta" });
  const runId = (await raw.query(`select run_id from consultas where id = $1`, [out.consulta])).rows[0].run_id as string;
  const answer = { project: "micasa", id: out.consulta, short: "Quedan dos registros.", why: ["Nada compara correo ni teléfono."], sources: [{ path: "src/db/listado.ts", line: 20 }, { path: "src/app/layout.tsx", missing: true }], branch: "main", commit: "4c4d49f", sure: "seen" as const, fix: "Avisar cuando el correo ya existe." };
  await assert.rejects(consultas.answerConsulta(db, answer, { agent: "taller-micasa", session_id: "x" }), (e: { code?: string }) => e.code === "CONSULTA_FORBIDDEN");
  await assert.rejects(consultas.answerConsulta(db, { ...answer, project: "workia" }, { agent: "po-micasa" }), (e: { code?: string }) => e.code === "CONSULTA_NOT_FOUND");
  const ok = await consultas.answerConsulta(db, answer, { agent: "Claude Code", session_id: `run-${runId.slice(0, 8)}` });
  assert.equal(ok.id, out.consulta);
  const [c] = await list();
  assert.equal(c!.state, "lista");
  assert.equal(c!.answer.short, "Quedan dos registros.");
  assert.deepEqual(c!.answer.sources, [{ path: "src/db/listado.ts", line: 20, missing: false }, { path: "src/app/layout.tsx", line: null, missing: true }]);
  assert.equal(c!.answer.sure, "seen");
  assert.equal(c!.answer.by, "po-micasa");
  // Pedirlo: the answer travels into the new ticket.
  const req = await ask({ text: "Avisar cuando el correo ya existe.", mode: "ya", consulta: out.consulta });
  const scope = (await raw.query(`select scope from tasks where key = $1`, [req.key])).rows[0].scope as string;
  assert.match(scope, /Respuesta del PO: Quedan dos registros\./);
  assert.match(scope, /src\/db\/listado\.ts:20/);
});

test("I57-1 #4 (PLA-I60): a busy PO still gets the question queued at once: a question is a work item of its own", async () => {
  const po = await id("agents", "po-micasa");
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, work_key) values ($1, $2, 'product-owner', 'running', 'running', 'general')`, [po, await id("projects", "micasa")]);
  const out = await ask({ text: "¿Cuántas sucursales hay?", mode: "pregunta" });
  assert.equal(out.wake, "queued");
  assert.equal((await list())[0]!.state, "cola");
  assert.equal(await consultas.retryConsultas(db), 0, "nothing to retry: it already has its run");
});

test("I57-1 #5: the deny rules for a question cover QA's and the shell writes", () => {
  for (const r of ["NotebookEdit", "Bash(git push*)", "Bash(mv*)", "Bash(npx*)", "mcp__plania__thread_post"]) assert.ok(CONSULTA_DENY_RULES.includes(r), r);
});

// ---- PLA-50: questions have a lane of their own

const busyRun = async (slug: string, opts: { consulta?: boolean } = {}) => {
  const agent = await id("agents", slug);
  const row = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, started_at, lane, work_key) values ($1, $2, 'taller', 'running', 'running', now(), $3, $4) returning id`, [agent, await id("projects", "micasa"), opts.consulta ? "consulta" : "work", opts.consulta ? `consulta:${crypto.randomUUID()}` : "general"])).rows[0];
  if (opts.consulta) await raw.query(`insert into consultas (project_id, agent_id, text, run_id) values ($1, $2, 'otra', $3)`, [await id("projects", "micasa"), agent, row.id]);
  return row.id as string;
};

test("PLA-50 #1: a queued question starts while a normal run holds the only general slot", async () => {
  await raw.query(`update runner_settings set max_concurrent = 1`);
  await busyRun("taller-micasa");
  const out = await ask({ text: "¿Hay forma de administrar usuarios del panel?", mode: "pregunta" });
  assert.equal(out.wake, "queued");
  const f = fakes();
  const d = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(d.started, 1, JSON.stringify((await raw.query(`select status, summary from agent_runs`)).rows));
  assert.equal(f.spawned.length, 1);
  f.spawned[0]!.finish();
  await runner.waitForAllRuns();
});

test("PLA-50 #2: a running question does not take the general slot: a normal run still starts", async () => {
  await raw.query(`update runner_settings set max_concurrent = 1`);
  await busyRun("asistente", { consulta: true });
  const hold = await import("../src/runner/hold.js");
  assert.equal(await hold.runningCount(db), 0, "the question is not counted as work");
  assert.equal(await hold.runningCount(db, "consulta"), 1);
  const settings = (await raw.query(`select * from runner_settings`)).rows[0];
  const cap = await hold.capacityFacts(db, { ...settings, maxConcurrent: 1, planGuardPct: 70, guardOverride: false } as never, new Date());
  assert.equal(hold.capacityHold(cap), null, "the general lane is free");
});

test("PLA-50 #3: a second question waits (queued, not dropped) while one question runs", async () => {
  await raw.query(`update runner_settings set max_concurrent = 1`);
  await busyRun("asistente", { consulta: true });
  const out = await ask({ text: "¿Dónde se guarda el teléfono?", mode: "pregunta" });
  assert.equal(out.wake, "queued");
  const f = fakes();
  const d = await runner.drainQueue(db, new Date(), f.deps as never);
  assert.equal(d.started, 0);
  assert.equal(f.spawned.length, 0);
  // PLA-69: still queued, not dropped; it reads «cola» with the runner's reason, not «leyendo».
  const [held] = await list();
  assert.equal(held!.state, "cola", "still queued, not dropped");
  assert.ok(held!.held, "says why it waits");
  const queued = (await raw.query(`select status from agent_runs r join consultas c on c.run_id = r.id where c.id = $1`, [out.consulta])).rows[0];
  assert.equal(queued.status, "queued");
});
