// PLA-I59-2 (Motores): the floor's read carries each seat's motor and week usage, and the console's save is all
// or nothing. Fake data on the throwaway test store.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");

let store: TestStore;
type Json = Record<string, any>;
const headers = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const get = async (path: string) => (await (await app.request(path, { headers: headers() })).json()) as Json;
const put = async (path: string, body: unknown) => {
  const res = await app.request(path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
};
const seat = (read: Json, agent: string) => (read.projects as Json[]).find((p) => p.slug === "mianovia")!.team.find((m: Json) => m.agent === agent) as Json;
const cols = async (slug: string) => {
  const a = (await store.get("agents", { slug }))!;
  return { motor_model: a.motorModel, motor_effort: a.motorEffort, consulta_model: a.consultaModel, consulta_effort: a.consultaEffort };
};
const setAgent = (slug: string, patch: { motorModel?: string | null }) => store.fix((uow) => uow.update("agents", { slug }, patch));

before(async () => {
  store = await resetTestStore();
  await store.fix(async (uow) => {
    await uow.insert("projects", { slug: "plania", title: "Plania", keyPrefix: "PLA" });
    await uow.insert("projects", { slug: "mianovia", title: "Mianovia", keyPrefix: "MIA" });
  });
  await seedOrg(makeDb().db);
  const pla = await store.projectId("plania");
  const mia = await store.projectId("mianovia");
  const actor = { agent: "test", session_id: "s" };
  await store.fix(async (uow) => {
    for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente", "Prompt: QA"]) {
      await uow.insert("docs", { projectId: pla, title, markdown: `# ${title}\n\nTexto de prueba.`, actor });
    }
  });
  // Mianovia's team: PO, Research, Artist, Taller (as a new project gets it).
  const { ensureMember } = await import("../src/runner/team.js");
  const { db } = makeDb();
  const p = { id: mia, slug: "mianovia", title: "Mianovia" };
  for (const t of ["product-owner", "research", "artist", "taller"] as const) await ensureMember(db as never, p, t, { reportsTo: t === "product-owner" ? "ceo" : "po-mianovia" });
  // This week: research 300 (input+output), taller 100; po nothing.
  const run = async (slug: string, input: number, output: number) => {
    const agentId = (await store.get("agents", { slug }))!.id;
    await store.fix((uow) =>
      uow.insert("agentRuns", {
        agentId,
        projectId: mia,
        role: "x",
        status: "ok",
        startedAt: new Date(uow.now.getTime() - 5 * 60_000),
        endedAt: new Date(uow.now.getTime() - 60_000),
        inputTokens: input,
        outputTokens: output,
      }),
    );
  };
  await run("research-mianovia", 200, 100);
  await run("taller-mianovia", 60, 40);
});

after(async () => {
  await store?.end();
});

test("I59-2: the read gives each seat its motor, own flags and week share; the PO its Preguntar motor; the company default once", async () => {
  await store.fix((uow) => uow.update("runnerSettings", { id: 1 }, { defaultModel: "opus", defaultEffort: "high" }));
  await setAgent("research-mianovia", { motorModel: "sonnet" });
  const read = await get("/api/company");
  assert.deepEqual(read.motor_default, { model: "opus", effort: "high" });
  assert.deepEqual(seat(read, "research-mianovia").motor, { model: "sonnet", effort: "high", own_model: true, own_effort: false });
  assert.deepEqual(seat(read, "taller-mianovia").motor, { model: "opus", effort: "high", own_model: false, own_effort: false });
  assert.deepEqual(seat(read, "po-mianovia").consulta_motor, { model: "opus", effort: "high", own_model: false, own_effort: false });
  assert.equal(seat(read, "research-mianovia").consulta_motor, null);
  assert.equal(seat(read, "research-mianovia").used_week.tokens, 300);
  assert.equal(seat(read, "research-mianovia").used_week.share, 0.75);
  assert.equal(seat(read, "po-mianovia").used_week.tokens, 0);
  await setAgent("research-mianovia", { motorModel: null });
});

test("I59-2: a batch save of three seats is one transaction; a bad value in one changes none; one event per seat", async () => {
  const before = await store.count("events", { type: "agent.motor" });
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
  const after = await store.count("events", { type: "agent.motor" });
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
  assert.equal(await store.count("events", { type: "company.motor" }), 1);
});

// An agent row and what Postgres removed or cleared with it (on delete cascade / set null).
const deleteAgent = (slug: string) =>
  store.fix(async (uow) => {
    const a = await uow.get("agents", { slug });
    if (!a) return;
    const runs = await uow.find("agentRuns", { agentId: a.id });
    if (runs.length) await uow.delete("runLocks", { runId: runs.map((r) => r.id) });
    await uow.delete("agentRuns", { agentId: a.id });
    await uow.delete("heartbeatRuns", { agentId: a.id });
    await uow.delete("agentSessions", { agentId: a.id });
    await uow.update("tasks", { ownerAgent: a.id }, { ownerAgent: null });
    await uow.update("agents", { reportsTo: a.id }, { reportsTo: null });
    await uow.update("consultas", { agentId: a.id }, { agentId: null });
    await uow.delete("agents", { id: a.id });
  });

test("I59-2: hiring with a motor stores it; a bad one hires nobody; without one the new seat inherits", async () => {
  const bad = await app.request("/api/company/projects/mianovia/team", { method: "POST", headers: headers(), body: JSON.stringify({ template: "qa", motor: { effort: "ultra" } }) });
  assert.equal(bad.status, 400);
  assert.equal(await store.count("agents", { slug: "qa-mianovia" }), 0);
  const hired = await app.request("/api/company/projects/mianovia/team", { method: "POST", headers: headers(), body: JSON.stringify({ template: "qa", motor: { model: "haiku", effort: "low" } }) });
  assert.equal(hired.status, 201, await hired.clone().text());
  const body = (await hired.json()) as Json;
  assert.deepEqual(body.agent.motor, { model: "haiku", effort: "low", own_model: true, own_effort: true });
  assert.deepEqual(await cols("qa-mianovia"), { motor_model: "haiku", motor_effort: "low", consulta_model: null, consulta_effort: null });
  await deleteAgent("qa-mianovia");
  const plain = await app.request("/api/company/projects/mianovia/team", { method: "POST", headers: headers(), body: JSON.stringify({ template: "qa" }) });
  assert.equal(plain.status, 201);
  assert.equal(((await plain.json()) as Json).agent.motor.own_model, false);
});
