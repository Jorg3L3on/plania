// PLA-I31-3: POST /api/company/projects, the new-project template that starts paused. Throwaway DB.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
process.env.PLANIA_EVENT_WAKES = "1";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { roleOf } = await import("../src/runner/limits.js");
const { prefixCandidates, slugOf } = await import("../src/runner/new-project.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
let promptDocId: string;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const post = (body: unknown, headers: Record<string, string> = jorge()) =>
  app.request("/api/company/projects", { method: "POST", headers, body: JSON.stringify(body) });

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update runner_settings set company_paused = false`);
  const micasa = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  promptDocId = (
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Prompt: Product owner', '# PO', $2) returning id`, [
      micasa,
      JSON.stringify({ agent: "test", session_id: "s" }),
    ])
  ).rows[0].id;
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I31-3: only Jorge's screen creates a project: Bearer 403, no cookie 401, bad body 400", async () => {
  const bearer = await post({ name: "X", goal: "Y" }, { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" });
  assert.equal(bearer.status, 403);
  const bearerWithCookie = await post({ name: "X", goal: "Y" }, { ...jorge(), Authorization: `Bearer ${TEST_BEARER}` });
  assert.equal(bearerWithCookie.status, 403);
  assert.equal((await post({ name: "X", goal: "Y" }, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await post({ name: "X" })).status, 400);
  assert.equal((await post({ name: "X", goal: "Y", slug: "x" })).status, 400);
  assert.equal((await raw.query(`select count(*)::int as n from projects where slug = 'x'`)).rows[0].n, 0);
});

test("I31-3 #1: a created project is paused, has its goal, a PO with the template prompt, no weekly limit, and no wake until resumed", async () => {
  const res = await post({ name: "Café Lindo", goal: "Vender café en línea a 100 clientes." });
  assert.equal(res.status, 201);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(body, {
    slug: "cafe-lindo",
    key_prefix: "CAF",
    paused: true,
    po: "po-cafe-lindo",
    team: ["po-cafe-lindo", "research-cafe-lindo", "artist-cafe-lindo", "taller-cafe-lindo"],
    prompt_doc_id: promptDocId,
  });

  const project = (await raw.query(`select id, title, runs_paused, key_prefix from projects where slug = 'cafe-lindo'`)).rows[0];
  assert.equal(project.title, "Café Lindo");
  assert.equal(project.runs_paused, true, "the switch is off");
  const goal = (await raw.query(`select title, status from goals where project_id = $1`, [project.id])).rows;
  assert.deepEqual(goal, [{ title: "Vender café en línea a 100 clientes.", status: "active" }]);

  const po = (await raw.query(`select a.*, p.slug as boss from agents a left join agents p on p.id = a.reports_to where a.slug = 'po-cafe-lindo'`)).rows[0];
  assert.equal(po.adapter, "claude_code");
  assert.equal(po.role, "product-owner");
  assert.equal(po.boss, "ceo");
  assert.equal(po.heartbeat_minutes, null);
  assert.deepEqual(po.capabilities, ["cafe-lindo"]);
  assert.equal(roleOf({ slug: po.slug, role: po.role, capabilities: po.capabilities }), "product-owner");
  assert.match(po.note, new RegExp(`Prompt: Product owner.*${promptDocId}`));

  // PLA-I32-2 #2: the PO comes with its team, every member on the project with its role template.
  const team = (
    await raw.query(
      `select a.slug, a.role_template, a.adapter, b.slug as boss from agents a left join agents b on b.id = a.reports_to where a.project_id = $1 order by a.slug`,
      [project.id],
    )
  ).rows;
  assert.deepEqual(team, [
    { slug: "artist-cafe-lindo", role_template: "artist", adapter: "claude_code", boss: "po-cafe-lindo" },
    { slug: "po-cafe-lindo", role_template: "product-owner", adapter: "claude_code", boss: "ceo" },
    { slug: "research-cafe-lindo", role_template: "research", adapter: "claude_code", boss: "po-cafe-lindo" },
    { slug: "taller-cafe-lindo", role_template: "taller", adapter: "claude_code", boss: "po-cafe-lindo" },
  ]);
  for (const m of team) assert.equal(roleOf({ slug: m.slug, role: "x", capabilities: [], roleTemplate: m.role_template }), m.role_template);

  // PLA-21: no weekly limit is made for it.
  assert.equal((await raw.query(`select to_regclass('token_budgets') as t`)).rows[0].t, null);

  // Nothing is queued while paused, not even when a ticket in it moves to Ready.
  await writes.createTask(db, { project: "cafe-lindo", title: "Primera", scope: "s", checks: ["c"] } as never, { actor: { agent: "t", session_id: "s" } });
  const t = (await raw.query(`select key, version from tasks where project_id = $1`, [project.id])).rows[0];
  await writes.setTask(db, { project: "cafe-lindo", key: t.key, status: "Ready", version: t.version } as never, { actor: { agent: "t", session_id: "s" } });
  const runs = async () => (await raw.query(`select a.slug, r.status, r.task_key from agent_runs r join agents a on a.id = r.agent_id where r.project_id = $1`, [project.id])).rows;
  assert.deepEqual(await runs(), []);

  // The Compañía read shows it paused, with this week's tokens and no limit.
  const state = (await (await app.request("/api/company", { headers: jorge() })).json()) as { projects: { slug: string; paused: boolean; usage: { used: number } }[] };
  const card = state.projects.find((p) => p.slug === "cafe-lindo")!;
  assert.equal(card.paused, true);
  assert.deepEqual(card.usage, { used: 0 });

  // Jorge resumes it: its PO's first wake is queued (and nothing else).
  const resumed = await app.request("/api/company/projects/cafe-lindo/switch", { method: "POST", headers: jorge(), body: JSON.stringify({ paused: false }) });
  assert.equal(resumed.status, 200);
  assert.deepEqual(await runs(), [{ slug: "po-cafe-lindo", status: "queued", task_key: null }]);
});

test("I31-3: the same name again is 409 PROJECT_EXISTS; a taken key prefix picks another", async () => {
  const again = await post({ name: "Cafe lindo", goal: "Otra meta." });
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: "PROJECT_EXISTS", slug: "cafe-lindo" });

  const second = await post({ name: "MiCasa Dos", goal: "Una meta." });
  assert.equal(second.status, 201);
  const body = (await second.json()) as { slug: string; key_prefix: string };
  assert.equal(body.slug, "micasa-dos");
  assert.notEqual(body.key_prefix, "MIC");
  assert.match(body.key_prefix, /^[A-Z0-9]{3}$/);
  assert.equal((await raw.query(`select count(*)::int as n from projects where key_prefix = $1`, [body.key_prefix])).rows[0].n, 1);

  assert.equal(slugOf("  ¡Hola, Mundo!  "), "hola-mundo");
  assert.equal(slugOf("123 go"), "p-123-go");
  assert.equal(prefixCandidates("ab")[0], "ABX");
});

test("I31-3: without the Prompt: Product owner doc nothing is created (409 PROMPT_DOC_MISSING)", async () => {
  await raw.query(`update docs set title = 'Prompt: PO (old)' where id = $1`, [promptDocId]);
  try {
    const res = await post({ name: "Sin Prompt", goal: "Meta." });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "PROMPT_DOC_MISSING" });
    assert.equal((await raw.query(`select count(*)::int as n from projects where slug = 'sin-prompt'`)).rows[0].n, 0);
  } finally {
    await raw.query(`update docs set title = 'Prompt: Product owner' where id = $1`, [promptDocId]);
  }
});
