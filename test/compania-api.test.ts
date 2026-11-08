// PLA-I30-2/3: the Compañía read gains viewer, prompts, roster and project_facts; the project sheet and the
// prompt doc are new cookie-only reads. Existing fields keep their meaning. Fake data on the throwaway test DB.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { seedOrg } = await import("../scripts/seed-org.js");

let raw: pg.Client;
const cookie = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}` });
type Json = Record<string, any>;
const get = async (path: string, headers: Record<string, string> = cookie()) => {
  const res = await app.request(path, { headers });
  return { status: res.status, body: (await res.json()) as Json };
};

before(async () => {
  raw = await resetTestDb();
  await raw.query(`insert into projects (slug, title, key_prefix) values ('plania', 'Plania', 'PLA'), ('mianovia', 'Mianovia', 'MIA')`);
  await seedOrg(makeDb().db);
  const pla = (await raw.query(`select id from projects where slug = 'plania'`)).rows[0].id;
  const mia = (await raw.query(`select id from projects where slug = 'mianovia'`)).rows[0].id;
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const title of ["Prompt: Product owner", "Prompt: Taller", "Prompt: Research", "Prompt: Artist", "Prompt: Asistente"]) {
    await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4::jsonb)`, [pla, title, `# ${title}\n\nTexto de prueba.`, actor]);
  }
  await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, 'Secreto', 'no', $2::jsonb)`, [pla, actor]);
  await raw.query(`insert into goals (project_id, title) values ($1, 'Que una novia arme su lista en cinco minutos.')`, [mia]);
  const t = (key: string, status: string, extra = "") =>
    raw.query(`insert into tasks (project_id, key, title, kind, status${extra ? ", blocked_note" : ""}) values ($1, $2, $3, 'ticket', $4${extra ? ", $5" : ""})`, [
      mia, key, `Ticket ${key}`, status, ...(extra ? [extra] : []),
    ]);
  await t("MIA-1", "In progress");
  await t("MIA-2", "Blocked", "espera la API de pagos");
  await t("MIA-3", "Ready");
  await raw.query(`insert into tasks (project_id, key, title, kind, status, stage) values ($1, 'MIA-IDEA1', 'Filtros por precio', 'idea', 'Open', 'design')`, [mia]);
  const po = (await raw.query(`select id from agents where slug = 'po-mianovia'`)).rows[0].id;
  await raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, task_key, started_at, ended_at, tokens_total, summary) values ($1, $2, 'product-owner', 'ok', 'MIA-IDEA1', now() - interval '1 hour', now() - interval '50 minutes', 42000, 'escribió 2 ideas')`,
    [po, mia],
  );
});

after(async () => {
  await raw?.end();
});

test("GET /api/company keeps its fields and adds viewer, prompts, roster and project_facts", async () => {
  const { status, body } = await get("/api/company");
  assert.equal(status, 200);
  for (const key of ["company", "settings", "week", "projects", "roles", "runs", "plan"]) assert.ok(key in body, key);
  assert.deepEqual(body.viewer, { can_edit_limits: true });
  const docs = (await raw.query(`select id, title from docs where title like 'Prompt: %'`)).rows;
  const byTitle = Object.fromEntries(docs.map((d) => [d.title, d.id]));
  assert.equal(body.prompts.taller.doc_id, byTitle["Prompt: Taller"]);
  assert.equal(body.prompts["product-owner"].doc_id, byTitle["Prompt: Product owner"]);
  assert.equal(body.prompts.asistente.doc_id, byTitle["Prompt: Asistente"]);
  const roles = new Set(body.roster.map((r: Json) => r.role));
  assert.deepEqual([...roles].sort(), ["artist", "asistente", "product-owner", "research", "taller"]);
  assert.equal(body.roster.find((r: Json) => r.slug === "po-mianovia").project, "mianovia");
  assert.equal(body.roster.some((r: Json) => ["cursor", "coach", "claude-code"].includes(r.slug)), false);
  const mia = body.project_facts.mianovia;
  assert.equal(mia.goal, "Que una novia arme su lista en cinco minutos.");
  assert.deepEqual([mia.in_flight, mia.blocked], [1, 1]);
  assert.equal(mia.po.slug, "po-mianovia");
  assert.equal(mia.last_run.tokens, 42000);
  assert.equal(body.project_facts.micasa.goal, null);
  assert.equal(JSON.stringify(body).includes("usd"), false);
});

test("the project sheet carries goal, pipeline, en curso, bloqueado, siguiente and runs with tokens", async () => {
  const { status, body } = await get("/api/company/projects/mianovia");
  assert.equal(status, 200);
  assert.equal(body.goal, "Que una novia arme su lista en cinco minutos.");
  assert.deepEqual(body.pipeline.map((s: Json) => s.stage), ["idea", "research", "design", "planning", "ready"]);
  assert.deepEqual(body.pipeline.find((s: Json) => s.stage === "design"), { stage: "design", count: 1, newest: "Filtros por precio" });
  assert.deepEqual(body.in_progress.map((t: Json) => t.key), ["MIA-1"]);
  assert.deepEqual(body.blocked.map((t: Json) => [t.key, t.why]), [["MIA-2", "espera la API de pagos"]]);
  assert.deepEqual(body.next.map((t: Json) => t.key), ["MIA-3"]);
  assert.equal(body.runs[0].tokens, 42000);
  assert.equal((await get("/api/company/projects/nadie")).status, 404);
});

test("the prompt doc route reads role prompts only, and every new read is cookie-only", async () => {
  const id = (await raw.query(`select id from docs where title = 'Prompt: Taller'`)).rows[0].id;
  const doc = await get(`/api/company/docs/${id}`);
  assert.equal(doc.status, 200);
  assert.equal(doc.body.title, "Prompt: Taller");
  assert.match(doc.body.markdown, /Texto de prueba/);
  const other = (await raw.query(`select id from docs where title = 'Secreto'`)).rows[0].id;
  assert.equal((await get(`/api/company/docs/${other}`)).status, 404);
  for (const path of ["/api/company", "/api/company/projects/mianovia", `/api/company/docs/${id}`]) {
    assert.equal((await get(path, {})).status, 401, path);
    assert.equal((await get(path, { ...cookie(), Authorization: `Bearer ${TEST_BEARER}` })).status, 403, path);
  }
});
