// PLA-I46-10: accepting or returning a delivery from the floor's evidence card, through the screen's own route
// (POST /api/company/decisions/:id), and the switch «Aceptar sola en la copia de prueba». Throwaway DB; gh is
// faked through releaseGh.run, so no real gh ever runs and nothing reaches GitHub.
//   #1 Aceptar merges the PR into the test copy (sandbox), never main
//   #2 Devolver a Taller with a reason: the ticket goes back to Ready, the note (reason: line) reaches it, Taller wakes
//   #3 after a return the floor has no move (no green button anywhere) and the delivery reads as returned
//   #4 the switch is off by default; only the owner's screen turns it on (agents cannot, by set_project or Bearer)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

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
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
let taller: string;
const realGh = releaseGh.run;
const PO = { agent: "po-micasa", session_id: "s-po-i46-10" };
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const company = async () => (await (await app.request("/api/company", { headers: jorge() })).json()) as Json;
const decide = (id: string, body: Json) => app.request(`/api/company/decisions/${encodeURIComponent(id)}`, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const card = (c: Json) => c.projects.find((p: Json) => p.slug === "micasa");

// A code ticket In review with its PR, made by Taller, and Taller's delivery message on the project thread.
async function deliver(title: string, pr: number): Promise<{ key: string; id: string }> {
  const t = (await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], work_type: "code", owner_agent: taller } as never, { actor: PO })) as { key: string };
  const url = `https://github.com/example/micasa/pull/${pr}`;
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [t.key, url]);
  await raw.query(`update checks set done = true, done_at = now() where task_id = (select id from tasks where key = $1)`, [t.key]);
  const { thread } = await resolveThread(db, "micasa");
  const m = await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, $2, 'taller', $3, $4) returning id`, [
    thread.id,
    taller,
    `Listo ${t.key}: PR #${pr}`,
    JSON.stringify([
      { kind: "ticket", ref: t.key, title },
      { kind: "pr", ref: url, title: `PR #${pr}` },
    ]),
  ]);
  return { key: t.key, id: `m-${m.rows[0].id}` };
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const pid = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  taller = "taller-mc-i46";
  await raw.query(`insert into agents (slug, name, role, kind, adapter, project_id, role_template) values ($1, 'Taller', 'engineer', 'coder', 'claude_code', $2, 'taller') on conflict do nothing`, [taller, pid]);
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
  await raw?.end();
});

test("I46-10 #1: Aceptar on the evidence card merges the delivery into the test copy (sandbox), never main", async () => {
  const { key, id } = await deliver("Pantalla de gracias", 31);
  const c = await company();
  const m = card(c).next_move;
  assert.equal(m.verbo, "aceptar");
  assert.deepEqual(m.accion, { kind: "decision", id, action: "fusionar", label: "Aceptar" });
  assert.equal(m.origen.decision, "pr", "the evidence card is drawn for this move");
  const res = await decide(id, { action: "fusionar" });
  assert.equal(res.status, 200, await res.clone().text());
  const ev = (await raw.query(`select payload from events where type = 'pr.merged' and task_key = $1`, [key])).rows[0].payload;
  assert.deepEqual([ev.number, ev.base, ev.by], [31, "sandbox", "screen"]);
  assert.equal(card(await company()).next_move, null, "nothing left to accept on the floor");

  // A delivery whose PR goes to main is refused: main is never accepted from the floor.
  const bad = await deliver("Atajo a main", 99);
  const refused = await decide(bad.id, { action: "fusionar" });
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as Json).error, "BASE_NOT_SANDBOX");
  await raw.query(`update tasks set status = 'Done' where key = $1`, [bad.key]);
  await raw.query(`update thread_messages set action_state = '{"action":"aceptar","at":"2026-01-01T00:00:00Z","result":{}}'::jsonb where id = $1`, [bad.id.slice(2)]);
});

test("I46-10 #2 #3: Devolver a Taller with a reason puts the ticket back with Taller, the note reaches it, and the floor stops asking", async () => {
  await raw.query(`delete from agent_runs`);
  const { key, id } = await deliver("Exportar a Excel", 32);
  assert.equal(card(await company()).next_move?.origen.id, id);
  const text = returnText("No se ve bien", "  el botón queda cortado a 390 ");
  assert.equal(text, "No se ve bien: el botón queda cortado a 390");
  const res = await decide(id, { action: "cambios", text });
  assert.equal(res.status, 200, await res.clone().text());
  // Back with Taller: Ready, the note on the ticket, its owner woken.
  assert.equal((await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status, "Ready");
  const note = (await raw.query(`select payload from events where task_key = $1 and type = 'note' order by id desc limit 1`, [key])).rows[0];
  assert.match(JSON.stringify(note?.payload ?? {}), /No se ve bien: el botón queda cortado a 390/);
  const runs = (await raw.query(`select a.slug, r.status, r.task_key from agent_runs r join agents a on a.id = r.agent_id`)).rows;
  assert.deepEqual(runs, [{ slug: taller, status: "queued", task_key: key }]);

  // The floor: the delivery reads as returned, and nothing is the owner's (no move, so no green button anywhere).
  const c = await company();
  const back = c.decisions.find((d: Json) => d.id === id);
  assert.deepEqual([back.state.action, back.state.result.text, back.actions], ["cambios", text, []]);
  assert.equal(card(c).next_move, null);
  assert.equal((returnedDelivery("micasa", c.decisions as never) as Json | null)?.id, id);

  // Taller delivers again: the new delivery is the move once more and the return no longer stands.
  const again = await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ((select thread_id from thread_messages where id = $1), $2, 'taller', 'Arreglado', (select links from thread_messages where id = $1)) returning id`, [id.slice(2), taller]);
  await raw.query(`update tasks set status = 'In review' where key = $1`, [key]);
  const c2 = await company();
  assert.equal(card(c2).next_move?.origen.id, `m-${again.rows[0].id}`);
  assert.equal(returnedDelivery("micasa", c2.decisions), null);
});

test("I46-10 #4: the switch is off by default and only the owner's screen turns it on", async () => {
  await raw.query(`update projects set settings = settings - 'auto_accept' where slug = 'micasa'`);
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
