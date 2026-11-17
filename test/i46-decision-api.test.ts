// PLA-I46-10: accepting or returning a delivery from the floor's evidence card, through the screen's own route
// (POST /api/company/decisions/:id), and the switch «Aceptar sola en la copia de prueba». Throwaway store; gh is
// faked through releaseGh.run, so no real gh ever runs and nothing reaches GitHub.
//   #1 Aceptar merges the PR into the test copy (sandbox), never main
//   #2 Devolver a Taller with a reason: the ticket goes back to Ready, the note (reason: line) reaches it, Taller wakes
//   #3 after a return the floor has no move (no green button anywhere) and the delivery reads as returned
//   #4 the switch is off by default; only the owner's screen turns it on (agents cannot, by set_project or Bearer)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TEST_BEARER, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { releaseGh } = await import("../src/mcp/release-ship.js");
const writes = await import("../src/mcp/writes.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const { resolveThread } = await import("../src/runner/threads.js");
const { returnedDelivery } = await import("../src/api/company-move.js");
const { returnText } = (await import(new URL("../ui/src/lib/evidencia.ts", import.meta.url).href)) as { returnText: (reason: string, line: string) => string };

type Db = ReturnType<typeof makeDb>["db"];
type Json = Record<string, any>;
let store: TestStore;
let db: Db;
let closeDb: () => Promise<void>;
let taller: string;
const realGh = releaseGh.run;
const PO = { agent: "po-micasa", session_id: "s-po-i46-10" };
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const company = async () => (await (await app.request("/api/company", { headers: jorge() })).json()) as Json;
const decide = (id: string, body: Json) => app.request(`/api/company/decisions/${encodeURIComponent(id)}`, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const card = (c: Json) => c.projects.find((p: Json) => p.slug === "micasa");
const taskOf = async (key: string) => {
  const t = await store.get("tasks", { key });
  if (!t) throw new Error(`no task ${key}`);
  return t;
};

// A code ticket In review with its PR, made by Taller, and Taller's delivery message on the project thread.
async function deliver(title: string, pr: number): Promise<{ key: string; id: string }> {
  const t = (await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], work_type: "code", owner_agent: taller } as never, { actor: PO })) as { key: string };
  const url = `https://github.com/example/micasa/pull/${pr}`;
  const task = await taskOf(t.key);
  const { thread } = await resolveThread(db, "micasa");
  const m = await store.fix(async (uow) => {
    await uow.update("tasks", { id: task.id }, { status: "In review", prUrl: url });
    await uow.update("checks", { taskId: task.id }, { done: true, doneAt: uow.now });
    return uow.insert("threadMessages", {
      threadId: thread.id,
      authorAgent: taller,
      authorRole: "taller",
      body: `Listo ${t.key}: PR #${pr}`,
      links: [
        { kind: "ticket", ref: t.key, title },
        { kind: "pr", ref: url, title: `PR #${pr}` },
      ],
    });
  });
  return { key: t.key, id: `m-${m.id}` };
}

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const pid = await store.projectId("micasa");
  taller = "taller-mc-i46";
  await store.fix(async (uow) => {
    await uow.update("projects", { slug: "micasa" }, { runsPaused: false });
    if (!(await uow.get("agents", { slug: taller })))
      await uow.insert("agents", { slug: taller, name: "Taller", role: "engineer", kind: "coder", adapter: "claude_code", projectId: pid, roleTemplate: "taller" });
  });
  // The fake gh: every PR is open, on sandbox, at one head; a merge answers with its merge commit.
  releaseGh.run = async (args) => {
    const n = args[2]!;
    if (args[1] === "view" && args.includes("baseRefName,state,headRefOid,url")) return { ok: true, stdout: JSON.stringify({ baseRefName: n === "99" ? "main" : "sandbox", state: "OPEN", headRefOid: "f".repeat(40), url: `https://github.com/example/micasa/pull/${n}` }), stderr: "" };
    if (args[1] === "merge") return { ok: true, stdout: "", stderr: "" };
    if (args[1] === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: "a".repeat(40) }, url: `https://github.com/example/micasa/pull/${n}` }), stderr: "" };
    return { ok: false, stdout: "", stderr: "unexpected" };
  };
});

after(async () => {
  releaseGh.run = realGh;
  await closeDb?.();
  await store?.end();
});

test("I46-10 #1: Aceptar on the evidence card merges the delivery into the test copy (sandbox), never main", async () => {
  const { key, id } = await deliver("Pantalla de gracias", 31);
  const c = await company();
  const m = card(c).next_move;
  assert.equal(m.verbo, "aceptar");
  assert.deepEqual(m.accion, { kind: "decision", id, action: "fusionar", label: "Aprobar y pasar a prueba" });
  assert.equal(m.origen.decision, "pr", "the evidence card is drawn for this move");
  const res = await decide(id, { action: "fusionar" });
  assert.equal(res.status, 200, await res.clone().text());
  const [merged] = await store.find("events", { type: "pr.merged", taskKey: key });
  const ev = merged!.payload;
  assert.deepEqual([ev.number, ev.base, ev.by], [31, "sandbox", "screen"]);
  assert.equal(card(await company()).next_move, null, "nothing left to accept on the floor");

  // A delivery whose PR goes to main is refused: main is never accepted from the floor.
  const bad = await deliver("Atajo a main", 99);
  const refused = await decide(bad.id, { action: "fusionar" });
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as Json).error, "BASE_NOT_SANDBOX");
  const badTask = await taskOf(bad.key);
  await store.fix(async (uow) => {
    await uow.update("tasks", { id: badTask.id }, { status: "Done" });
    await uow.update("threadMessages", { id: bad.id.slice(2) }, { actionState: { action: "aceptar", at: "2026-01-01T00:00:00Z", result: {} } as never });
  });
});

test("I46-10 #2 #3: Devolver a Taller with a reason puts the ticket back with Taller, the note reaches it, and the floor stops asking", async () => {
  await store.fix((uow) => uow.delete("agentRuns", {}));
  const { key, id } = await deliver("Exportar a Excel", 32);
  assert.equal(card(await company()).next_move?.origen.id, id);
  const text = returnText("No se ve bien", "  el botón queda cortado a 390 ");
  assert.equal(text, "No se ve bien: el botón queda cortado a 390");
  const res = await decide(id, { action: "cambios", text });
  assert.equal(res.status, 200, await res.clone().text());
  // Back with Taller: Ready, the note on the ticket, its owner woken.
  assert.equal((await taskOf(key)).status, "Ready");
  const [note] = await store.find("events", { taskKey: key, type: "note" }, { orderBy: [{ column: "id", desc: true }], limit: 1 });
  assert.match(JSON.stringify(note?.payload ?? {}), /No se ve bien: el botón queda cortado a 390/);
  const slugOf = new Map((await store.find("agents")).map((a) => [a.id, a.slug]));
  const runs = (await store.find("agentRuns")).map((r) => ({ slug: slugOf.get(r.agentId), status: r.status, task_key: r.taskKey }));
  assert.deepEqual(runs, [{ slug: taller, status: "queued", task_key: key }]);

  // The floor: the delivery reads as returned, and nothing is the owner's (no move, so no green button anywhere).
  const c = await company();
  const back = c.decisions.find((d: Json) => d.id === id);
  assert.deepEqual([back.state.action, back.state.result.text, back.actions], ["cambios", text, []]);
  assert.equal(card(c).next_move, null);
  assert.equal((returnedDelivery("micasa", c.decisions as never) as Json | null)?.id, id);

  // Taller delivers again: the new delivery is the move once more and the return no longer stands.
  const first = (await store.get("threadMessages", { id: id.slice(2) }))!;
  const task = await taskOf(key);
  const again = await store.fix(async (uow) => {
    const m = await uow.insert("threadMessages", { threadId: first.threadId, authorAgent: taller, authorRole: "taller", body: "Arreglado", links: first.links });
    await uow.update("tasks", { id: task.id }, { status: "In review" });
    return m;
  });
  const c2 = await company();
  assert.equal(card(c2).next_move?.origen.id, `m-${again.id}`);
  assert.equal(returnedDelivery("micasa", c2.decisions), null);
});

test("I46-10 #4: the switch is off by default and only the owner's screen turns it on", async () => {
  await store.fix(async (uow) => {
    const p = (await uow.get("projects", { slug: "micasa" }))!;
    const { auto_accept: _off, ...settings } = p.settings;
    await uow.update("projects", { id: p.id }, { settings });
  });
  assert.deepEqual(card(await company()).auto_accept, { on: false, hold: null });
  // An agent cannot: set_project does not take it, and the options route refuses a Bearer token.
  const p = await findProject(db, "micasa");
  await assert.rejects(setProject(db, { project: "micasa", version: p.version, settings: { auto_accept: true } } as never, { actor: PO }), /INVALID_FILTER/);
  const bearer = await app.request("/api/company/projects/micasa/options", { method: "PUT", headers: { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" }, body: JSON.stringify({ auto_accept: true }) });
  assert.ok([401, 403].includes(bearer.status), `Bearer refused (${bearer.status})`);
  assert.equal((await app.request("/api/company/projects/micasa/options", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto_accept: true }) })).status, 401);
  assert.equal(card(await company()).auto_accept.on, false);
  // The owner's click.
  const on = await app.request("/api/company/projects/micasa/options", { method: "PUT", headers: jorge(), body: JSON.stringify({ auto_accept: true }) });
  assert.equal(on.status, 200);
  assert.equal(card(await company()).auto_accept.on, true);
  await app.request("/api/company/projects/micasa/options", { method: "PUT", headers: jorge(), body: JSON.stringify({ auto_accept: false }) });
});
