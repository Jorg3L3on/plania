// PLA-I53-2: the stage served by both reads. GET /api/projects/:slug puts etapa on every ticket, GET /api/company
// returns every open initiative with its tickets' etapa (tablero), and both carry the same ahora. Throwaway store,
// fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resetTestStore, useOwnerCode, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");

type Json = Record<string, any>;
let store: TestStore;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const get = async (path: string): Promise<Json> => {
  const res = await app.request(path, { headers: jorge() });
  assert.equal(res.status, 200);
  return (await res.json()) as Json;
};
const ctx = { actor: { agent: "po-micasa", session_id: "s-po" } };
const make = (input: Json) => writes.createTask(db, { project: "micasa", scope: "s", checks: ["c"], status: "Ready", ...input } as never, ctx as never) as Promise<{ key: string }>;
const K: Record<string, string> = {};
const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await store.fix((uow) => uow.update("projects", {}, { runsPaused: false }));
  const project = await store.projectId("micasa");
  const taller = (await store.get("agents", { slug: "taller-micasa" }))!.id;
  const idOf = async (key: string) => (await store.get("tasks", { projectId: project, key }))!.id;
  const setTask = (key: string, patch: Json) => store.fix((uow) => uow.update("tasks", { projectId: project, key }, patch));

  const leg = await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Tramo en curso", scope: "PRD" } as never, ctx as never);
  const later = await writes.createTask(db, { project: "micasa", kind: "initiative", title: "Tramo siguiente", scope: "PRD" } as never, ctx as never);
  await setTask(leg.key, { status: "Active" });
  K.leg = leg.key;
  K.later = later.key;
  for (const [name, title] of [
    ["lease", "Pantalla con reserva viva"],
    ["run", "Servidor con un paso corriendo"],
    ["expired", "Reserva vencida"],
    ["qafail", "QA la devolvió"],
    ["qarun", "QA la prueba ahora"],
    ["ready", "Lista para empezar"],
    ["backlog", "Puesto para después"],
    ["done", "Ya hecho"],
  ] as const) K[name] = (await make({ title, parent_key: leg.key })).key;
  K.next = (await make({ title: "Del tramo siguiente", parent_key: later.key })).key;
  K.loose = (await make({ title: "Suelto" })).key;
  // PLA-54: a step filed in Backlog that never moved waits its turn in the chain: not postponed. Behind an In
  // review step it still waits (it moves once that one lands).
  K.step = (await make({ title: "Paso siguiente", parent_key: leg.key, status: "Backlog", blocked_by: [K.ready] })).key;
  K.afterReview = (await make({ title: "Tras la revisión", parent_key: leg.key, status: "Backlog", blocked_by: [K.qarun] })).key;

  const lease = { agent: "taller-micasa", session_id: "s-lease" };
  const qafail = await idOf(K.qafail!);
  const qarun = await idOf(K.qarun!);
  await store.fix(async (uow) => {
    const now = uow.now;
    await uow.update("tasks", { projectId: project, key: K.lease }, { status: "In progress", owner: lease, claimedAt: minutesAgo(now, 4), leaseUntil: minutesAgo(now, -20) });
    await uow.update("tasks", { projectId: project, key: K.run }, { status: "In progress" });
    await uow.insert("agentRuns", { agentId: taller, projectId: project, role: "taller", status: "running", taskKey: K.run, startedAt: minutesAgo(now, 3) });
    await uow.update("tasks", { projectId: project, key: K.expired }, { status: "In progress", owner: lease, claimedAt: minutesAgo(now, 120), leaseUntil: minutesAgo(now, 60) });
    await uow.update("tasks", { projectId: project, key: [K.qafail!, K.qarun!] }, { status: "In review" });
    await uow.insert("qaLanes", { projectId: project, taskId: qafail, taskKey: K.qafail!, status: "fail", attempt: 1, commit: "abc1234", endedAt: minutesAgo(now, 1) });
    await uow.insert("qaLanes", { projectId: project, taskId: qarun, taskKey: K.qarun!, status: "checking", attempt: 1, commit: "abc1234", startedAt: minutesAgo(now, 2) });
    await uow.update("tasks", { projectId: project, key: K.backlog }, { status: "Backlog", statusChangedAt: now });
    await uow.update("tasks", { projectId: project, key: K.done }, { status: "Done" });
  });
});

after(async () => {
  await closeDb?.();
  await store?.end();
});

const EXPECTED: Record<string, string> = {
  lease: "construyendo",
  run: "construyendo",
  expired: "sin_dueno",
  qafail: "devuelto",
  qarun: "en_qa",
  ready: "lista",
  backlog: "pospuesto",
  done: "hecho",
  next: "lista",
  loose: "lista",
  step: "despues",
  afterReview: "despues",
};

test("I53-2 #2: GET /api/projects/:slug carries etapa on every ticket, null on initiatives", async () => {
  const page = await get("/api/projects/micasa");
  const by = new Map((page.tasks as Json[]).map((t) => [t.key, t]));
  for (const [name, etapa] of Object.entries(EXPECTED)) assert.equal(by.get(K[name]!)?.etapa?.etapa, etapa, name);
  for (const t of page.tasks as Json[]) {
    if (t.kind === "ticket") assert.ok(t.etapa && typeof t.etapa.etapa === "string", t.key);
    else assert.equal(t.etapa, null, t.key);
  }
  const lease = by.get(K.lease!)!.etapa;
  assert.deepEqual(lease.holder, { agent: "taller-micasa", role: "taller" });
  assert.equal(lease.live, true);
  assert.equal(by.get(K.qarun!)!.etapa.qa, "running");
  assert.equal(by.get(K.expired!)!.etapa.holder, null);
  // PLA-54: the board names what the step waits on, and keeps «Pospuesto a propósito» for the one put back.
  assert.equal(by.get(K.step!)!.etapa.reason, "Espera a «Lista para empezar»");
  assert.equal(by.get(K.afterReview!)!.etapa.reason, "Espera a «QA la prueba ahora»");
  assert.equal(by.get(K.backlog!)!.etapa.reason, "Pospuesto a propósito.");
  // The old fields stay.
  assert.ok("claimed_by" in by.get(K.lease!)!);
});

test("I53-2 #2: GET /api/company returns every open initiative with its tickets' etapa; route is untouched", async () => {
  const card = ((await get("/api/company")).projects as Json[]).find((p) => p.slug === "micasa")!;
  assert.ok(card.route, "route stays until F3 lands");
  const rows = card.tablero.initiatives as Json[];
  assert.deepEqual(rows.map((i) => i.key), [K.leg, K.later]);
  const leg = rows[0]!;
  assert.equal(leg.status, "Active");
  assert.deepEqual([leg.done, leg.total], [1, 10]);
  const by = new Map([...rows.flatMap((i) => i.tickets as Json[]), ...(card.tablero.loose as Json[])].map((t) => [t.key, t]));
  for (const [name, etapa] of Object.entries(EXPECTED)) assert.equal(by.get(K[name]!)?.etapa.etapa, etapa, name);
  assert.equal(rows[1]!.tickets[0].key, K.next);
  assert.deepEqual((card.tablero.loose as Json[]).map((t) => t.key), [K.loose]);
  assert.equal(by.get(K.next!)!.parent_key, K.later);
});

test("I53-2 #3: ahora lists exactly construyendo, en_qa running and devuelto, the same on both reads", async () => {
  const card = ((await get("/api/company")).projects as Json[]).find((p) => p.slug === "micasa")!;
  const page = await get("/api/projects/micasa");
  const keys = (a: Json[]) => a.map((x) => x.key).sort();
  assert.deepEqual(keys(card.ahora), [K.lease, K.run, K.qafail, K.qarun].sort());
  assert.deepEqual(card.ahora, page.ahora);
  const run = (card.ahora as Json[]).find((x) => x.key === K.run)!;
  assert.equal(run.etapa, "construyendo");
  assert.deepEqual(run.holder, { agent: "taller-micasa", role: "taller" });
  assert.equal(run.live, true);
  assert.ok(Date.parse(run.since) < Date.now());
  const lease = (card.ahora as Json[]).find((x) => x.key === K.lease)!;
  assert.equal(lease.live, true);
  assert.equal(lease.initiative, K.leg);
  assert.equal((card.ahora as Json[]).find((x) => x.key === K.qafail)!.etapa, "devuelto");
  assert.equal((card.ahora as Json[]).some((x) => x.key === K.expired), false);
});
