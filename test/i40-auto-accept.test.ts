// PLA-I40-7: accepting a delivery without the owner. Off by default; with the project's switch on, a teammate's
// PR whose checks are done and whose tests pass on its head is merged into the test copy on the tick, logged as
// pr.merged by: auto. Throwaway DB; gh is faked through releaseGh.run, so no real gh ever runs.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { releaseGh } = await import("../src/mcp/release-ship.js");
const { sweepAutoAccept } = await import("../src/api/auto-accept.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const realGh = releaseGh.run;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const card = async (): Promise<Json> => ((await (await app.request("/api/company", { headers: jorge() })).json()) as Json).projects.find((p: Json) => p.slug === "micasa");
const option = (on: boolean, headers: Record<string, string> = jorge()) => app.request("/api/company/projects/micasa/options", { method: "PUT", headers, body: JSON.stringify({ auto_accept: on }) });
const HEAD = "f".repeat(40);
let n = 100;
let merges: string[][] = [];
let ghBase = "sandbox";

// A code ticket In review with its check done, a passing result on the PR's head, an open PR into `base`, and
// Taller's delivery message in the project thread.
async function delivery(title: string, patch: { base?: string; ci?: string; verdict?: string; fail?: number; commit?: string; checkDone?: boolean; waived?: boolean; author?: string } = {}) {
  const num = ++n;
  const url = `https://github.com/example/micasa/pull/${num}`;
  const t = (await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], work_type: "code" } as never, { actor: { agent: "po-micasa", session_id: "s" } })) as Json;
  await raw.query(`update tasks set status = 'In review', pr_url = $2, branch = $3 where key = $1`, [t.key, url, `jl/b-${num}`]);
  if (patch.checkDone !== false) await raw.query(`update checks set done = true, done_at = now() where task_id = (select id from tasks where key = $1)`, [t.key]);
  if (patch.waived) await raw.query(`update checks set done = false, waived_at = now() where task_id = (select id from tasks where key = $1)`, [t.key]);
  await raw.query(
    `insert into results (task_id, kind, verdict, cite, counts, commit, branch, actor) select id, 'test', $2, 'pnpm test', $3::jsonb, $4, $5, '{"agent":"taller-micasa"}'::jsonb from tasks where key = $1`,
    [t.key, patch.verdict ?? "pass", JSON.stringify({ pass: 42, fail: patch.fail ?? 0 }), patch.commit ?? HEAD, `jl/b-${num}`],
  );
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, ci_state, head_sha, head_branch, base_branch, changed_files) select project_id, 'example/micasa', $2, $3, 'pr', id, 'open', $4, $5, $6, $7, 7 from tasks where key = $1`,
    [t.key, num, url, patch.ci ?? "none", HEAD, `jl/b-${num}`, patch.base ?? "sandbox"],
  );
  const thread = (await raw.query(`select id from threads where kind = 'project' and project_id = (select id from projects where slug = 'micasa')`)).rows[0].id;
  const author = patch.author ?? "taller-micasa";
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, $2, 'taller', 'Listo para revisar.', $3::jsonb)`, [thread, author, JSON.stringify([{ kind: "ticket", ref: t.key, title }, { kind: "pr", ref: url, title: "PR" }])]);
  return { key: t.key as string, num };
}
const status = async (key: string) => (await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status as string;
const mergedEvents = async (key: string) => (await raw.query(`select payload, actor from events where type = 'pr.merged' and task_key = $1`, [key])).rows as Json[];

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await card(); // the first read makes each project's thread
  releaseGh.run = async (args) => {
    const num = args[2]!;
    if (args[1] === "view" && args.includes("baseRefName,state,headRefOid,url")) return { ok: true, stdout: JSON.stringify({ baseRefName: ghBase, state: "OPEN", headRefOid: HEAD, url: `https://github.com/example/micasa/pull/${num}` }), stderr: "" };
    if (args[1] === "merge") {
      merges.push(args);
      return { ok: true, stdout: "", stderr: "" };
    }
    if (args[1] === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: "a".repeat(40) }, url: `https://github.com/example/micasa/pull/${num}` }), stderr: "" };
    return { ok: false, stdout: "", stderr: "unexpected" };
  };
});

beforeEach(async () => {
  merges = [];
  ghBase = "sandbox";
  await raw.query(`update projects set runs_paused = (slug <> 'micasa'), settings = settings - 'auto_accept'`);
  await raw.query(`update runner_settings set company_paused = false`);
  await raw.query(`update tasks set status = 'Done' where kind = 'ticket' and status = 'In review'`);
  await raw.query(`update thread_messages set action_state = '{"action":"aceptar","at":"2026-01-01T00:00:00Z","result":{}}'::jsonb where action_state is null`);
});

after(async () => {
  releaseGh.run = realGh;
  await closeDb?.();
  await raw?.end();
});

test("I40-7 #2: off by default: with the switch off nothing merges", async () => {
  const d = await delivery("Listado de casas");
  assert.deepEqual((await card()).auto_accept, { on: false, hold: null });
  assert.deepEqual(await sweepAutoAccept(db), { accepted: [], held: [] });
  assert.equal(merges.length, 0);
  assert.equal(await status(d.key), "In review");
});

test("I40-7 #1, #3: with the switch on, a delivery whose checks are done and tests pass on its head is merged, logged by: auto with the evidence", async () => {
  assert.equal((await option(true)).status, 200);
  const d = await delivery("Listado de casas");
  assert.deepEqual((await card()).auto_accept, { on: true, hold: null });

  const out = await sweepAutoAccept(db);
  assert.deepEqual(out, { accepted: [d.key], held: [] });
  assert.deepEqual(merges, [["pr", "merge", String(d.num), "--repo", "example/micasa", "--merge", "--match-head-commit", HEAD]]);
  const ev = await mergedEvents(d.key);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0]!.payload.by, ev[0]!.payload.base, ev[0]!.actor.agent], ["auto", "sandbox", "plania"]);
  const evidence = (await raw.query(`select id from results where task_id = (select id from tasks where key = $1) and verdict = 'pass'`, [d.key])).rows[0].id;
  assert.equal(ev[0]!.payload.evidence_id, evidence);

  // The floor has it as an answer that says who accepted, and a second tick does nothing.
  const acted = ((await (await app.request("/api/company", { headers: jorge() })).json()) as Json).decisions.find((x: Json) => x.ref === d.key);
  assert.deepEqual([acted.state.action, acted.state.result.by], ["aceptar", "auto"]);
  assert.deepEqual(await sweepAutoAccept(db), { accepted: [], held: [] });
  assert.equal(merges.length, 1);
});

test("I40-7 #1: each condition holds it back and says why: an open check, a waived check, failing or stale evidence, a red PR, a PR into main, a stranger", async () => {
  await option(true);
  const cases: [string, Parameters<typeof delivery>[1], RegExp][] = [
    ["Check abierto", { checkDone: false }, /Falta 1 check/],
    ["Check exento", { waived: true }, /punto exento/],
    ["Prueba que falla", { verdict: "fail", fail: 2 }, /La última prueba falló/],
    ["Prueba vieja", { commit: "b".repeat(40) }, /último commit/],
    ["PR en rojo", { ci: "failure" }, /Las pruebas fallan/],
    ["PR corriendo", { ci: "pending" }, /siguen corriendo/],
    ["PR a main", { base: "main" }, /va a main/],
    ["De otro", { author: "taller-workia" }, /No la entregó alguien del equipo/],
  ];
  for (const [title, patch, why] of cases) {
    await raw.query(`update tasks set status = 'Done' where kind = 'ticket' and status = 'In review'`);
    await raw.query(`update thread_messages set action_state = '{"action":"aceptar","at":"2026-01-01T00:00:00Z","result":{}}'::jsonb where action_state is null`);
    const d = await delivery(title, patch);
    const out = await sweepAutoAccept(db);
    assert.deepEqual(out.accepted, [], title);
    assert.match(out.held[0]?.reason ?? "", why, title);
    assert.equal(await status(d.key), "In review", title);
    assert.match((await card()).auto_accept.hold, why, `${title}: the floor says why`);
  }
  assert.equal(merges.length, 0, "nothing merged");

  // The database said sandbox but GitHub says main: the merge itself still refuses.
  await raw.query(`update tasks set status = 'Done' where kind = 'ticket' and status = 'In review'`);
  await raw.query(`update thread_messages set action_state = '{"action":"aceptar","at":"2026-01-01T00:00:00Z","result":{}}'::jsonb where action_state is null`);
  const sneaky = await delivery("Atajo a main");
  ghBase = "main";
  const out = await sweepAutoAccept(db);
  assert.deepEqual(out.accepted, []);
  assert.match(out.held[0]!.reason, /solo se fusiona a sandbox/);
  assert.equal((await mergedEvents(sneaky.key)).length, 0);
  assert.equal(merges.length, 0);
});

test("I40-7: a paused project or company accepts nothing", async () => {
  await option(true);
  await delivery("Listado de casas");
  await raw.query(`update projects set runs_paused = true where slug = 'micasa'`);
  assert.deepEqual(await sweepAutoAccept(db), { accepted: [], held: [] });
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  await raw.query(`update runner_settings set company_paused = true`);
  assert.deepEqual(await sweepAutoAccept(db), { accepted: [], held: [] });
  assert.equal(merges.length, 0);
});

test("I40-7 #4: the switch is the screen's only, and it survives a read", async () => {
  assert.equal((await option(true, { Authorization: "Bearer x", "Content-Type": "application/json" })).status, 403);
  assert.equal((await option(true, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await card()).auto_accept.on, false);
  const on = await option(true);
  assert.equal(((await on.json()) as Json).auto_accept, true);
  assert.equal((await card()).auto_accept.on, true);
  assert.equal((await raw.query(`select settings->>'auto_accept' as v from projects where slug = 'micasa'`)).rows[0].v, "true");
  await option(false);
  assert.equal((await card()).auto_accept.on, false);
});
