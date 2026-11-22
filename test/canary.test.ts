// PLA-I74-2 / PLA-I74-3: the canary. One owner request goes from Pedir («Darle forma») to production through the real
// HTTP API, runner queue, heartbeat, QA lane, El Probador, GitHub and deploy pollers, with every outside call faked at
// its existing seam (test/canary/harness.ts says which). The happy path runs on an npm-locked and a pnpm-locked app;
// the scenario rows below each lock in a plumbing finding from a guided test. A row whose fix is still being built is
// a todo naming the ticket that fixes it, so CI stays green until that lane lands and the row turns into a plain pass.
// Throwaway test database only; no network, no real claude.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "micasa";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
process.env.PLANIA_TZ = "America/Mexico_City";
const { loadMods, makeWorld } = await import("./canary/harness.js");
const m = await loadMods();

type World = Awaited<ReturnType<typeof makeWorld>>;
let raw: pg.Client;
let db: any;
let closeDb: (() => Promise<void>) | undefined;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-canary-"));

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = m.client.makeDb() as never);
  await m.seedOrg(db);
  const home = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  for (const title of new Set(Object.values(m.limits.PROMPT_DOCS))) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, '{"agent":"canary","session_id":"s"}'::jsonb)`, [home, title, `# ${title}\nPlania first. Never main.`]);
  }
  // The company runs: one slot, no rest between runs, plan use low.
  await raw.query(`update runner_settings set company_paused = false, max_concurrent = 1, cooldown_minutes = 0, plan_guard_pct = 90`);
  await raw.query(`update projects set runs_paused = true`);
  await raw.query(`insert into plan_readings (at, source, status, five_hour_pct, five_hour_resets_at) values (now(), 'stream', 'allowed', 5, now() + interval '4 hours')`);
});

after(async () => {
  await m.runner.waitForAllRuns();
  await m.qa.waitForQa();
  await m.probador.waitForProbador();
  m.prueba.resetPrueba();
  await closeDb?.();
  await raw.end();
  rmSync(scratch, { recursive: true, force: true });
});

async function world(locker: "npm" | "pnpm", opts: Parameters<typeof makeWorld>[4] extends infer O ? Partial<O> : never = {}): Promise<World> {
  m.runner.resetRunnerForTests();
  m.qa.resetQaForTests();
  m.prueba.resetPrueba();
  // Only this world's project runs: the others stay paused, so a tick never wakes an earlier world's agents.
  await raw.query(`update projects set runs_paused = true`);
  const w = await makeWorld(m, raw, db, scratch, { locker, ...opts });
  m.prueba.setPruebaDeps(w.pruebaDeps as never);
  return w;
}

// ---- The path, as the owner walks it. Each owner step waits (ticking) until the screen offers it.

const DECISIONS = ["pedir", "asi_es", "me_gusta", "construir", "aceptar", "publicar"];

async function pedir(w: World, text = "Quiero ver a mis clientes en una lista") {
  const r = await w.click("pedir", `/api/company/projects/${w.slug}/ask`, { text, mode: "forma" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.mode, "forma");
  w.ideaKey = r.json.key;
  return r.json;
}
const stopDelivered = (w: World, title: string) => async () => !!(await w.one(`select 1 as x from docs d join tasks t on t.id = d.task_id where t.key = $1 and t.project_id = $2 and d.title = $3`, [w.ideaKey, w.pid, title]));
async function asiEs(w: World) {
  await w.until("the PO's «Entendí» (Idea doc)", stopDelivered(w, "Idea"));
  const r = await w.click("asi_es", `/api/company/projects/${w.slug}/ideas/${w.ideaKey}/respuesta`, { stop: "entendido", verdict: "ok" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
async function meGusta(w: World) {
  await w.until("Artist's design (Design doc)", stopDelivered(w, "Design"));
  const r = await w.click("me_gusta", `/api/company/projects/${w.slug}/ideas/${w.ideaKey}/respuesta`, { stop: "diseno", verdict: "ok" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
async function construir(w: World) {
  await w.until("the plan at Lista", async () => (await w.task(w.ideaKey!))?.stage === "ready");
  const r = await w.click("construir", `/api/company/projects/${w.slug}/pedidos/${w.ideaKey}/construir`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
async function deliveryCard(w: World) {
  return (await w.cards()).find((d) => (d.kind === "pr" || d.kind === "deliverable") && JSON.stringify(d).includes(w.stepKey ?? "\u0000"));
}
async function aceptar(w: World) {
  await w.until("the delivery's Aceptar card", async () => !!(await deliveryCard(w)), 30);
  const card = (await deliveryCard(w))!;
  const action = (card.actions as string[]).includes("fusionar") ? "fusionar" : "aceptar";
  const r = await w.click("aceptar", `/api/company/decisions/${card.id}`, { action });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
async function publicar(w: World) {
  // The sheet's own read (releasePlan) says when Publicar may ship.
  const { releasePlan } = await import("../src/mcp/release-plan.js");
  await w.until("Publicar ready", async () => (await releasePlan(db, await m.queries.findProject(db, w.slug)))?.ship.ready === true);
  const r = await w.click("publicar", `/api/projects/${w.slug}/release/ship`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // The host builds what was merged into main.
  w.host.deploy((await import("./canary/fixture.js")).head(w.fx.origin, "main"));
  return r.json;
}
async function enProduccion(w: World) {
  await w.until("the step in production", async () => ["Released", "Done"].includes((await w.task(w.stepKey!))?.status));
}

/** The whole happy path; a scenario hooks in between with `at`. */
async function walk(w: World, at: Partial<Record<(typeof DECISIONS)[number] | "end", () => Promise<void>>> = {}) {
  await pedir(w);
  await at.pedir?.();
  await asiEs(w);
  await meGusta(w);
  await construir(w);
  await at.construir?.();
  await aceptar(w);
  await at.aceptar?.();
  await publicar(w);
  await at.publicar?.();
  await enProduccion(w);
  await at.end?.();
}

/** What every row asserts once the path settled. */
async function settled(w: World, decisions = DECISIONS) {
  assert.deepEqual(w.fakeErrors, []);
  assert.deepEqual(w.clicks.map((c) => c.what), decisions, "the owner made only the decision clicks");
  // Nobody's turn never lasts past one tick (the next tick must find someone).
  for (let i = 1; i < w.turns.length; i += 1) {
    assert.ok(!(w.turns[i]!.who === "nobody" && w.turns[i - 1]!.who === "nobody"), `nobody's turn for two ticks: ${JSON.stringify(w.turns.slice(Math.max(0, i - 3), i + 1))}`);
  }
  const step = (await w.task(w.stepKey!))!;
  assert.ok(["Released", "Done"].includes(step.status), `step ${step.key} is ${step.status}`);
  const env = await w.one(`select commit from env_states where project_id = $1 and env = 'prod'`, [w.pid]);
  assert.ok(env?.commit, "prod records the deployed commit");
  assert.deepEqual(w.github.unknown, [], "every GitHub call Plania made is one the fake knows");
}

/** The key events, in order (each appears, and after the one before it). */
async function inOrder(w: World, types: string[]) {
  const rows = await w.all(`select id, type, task_key from events where project_id = $1 order by id`, [w.pid]);
  let at = -1;
  for (const type of types) {
    const i = rows.findIndex((r, idx) => idx > at && r.type === type);
    assert.ok(i >= 0, `event ${type} after ${types[types.indexOf(type) - 1] ?? "the start"}; seen: ${[...new Set(rows.map((r) => r.type))].join(", ")}`);
    at = i;
  }
}

const KEY_EVENTS = ["task.created", "wake.queued", "stage.delivered", "idea.respuesta", "stage.delivered", "stage.delivered", "idea.respuesta", "stage.delivered", "pedido.construir", "claim.acquired", "task.status", "pr.opened", "verify.started", "probador.pass", "pr.merged", "release.merged", "release.recorded"];

describe("PLA-I74-2: the happy path", () => {
  for (const locker of ["npm", "pnpm"] as const) {
    test(`${locker}: Pedir → Así es → Me gusta → Constrúyelo → Aceptar → Publicar → En producción`, async () => {
      const w = await world(locker);
      try {
        await walk(w);
        if (process.env.CANARY_DEBUG) console.log(JSON.stringify({ turns: w.turns, installs: w.installs.map((i) => i.command), servers: w.servers.length, shots: w.shots.length, roles: w.spawned.map((r) => `${r.role}:${r.key}`), events: (await w.all(`select type from events where project_id = $1 order by id`, [w.pid])).map((r) => r.type) }, null, 1));
        await settled(w);
        await inOrder(w, KEY_EVENTS);
        // The test copies installed with the lockfile's own tool, never the other one.
        assert.ok(w.installs.length > 0, "the delivery copy installed its packages");
        assert.deepEqual([...new Set(w.installs.map((i) => i.command))], [w.fx.installCommand]);
        // The builder's commit is the one that reached main.
        const main = (await import("./canary/fixture.js")).head(w.fx.origin, "main");
        const env = await w.one(`select commit from env_states where project_id = $1 and env = 'prod'`, [w.pid]);
        assert.equal(env!.commit, main);
        // Every role ran, each as the runner started it.
        assert.deepEqual([...new Set(w.spawned.map((r) => r.role))].sort(), ["artist", "product-owner", "qa", "research", "taller"]);
      } finally {
        w.restore();
      }
    });
  }
});
