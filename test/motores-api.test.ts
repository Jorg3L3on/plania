// PLA-I59-2 (Motores): the floor's read carries each seat's motor and week usage, and the console's save is all
// or nothing. Fake data on the throwaway test DB.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");

let raw: pg.Client;
type Json = Record<string, any>;
const headers = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const get = async (path: string) => (await (await app.request(path, { headers: headers() })).json()) as Json;
const put = async (path: string, body: unknown) => {
  const res = await app.request(path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
};
const seat = (read: Json, agent: string) => (read.projects as Json[]).find((p) => p.slug === "mianovia")!.team.find((m: Json) => m.agent === agent) as Json;
const cols = async (slug: string) => (await raw.query(`select motor_model, motor_effort, consulta_model, consulta_effort from agents where slug = $1`, [slug])).rows[0];

before(async () => {
  raw = await resetTestDb();
  await raw.query(`insert into projects (slug, title, key_prefix) values ('plania', 'Plania', 'PLA'), ('mianovia', 'Mianovia', 'MIA')`);
  await seedOrg(makeDb().db);
  const pla = (await raw.query(`select id from projects where slug = 'plania'`)).rows[0].id;
  const mia = (await raw.query(`select id from projects where slug = 'mianovia'`)).rows[0].id;
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente", "Prompt: QA"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4::jsonb)`, [pla, title, `# ${title}\n\nTexto de prueba.`, actor]);
  }
  // Mianovia's team: PO, Research, Artist, Taller (as a new project gets it).
  const { ensureMember } = await import("../src/runner/team.js");
  const { db } = makeDb();
  const p = { id: mia, slug: "mianovia", title: "Mianovia" };
  for (const t of ["product-owner", "research", "artist", "taller"] as const) await ensureMember(db as never, p, t, { reportsTo: t === "product-owner" ? "ceo" : "po-mianovia" });
  // This week: research 300 (input+output), taller 100; po nothing.
  const run = async (slug: string, input: number, output: number) =>
    raw.query(
      `insert into agent_runs (agent_id, project_id, role, status, started_at, ended_at, input_tokens, output_tokens) values ((select id from agents where slug = $1), $2, 'x', 'ok', now() - interval '5 minutes', now() - interval '1 minute', $3, $4)`,
      [slug, mia, input, output],
    );
  await run("research-mianovia", 200, 100);
  await run("taller-mianovia", 60, 40);
});

after(async () => {
  await raw?.end();
});

test("I59-2: the read gives each seat its motor, own flags and week share; the PO its Preguntar motor; the company default once", async () => {
  await raw.query(`update runner_settings set default_model = 'opus', default_effort = 'high'`);
  await raw.query(`update agents set motor_model = 'sonnet' where slug = 'research-mianovia'`);
  const read = await get("/api/company");
  assert.deepEqual(read.motor_default, { model: "opus", effort: "high" });
  assert.deepEqual(seat(read, "research-mianovia").motor, { model: "sonnet", effort: "high", own_model: true, own_effort: false });
  assert.deepEqual(seat(read, "taller-mianovia").motor, { model: "opus", effort: "high", own_model: false, own_effort: false });
  assert.deepEqual(seat(read, "po-mianovia").consulta_motor, { model: "opus", effort: "high", own_model: false, own_effort: false });
  assert.equal(seat(read, "research-mianovia").consulta_motor, null);
  assert.equal(seat(read, "research-mianovia").used_week.tokens, 300);
  assert.equal(seat(read, "research-mianovia").used_week.share, 0.75);
  assert.equal(seat(read, "po-mianovia").used_week.tokens, 0);
  await raw.query(`update agents set motor_model = null where slug = 'research-mianovia'`);
});

test("I59-2: a batch save of three seats is one transaction; a bad value in one changes none; one event per seat", async () => {
  const before = Number((await raw.query(`select count(*) from events where type = 'agent.motor'`)).rows[0].count);
  const bad = await put("/api/company/motores", {
    project: "mianovia",
    seats: [
      { agent: "research-mianovia", motor: { model: "sonnet", effort: "medium" } },
      { agent: "artist-mianovia", motor: { model: "opus" } },
      { agent: "taller-mianovia", motor: { model: "gpt-4" } },
    ],
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "seats.2.motor.model");
  assert.ok(bad.body.hint);
  assert.equal((await cols("research-mianovia")).motor_model, null);
  const ok = await put("/api/company/motores", {
    project: "mianovia",
    seats: [
      { agent: "research-mianovia", motor: { model: "sonnet", effort: "medium" } },
      { agent: "artist-mianovia", motor: { model: "opus" } },
      { agent: "po-mianovia", consulta_motor: { model: "haiku", effort: "low" } },
    ],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.changed, ["research-mianovia", "artist-mianovia", "po-mianovia"]);
  assert.deepEqual(await cols("research-mianovia"), { motor_model: "sonnet", motor_effort: "medium", consulta_model: null, consulta_effort: null });
  assert.deepEqual(await cols("po-mianovia"), { motor_model: null, motor_effort: null, consulta_model: "haiku", consulta_effort: "low" });
  const after = Number((await raw.query(`select count(*) from events where type = 'agent.motor'`)).rows[0].count);
  assert.equal(after - before, 3);
  // A seat that is not on this project's team is 404 and changes nothing.
  const stranger = await put("/api/company/motores", { project: "mianovia", seats: [{ agent: "research-mianovia", motor: { model: "fable" } }, { agent: "ceo", motor: { model: "opus" } }] });
  assert.equal(stranger.status, 404);
  assert.equal((await cols("research-mianovia")).motor_model, "sonnet");
});

test("I59-2: clearing a seat (null) makes it inherit the company default in the next read; the default saves too", async () => {
  const res = await put("/api/company/motores", { project: "mianovia", seats: [{ agent: "research-mianovia", motor: null }], company: { model: "sonnet", effort: "medium" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.company, true);
  const read = await get("/api/company");
  assert.deepEqual(seat(read, "research-mianovia").motor, { model: "sonnet", effort: "medium", own_model: false, own_effort: false });
  assert.deepEqual(read.motor_default, { model: "sonnet", effort: "medium" });
  assert.equal(Number((await raw.query(`select count(*) from events where type = 'company.motor'`)).rows[0].count), 1);
});

test("I59-2: hiring with a motor stores it; a bad one hires nobody; without one the new seat inherits", async () => {
  const bad = await app.request("/api/company/projects/mianovia/team", { method: "POST", headers: headers(), body: JSON.stringify({ template: "qa", motor: { effort: "ultra" } }) });
  assert.equal(bad.status, 400);
  assert.equal((await raw.query(`select count(*) from agents where slug = 'qa-mianovia'`)).rows[0].count, "0");
  const hired = await app.request("/api/company/projects/mianovia/team", { method: "POST", headers: headers(), body: JSON.stringify({ template: "qa", motor: { model: "haiku", effort: "low" } }) });
  assert.equal(hired.status, 201, await hired.clone().text());
  const body = (await hired.json()) as Json;
  assert.deepEqual(body.agent.motor, { model: "haiku", effort: "low", own_model: true, own_effort: true });
  assert.deepEqual(await cols("qa-mianovia"), { motor_model: "haiku", motor_effort: "low", consulta_model: null, consulta_effort: null });
  await raw.query(`delete from agents where slug = 'qa-mianovia'`);
  const plain = await app.request("/api/company/projects/mianovia/team", { method: "POST", headers: headers(), body: JSON.stringify({ template: "qa" }) });
  assert.equal(plain.status, 201);
  assert.equal(((await plain.json()) as Json).agent.motor.own_model, false);
});
