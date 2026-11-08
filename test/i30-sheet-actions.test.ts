// PLA-I30-6/7/8: the project sheet's actions (Pedirle al PO, Despertar ahora) and its honest status. Throwaway DB.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { buildBrief, buildQueue } = await import("../src/mcp/ceo-signals.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
const A = { actor: { agent: "test-agent", session_id: "s-i30-sheet" } };
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const ask = (slug: string, body: unknown, headers: Record<string, string> = jorge()) =>
  app.request(`/api/company/projects/${slug}/ask`, { method: "POST", headers, body: JSON.stringify(body) });
const wake = (slug: string, headers: Record<string, string> = jorge()) => app.request(`/api/company/projects/${slug}/wake`, { method: "POST", headers });
const runsOf = async (slug: string) =>
  (await raw.query(`select r.status, r.task_key from agent_runs r join agents a on a.id = r.agent_id where a.slug = $1 order by r.queued_at`, [slug])).rows;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update runner_settings set company_paused = false`);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I30-6: ask and wake are Jorge's screen only: Bearer 403, no cookie 401, short text 400", async () => {
  assert.equal((await ask("micasa", { text: "hola PO" }, { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" })).status, 403);
  assert.equal((await ask("micasa", { text: "hola PO" }, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await ask("micasa", { text: "x" })).status, 400);
  assert.equal((await wake("micasa", { Authorization: `Bearer ${TEST_BEARER}` })).status, 403);
  assert.equal((await wake("micasa", {})).status, 401);
});

test("I30-6 #1: a paused project refuses with 409 PROJECT_PAUSED; a project without a runner PO with 409 NO_PO", async () => {
  const paused = await ask("micasa", { text: "Arma el plan de lanzamiento" });
  assert.equal(paused.status, 409);
  assert.equal(((await paused.json()) as { error: string }).error, "PROJECT_PAUSED");
  await raw.query(`update projects set runs_paused = false where slug = 'workia'`);
  await raw.query(`update agents set adapter = 'none' where slug = 'workia'`);
  const noPo = await ask("workia", { text: "Arma el plan de lanzamiento" });
  assert.equal(noPo.status, 409);
  assert.equal(((await noPo.json()) as { error: string }).error, "NO_PO");
  assert.equal((await wake("workia")).status, 409);
  assert.equal((await raw.query(`select count(*)::int as n from tasks t join projects p on p.id = t.project_id where p.slug in ('micasa', 'workia')`)).rows[0].n, 0);
});

test("I30-6 #1 #2: a request becomes a Ready ticket the PO owns, origin jorge, and queues that PO's wake", async () => {
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const res = await ask("micasa", { text: "Arma el borrador de Campos y flujos con la propuesta" });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { key: string; po: string; wake: string };
  assert.equal(body.po, "housi");
  assert.equal(body.wake, "queued");
  const t = (
    await raw.query(`select t.status, t.origin, t.work_type, a.slug as owner, t.title from tasks t join agents a on a.id = t.owner_agent where t.key = $1`, [body.key])
  ).rows[0];
  assert.deepEqual(t, { status: "Ready", origin: "jorge", work_type: "ops", owner: "housi", title: "Arma el borrador de Campos y flujos con la propuesta" });
  assert.deepEqual(await runsOf("housi"), [{ status: "queued", task_key: body.key }]);
});

test("I30-6 #2: a PO-owned ticket moved to Ready wakes that PO; an unowned ops ticket created Ready wakes nobody", async () => {
  await raw.query(`delete from agent_runs`);
  const created = (await writes.createTask(
    db,
    { project: "micasa", title: "Plan de la semana", scope: "s", checks: ["c"], owner_agent: "housi", work_type: "ops" },
    A,
  )) as { key: string; version: number };
  assert.deepEqual(await runsOf("housi"), [], "Backlog wakes nobody");
  await writes.setTask(db, { project: "micasa", key: created.key, status: "Ready", version: created.version }, A);
  assert.deepEqual(await runsOf("housi"), [{ status: "queued", task_key: created.key }]);

  await raw.query(`delete from agent_runs`);
  await writes.createTask(db, { project: "micasa", title: "Suelto", scope: "s", checks: ["c"], status: "Ready", work_type: "ops" }, A);
  assert.equal((await raw.query(`select count(*)::int as n from agent_runs`)).rows[0].n, 0, "Taller still wakes on a move only");
});

test("I30-7 #1: Despertar ahora with no PO work answers idle and records no run; with PO work it goes through the runner", async () => {
  await raw.query(`delete from agent_runs`);
  await raw.query(`update projects set runs_paused = false where slug = 'zigzag'`);
  const idle = await wake("zigzag");
  assert.equal(idle.status, 200);
  assert.deepEqual(await idle.json(), { woke: false, reason: "idle", ticket: null, summary: "Sin trabajo para el PO: pídele algo." });
  assert.equal((await raw.query(`select count(*)::int as n from agent_runs`)).rows[0].n, 0);
  assert.equal((await raw.query(`select count(*)::int as n from heartbeat_runs hr join agents a on a.id = hr.agent_id where a.slug = 'zigzag'`)).rows[0].n, 0);

  // micasa has Ready work owned by housi. Cap 0: the runner queues it instead of spawning.
  await raw.query(`update runner_settings set max_concurrent = 0`);
  const busy = await wake("micasa");
  assert.equal(busy.status, 200);
  const out = (await busy.json()) as { reason: string; ticket: string | null };
  assert.notEqual(out.reason, "idle");
  assert.ok(out.ticket, "names the ticket it woke on");
  await raw.query(`update runner_settings set max_concurrent = 1`);
});

test("I30-8 #1: the sheet counts bot work, marks Jorge's own Ready tickets, and resolves config failures once the env is set", async () => {
  const mine = (await writes.createTask(
    db,
    { project: "zigzag", title: "Kickoff con el cliente", scope: "s", checks: ["c"], status: "Ready", owner_agent: "ceo", work_type: "ops" },
    A,
  )) as { key: string };
  const project = (await raw.query(`select id from projects where slug = 'zigzag'`)).rows[0].id;
  const agent = (await raw.query(`select id from agents where slug = 'zigzag'`)).rows[0].id;
  process.env.PLANIA_TEST_SET_ENV = "yes";
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, summary, ended_at) values
       ($1, $2, 'product-owner', 'fail', 'fail: missing env PLANIA_TEST_SET_ENV', now()),
       ($1, $2, 'product-owner', 'fail', 'fail: missing env PLANIA_TEST_NOT_SET', now())`,
    [agent, project],
  );
  const res = await app.request("/api/company/projects/zigzag", { headers: jorge() });
  assert.equal(res.status, 200);
  const sheet = (await res.json()) as { bot_work: number; next: { key: string; yours: boolean }[]; runs: { summary: string; resolved?: boolean }[] };
  assert.equal(sheet.bot_work, 0, "Jorge's own ticket is no bot's work");
  assert.deepEqual(sheet.next.find((n) => n.key === mine.key)?.yours, true);
  assert.equal(sheet.runs.find((r) => r.summary.endsWith("PLANIA_TEST_SET_ENV"))?.resolved, true);
  assert.equal(sheet.runs.find((r) => r.summary.endsWith("PLANIA_TEST_NOT_SET"))?.resolved, undefined);

  const micasa = (await (await app.request("/api/company/projects/micasa", { headers: jorge() })).json()) as { bot_work: number };
  assert.ok(micasa.bot_work >= 1, "housi's Ready ticket counts");
  const company = (await (await app.request("/api/company", { headers: jorge() })).json()) as { project_facts: Record<string, { bot_work: number }> };
  assert.equal(company.project_facts.zigzag?.bot_work, 0);
  assert.ok((company.project_facts.micasa?.bot_work ?? 0) >= 1);
  delete process.env.PLANIA_TEST_SET_ENV;
});

test("I30-8 #2: Jorge's own Ready tickets are a step in Solo tú", () => {
  const queue = buildQueue(
    { waits: [], reviews: [], initiatives: [], yours: [{ project: "mianovia", key: "MIA-I1-1", title: "Kickoff", since: "2026-11-01T00:00:00.000Z" }] },
    new Date("2026-11-08T00:00:00.000Z"),
  );
  assert.deepEqual(queue.map((q) => [q.kind, q.key, q.detail, q.age_days]), [["paso", "MIA-I1-1", "Te toca: ningún bot lo toma", 7]]);
  assert.deepEqual(buildBrief({ queue, finished: 0, previous: 0 }), ["Te toca: MIA-I1-1 Kickoff (Mianovia)."]);
});
