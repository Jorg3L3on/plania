// PLA-I2-12 #2: a run that fails because Claude is signed out says so, not «sin resultado». The runner starts a fake
// child; what it prints is the fake Claude's own output (test/fixtures/fake-claude.mjs, FAKE_SIGNED_OUT=1).
// Throwaway database, fake values only.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb, resetPool } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const runner = await import("../src/runner/runner.js");
const writes = await import("../src/mcp/writes.js");
const { runWords } = (await import(new URL("../ui/src/lib/calidad.ts", import.meta.url).href)) as { runWords: (s: string) => string | null };
const { startFailureOf } = await import("../src/runner/start-failures.js");

const FAKE_CLAUDE = path.join(import.meta.dirname, "fixtures/fake-claude.mjs");
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i2-12-"));
const ACT = { actor: { agent: "test", session_id: "s" } } as never;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;

const fakeClaudeOutput = (env: Record<string, string>) =>
  new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile(process.execPath, [FAKE_CLAUDE], { env: { ...process.env, FAKE_MS: "30", ...env } }, (err, stdout) => {
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout) });
    });
  });

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  play(out: { code: number; stdout: string }): void {
    this.stdout.write(out.stdout);
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("exit", out.code, null));
  }
}

before(async () => {
  raw = await resetTestDb();
  ({ db } = makeDb());
  await seedOrg(db);
  await raw.query(`update runner_settings set max_concurrent = 10, cooldown_minutes = 0, max_starts_per_minute = 100, company_paused = false`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
  const repo = path.join(scratch, "repo-micasa");
  mkdirSync(repo, { recursive: true });
  await raw.query(`update projects set runs_paused = false, settings = coalesce(settings, '{}'::jsonb) || $2::jsonb where slug = $1`, ["micasa", JSON.stringify({ local: { repo_path: repo } })]);
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Taller', '# Prompt: Taller', $2)`, [await id("projects", "micasa"), JSON.stringify({ agent: "test", session_id: "s" })]);
});

after(async () => {
  await runner.waitForAllRuns();
  await raw?.end();
  await resetPool().catch(() => undefined);
  rmSync(scratch, { recursive: true, force: true });
});

async function runOnce(out: { code: number; stdout: string }) {
  const key = ((await writes.createTask(db, { project: "micasa", title: `Sesión ${Math.random()}`, scope: "s", checks: ["c"], status: "Ready" } as never, ACT)) as { key: string }).key;
  const runId = (
    await raw.query(
      `insert into agent_runs (agent_id, project_id, role, status, summary, task_key, work_key, trigger, lane) values ($1, $2, 'taller', 'queued', 'queued: event x', $3, 'task:' || $3, 'event', 'work') returning id`,
      [await id("agents", "taller-micasa"), await id("projects", "micasa"), key],
    )
  ).rows[0].id as string;
  const spawned: FakeChild[] = [];
  const deps = {
    env: { HOME: scratch, PATH: "/usr/bin:/bin", PLANIA_RUNNER_TOKEN: "runner-token", PLANIA_PROMPTS_PROJECT: "micasa", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_WORKER_ID: "test:main" } as NodeJS.ProcessEnv,
    logDir: path.join(scratch, "logs"),
    tmpDir: path.join(scratch, "tmp"),
    worktreeRoot: path.join(scratch, "worktrees"),
    graceMs: 10,
    liveFlushMs: 0,
    footprints: false,
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    spawn: () => {
      const c = new FakeChild(70_000 + spawned.length);
      spawned.push(c);
      return c;
    },
    kill: () => undefined,
    reportTokens: async () => undefined,
    probeUsage: async () => null,
    machine: () => ({ freeMb: 99_999, freeDiskGb: 999 }),
  };
  await runner.drainQueue(db, new Date(), deps as never);
  assert.equal(spawned.length, 1, "the run started");
  spawned[0]!.play(out);
  await runner.waitForAllRuns();
  return (await raw.query(`select status, summary from agent_runs where id = $1`, [runId])).rows[0] as { status: string; summary: string };
}

test("I2-12 #2: a run on a signed-out Claude fails with «sin sesión de Claude», not «sin resultado»", async () => {
  const out = await fakeClaudeOutput({ FAKE_SIGNED_OUT: "1" });
  assert.equal(out.code, 1);
  const row = await runOnce(out);
  assert.equal(row.status, "fail");
  assert.match(row.summary, /^fail: signed out \(1 turns/);
  assert.equal(startFailureOf(row.summary), null, "it started; it is not a start-up failure");
  const words = runWords(row.summary)!;
  assert.match(words, /^Falló: sin sesión de Claude en esta máquina/);
  assert.doesNotMatch(words, /sin dar resultado/);
  // A signed-out run spent nothing: the plan reading is not left unknown by it.
  const unknown = (await raw.query(`select count(*)::int as n from plan_readings where status = 'unknown'`)).rows[0].n;
  assert.equal(unknown, 0);
});

test("I2-12 #2: the same fake Claude signed in ends ok", async () => {
  const row = await runOnce(await fakeClaudeOutput({}));
  assert.equal(row.status, "ok", row.summary);
});
