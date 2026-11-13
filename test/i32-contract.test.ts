// PLA-I32-6: the read contract the Compañía pages build on (Plan doc of PLA-IDEA7, "Contrato de API"). The keys
// are fixed here: GET /api/company, GET /api/company/projects/:slug, GET /api/threads/:id and GET /api/machine's
// plumbing, plus POST /api/company/projects/:slug/team. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const questions = await import("../src/mcp/questions.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const get = async (path: string): Promise<Json> => {
  const res = await app.request(path, { headers: jorge() });
  assert.equal(res.status, 200, `${path}: ${res.status}`);
  return (await res.json()) as Json;
};
const keys = (o: Json) => Object.keys(o).sort();
const STATES = ["running", "idle", "waiting_jorge", "paused"];
const LIGHTS = ["ok", "needs_jorge", "failed", "blocked", "late", "quiet", "paused"];
const USAGE = ["used"];
const MEMBER = ["agent", "last", "next_start", "now", "produced", "queue", "role", "state", "template", "waiting"];

before(async () => {
  raw = await resetTestDb();
  await raw.query(`insert into projects (slug, title, key_prefix) values ('mianovia', 'Mianovia', 'MIA')`);
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const pid = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente", "Prompt: QA"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [await pid("micasa"), title, `# ${title}`, actor]);
  }
  await raw.query(`update projects set runs_paused = false where slug in ('micasa', 'mianovia')`);
  await raw.query(`insert into goals (project_id, title) values ($1, 'Primera boda')`, [await pid("mianovia")]);
  // Mianovia: Taller is running on a ticket; Research delivered a doc; the PO waits on Jorge.
  const A = { actor: { agent: "po-mianovia", session_id: "s-po" } };
  const t = (await writes.createTask(db, { project: "mianovia", key: "MIA-1", title: "Invitaciones", scope: "s", checks: ["c"] } as never, A)) as { key: string };
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, started_at) select id, $1, 'MIA-1', 'taller', 'running', now() from agents where slug = 'taller-mianovia'`,
    [await pid("mianovia")],
  );
  await raw.query(
    `insert into agent_runs (agent_id, project_id, task_key, role, status, started_at, ended_at, tokens_total) select id, $1, 'MIA-1', 'research', 'ok', now() - interval '1 hour', now() - interval '50 minutes', 1200 from agents where slug = 'research-mianovia'`,
    [await pid("mianovia")],
  );
  const thread = (await (await app.request("/api/threads/mianovia", { headers: jorge() })).json()) as { id: string };
  await raw.query(
    `insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'research-mianovia', 'research', 'Investigación lista', $2::jsonb)`,
    [thread.id, JSON.stringify([{ kind: "ticket", ref: t.key, title: "Invitaciones" }, { kind: "doc", ref: "00000000-0000-4000-8000-000000000001", title: "Research" }])],
  );
  await questions.ask(db, { project: "mianovia", key: t.key, question: "¿Papel o digital?" }, A);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I32-6 #1: GET /api/company has exactly the contract keys, a team of four per project and the plumbing line", async () => {
  const c = await get("/api/company");
  assert.deepEqual(keys(c), ["asistente", "company", "decisions", "inbox", "plumbing", "projects", "week"], "PLA-I35-1 added decisions, PLA-I36-2 inbox");
  assert.deepEqual(keys(c.company), ["paused"]);
  assert.deepEqual(keys(c.week), ["resets_at", "starts_at", "timezone"]);
  assert.deepEqual(keys(c.asistente), ["last_run", "state", "thread_id", "unread", "usage"]);
  assert.deepEqual(keys(c.asistente.usage), USAGE);
  assert.ok(STATES.includes(c.asistente.state));
  assert.deepEqual(keys(c.plumbing), ["paused", "running", "spend"]);
  assert.deepEqual([c.plumbing.running, c.plumbing.paused, c.plumbing.spend], [1, false, 1200]);
  assert.deepEqual(c.projects.map((p: Json) => p.slug), ["filmia", "mianovia", "micasa", "workia", "zigzag"]);
  for (const p of c.projects) {
    assert.deepEqual(keys(p), ["goal", "latest", "light", "light_reason", "next", "orders", "paused", "plan", "plan_approval", "preview_url", "ready", "route", "rumbo", "slug", "stale_requests", "team", "this_week", "thread", "title", "usage", "work"], p.slug);
    assert.deepEqual(keys(p.usage), ["last_week", "used"]);
    assert.ok(LIGHTS.includes(p.light), p.light);
    assert.deepEqual(keys(p.thread), ["id", "last", "unread"]);
    assert.deepEqual(p.team.map((m: Json) => m.template), ["product-owner", "research", "artist", "taller"], p.slug);
    for (const m of p.team) {
      assert.deepEqual(keys(m), MEMBER);
      assert.ok(STATES.includes(m.state), m.state);
    }
  }
  const mia = c.projects.find((p: Json) => p.slug === "mianovia");
  assert.equal(mia.goal, "Primera boda");
  assert.equal(mia.light, "needs_jorge");
  const by = Object.fromEntries(mia.team.map((m: Json) => [m.agent, m]));
  assert.equal(by["taller-mianovia"].state, "running");
  assert.deepEqual(keys(by["taller-mianovia"].now), ["run_id", "since", "ticket", "title"]);
  assert.equal(by["taller-mianovia"].now.ticket, "MIA-1");
  assert.deepEqual(by["research-mianovia"].last.status, "ok");
  assert.deepEqual(keys(by["research-mianovia"].last), ["at", "run_id", "status", "ticket", "title"]);
  assert.deepEqual(by["research-mianovia"].produced, { kind: "doc", ref: "00000000-0000-4000-8000-000000000001", title: "Research" });
  assert.equal(by["po-mianovia"].state, "waiting_jorge");
  assert.equal(by["po-mianovia"].waiting, "¿Papel o digital?");
  assert.equal(by["po-mianovia"].role, "product-owner");
  assert.equal(mia.thread.unread, 1);
  assert.deepEqual(keys(mia.thread.last), ["at", "author_role", "body"]);
  const filmia = c.projects.find((p: Json) => p.slug === "filmia");
  assert.equal(filmia.light, "paused");
  assert.ok(filmia.team.every((m: Json) => m.state === "paused"));
});

test("I32-6 #1: GET /api/company/projects/:slug is the project sheet plus team, thread_id and templates", async () => {
  const p = await get("/api/company/projects/mianovia");
  assert.deepEqual(keys(p), ["blocked", "bot_work", "goal", "in_progress", "next", "pipeline", "runs", "slug", "team", "templates", "thread_id", "title"]);
  assert.equal(p.team.length, 4);
  assert.deepEqual(p.templates, [{ slug: "qa", title: "QA" }], "only templates with a prompt doc, not already on the team");
  const thread = await get(`/api/threads/${p.thread_id}`);
  assert.deepEqual(keys(thread), ["id", "kind", "messages", "project"]);
  assert.deepEqual(keys(thread.messages[0]), ["action_state", "actions", "at", "author", "body", "id", "links", "question_id"]);
  assert.deepEqual(keys(thread.messages[0].author), ["agent", "role"]);
});

test("I32-6 #2: POST team creates the agent with project_id and role_template and returns it in team", async () => {
  const post = (slug: string, body: unknown, headers: Record<string, string> = jorge()) =>
    app.request(`/api/company/projects/${slug}/team`, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await post("mianovia", { template: "qa" }, { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" })).status, 403);
  assert.equal((await post("mianovia", { template: "qa" }, { "Content-Type": "application/json" })).status, 401);
  const bogus = await post("mianovia", { template: "chef" });
  assert.equal(bogus.status, 400);
  assert.equal(((await bogus.json()) as Json).error, "INVALID_TEMPLATE");
  const noDoc = await post("mianovia", { template: "copy" });
  assert.equal(noDoc.status, 409);
  assert.equal(((await noDoc.json()) as Json).error, "PROMPT_DOC_MISSING");

  const res = await post("mianovia", { template: "qa" });
  assert.equal(res.status, 201);
  const out = (await res.json()) as Json;
  assert.deepEqual(keys(out), ["agent", "team"]);
  assert.deepEqual([out.agent.agent, out.agent.template, out.agent.role, out.agent.state], ["qa-mianovia", "qa", "qa", "idle"]);
  assert.deepEqual(out.team.map((m: Json) => m.agent), ["po-mianovia", "research-mianovia", "artist-mianovia", "taller-mianovia", "qa-mianovia"]);
  const row = (await raw.query(`select a.role_template, a.adapter, p.slug as project, b.slug as boss from agents a join projects p on p.id = a.project_id join agents b on b.id = a.reports_to where a.slug = 'qa-mianovia'`)).rows[0];
  assert.deepEqual(row, { role_template: "qa", adapter: "claude_code", project: "mianovia", boss: "po-mianovia" });
  assert.deepEqual((await get("/api/company/projects/mianovia")).templates, []);
  const again = await post("mianovia", { template: "qa" });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as Json).error, "AGENT_EXISTS");
});

test("I32-6 #1: GET /api/machine keeps the inventory and adds the plumbing: week tokens per project and Asistente, guard, switches, runs, log", async () => {
  const m = await get("/api/machine");
  for (const k of ["machine", "totals", "backup", "findings", "items", "plumbing"]) assert.ok(k in m, k);
  assert.deepEqual(keys(m.plumbing), ["company", "log", "plan", "runs", "settings", "usage", "viewer", "week"]);
  assert.deepEqual(keys(m.plumbing.usage), ["asistente", "projects"]);
  assert.deepEqual(keys(m.plumbing.usage.asistente), USAGE);
  assert.deepEqual(keys(m.plumbing.usage.projects[0]), ["paused", "paused_at", "slug", "title", "usage"]);
  assert.deepEqual(keys(m.plumbing.runs), ["live", "queued"]);
  assert.equal(m.plumbing.runs.live[0].agent, "taller-mianovia");
  assert.equal(m.plumbing.log[0].agent, "research-mianovia");
  assert.equal("asistente_weekly_limit" in m.plumbing.settings, false, "no Asistente limit");
  assert.equal("roles" in m.plumbing, false, "no role caps");
});
