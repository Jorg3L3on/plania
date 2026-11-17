// PLA-I40-7: accepting a delivery without the owner. Off by default; with the project's switch on, a teammate's
// PR whose checks are done and whose tests pass on its head is merged into the test copy on the tick, logged as
// pr.merged by: auto. Throwaway store; gh is faked through releaseGh.run, so no real gh ever runs.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Actor, ActionState } from "../src/db/schema.js";
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
const { releaseGh } = await import("../src/mcp/release-ship.js");
const { sweepAutoAccept } = await import("../src/api/auto-accept.js");

type Json = Record<string, any>;
let store: TestStore;
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
  const micasa = await store.projectId("micasa");
  await store.fix(async (uow) => {
    const [task] = await uow.update("tasks", { key: t.key }, { status: "In review", prUrl: url, branch: `jl/b-${num}` });
    if (patch.checkDone !== false) await uow.update("checks", { taskId: task!.id }, { done: true, doneAt: uow.now });
    if (patch.waived) await uow.update("checks", { taskId: task!.id }, { done: false, waivedAt: uow.now });
    await uow.insert("results", {
      taskId: task!.id,
      kind: "test",
      verdict: patch.verdict ?? "pass",
      cite: "pnpm test",
      counts: { pass: 42, fail: patch.fail ?? 0 },
      commit: patch.commit ?? HEAD,
      branch: `jl/b-${num}`,
      actor: { agent: "taller-micasa" } as Actor,
    });
    await uow.insert("pullRequests", {
      projectId: task!.projectId,
      repo: "example/micasa",
      number: num,
      url,
      title: "pr",
      taskId: task!.id,
      state: "open",
      ciState: patch.ci ?? "none",
      headSha: HEAD,
      headBranch: `jl/b-${num}`,
      baseBranch: patch.base ?? "sandbox",
      changedFiles: 7,
    });
    const thread = (await uow.get("threads", { kind: "project", projectId: micasa }))!;
    const author = patch.author ?? "taller-micasa";
    await uow.insert("threadMessages", {
      threadId: thread.id,
      authorAgent: author,
      authorRole: "taller",
      body: "Listo para revisar.",
      links: [
        { kind: "ticket", ref: t.key, title },
        { kind: "pr", ref: url, title: "PR" },
      ],
    });
  });
  return { key: t.key as string, num };
}
const status = async (key: string) => (await store.get("tasks", { key }))!.status;
const mergedEvents = async (key: string) => (await store.find("events", { type: "pr.merged", taskKey: key })).map((e) => ({ payload: e.payload, actor: e.actor })) as Json[];
// Every delivery of an earlier test leaves review, and its message counts as answered.
const ANSWERED = { action: "aceptar", at: "2026-01-01T00:00:00Z", result: {} } as ActionState;
const settleEarlier = () =>
  store.fix(async (uow) => {
    await uow.update("tasks", { kind: "ticket", status: "In review" }, { status: "Done" });
    await uow.update("threadMessages", { actionState: null }, { actionState: ANSWERED });
  });

before(async () => {
  store = await resetTestStore();
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
  await store.fix(async (uow) => {
    for (const p of await uow.find("projects")) {
      const { auto_accept: _off, ...settings } = p.settings ?? {};
      await uow.update("projects", { id: p.id }, { runsPaused: p.slug !== "micasa", settings: settings as typeof p.settings });
    }
    await uow.update("runnerSettings", { id: 1 }, { companyPaused: false });
  });
  await settleEarlier();
});

after(async () => {
  releaseGh.run = realGh;
  await closeDb?.();
  await store?.end();
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
  const taskId = (await store.get("tasks", { key: d.key }))!.id;
  const evidence = (await store.get("results", { taskId, verdict: "pass" }))!.id;
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
    await settleEarlier();
    const d = await delivery(title, patch);
    const out = await sweepAutoAccept(db);
    assert.deepEqual(out.accepted, [], title);
    assert.match(out.held[0]?.reason ?? "", why, title);
    assert.equal(await status(d.key), "In review", title);
    assert.match((await card()).auto_accept.hold, why, `${title}: the floor says why`);
  }
  assert.equal(merges.length, 0, "nothing merged");

  // The database said sandbox but GitHub says main: the merge itself still refuses.
  await settleEarlier();
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
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: true }));
  assert.deepEqual(await sweepAutoAccept(db), { accepted: [], held: [] });
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: false }));
  await store.fix((uow) => uow.update("runnerSettings", { id: 1 }, { companyPaused: true }));
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
  assert.equal(String((await store.get("projects", { slug: "micasa" }))!.settings.auto_accept), "true");
  await option(false);
  assert.equal((await card()).auto_accept.on, false);
});
