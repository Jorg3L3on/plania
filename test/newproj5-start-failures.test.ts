// NEWPROJ-5: a run that could not start shows on its step. In the new-project trial (2026-11-18) «Arma el plan» read
// «Pidiendo…» for eleven seconds, the PO's run ended "fail: missing env PLANIA_RUNNER_TOKEN", and the project page
// listed the step twice (Te toca «Que empiece ya», En fila «arranca sola») with nothing about the failure.
//   1. every start-up failure the runner code writes is in src/runner/start-failures.ts and has Spanish words
//   2. the ask route answers before the PO's run starts or fails
//   3. the project's read marks the step, and its row says why in Spanish with a retry, in Te toca only
//   4. a start move on a step that has a row is that row's lever, not a second row
//   5. Plomería's log words
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
// As in the trial (PLANIA_JOBS=0): no event wake is queued with the ticket, so the ask's own wake starts the run.
process.env.PLANIA_EVENT_WAKES = "0";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { ensureMember } = await import("../src/runner/team.js");
const actions = await import("../src/api/company-actions.js");
const { projectEtapas } = await import("../src/api/etapa.js");
const runner = await import("../src/runner/runner.js");
const { START_FAILURES, AFTER_START_FAILURES, startFailureOf } = await import("../src/runner/start-failures.js");

const load = async (p: string) => (await import(new URL(`../ui/src/${p}`, import.meta.url).href)) as Record<string, any>;
const arranque = await load("lib/arranque.ts");
const calidad = await load("lib/calidad.ts");
const { cosasOf, RETRY } = await load("lib/cosas.ts");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug = 'workia'`);
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 2, cooldown_minutes = 0`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 10, now() + interval '3 hours')`);
  const p = (await raw.query(`select id, slug, title from projects where slug = 'workia'`)).rows[0];
  await ensureMember(db, p, "product-owner", { reportsTo: "ceo", note: "test" });
  await raw.query(`insert into goals (project_id, title) values ($1, 'Lanzar la beta')`, [p.id]);
});

after(async () => {
  await actions.waitForAskWakes();
  await runner.waitForAllRuns();
  await closeDb?.();
  await raw?.end();
});

// ---- 1. the list and its words

// Every "fail: <reason>" literal the runner writes, read from its source. A reason written from a variable
// ("fail: ${result.subtype}") is Claude's own result, after the start.
function failLiterals(): Map<string, string> {
  const dir = new URL("../src/runner/", import.meta.url);
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    for (const line of readFileSync(new URL(f, dir), "utf8").split("\n")) {
      if (/^\s*\/\//.test(line)) continue;
      for (const m of line.matchAll(/["`]fail: ([^"`]*)["`]?/g)) {
        const reason = m[1]!.split("(")[0]!.trim();
        if (!reason || reason.startsWith("$")) continue;
        // runner.ts reads a worktree summary by its prefix ("fail: base…"), it does not write it.
        if (line.includes(`startsWith("fail: ${reason}")`)) continue;
        out.set(reason, `${f}: ${line.trim()}`);
      }
    }
  }
  return out;
}

test("NEWPROJ-5 #1: every failure the runner code writes is a start-up failure or an after-start one", () => {
  const found = failLiterals();
  assert.ok(found.has("missing env PLANIA_RUNNER_TOKEN") && found.has("no prompt doc") && found.has("fetch origin/sandbox"), "the scan reads runner.ts and worktree.ts");
  const known = new Set<string>([...START_FAILURES, ...AFTER_START_FAILURES]);
  for (const [reason, where] of found) assert.ok(known.has(reason), `"fail: ${reason}" is in neither list of src/runner/start-failures.ts (${where})`);
  for (const r of START_FAILURES) assert.ok(found.has(r), `"${r}" is listed but the runner no longer writes it`);
});

test("NEWPROJ-5 #2: every start-up failure has Spanish words: what happened and what to fix", () => {
  for (const r of START_FAILURES) {
    const w = arranque.ARRANQUE[r];
    assert.ok(w, `no words for "${r}" in ui/src/lib/arranque.ts`);
    assert.ok(w.por && w.arregla, r);
    assert.doesNotMatch(`${w.por} ${w.arregla}`.replace(/PLANIA_[A-Z_]+/g, ""), /sandbox|\bfail\b|worktree/i, `plain Spanish for "${r}"`);
  }
  assert.equal(arranque.arranqueLine("fail: missing env PLANIA_RUNNER_TOKEN"), "No pudo arrancar: el servidor no tiene la llave con la que el equipo entra a Plania. Pon PLANIA_RUNNER_TOKEN en el archivo .env de Plania y reinicia el servidor.");
  assert.match(arranque.arranqueLine("fail: no prompt doc (Prompt: Product owner)"), /^No pudo arrancar: faltan las instrucciones de este puesto\./);
  assert.match(arranque.arranqueLine("fail: base not allowed (branch main)"), /rama de origen/);
  assert.equal(arranque.arranqueLine("fail: error_max_turns (40 turns)"), null, "a run that started is not a start-up failure");
  assert.equal(arranque.arranqueLine("ok: done"), null);
  assert.equal(startFailureOf("fail: fetch origin/sandbox"), "fetch origin/sandbox");
  assert.equal(startFailureOf("fail: no result"), null);
});

test("NEWPROJ-5 #5: Plomería's log and Calidad read the same words", () => {
  assert.match(calidad.logWords("fail: worktree add"), /^No pudo arrancar: no pudo crear la carpeta de trabajo\./);
  assert.equal(calidad.logWords("fail: error_max_turns (41 turns, session c1)"), "Llegó al tope de turnos (41 turnos)");
  assert.equal(calidad.logWords("Entregó el paso"), "Entregó el paso");
  assert.equal(calidad.reasonWord("missing env PLANIA_RUNNER_TOKEN"), "El servidor no tiene la llave con la que el equipo entra a Plania");
  assert.equal(calidad.runWords("fail: no repo"), "Falló: no encontró el repositorio", "an existing word stays");
});

// ---- 2-3. the route, the run, the step's row

test("NEWPROJ-5 #3: the ask answers before the PO's run starts; the failed start then shows on the step's row", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let reached = false;
  const deps = {
    runner: {
      env: { PATH: process.env.PATH ?? "" }, // no PLANIA_RUNNER_TOKEN: the trial's failure
      machine: async () => {
        reached = true;
        await gate;
        return { freeMb: Number.POSITIVE_INFINITY, freeDiskGb: Number.POSITIVE_INFINITY };
      },
      footprints: false,
    },
  };
  const out = (await actions.askPo(db, "workia", "Arma el plan del proyecto: los entregables y los pasos de cada uno.", { mode: "ya" }, deps as never)) as Json;
  assert.equal(out.mode, "ya");
  assert.deepEqual(out.woke, { woke: false, reason: "starting", ticket: out.key, summary: "" }, "answered while the run is still being started");
  const t = (await raw.query(`select status from tasks where key = $1`, [out.key])).rows[0];
  assert.equal(t.status, "Ready", "the step exists when the answer leaves");
  // The wake was not waited for: the runner is still held at its first check.
  for (let i = 0; i < 100 && !reached; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(reached, "the wake runs in the background");
  assert.equal((await raw.query(`select count(*)::int as n from agent_runs where task_key = $1 and status = 'fail'`, [out.key])).rows[0].n, 0);
  release();
  await actions.waitForAskWakes();
  const run = (await raw.query(`select status, summary, trigger from agent_runs where task_key = $1 order by queued_at desc limit 1`, [out.key])).rows[0];
  assert.deepEqual([run.status, run.summary, run.trigger], ["fail", "fail: missing env PLANIA_RUNNER_TOKEN", "owner"]);

  // The project's read marks the step.
  const p = (await raw.query(`select * from projects where slug = 'workia'`)).rows[0];
  const e = await projectEtapas(db, { ...p, id: p.id, slug: p.slug, settings: p.settings ?? {} } as never);
  const step = e.byTicket.get(out.key)!;
  assert.equal(step.etapa.etapa, "lista");
  assert.equal(step.arranque?.summary, "fail: missing env PLANIA_RUNNER_TOKEN");

  // The row model: Te toca, the reason in Spanish, a retry; never «arranca sola», never «Que empiece ya».
  const company = (await (await app.request("/api/company", { headers: jorge() })).json()) as Json;
  const card = company.projects.find((x: Json) => x.slug === "workia");
  const c = cosasOf({ p: card, decisions: company.decisions ?? [], ficha: { ideas: [], promoted: [] } });
  const rows = c.grupos.flatMap((g: Json) => g.cosas.map((x: Json) => ({ ...x, g: g.grupo })));
  const mine = rows.filter((x: Json) => x.key === out.key || x.hilo.tramos.some((s: Json) => s.key === out.key));
  assert.equal(mine.length, 1, `listed once: ${JSON.stringify(rows.map((x: Json) => [x.g, x.key, x.espera]))}`);
  assert.equal(mine[0].g, "toca");
  assert.match(mine[0].espera, /^No pudo arrancar: el servidor no tiene la llave/);
  assert.match(mine[0].espera, /PLANIA_RUNNER_TOKEN en el archivo \.env/);
  assert.doesNotMatch(JSON.stringify(rows), /arranca sola|Está listo y espera tu señal/);
  if (mine[0].palanca) assert.equal(mine[0].palanca.action.label, RETRY);
});

test("NEWPROJ-5 #3b: the route itself answers 201 with the wake still starting", async () => {
  const res = await app.request("/api/company/projects/workia/ask", { method: "POST", headers: jorge(), body: JSON.stringify({ text: "Revisa los textos de la portada", mode: "ya" }) });
  assert.equal(res.status, 201);
  const out = (await res.json()) as Json;
  assert.equal(out.woke.reason, "starting");
  await actions.waitForAskWakes();
});

// ---- 4. one group per step (pure)

const etapa = (e: string, over: Record<string, unknown> = {}) => ({ etapa: e, qa: null, holder: null, live: false, since: "2026-11-18T10:00:00Z", ci: null, reason: null, ...over });
const tk = (key: string, e: string, over: Record<string, unknown> = {}) => ({ key, title: `Paso ${key}`, status: "Ready", phase: 1, parent_key: null, etapa: etapa(e), ...over });
const member = (agent: string, role: string, next: Record<string, unknown> | null = null) => ({ agent, role, template: role, state: "idle", now: null, last: null, produced: null, waiting: null, next_start: next });
const project = (over: Record<string, unknown>): any => ({
  slug: "nueva",
  title: "Nueva",
  paused: false,
  light: "ok",
  goal: null,
  team: [member("po-nueva", "product-owner", { key: "NUE-1", title: "Paso NUE-1", hold: "unqueued", starts_at: null, text: "" })],
  tablero: { initiatives: [], loose: [tk("NUE-1", "lista")], loose_done: 0, done_initiatives: [] },
  pedidos: [],
  next_move: { verbo: "arrancar", texto: "Arrancar «Paso NUE-1»", accion: { kind: "start", agent: "po-nueva", label: "Que empiece ya" }, origen: { kind: "hold", agent: "po-nueva", hold: "unqueued" } },
  ...over,
});
const groupsOf = (c: any, key: string) => c.grupos.flatMap((g: any) => g.cosas.filter((x: any) => x.key === key || x.hilo.tramos.some((t: any) => t.key === key)).map(() => g.grupo));

test("NEWPROJ-5 #4: a Ready step with the server's start move is in exactly one group, carrying the move", () => {
  const c = cosasOf({ p: project({}), decisions: [], ficha: { ideas: [], promoted: [] } });
  assert.deepEqual(groupsOf(c, "NUE-1"), ["toca"]);
  assert.equal(c.grupos.flatMap((g: any) => g.cosas).length, 1, "no separate move row");
  const row = c.grupos[0].cosas[0];
  assert.equal(row.espera, "Está listo y espera tu señal.");
  assert.deepEqual(row.palanca, { kind: "jugada", action: { kind: "start", agent: "po-nueva", label: "Que empiece ya" }, decision: null });
  // Without the move it waits in En fila, once.
  assert.deepEqual(groupsOf(cosasOf({ p: project({ next_move: null }), decisions: [], ficha: null }), "NUE-1"), ["fila"]);
});

test("NEWPROJ-5 #4b: a step whose run could not start is in Te toca once, with its reason and a retry", () => {
  const p = project({ tablero: { initiatives: [], loose: [tk("NUE-1", "lista", { arranque: { summary: "fail: missing env PLANIA_RUNNER_TOKEN", at: "2026-11-18T10:01:00Z" } })], loose_done: 0, done_initiatives: [] } });
  const c = cosasOf({ p, decisions: [], ficha: null });
  assert.deepEqual(groupsOf(c, "NUE-1"), ["toca"]);
  const row = c.grupos[0].cosas[0];
  assert.match(row.espera, /^No pudo arrancar: el servidor no tiene la llave/);
  assert.equal(row.cap, "NO PUDO ARRANCAR");
  assert.deepEqual(row.palanca, { kind: "jugada", action: { kind: "start", agent: "po-nueva", label: RETRY }, decision: null });
  assert.doesNotMatch(JSON.stringify(c), /arranca sola|Que empiece ya/);
  // Inside an initiative the step is named.
  const i = cosasOf({ p: project({ next_move: null, tablero: { initiatives: [{ key: "NUE-I1", title: "Plan", status: "Active", done: 0, total: 1, tickets: [tk("NUE-1", "lista", { arranque: { summary: "fail: no prompt doc (Prompt: Product owner)", at: null } })] }], loose: [], loose_done: 0, done_initiatives: [] } }), decisions: [], ficha: null });
  assert.deepEqual(groupsOf(i, "NUE-1"), ["toca"]);
  assert.match(i.grupos[0].cosas[0].espera, /^«Paso NUE-1»: No pudo arrancar: faltan las instrucciones/);
});
