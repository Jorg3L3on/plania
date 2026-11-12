// PLA-I39-1: what the building needs from GET /api/company. Who asked each decision (asker), what waits for each
// teammate (queue), titles instead of keys (now.title, last.title), and Asistente's unread count. Throwaway DB,
// fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
const questions = await import("../src/mcp/questions.js");
const { propose } = await import("../src/mcp/proposals.js");
const { decisionsRead } = await import("../src/api/company-decisions.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const company = async (): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  assert.equal(res.status, 200);
  return (await res.json()) as Json;
};
const card = async (slug: string) => (await company()).projects.find((p: Json) => p.slug === slug) as Json;
const as = (agent: string) => ({ actor: { agent, session_id: `s-${agent}` } });
const id = async (table: string, slug: string) => (await raw.query(`select id from ${table} where slug = $1`, [slug])).rows[0].id as string;
const ticket = (project: string, title: string, patch: Json = {}) =>
  writes.createTask(db, { project, title, scope: "s", checks: ["c"], status: "Ready", ...patch } as never, as(`po-${project}`)) as Promise<{ key: string }>;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false`);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I39-1 #1: a proposal carries the PO as asker, a question the agent that asked it, a release null", async () => {
  await propose(
    db,
    { project: "filmia", kind: "choice", title: "Dos caminos para el tráiler", options: [{ label: "Corto", recommended: true }, { label: "Largo" }], recommended_reason: "sale antes" },
    as("po-filmia") as never,
  );
  const t = await ticket("filmia", "Elegir la música");
  await questions.ask(db, { project: "filmia", key: t.key, question: "¿Qué música?", options: ["A", "B"] } as never, as("research-filmia"));

  const rows = (await company()).decisions as Json[];
  const proposal = rows.find((d) => d.kind === "proposal" && d.project === "filmia")!;
  assert.deepEqual(proposal.asker, { agent: "po-filmia", role: "product-owner" });
  const question = rows.find((d) => d.kind === "question" && d.project === "filmia")!;
  assert.deepEqual(question.asker, { agent: "research-filmia", role: "research" });

  const inbox = new Map<string, Json[]>([
    [
      "zigzag",
      [
        {
          id: "release:zigzag",
          kind: "release",
          group: "pasos",
          project: "zigzag",
          waiting_since: "2026-11-09T10:00:00.000Z",
          target: { from: { branch: "sandbox" }, into: { branch: "main" }, env: "prod", ahead: 1, tickets: [{ key: "ZIG-9", title: "Uno", status: "Merged", pr_url: null }], open_checks: 0, before: [] },
        },
      ],
    ],
  ]);
  const release = (await decisionsRead(db, new Date(), inbox as never)).find((d) => d.kind === "release")!;
  assert.equal(release.asker, null);
});

test("I39-1 #2: Ready tickets queue by owner, else code to Taller and the rest to the PO; Jorge's in none; three each", async () => {
  for (const n of [1, 2, 3, 4]) await ticket("workia", `Pantalla ${n}`);
  await ticket("workia", "Entrevistar a tres tiendas", { work_type: "research" });
  await ticket("workia", "Bocetos del carrito", { owner_agent: "artist-workia" });
  await ticket("workia", "Firmar con el proveedor", { owner_agent: "ceo" });

  const team = (await card("workia")).team as Json[];
  const queue = (role: string) => team.find((m) => m.role === role)!.queue.map((q: Json) => q.title);
  assert.deepEqual(queue("taller"), ["Pantalla 1", "Pantalla 2", "Pantalla 3"]);
  assert.deepEqual(queue("product-owner"), ["Entrevistar a tres tiendas"]);
  assert.deepEqual(queue("artist"), ["Bocetos del carrito"]);
  assert.deepEqual(queue("research"), []);
  const all = team.flatMap((m) => m.queue.map((q: Json) => q.title));
  assert.equal(all.includes("Firmar con el proveedor"), false);
  for (const m of team) for (const q of m.queue) assert.match(q.key, /^WRK-/);
});

test("I39-1 #3: now and last carry the ticket's title, and null when the run has no ticket", async () => {
  const t = await ticket("micasa", "Ficha de la casa");
  const taller = await id("agents", "taller-micasa");
  const po = await id("agents", "po-micasa");
  const project = await id("projects", "micasa");
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, task_key, started_at) values ($1, $2, 'taller', 'running', $3, now() - interval '5 minutes')`, [taller, project, t.key]);
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, started_at, ended_at) values ($1, $2, 'product-owner', 'ok', 'listo', now() - interval '20 minutes', now() - interval '10 minutes')`, [po, project]);

  const team = (await card("micasa")).team as Json[];
  const builder = team.find((m) => m.role === "taller")!;
  assert.equal(builder.state, "running");
  assert.deepEqual([builder.now.ticket, builder.now.title], [t.key, "Ficha de la casa"]);
  const owner = team.find((m) => m.role === "product-owner")!;
  assert.deepEqual([owner.last.ticket, owner.last.title], [null, null]);
  for (const m of team) {
    if (m.now) assert.notEqual(m.now.title, m.now.ticket);
    if (m.last?.ticket) assert.notEqual(m.last.title, m.last.ticket);
  }
});

test("I39-1 #4: asistente.unread counts the company thread's unread messages", async () => {
  const before = (await company()).asistente;
  assert.equal(before.unread, 0);
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links) values ($1, 'asistente', 'asistente', 'Uno', '[]'), ($1, 'asistente', 'asistente', 'Dos', '[]'), ($1, 'jorge', 'jorge', 'Mío', '[]')`, [before.thread_id]);
  assert.equal((await company()).asistente.unread, 2);
  await raw.query(`update threads set read_at = now() + interval '1 second' where id = $1`, [before.thread_id]);
  assert.equal((await company()).asistente.unread, 0);
});
