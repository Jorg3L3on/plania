// PLA-I71-3: seats the owner manages from Equipo (src/runner/puestos.ts, src/api/company-equipo.ts, propose_seat).
// Move (a loop is MANAGER_LOOP), pause (the runner holds a paused seat's runs, seat_paused), retire (history stays,
// reports move up), add from the catalog or a role of the owner's own (arrives paused, at most eight), and a PO's
// proposal that only the owner's screen decides (a Bearer is refused). Throwaway DB, fake values, no real claude.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "tienda";
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i71-puestos-"));
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { ensureTeam } = await import("../src/runner/team.js");
const puestos = await import("../src/runner/puestos.js");
const runner = await import("../src/runner/runner.js");
const { createMcpServer } = await import("../src/mcp/register.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
let pid: string;
const owner = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = owner()) => {
  const res = await app.request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
};
const agent = async (slug: string) => (await raw.query(`select a.*, b.slug as boss from agents a left join agents b on b.id = a.reports_to where a.slug = $1`, [slug])).rows[0] as Json;
const team = async () => ((await call("GET", "/api/company/projects/tienda")).json.team as Json[]).map((m) => m.agent).sort();

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await raw.query(`insert into agents (slug, name, role, kind) values ('ceo', 'CEO', 'ceo', 'human')`);
  pid = (await raw.query(`insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND') returning id`)).rows[0].id;
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const t of ["Product owner", "Taller", "Research", "Artist", "QA", "Copy", "Seguridad", "Marketing", "Data"])
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [pid, `Prompt: ${t}`, `# ${t}`, actor]);
  await ensureTeam(db, { id: pid, slug: "tienda", title: "Tienda" });
});
after(async () => {
  await closeDb();
  await raw.end();
});

test("I71-3 #1: the migration is the next number and safe to run twice", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../drizzle/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes("0075_equipo_puestos.sql"));
  const sql = readFileSync(new URL("0075_equipo_puestos.sql", dir), "utf8");
  await raw.query(sql);
  await raw.query(sql);
  assert.equal((await raw.query(`select count(*)::int as n from puestos where origin = 'factory'`)).rows[0].n, 9);
});

test("I71-3 #2: a move that would make a loop is MANAGER_LOOP; a valid one moves; a stranger is MANAGER_NOT_ON_TEAM", async () => {
  // Research under Taller, then Taller under Research is a loop.
  assert.equal((await call("PUT", "/api/company/projects/tienda/team/research-tienda/manager", { reports_to: "taller-tienda" })).status, 200);
  assert.equal((await agent("research-tienda")).boss, "taller-tienda");
  const loop = await call("PUT", "/api/company/projects/tienda/team/taller-tienda/manager", { reports_to: "research-tienda" });
  assert.equal(loop.status, 409);
  assert.equal(loop.json.error, "MANAGER_LOOP");
  assert.equal((await call("PUT", "/api/company/projects/tienda/team/taller-tienda/manager", { reports_to: "taller-tienda" })).json.error, "MANAGER_LOOP");
  assert.deepEqual((await call("GET", "/api/company/projects/tienda/team/taller-tienda/below")).json.below.sort(), ["research-tienda", "taller-tienda"]);
  assert.equal((await call("PUT", "/api/company/projects/tienda/team/taller-tienda/manager", { reports_to: "nadie" })).json.error, "MANAGER_NOT_ON_TEAM");
  // To the owner: the company's seat.
  assert.equal((await call("PUT", "/api/company/projects/tienda/team/research-tienda/manager", { reports_to: null })).status, 200);
  assert.equal((await agent("research-tienda")).boss, "ceo");
  // The chart's read follows.
  const r = ((await call("GET", "/api/company/projects/tienda")).json.team as Json[]).find((m) => m.agent === "research-tienda")!;
  assert.equal(r.reports_to, "ceo");
  await call("PUT", "/api/company/projects/tienda/team/research-tienda/manager", { reports_to: "po-tienda" });
});

test("I71-3 #3: a paused seat starts no run (held seat_paused) and shows paused; resume restores it", async () => {
  assert.equal((await call("PUT", "/api/company/projects/tienda/team/artist-tienda/pause", { paused: true })).status, 200);
  const m = ((await call("GET", "/api/company/projects/tienda")).json.team as Json[]).find((x) => x.agent === "artist-tienda")!;
  assert.equal(m.state, "paused");
  assert.ok(m.paused_at);
  await raw.query(`update runner_settings set cooldown_minutes = 0`);
  const run = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, work_key, trigger, lane) select id, $1, 'artist', 'queued', 'q', 'general', 'event', 'work' from agents where slug = 'artist-tienda' returning id`, [pid])).rows[0].id;
  const deps = { env: { HOME: scratch, PATH: "/usr/bin:/bin", CLAUDE_CODE_BIN: "/fake/claude" } as NodeJS.ProcessEnv, logDir: scratch, tmpDir: scratch, worktreeRoot: scratch, footprints: false, git: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => { throw new Error("no run may start"); }, kill: () => undefined, machine: () => ({ freeMb: 99_999, freeDiskGb: 999 }), probeUsage: async () => null, reportTokens: async () => undefined };
  const r = await runner.admit(db, new Date(), deps as never);
  assert.deepEqual(r.outcomes.get(run), { kind: "held", code: "seat_paused", summary: "queued: the owner paused this seat" });
  assert.equal((await raw.query(`select status, held_code from agent_runs where id = $1`, [run])).rows[0].held_code, "seat_paused");
  assert.equal((await call("PUT", "/api/company/projects/tienda/team/artist-tienda/pause", { paused: false })).status, 200);
  assert.equal((await agent("artist-tienda")).paused_at, null);
  const again = await runner.admit(db, new Date(), deps as never).catch(() => null);
  assert.notEqual((again?.outcomes.get(run) as Json | undefined)?.code, "seat_paused");
  await raw.query(`delete from agent_runs where id = $1`, [run]);
});

test("I71-3 #6: adding from the catalog and from a role of the owner's own arrives paused; the eighth seat is the last", async () => {
  const cat = (await call("GET", "/api/company/projects/tienda/equipo")).json.puestos as Json[];
  assert.deepEqual(cat.filter((c) => c.origin === "factory").map((c) => c.slug), ["product-owner", "research", "artist", "taller", "qa", "copy", "seguridad", "marketing", "data"]);
  assert.ok(cat.find((c) => c.slug === "taller")!.taken);
  const qa = await call("POST", "/api/company/projects/tienda/team", { template: "qa" });
  assert.equal(qa.status, 201, JSON.stringify(qa.json));
  assert.equal(qa.json.agent.state, "paused");
  assert.ok((await agent("qa-tienda")).paused_at);
  assert.equal((await agent("qa-tienda")).boss, "po-tienda");
  // A role of the owner's own: two lines on a base role; its seat runs on that role, its line as the manner.
  const bad = await call("POST", "/api/company/puestos", { title: "", line: "x", base: "taller" });
  assert.equal(bad.json.error, "PUESTO_INVALID");
  assert.equal((await call("POST", "/api/company/puestos", { title: "Redes", line: "x", base: "ceo" })).json.error, "PUESTO_INVALID");
  const own = await call("POST", "/api/company/puestos", { title: "Redes sociales", line: "Publica en redes lo que se lanza.", base: "copy" });
  assert.equal(own.status, 201);
  assert.equal(own.json.slug, "redes-sociales");
  assert.equal((await call("POST", "/api/company/puestos", { title: "Redes sociales", line: "otra", base: "copy" })).json.error, "SEAT_TAKEN");
  const added = await call("POST", "/api/company/projects/tienda/team", { template: "redes-sociales" });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  assert.equal(added.json.agent.puesto, "Redes sociales");
  const row = await agent("redes-sociales-tienda");
  assert.equal(row.role_template, "copy");
  assert.equal(row.manner, "Publica en redes lo que se lanza.");
  assert.ok(row.paused_at);
  for (const t of ["copy", "seguridad"]) assert.equal((await call("POST", "/api/company/projects/tienda/team", { template: t })).status, 201, t);
  assert.equal((await team()).length, 8);
  const ninth = await call("POST", "/api/company/projects/tienda/team", { template: "marketing" });
  assert.equal(ninth.status, 409);
  assert.equal(ninth.json.error, "TEAM_FULL");
});

test("I71-3 #4: retiring keeps runs and lessons, moves its reports up, and leaves the chart; the PO stays", async () => {
  await call("PUT", "/api/company/projects/tienda/team/qa-tienda/manager", { reports_to: "taller-tienda" });
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, work_key, trigger, lane, ended_at) select id, $1, 'taller', 'ok', 'done', 'general', 'event', 'work', now() from agents where slug = 'taller-tienda'`, [pid]);
  await raw.query(`insert into lessons (project_id, agent_id, scope, text, state, proposed_by) select $1, id, 'agent', 'Nunca toques main.', 'active', 'owner' from agents where slug = 'taller-tienda'`, [pid]);
  const r = await call("POST", "/api/company/projects/tienda/team/taller-tienda/retire", {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.moved, ["qa-tienda"]);
  assert.equal((await agent("qa-tienda")).boss, "po-tienda");
  assert.equal((await agent("taller-tienda")).status, "retired");
  assert.ok(!(await team()).includes("taller-tienda"));
  assert.equal((await raw.query(`select count(*)::int as n from agent_runs r join agents a on a.id = r.agent_id where a.slug = 'taller-tienda'`)).rows[0].n, 1);
  assert.equal((await raw.query(`select count(*)::int as n from lessons l join agents a on a.id = l.agent_id where a.slug = 'taller-tienda'`)).rows[0].n, 1);
  const po = await call("POST", "/api/company/projects/tienda/team/po-tienda/retire", {});
  assert.equal(po.status, 409);
  assert.equal(po.json.error, "SEAT_REQUIRED");
});

test("I71-3 #5: only the project's PO proposes a seat; only the owner's screen decides it; a Bearer is refused", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(b);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(a);
  const propose = async (who: string, role: string) => {
    const r = (await client.callTool({ name: "propose_seat", arguments: { actor: { agent: who, session_id: `s-${who}` }, project: "tienda", role, reason: "Tres entregas volvieron por algo que una prueba habría visto." } })) as { isError?: boolean; content: { text: string }[] };
    return JSON.parse(r.content[0]!.text) as Json;
  };
  assert.equal((await propose("research-tienda", "marketing")).error, "SEAT_PROPOSAL_NOT_PO");
  assert.equal((await propose("po-tienda", "qa")).error, "SEAT_TAKEN");
  // Free a seat so the proposal can be accepted.
  await call("POST", "/api/company/projects/tienda/team/seguridad-tienda/retire", {});
  const made = await propose("po-tienda", "marketing");
  assert.equal(made.proposal.role, "marketing");
  assert.equal(made.proposal.state, "proposed");
  assert.equal((await propose("po-tienda", "marketing")).proposal.id, made.proposal.id, "one open proposal per role");
  const open = (await call("GET", "/api/company/projects/tienda/equipo")).json.proposals as Json[];
  assert.deepEqual(open.map((x) => x.role), ["marketing"]);
  // No MCP tool decides a proposal, and the screen's route refuses a Bearer.
  assert.ok(!(await client.listTools()).tools.some((t) => /decide|accept/.test(t.name) && /seat|propos/.test(t.name)));
  const bearer = await call("POST", `/api/company/projects/tienda/proposals/${made.proposal.id}/decide`, { accept: true }, { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" });
  assert.equal(bearer.status, 403);
  const yes = await call("POST", `/api/company/projects/tienda/proposals/${made.proposal.id}/decide`, { accept: true });
  assert.equal(yes.status, 200, JSON.stringify(yes.json));
  assert.deepEqual(yes.json, { state: "accepted", agent: "marketing-tienda" });
  assert.ok((await agent("marketing-tienda")).paused_at, "an accepted seat arrives paused");
  assert.equal((await call("POST", `/api/company/projects/tienda/proposals/${made.proposal.id}/decide`, { accept: false })).json.error, "PROPOSAL_DECIDED");
  assert.equal((await call("POST", `/api/company/projects/tienda/proposals/00000000-0000-4000-8000-000000000000/decide`, { accept: false })).json.error, "PROPOSAL_NOT_FOUND");
  await client.close();
});
