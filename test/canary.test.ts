// PLA-I74-2 / PLA-I74-3: the canary. One owner request goes from Pedir («Darle forma») to production through the real
// HTTP API, runner queue, heartbeat, QA lane, El Probador, GitHub and deploy pollers, with every outside call faked at
// its existing seam (test/canary/harness.ts says which). The happy path runs on an npm-locked and a pnpm-locked app;
// the scenario rows below each lock in a plumbing finding from a guided test. A row whose fix is still being built is
// a todo naming the ticket that fixes it, so CI stays green until that lane lands and the row turns into a plain pass.
// Throwaway test database only; no network, no real claude.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const scratch = mkdtempSync(path.join(tmpdir(), "plania-canary-"));
// The stills runCapture records (PNG files) go to the scratch folder, never ~/plania-captures.
process.env.PLANIA_CAPTURES_DIR = path.join(scratch, "captures");
const { loadMods, makeWorld } = await import("./canary/harness.js");
const m = await loadMods();

type World = Awaited<ReturnType<typeof makeWorld>>;
let raw: pg.Client;
let db: any;
let closeDb: (() => Promise<void>) | undefined;
// The screen's own words for the check-up warning next to «Constrúyelo» (ui/src/lib/revision.ts).
const revisionUi = (await import(new URL("../ui/src/lib/revision.ts", import.meta.url).href)) as { buildWarning: (r: unknown, now: number) => string | null };

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
  m.turns.resetTurnWatchForTests();
  m.revision.resetRevision();
  // Only this world's project runs: the others stay paused, so a tick never wakes an earlier world's agents. An
  // earlier row's project is removed (its agents, runs and events with it): the floor reads stay one project wide.
  await raw.query(`update projects set runs_paused = true`);
  await raw.query(`delete from agents where project_id in (select id from projects where slug like 'canary-%')`);
  await raw.query(`delete from projects where slug like 'canary-%'`);
  const w = await makeWorld(m, raw, db, scratch, { locker, ...opts });
  m.prueba.setPruebaDeps(w.pruebaDeps as never);
  m.revision.setRevisionDeps(w.revisionDeps as never);
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
/** The line the screen shows next to «Constrúyelo» about the check-up (null: rehearsed and green). */
async function buildWarning(w: World): Promise<string | null> {
  const r = await w.read(`/api/projects/${w.slug}/revision`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return revisionUi.buildWarning(r.json.revision, Date.now());
}
const warnings = new Map<World, string | null>();
async function construir(w: World) {
  await w.until("the plan at Lista", async () => (await w.task(w.ideaKey!))?.stage === "ready");
  warnings.set(w, await buildWarning(w));
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

/** What every row asserts once the path settled. healed: the watchdog heals the row expects (0 on a path that works). */
async function settled(w: World, decisions = DECISIONS, opts: { healed?: number } = {}) {
  assert.deepEqual(w.fakeErrors, []);
  assert.deepEqual(w.clicks.map((c) => c.what), decisions, "the owner made only the decision clicks");
  const healedNow = Number((await w.one(`select count(*)::int n from events where project_id = $1 and type = 'turn.healed'`, [w.pid]))!.n);
  // Nobody's turn never lasts past one tick (the next tick must find someone). Where the row expects a heal, a gap may
  // last the watchdog's two minutes and its heal: three ticks of the fast clock, never more.
  const longest = (opts.healed ?? 0) > 0 ? 3 : 1;
  let streak = 0;
  for (let i = 0; i < w.turns.length; i += 1) {
    streak = w.turns[i]!.who === "nobody" ? streak + 1 : 0;
    assert.ok(streak <= longest, `nobody's turn for ${streak} ticks: ${JSON.stringify(w.turns.slice(Math.max(0, i - 4), i + 1))}`);
  }
  // Plania's own turnOf agrees: no step is nobody's for longer than that either.
  const streaks = new Map<string, number>();
  for (const t of w.turns) {
    const now = new Set((t.plania ?? []).filter((x) => x.turn === "nobody").map((x) => x.key));
    for (const k of [...streaks.keys()]) if (!now.has(k)) streaks.delete(k);
    for (const k of now) {
      streaks.set(k, (streaks.get(k) ?? 0) + 1);
      assert.ok(streaks.get(k)! <= longest, `turnOf says ${k} is nobody's for ${streaks.get(k)} ticks: ${JSON.stringify(t.plania)}`);
    }
  }
  assert.equal(healedNow, opts.healed ?? 0, `watchdog heals (turn.healed): ${healedNow}`);
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
        // The test copies and the check-up installed with the lockfile's own tool, never the other one.
        assert.ok(w.installs.some((i) => i.by === "copia"), "the delivery copy installed its packages");
        assert.ok(w.installs.some((i) => i.by === "revision"), "the setup check-up installed its packages");
        assert.deepEqual([...new Set(w.installs.map((i) => i.command))], [w.fx.installCommand]);
        // Ready means rehearsed: the setup check-up passed, so «Constrúyelo» showed no warning.
        assert.equal(warnings.get(w), null, "no check-up warning next to «Constrúyelo»");
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

// ---- PLA-I74-3: one row per plumbing finding from guided tests 3 and 4. Each walks the same path and asserts the
// same things as the happy path, plus what its finding broke. A row a lane's fix turns green is { todo: "PLA-I74-<n>" }.

const SCRIPTS = (await import("./canary/harness.js")).SCRIPTS;
type Run = import("./canary/harness.js").Run;
const liveRuns = async (w: World) => Number((await w.one(`select count(*)::int n from agent_runs where project_id = $1 and status in ('queued', 'starting', 'running')`, [w.pid]))!.n);
const runsOn = async (w: World, key: string) => Number((await w.one(`select count(*)::int n from agent_runs where project_id = $1 and task_key = $2`, [w.pid, key]))!.n);
const healed = async (w: World) => Number((await w.one(`select count(*)::int n from events where project_id = $1 and type = 'turn.healed'`, [w.pid]))!.n);
/** A row its lane's fix turns green. CANARY_STRICT=1 runs it as a plain test, to see where it stands. */
const todo = (ticket: string) => (process.env.CANARY_STRICT === "1" ? {} : { todo: ticket });
const ctx = (agent: string) => ({ actor: { agent, session_id: "canary-setup" } });

/** Runs a row: a fresh world, the walk, and the shared asserts; always restores the seams. */
async function row(locker: "npm" | "pnpm", opts: Parameters<typeof world>[1], body: (w: World) => Promise<void>) {
  const w = await world(locker, opts);
  try {
    await body(w);
  } finally {
    w.restore();
  }
}

describe("PLA-I74-3: scenario rows", () => {
  test("PLA-161/163/165: an On hold initiative with a Ready step sits in the project; nobody starts it, the request still ships", async () => {
    await row("npm", {}, async (w) => {
      const writes = await import("../src/mcp/writes.js");
      const held = (await writes.createTask(db, { project: w.slug, kind: "initiative", title: "Algo para después", base_branch: "sandbox", scope: "s" } as never, ctx("po"))) as { key: string };
      const step = (await writes.createTask(db, { project: w.slug, parent_key: held.key, phase: 1, title: "Paso en espera", scope: "s", checks: ["c"], work_type: "code", status: "Ready" } as never, ctx("po"))) as { key: string };
      await raw.query(`update tasks set status = 'On hold' where project_id = $1 and key = $2`, [w.pid, held.key]);
      await walk(w);
      await settled(w);
      assert.equal(await runsOn(w, step.key), 0, "no run ever took the On hold initiative's step");
      assert.equal((await w.task(step.key))!.status, "Ready");
      assert.equal(w.spawned.find((r) => r.role === "taller")?.key, w.stepKey, "Taller's first run was on the request's step");
    });
  });

  test("PLA-164: «Constrúyelo» while every agent is idle wakes the PO, and the PO's plan wakes Taller, with no other click", async () => {
    await row("npm", {}, async (w) => {
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await w.until("the plan at Lista", async () => (await w.task(w.ideaKey!))?.stage === "ready");
      await w.until("every agent idle", async () => (await liveRuns(w)) === 0);
      const r = await w.click("construir", `/api/company/projects/${w.slug}/pedidos/${w.ideaKey}/construir`);
      assert.equal(r.status, 200);
      assert.equal(r.json.wake, "queued", "the PO's wake is queued by the click itself");
      await w.until("Taller on the first step", async () => !!w.stepKey && (await runsOn(w, w.stepKey)) > 0, 4);
      await aceptar(w);
      await publicar(w);
      await enProduccion(w);
      await settled(w);
    });
  });

  test("PLA-167: a run ends without releasing its step; the owner's note frees it and wakes Taller", async () => {
    let first = true;
    const taller = async (run: Run, w: World) => {
      if (first && run.key) {
        first = false;
        // It opens the step and ends: no finish, no release. The lease stays on a run that is over.
        await run.call("start", { project: run.project, key: run.key, workspace: { worktree_path: run.workspace!.path, branch: run.workspace!.branch } });
        return "Me quedé sin tiempo.";
      }
      return SCRIPTS.taller!(run, w);
    };
    await row("npm", { scripts: { taller } }, async (w) => {
      await walk(w, {
        construir: async () => {
          await w.until("the first Taller run over, its step still In progress", async () => !first && (await liveRuns(w)) === 0 && (await w.task(w.stepKey!))?.status === "In progress", 8);
          const r = await w.click("nota", `/api/company/projects/${w.slug}/tasks/${w.stepKey}/note`, { text: "¿Cómo va? Sigue con el paso, por favor." });
          assert.equal(r.status, 200, JSON.stringify(r.json));
        },
      });
      await settled(w, ["pedir", "asi_es", "me_gusta", "construir", "nota", "aceptar", "publicar"]);
      assert.equal(w.spawned.filter((r) => r.role === "taller").length, 2);
    });
  });

  test("PLA-167 / watchdog: a run ends without releasing its step; with no note, the watchdog heals it within its two minutes", async () => {
    let first = true;
    const taller = async (run: Run, w: World) => {
      if (first && run.key) {
        first = false;
        await run.call("start", { project: run.project, key: run.key, workspace: { worktree_path: run.workspace!.path, branch: run.workspace!.branch } });
        return "Me quedé sin tiempo.";
      }
      return SCRIPTS.taller!(run, w);
    };
    await row("npm", { scripts: { taller } }, async (w) => {
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await w.until("the first Taller run over, its step still In progress", async () => !first && (await liveRuns(w)) === 0, 8);
      // The bar: healed within two minutes. On the fast clock (a minute a tick): seen, two minutes, the heal.
      await w.until("the held step healed and Taller on it again", async () => (await healed(w)) >= 1 && w.spawned.filter((r) => r.role === "taller").length >= 2, 4);
      const heal = (await w.one(`select payload from events where project_id = $1 and type = 'turn.healed' order by id limit 1`, [w.pid]))!.payload;
      assert.match(JSON.stringify(heal), /held_by_ended_run|ended|release/i, `the heal says why: ${JSON.stringify(heal)}`);
      await aceptar(w);
      await publicar(w);
      await enProduccion(w);
      await settled(w, DECISIONS, { healed: 1 });
    });
  });

  test("PLA-166/168: the app compiles slowly on its first start; the check-up measures it, El Probador waits that long and the photos come", async () => {
    await row("npm", {}, async (w) => {
      // Every new copy answers 200 s after its start (fast clock): longer than the old fixed 180 s wait.
      w.coldMs = 200_000;
      await walk(w);
      await settled(w);
      const measured = await w.one(`select (payload->>'cold_start_ms')::bigint ms from events where project_id = $1 and type = 'revision.pass' order by id desc limit 1`, [w.pid]);
      assert.ok(Number(measured?.ms) >= 200_000, `the setup check-up measured the cold start: ${measured?.ms}`);
      const failed = await w.one(`select count(*)::int n from events where project_id = $1 and type = 'probador.pass' and (payload->>'ok')::boolean is not true`, [w.pid]);
      assert.equal(failed!.n, 0, "no photo pass failed on the slow start");
    });
  });

  test("wrong-page photos: the sample's view lands on another page; the photo is marked wrong and Aceptar waits", async () => {
    await row("npm", {}, async (w) => {
      // On the delivery's copy, the Clientes view ends on the login page (a session that expired mid-pass).
      w.landing = (url) => {
        const port = m.prueba.entregaRead(w.slug)?.port;
        return port && url.startsWith(`http://localhost:${port}/clientes`) ? `http://localhost:${port}/login` : url;
      };
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await w.until("the photos taken", async () => (await w.task(w.stepKey!))?.probador?.state === "lista", 12);
      for (let i = 0; i < 2; i += 1) await w.tick();
      const card = await deliveryCard(w);
      assert.ok(!card || card.hold, `Aceptar is not offered on a photo of the wrong page: ${JSON.stringify(card)}`);
      const probador = (await w.task(w.stepKey!))!.probador;
      assert.equal(probador.wrong, true);
      assert.match(probador.error, /\/login/, "the pass names the page it landed on");
      // The server refuses the accept too, not only the card.
      if (card) {
        const r = await w.click("aceptar", `/api/company/decisions/${card.id}`, { action: (card.actions as string[]).includes("fusionar") ? "fusionar" : "aceptar" });
        assert.notEqual(r.status, 200, JSON.stringify(r.json));
        assert.match(JSON.stringify(r.json), /PHOTO_WRONG_PAGE/);
      }
      assert.notEqual((await w.task(w.stepKey!))!.status, "Merged");
      assert.deepEqual(w.fakeErrors, []);
    });
  });

  test("a project test fails once at finish; Taller fixes it in the same run and the request ships", async () => {
    await row("npm", {}, async (w) => {
      let broke = false;
      w.build = (cwd) => {
        if (broke) return;
        broke = true;
        writeFileSync(path.join(cwd, "test", "lista.test.mjs"), `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("la lista", () => assert.equal(1, 2));\n`);
      };
      w.fixOnRefusal = (cwd, _run, out) => {
        if (JSON.stringify(out.error) !== '"VERIFY_FAILED"' && !/VERIFY_FAILED/.test(JSON.stringify(out))) return false;
        writeFileSync(path.join(cwd, "test", "lista.test.mjs"), `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("la lista", () => assert.equal(2, 2));\n`);
        return true;
      };
      await walk(w);
      await settled(w);
      assert.equal(w.refusals.length, 1);
      assert.match(JSON.stringify(w.refusals[0]), /VERIFY_FAILED/);
      const lane = await w.one(`select status, verify from qa_lanes where project_id = $1 order by created_at desc limit 1`, [w.pid]);
      assert.ok((lane!.verify as { ok: boolean }[]).every((v) => v.ok), "QA's own run of the tests passed on the fixed commit");
    });
  });

  // PLA-169 (found by this row): the redelivery's finish was refused EVIDENCE_STALE against the head the GitHub poller
  // stored before the push.
  test("Pedir ajuste: the owner sends the delivery back with his words; Taller redelivers and the request ships", async () => {
    await row("npm", {}, async (w) => {
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await w.until("the delivery's card", async () => !!(await deliveryCard(w)), 30);
      const card = (await deliveryCard(w))!;
      assert.ok((card.actions as string[]).includes("cambios"), JSON.stringify(card.actions));
      const r = await w.click("ajuste", `/api/company/decisions/${card.id}`, { action: "cambios", text: "Falta Beto en la lista." });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      await aceptar(w);
      await publicar(w);
      await enProduccion(w);
      await settled(w, ["pedir", "asi_es", "me_gusta", "construir", "ajuste", "aceptar", "publicar"]);
      const tallers = w.spawned.filter((x) => x.role === "taller");
      assert.equal(tallers.length, 2);
      assert.match(tallers[1]!.prompt, /Falta Beto en la lista/, "the second run carries the owner's words");
      const { gitIn } = await import("./canary/fixture.js");
      assert.match(gitIn(w.fx.origin, "show", "main:pages/clientes.html"), /Beto/, "what he asked for reached main");
    });
  });

  // PLA-52: the server goes down while `run` is under way: its row is running (with its pid) when it happens.
  const restartDuring = (w: World, run: Run, done: (swept: number) => void) => setTimeout(() => void w.restart(run).then(done), 50);

  test("PLA-52: Plania restarts in the middle of Taller's run, after it took the step; the step is retried and ships", async () => {
    let swept = -1;
    let first = true;
    const taller = async (run: Run, w: World) => {
      if (!first) return SCRIPTS.taller!(run, w);
      first = false;
      await run.call("start", { project: run.project, key: run.key, workspace: { worktree_path: run.workspace!.path, branch: run.workspace!.branch } });
      restartDuring(w, run, (n) => (swept = n));
      return new Promise<string>(() => undefined); // the process dies with the server
    };
    await row("npm", { scripts: { taller } }, async (w) => {
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await w.until("the restart's sweep", async () => swept >= 0, 6);
      assert.equal(swept, 1, "the start-up sweep closed the run the old server left running");
      await aceptar(w);
      await publicar(w);
      await enProduccion(w);
      await settled(w);
      assert.equal(w.spawned.filter((r) => r.role === "taller").length, 2, "one new Taller run took the step after the restart");
    });
  });

  test("PLA-52 / watchdog: Plania restarts while Taller's run starts, before it took the step; the watchdog wakes Taller on it", async () => {
    let swept = -1;
    let first = true;
    const taller = async (run: Run, w: World) => {
      if (!first) return SCRIPTS.taller!(run, w);
      first = false;
      restartDuring(w, run, (n) => (swept = n));
      return new Promise<string>(() => undefined);
    };
    await row("npm", { scripts: { taller } }, async (w) => {
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await w.until("the restart's sweep", async () => swept >= 0, 6);
      await w.until("a Taller run on the step again", async () => w.spawned.filter((r) => r.role === "taller").length >= 2, 4);
      await aceptar(w);
      await publicar(w);
      await enProduccion(w);
      await settled(w, DECISIONS, { healed: 1 });
    });
  });

  test("the host answers ERROR after Publicar; the ficha shows a red card with the build log, «Pedir arreglo» makes a Taller step, the step is not «En producción»", async () => {
    await row("npm", {}, async (w) => {
      w.host.outcome = "ERROR";
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await aceptar(w);
      await publicar(w);
      // The ficha the screen reads (GET /api/company/projects/:slug/ideas/:key, built.deploy).
      const ficha = async () => (await w.read(`/api/company/projects/${w.slug}/ideas/${w.ideaKey}`)).json;
      await w.until("the red deploy card on the ficha", async () => (await ficha()).built?.deploy?.state === "error", 4);
      const deploy = (await ficha()).built.deploy;
      assert.match(deploy.log ?? "", /Failed to compile|exited with 1/, `the card carries the build log: ${JSON.stringify(deploy)}`);
      assert.ok(!["Released", "Done"].includes((await w.task(w.stepKey!))!.status), "a failed deploy is not «En producción»");
      assert.equal((await w.turn()).who !== "nobody", true);
      // «Pedir arreglo»: one Ready Taller step under the initiative, carrying the log.
      const ini = (await w.task(w.ideaKey!))!.promoted_to as string;
      const r = await w.click("arreglo", `/api/company/projects/${w.slug}/initiatives/${ini}/arreglo`);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const fix = (await w.task(r.json.key))!;
      assert.match(fix.scope ?? "", /Failed to compile|exited with 1/, "the step carries the log");
      assert.ok(["Ready", "In progress"].includes(fix.status), fix.status);
      await w.until("Taller woken on the fix", async () => w.spawned.some((x) => x.role === "taller" && x.key === r.json.key), 4);
      assert.deepEqual(w.clicks.map((c) => c.what), [...DECISIONS, "arreglo"]);
      assert.deepEqual(w.fakeErrors, []);
    });
  });

  test("PLA-170: a project with no deploy setting and no key ships: the host's GitHub status says READY, the step is «En producción»", async () => {
    await row("npm", { host: "none" }, async (w) => {
      await walk(w);
      await settled(w);
      const p = await m.queries.findProject(db, w.slug);
      assert.equal(p.settings.vercel, undefined, "nothing about the host was set");
    });
  });

  test("PLA-170: no deploy setting and no key, the host answers ERROR after Publicar; the red card comes from GitHub and the watchdog asks Taller for the fix with no click", async () => {
    await row("npm", { host: "none" }, async (w) => {
      w.host.outcome = "ERROR";
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await aceptar(w);
      await publicar(w);
      const ficha = async () => (await w.read(`/api/company/projects/${w.slug}/ideas/${w.ideaKey}`)).json;
      await w.until("the red deploy card on the ficha", async () => (await ficha()).built?.deploy?.state === "error", 4);
      assert.ok(!["Released", "Done"].includes((await w.task(w.stepKey!))!.status), "a failed deploy is not «En producción»");
      // The watchdog: two minutes of grace, then the fix step, made by Plania, under the initiative.
      await w.until("the fix step, asked by the watchdog", async () => !!(await ficha()).built?.deploy?.fix_key, 6);
      const fixKey = (await ficha()).built.deploy.fix_key as string;
      const fix = (await w.task(fixKey))!;
      assert.match(fix.scope ?? "", /Vercel: failure/, "the fix carries what the host said");
      await w.until("Taller woken on the fix", async () => w.spawned.some((x) => x.role === "taller" && x.key === fixKey), 4);
      assert.deepEqual(w.clicks.map((c) => c.what), [...DECISIONS], "no click after Publicar");
      const vague = (await raw.query("select question from questions where project_id = $1 and question like '%algo de fuera%'", [w.pid])).rows;
      assert.deepEqual(vague, [], "no «waits on something outside» card");
      assert.deepEqual(w.fakeErrors, []);
    });
  });

  test("an agent asks the owner a question; his answer on the screen reaches the agent and the request goes on", async () => {
    let asked = false;
    const po = async (run: Run, w: World) => {
      const t = await run.call("get_task", { project: run.project, key: run.key });
      if (!asked && t.kind === "idea" && (t.stage ?? "idea") === "idea") {
        asked = true;
        await run.call("ask", { project: run.project, key: run.key, question: "¿La lista muestra también el teléfono?", options: ["Sí", "No"] });
        return "Pregunté al dueño.";
      }
      return SCRIPTS["product-owner"]!(run, w);
    };
    await row("npm", { scripts: { "product-owner": po } }, async (w) => {
      await pedir(w);
      await w.until("the question on the owner's screen", async () => !!(await w.one(`select id from questions where project_id = $1 and answered_at is null`, [w.pid])), 6);
      // Asistente reads it first (PLA-I32-5) and leaves a product question to the owner.
      await w.until("the owner's turn on the question", async () => (await w.turn()).who === "owner", 4);
      const q = (await w.one(`select id from questions where project_id = $1 and answered_at is null`, [w.pid]))!;
      const r = await w.click("responder", `/api/projects/${w.slug}/questions/${q.id}/answer`, { answer: "Sí" });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await aceptar(w);
      await publicar(w);
      await enProduccion(w);
      await settled(w, ["pedir", "responder", "asi_es", "me_gusta", "construir", "aceptar", "publicar"]);
      const pos = w.spawned.filter((x) => x.role === "product-owner" && x.key === w.ideaKey);
      assert.ok(pos.length >= 2 && /answer|respond|respuesta/i.test(pos[1]!.reason), `the PO woke on the answer: ${pos.map((x) => x.reason).join(" | ")}`);
    });
  });

  test("the project's check-up is red; «Constrúyelo» says so on the screen before the build starts", async () => {
    await row("npm", {}, async (w) => {
      w.checkupFails = true;
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await w.until("the plan at Lista", async () => (await w.task(w.ideaKey!))?.stage === "ready");
      const last = await w.one(`select (payload->>'ok')::boolean ok from events where project_id = $1 and type = 'revision.pass' order by id desc limit 1`, [w.pid]);
      assert.equal(last?.ok, false, "the setup check-up ran and is red");
      const warning = await buildWarning(w);
      assert.ok(warning, "the screen warns next to «Constrúyelo»");
      assert.match(warning!, /revisi/i, warning!);
    });
  });

  test("default review (one per module): Plania accepts the step on its photos; the owner reviews at Publicar", async () => {
    await row("pnpm", { revision: "por_modulo" }, async (w) => {
      await pedir(w);
      await asiEs(w);
      await meGusta(w);
      await construir(w);
      await w.until("the step accepted by Plania", async () => (await w.task(w.stepKey!))?.status === "Merged", 30);
      await publicar(w);
      await enProduccion(w);
      await settled(w, ["pedir", "asi_es", "me_gusta", "construir", "publicar"]);
      assert.ok(await w.one(`select 1 as x from events where project_id = $1 and type = 'pr.merged' and payload->>'by' = 'auto'`, [w.pid]), "the merge was Plania's");
    });
  });
});
