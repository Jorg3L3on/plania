// PLA-I35-1: the card as a report and Te toca. GET /api/company gains plan, this_week, next and work per project
// and decisions[]; POST /api/company/decisions/:id acts on one row. Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const questions = await import("../src/mcp/questions.js");
const { parseProposal } = await import("../src/api/company-decisions.js");
const { calendarOf } = await import("../src/api/company-plan.js");

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
const act = (id: string, body: unknown, headers: Record<string, string> = jorge()) =>
  app.request(`/api/company/decisions/${encodeURIComponent(id)}`, { method: "POST", headers, body: JSON.stringify(body) });
const keys = (o: Json) => Object.keys(o).sort();
const pid = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
const PO = { actor: { agent: "po-mianovia", session_id: "s-po" } };

const PROPOSAL = [
  "Leí el proyecto: Arranque 3/5, el borrador aceptado, lo siguiente es el kickoff.",
  "Propongo tres pasos para no esperar el kickoff:",
  "1. Planear el formulario con las respuestas por defecto del borrador, provisional (recomendado)",
  "2. Wireframes del formulario (375 y 768 px) para llevarlos al kickoff",
  "3. Research sin costo: anti-spam del formulario y acceso al panel",
  "1 y 2 pueden ir en paralelo.",
].join("\n");

before(async () => {
  raw = await resetTestDb();
  await raw.query(`insert into projects (slug, title, key_prefix) values ('mianovia', 'Mianovia', 'MIA')`);
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug in ('mianovia', 'micasa')`);
  // Mianovia: five initiatives, one a week; the first Active with five tickets, three done; the kickoff is Jorge's.
  const titles = ["Arranque y configuración", "Formulario de bienvenida", "Panel administrativo", "Contacto, exportación y avisos", "Ajustes finales y entrega"];
  for (const [i, title] of titles.entries()) {
    await writes.createTask(db, { project: "mianovia", kind: "initiative", key: `MIA-I${i + 1}`, title, scope: "s" } as never, PO);
  }
  await raw.query(`update tasks set status = 'Active' where key = 'MIA-I1'`);
  await writes.createTask(db, { project: "mianovia", key: "MIA-I1-1", parent_key: "MIA-I1", phase: 1, title: "Kickoff con la boutique", summary: "Llevar el borrador Campos y flujos", status: "Ready", owner_agent: "ceo", scope: "s", checks: ["c"] } as never, PO);
  for (const n of [2, 3, 4]) await writes.createTask(db, { project: "mianovia", key: `MIA-I1-${n}`, parent_key: "MIA-I1", phase: 1, title: `Base ${n}`, scope: "s", checks: ["c"] } as never, PO);
  await writes.createTask(db, { project: "mianovia", key: "MIA-I1-5", parent_key: "MIA-I1", phase: 2, title: "Hosting", status: "Ready", scope: "s", checks: ["c"] } as never, PO);
  await raw.query(`update tasks set status = 'Done' where key in ('MIA-I1-2', 'MIA-I1-3', 'MIA-I1-4')`);
  const actor = JSON.stringify({ agent: "po-mianovia", session_id: "s-po" });
  await raw.query(
    `insert into events (project_id, task_id, task_key, type, actor, payload) select project_id, id, key, 'task.status', $1::jsonb, '{"from":"In progress","to":"Done"}'::jsonb from tasks where key in ('MIA-I1-2', 'MIA-I1-3', 'MIA-I1-4')`,
    [actor],
  );
  await raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload) select project_id, id, key, 'doc.put', $1::jsonb, '{"doc_id":"d1"}'::jsonb from tasks where key = 'MIA-I1-2'`, [actor]);
  // The PO's proposal, the last message in the Mianovia thread.
  const thread = (await (await app.request("/api/threads/mianovia", { headers: jorge() })).json()) as { id: string };
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, at) values ($1, 'po-mianovia', 'product-owner', $2, now() - interval '52 minutes')`, [thread.id, PROPOSAL]);
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

test("I35-1 #1: parseProposal reads numbered options, the recommended one and the note", () => {
  const p = parseProposal(PROPOSAL)!;
  assert.equal(p.title, "Propongo tres pasos para no esperar el kickoff");
  assert.deepEqual(
    p.options.map((o) => [o.n, o.recommended]),
    [
      [1, true],
      [2, false],
      [3, false],
    ],
  );
  assert.equal(p.options[0]!.label, "Planear el formulario con las respuestas por defecto del borrador, provisional");
  assert.equal(p.note, "1 y 2 pueden ir en paralelo.");
  const second = parseProposal("Dos caminos:\n1. Uno\n2. Dos\nRecomiendo el segundo.")!;
  assert.deepEqual(second.options.map((o) => o.recommended), [false, true]);
  assert.equal(parseProposal("Recomiendo la 2"), null, "no list, no proposal");
  assert.equal(parseProposal("Solo una:\n1. Uno"), null, "one option is not a choice");
});

test("I35-1 #1: GET /api/company has plan, this_week, next and work per project and decisions[]", async () => {
  const c = await company();
  assert.deepEqual(keys(c), ["asistente", "company", "decisions", "inbox", "plumbing", "projects", "week"]);
  for (const p of c.projects) {
    assert.deepEqual(keys(p), ["budget", "goal", "light", "light_reason", "next", "orders", "paused", "plan", "plan_approval", "preview_url", "ready", "rumbo", "slug", "team", "this_week", "thread", "title", "work"], p.slug);
    assert.deepEqual(keys(p.this_week), ["docs", "done", "last_at", "prs"]);
    assert.deepEqual(keys(p.work), ["in_progress", "open"]);
  }
  const mia = c.projects.find((p: Json) => p.slug === "mianovia");
  // PLA-I36-5: no delivery date, no week bar: the active initiative and its tickets only.
  assert.deepEqual(mia.plan, {
    initiative: { key: "MIA-I1", title: "Arranque y configuración" },
    done: 3,
    total: 5,
    start_on: null,
    due_on: null,
    weeks: null,
    today_pct: null,
    done_pct: null,
    pace: null,
    weeks_behind: null,
    forecast_on: null,
  });
  assert.deepEqual([mia.this_week.done, mia.this_week.docs, mia.this_week.prs], [3, 1, 0]);
  assert.deepEqual(mia.next, { title: "Kickoff con la boutique", key: "MIA-I1-1", owner: "jorge", due: null });
  assert.deepEqual(mia.work, { open: 2, in_progress: 0 });
  assert.equal(c.projects.find((p: Json) => p.slug === "filmia").plan, null, "no Active initiative, no plan");

  for (const d of c.decisions) assert.deepEqual(keys(d), ["actions", "at", "body", "checks", "combinable", "detail", "evidence", "files", "hold", "id", "kind", "links", "options", "plan", "preview_url", "project", "recommended_reason", "ref", "release", "state", "title"]);
  const proposal = c.decisions.find((d: Json) => d.kind === "proposal");
  assert.equal(proposal.project, "mianovia");
  assert.equal(proposal.options.length, 3);
  assert.equal(proposal.options[0].recommended, true);
  assert.deepEqual(proposal.actions, ["elegir", "responder"]);
  assert.equal(proposal.state, null);
  const kickoff = c.decisions.find((d: Json) => d.kind === "action");
  assert.deepEqual([kickoff.title, kickoff.ref, kickoff.actions, kickoff.detail], ["Kickoff con la boutique", "MIA-I1-1", ["hecho", "aplazar"], "Llevar el borrador Campos y flujos"]);
  assert.equal(c.decisions[0].kind, "proposal", "a proposal before Jorge's own tickets");
});

test("I35-1 #3 (PLA-I36-5): pace is null without a delivery date, late or bad by the calendar", async () => {
  const today = new Date("2026-11-09T12:00:00Z");
  assert.deepEqual(calendarOf({ startOn: "2026-11-02", dueOn: "2026-12-07", today, done: 1, total: 5 }).pace, "ok");
  assert.deepEqual(calendarOf({ startOn: "2026-10-12", dueOn: "2026-11-30", today, done: 0, total: 5 }).pace, "bad");

  await raw.query(`update tasks set due_on = current_date + 34 where key = 'MIA-I5'`);
  let mia = (await company()).projects.find((p: Json) => p.slug === "mianovia");
  assert.deepEqual([mia.plan.pace, mia.plan.weeks_behind], ["ok", 0], "the delivery five weeks out, the plan just started");
  await raw.query(`update tasks set created_at = now() - interval '60 days' where key like 'MIA-I_' and kind = 'initiative'`);
  await raw.query(`update tasks set due_on = current_date + 1 where key = 'MIA-I5'`);
  mia = (await company()).projects.find((p: Json) => p.slug === "mianovia");
  assert.equal(mia.plan.pace, "bad", "almost all the time gone, a fraction of the work done");
  await raw.query(`update tasks set due_on = null where key in ('MIA-I1', 'MIA-I5')`);
});

test("I35-1 #2: Elegir posts 'Elijo n' in the project thread, makes the PO's Ready ticket and queues its wake; twice is 409", async () => {
  const id = (await company()).decisions.find((d: Json) => d.kind === "proposal").id as string;
  assert.equal((await act(id, { action: "elegir", option: 1 }, { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" })).status, 403);
  assert.equal((await act(id, { action: "elegir", option: 9 })).status, 400);
  const res = await act(id, { action: "elegir", option: 1 });
  assert.equal(res.status, 200);
  const out = (await res.json()) as Json;
  assert.equal(out.state.action, "elegir");
  assert.equal(out.state.result.option, 1);
  assert.equal(out.wake, "queued");
  assert.equal(out.created.kind, "ticket");
  const msgs = (await (await app.request("/api/threads/mianovia", { headers: jorge() })).json()) as { messages: Json[] };
  const mine = msgs.messages.at(-1)!;
  assert.equal(mine.author.agent, "jorge");
  assert.equal(mine.body, "Elijo 1: Planear el formulario con las respuestas por defecto del borrador, provisional");
  const ticket = (await raw.query(`select t.status, t.origin, a.slug from tasks t join agents a on a.id = t.owner_agent where t.key = $1`, [out.created.key])).rows[0];
  assert.deepEqual(ticket, { status: "Ready", origin: "jorge", slug: "po-mianovia" });
  assert.equal((await raw.query(`select count(*)::int as n from events where type = 'wake.queued' and payload->>'agent' = 'po-mianovia'`)).rows[0].n >= 1, true);

  const again = await act(id, { action: "elegir", option: 2 });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as Json).error, "ALREADY_ACTED");
  const row = (await company()).decisions.find((d: Json) => d.id === id);
  assert.deepEqual([row.state.action, row.actions], ["elegir", []], "the row stays, acted, with its result");
});

test("I35-1 #2: Hecho closes the ceo-owned ticket; a question is answered by its option", async () => {
  const c = await company();
  const kickoff = c.decisions.find((d: Json) => d.kind === "action");
  assert.equal((await act(kickoff.id, { action: "elegir", option: 1 })).status, 400);
  const done = await act(kickoff.id, { action: "hecho" });
  assert.equal(done.status, 200, JSON.stringify(await done.clone().json()));
  assert.equal((await raw.query(`select status from tasks where key = 'MIA-I1-1'`)).rows[0].status, "Done");
  const twice = await act(kickoff.id, { action: "hecho" });
  assert.equal(twice.status, 409, JSON.stringify(await twice.clone().json()) + kickoff.id);
  const after1 = (await company()).decisions.find((d: Json) => d.id === kickoff.id);
  assert.equal(after1.state.action, "hecho");

  await questions.ask(db, { project: "mianovia", key: "MIA-I1-5", question: "¿Dónde vive el formulario?", options: ["Sigue local", "Ya decidiremos"], human_only: true } as never, PO);
  const q = (await company()).decisions.find((d: Json) => d.kind === "question");
  assert.deepEqual(q.options.map((o: Json) => o.label), ["Sigue local", "Ya decidiremos"]);
  assert.equal((await act(q.id, { action: "elegir", option: 1 })).status, 200);
  assert.equal((await raw.query(`select answer from questions where id = $1`, [q.id.slice(2)])).rows[0].answer, "Sigue local");
  assert.equal((await act(q.id, { action: "responder", text: "otra" })).status, 409);
  assert.equal((await act("m-00000000-0000-4000-8000-000000000000", { action: "elegir", option: 1 })).status, 404);
});
