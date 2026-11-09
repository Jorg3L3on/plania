// PLA-I31-2: Asistente's 07:00 brief and 2-hourly check, on a fake clock. Throwaway DB; no claude.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_HOME_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const writes = await import("../src/mcp/writes.js");
const asistente = await import("../src/runner/asistente.js");
const { jobsToStart } = await import("../src/jobs/index.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const TZ = "America/Mexico_City";
const deps = { tz: TZ, env: { PLANIA_HOME_PROJECT: "micasa" } as NodeJS.ProcessEnv };
const ctx = { actor: { agent: "test-agent", session_id: "s-i31-2" } };

async function id(table: "agents" | "projects", slug: string): Promise<string> {
  return (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
}
const questionsOn = async (key: string) =>
  (await raw.query(`select q.question, q.asked_by from questions q join tasks t on t.id = q.task_id where t.key = $1`, [key])).rows as { question: string; asked_by: { agent: string } }[];

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
});

beforeEach(async () => {
  asistente.resetAsistenteForTests();
  await raw.query(`delete from events where type in ('asistente.brief', 'asistente.check')`);
  await raw.query(`delete from agent_runs`);
  await raw.query(`delete from token_budgets`);
  await raw.query(`delete from questions`);
  await raw.query(`update projects set runs_paused = true`);
  await raw.query(`update runner_settings set company_paused = false`);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I31-2 #1: on a fake clock the brief fires once, at 07:00 local, and the check 12 times in 24 h", async () => {
  // 2026-11-10 00:00 in Mexico City is 06:00Z. One tick every 10 minutes for 24 hours.
  const start = Date.parse("2026-11-10T06:00:00Z");
  const briefs: string[] = [];
  let checks = 0;
  for (let t = start; t < start + 24 * 3_600_000; t += 10 * 60_000) {
    const now = new Date(t);
    const out = await asistente.runAsistente(db, now, deps);
    if (out.brief) briefs.push(now.toISOString());
    checks += out.check;
  }
  assert.deepEqual(briefs, ["2026-11-10T13:00:00.000Z"], "07:00 in America/Mexico_City");
  assert.equal(checks, 12);
  assert.deepEqual(asistente.localParts(new Date("2026-11-10T13:00:00Z"), TZ), { date: "2026-11-10", hour: 7 });
  // The job is one of the always-on jobs (it spawns nothing), not gated on PLANIA_JOBS like the heartbeat.
  assert.equal(jobsToStart().some((j) => j.name === "asistente"), true);
  assert.equal(jobsToStart().some((j) => j.name === "heartbeat"), false);
});

test("I31-2: a server asleep at 07:00 writes the brief on its first tick after, once that day", async () => {
  const late = new Date("2026-11-11T16:30:00Z"); // 10:30 local
  assert.equal((await asistente.runAsistente(db, late, deps)).brief, 1);
  assert.equal((await asistente.runAsistente(db, new Date(late.getTime() + 3_600_000), deps)).brief, 0);
  // Before 07:00 the next day: nothing yet.
  assert.equal((await asistente.runAsistente(db, new Date("2026-11-12T12:00:00Z"), deps)).brief, 0);
});

test("I31-2 #2: a project at 85% yields a brief line and no ask, and no line proposes raising the limit", async () => {
  const micasa = await id("projects", "micasa");
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`insert into token_budgets (scope, project_id, weekly_limit) values ('project', $1, 1000000)`, [micasa]);
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, started_at, ended_at, queued_at, tokens_total, summary)
     values ($1, $2, 'taller', 'ok', now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour', 850000, 'ok: success, 9 turns')`,
    [await id("agents", "taller"), micasa],
  );
  const now = new Date();
  const lines = await asistente.buildBrief(db, now);
  assert.equal(lines.includes("MiCasa va al 85 % de su presupuesto semanal."), true, lines.join("\n"));
  for (const line of lines) assert.doesNotMatch(line, /sub(e|ir)|aument|ampl|raise|increase|más presupuesto|límite nuevo/i);

  // A zone where it is already past 07:00, so this tick also writes the brief.
  const tz = now.getUTCHours() >= 7 ? "UTC" : "Pacific/Kiritimati";
  const out = await asistente.runAsistente(db, now, { ...deps, tz });
  assert.equal(out.brief, 1);
  assert.equal(out.check, 1);
  assert.equal(out.asks, 0);
  assert.equal((await raw.query(`select count(*)::int as n from questions`)).rows[0].n, 0);
  const check = (await raw.query(`select payload from events where type = 'asistente.check' order by id desc limit 1`)).rows[0];
  assert.equal(check.payload.lines.includes("MiCasa va al 85 % de su presupuesto semanal."), true);

  // The brief is stored as {lines, generated_at} and, PLA-I32-5, posted in the company thread (server summary:
  // event wakes are off here, so no Asistente run could write it).
  const brief = await asistente.latestBrief(db);
  assert.ok(brief);
  assert.deepEqual(Object.keys(brief).sort(), ["generated_at", "lines"]);
  assert.equal(brief.lines.includes("MiCasa va al 85 % de su presupuesto semanal."), true);
  assert.equal(brief.generated_at, now.toISOString());
  const res = await app.request("/api/threads/company", { headers: { Cookie: `${SESSION_COOKIE}=${createSession()}` } });
  const thread = (await res.json()) as { messages: { author: { agent: string }; body: string }[] };
  const posted = thread.messages.filter((m) => m.body.startsWith("Resumen del servidor")).at(-1)!;
  assert.equal(posted.author.agent, "asistente");
  assert.match(posted.body, /MiCasa va al 85 % de su presupuesto semanal\./);
});

test("I31-2: there is no brief before the first one", async () => {
  assert.equal(await asistente.latestBrief(db), null);
});

test("I31-2 #3: the same failure twice yields exactly one ask; a different failure yields none", async () => {
  const micasa = await id("projects", "micasa");
  const taller = await id("agents", "taller");
  await writes.createTask(db, { project: "micasa", key: "AS-FAIL", title: "Falla", scope: "s", checks: ["c"], status: "Ready" } as never, ctx);
  await writes.createTask(db, { project: "micasa", key: "AS-ONCE", title: "Otra", scope: "s", checks: ["c"], status: "Ready" } as never, ctx);
  const run = (key: string, summary: string, minutesAgo: number) =>
    raw.query(
      `insert into agent_runs (agent_id, project_id, task_key, role, status, started_at, ended_at, queued_at, summary)
       values ($1, $2, $3, 'taller', 'fail', now() - make_interval(mins => $5), now() - make_interval(mins => $5), now() - make_interval(mins => $5), $4)`,
      [taller, micasa, key, summary, minutesAgo],
    );
  await run("AS-FAIL", "fail: error_max_turns (40 turns, session aaaa1111)", 120);
  await run("AS-FAIL", "fail: error_max_turns (40 turns, session bbbb2222)", 10);
  await run("AS-ONCE", "fail: no result", 120);
  await run("AS-ONCE", "fail: error_max_turns (40 turns, session cccc3333)", 10);

  const t0 = new Date();
  const first = await asistente.runAsistente(db, t0, deps);
  assert.equal(first.asks, 1);
  const qs = await questionsOn("AS-FAIL");
  assert.equal(qs.length, 1);
  assert.equal(qs[0]!.asked_by.agent, "asistente");
  assert.match(qs[0]!.question, /taller falló dos veces seguidas igual en AS-FAIL: fail: error_max_turns \(N turns\)/);
  assert.equal((await raw.query(`select status from tasks where key = 'AS-FAIL'`)).rows[0].status, "Needs Jorge");
  assert.equal((await questionsOn("AS-ONCE")).length, 0);

  // The next check (another slot) and a third identical failure ask nothing more.
  await run("AS-FAIL", "fail: error_max_turns (40 turns, session dddd4444)", 1);
  const later = await asistente.runAsistente(db, new Date(t0.getTime() + 2 * 3_600_000), deps);
  assert.equal(later.check, 1);
  assert.equal(later.asks, 0);
  assert.equal((await questionsOn("AS-FAIL")).length, 1);
  assert.equal((await raw.query(`select count(*)::int as n from questions`)).rows[0].n, 1);
});

test("I31-2: stuck and quiet look only at running projects", async () => {
  const micasa = await id("projects", "micasa");
  await writes.createTask(db, { project: "micasa", key: "AS-STUCK", title: "Atascada", scope: "s", checks: ["c"], status: "Ready" } as never, ctx);
  await raw.query(`update tasks set status = 'In progress' where key = 'AS-STUCK'`);
  const future = new Date(Date.now() + 3 * 24 * 3_600_000);
  // Paused: nothing.
  let f = await asistente.findings(db, future);
  assert.deepEqual([...f.quiet, ...f.stuck], []);
  await raw.query(`update projects set runs_paused = false where id = $1`, [micasa]);
  f = await asistente.findings(db, future);
  assert.equal(f.quiet.length, 1);
  assert.match(f.quiet[0]!, /^MiCasa lleva 3 días sin movimiento\.$/);
  assert.equal(f.stuck.length, 1);
  assert.match(f.stuck[0]!, /^AS-STUCK \(MiCasa\) está atascada: \d+ h en curso sin movimiento\.$/);
  assert.equal(asistente.failureSignature("fail: error_max_turns (12 turns, session ab12cd34)"), "fail: error_max_turns (N turns)");
});
