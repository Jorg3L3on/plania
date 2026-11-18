// PLA-I32-3: threads on the screen (cookie only) and for bots (thread_post / thread_read), the wakes a
// message from Jorge queues, and the closing line a runner's finish leaves. Throwaway DB; nothing spawns.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const { runSession } = await import("../src/runner/run-session.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
let client: Client;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const get = (path: string, headers: Record<string, string> = jorge()) => app.request(path, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = jorge()) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data;
}

type Thread = { id: string; kind: string; project: string | null; title: string; unread: number; last: { at: string; author_role: string; body: string } | null };
type Message = { id: string; at: string; author: { agent: string; role: string }; body: string; links: { kind: string; ref: string; title: string }[]; actions: string[]; action_state: unknown; question_id: string | null };

const threads = async () => ((await (await get("/api/threads")).json()) as { threads: Thread[] }).threads;
const threadOf = async (project: string | null) => (await threads()).find((t) => t.project === project)!;
const runsOf = async (slug: string) =>
  (await raw.query(`select r.status, r.task_key, r.role, p.slug as project from agent_runs r join agents a on a.id = r.agent_id join projects p on p.id = r.project_id where a.slug = $1 order by r.queued_at`, [slug])).rows;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "i32-threads", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("I32-3 #4: the thread routes are Jorge's screen only: Bearer 403 (even with the cookie), no cookie 401", async () => {
  const bearer = { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" };
  assert.equal((await get("/api/threads", bearer)).status, 403);
  assert.equal((await get("/api/threads", { ...jorge(), Authorization: `Bearer ${TEST_BEARER}` })).status, 403);
  assert.equal((await get("/api/threads", {})).status, 401);
  assert.equal((await get("/api/threads/company", bearer)).status, 403);
  assert.equal((await get("/api/threads/company", {})).status, 401);
  assert.equal((await post("/api/threads/company/messages", { body: "hola" }, bearer)).status, 403);
  assert.equal((await post("/api/threads/company/messages", { body: "hola" }, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await post("/api/threads/company/messages", { body: "" })).status, 400);
  assert.equal((await get("/api/threads/no-such-project")).status, 404);
});

test("I32-3: the list has the company thread and one per project, nothing unread yet", async () => {
  const list = await threads();
  assert.deepEqual(list.map((t) => [t.kind, t.project, t.unread, t.last]), [
    ["company", null, 0, null],
    ["project", "filmia", 0, null],
    ["project", "micasa", 0, null],
    ["project", "workia", 0, null],
    ["project", "zigzag", 0, null],
  ]);
});

test("I32-3 #1: Jorge's message in the company thread queues Asistente's wake, even with its home project paused", async () => {
  assert.equal((await raw.query(`select runs_paused from projects where slug = 'zigzag'`)).rows[0].runs_paused, true);
  const company = await threadOf(null);
  const res = await post(`/api/threads/${company.id}/messages`, { body: "Micasa: quiero el plan de lanzamiento" });
  assert.equal(res.status, 201);
  const out = (await res.json()) as { message: Message; created: unknown; wake: string };
  assert.equal(out.created, null);
  assert.equal(out.wake, "queued");
  assert.deepEqual(out.message.author, { agent: "jorge", role: "ceo" });
  assert.deepEqual(out.message.actions, []);
  assert.deepEqual(await runsOf("asistente"), [{ status: "queued", task_key: null, role: "asistente", project: "zigzag" }]);
  const ev = (await raw.query(`select payload from events where type = 'thread.message'`)).rows.map((r) => r.payload);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].thread_kind, "company");
  assert.equal(ev[0].author, "jorge");
  assert.equal((await raw.query(`select count(*)::int as n from events where type = 'wake.queued' and payload->>'agent' = 'asistente'`)).rows[0].n, 1);
  // "company" works as the thread id too, and a second message coalesces into the queued run.
  assert.equal((await post(`/api/threads/company/messages`, { body: "y también el brief" })).status, 201);
  assert.equal((await runsOf("asistente")).length, 1);
});

test("I32-3 #1: Jorge's message in a project thread makes a Ready ticket for its PO, origin jorge, and queues the PO's wake", async () => {
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const micasa = await threadOf("micasa");
  const res = await post(`/api/threads/${micasa.id}/messages`, { body: "Arma el borrador de precios\ncon tres planes" });
  assert.equal(res.status, 201);
  const out = (await res.json()) as { message: Message; created: { kind: string; key: string }; wake: string };
  assert.equal(out.created.kind, "ticket");
  assert.equal(out.wake, "queued");
  assert.deepEqual(out.message.links, [{ kind: "ticket", ref: out.created.key, title: "Arma el borrador de precios" }]);
  const t = (await raw.query(`select t.status, t.origin, a.slug as owner from tasks t join agents a on a.id = t.owner_agent where t.key = $1`, [out.created.key])).rows[0];
  assert.deepEqual(t, { status: "Ready", origin: "jorge", owner: "po-micasa" });
  assert.deepEqual(await runsOf("po-micasa"), [{ status: "queued", task_key: out.created.key, role: "product-owner", project: "micasa" }]);

  // A paused project still gets the ticket; nothing is queued and the reply says why.
  const workia = await threadOf("workia");
  const paused = (await (await post(`/api/threads/${workia.id}/messages`, { body: "Revisa el onboarding" })).json()) as { created: { key: string }; wake: string };
  assert.ok(paused.created.key);
  assert.equal(paused.wake, "paused");
  assert.deepEqual(await runsOf("po-workia"), []);
});

test("I32-3 #2: thread_post and thread_read: a PO only in its own project's thread, Asistente in every thread", async () => {
  const po = { agent: "po-micasa", session_id: "s-po" };
  const own = await call("thread_post", { actor: po, thread: "micasa", body: "Tomo el borrador de precios.", links: [{ kind: "ticket", ref: "MIC-1", title: "x" }] });
  assert.equal(own.__error, undefined, JSON.stringify(own));
  assert.deepEqual(own.message.author, { agent: "po-micasa", role: "product-owner" });
  for (const thread of ["workia", "company"]) {
    const other = await call("thread_post", { actor: po, thread, body: "hola" });
    assert.equal(other.__error, "THREAD_FORBIDDEN", thread);
    assert.equal(other.__status, 403);
    assert.equal((await call("thread_read", { actor: po, thread })).__error, "THREAD_FORBIDDEN");
  }
  const research = await call("thread_post", { actor: { agent: "research-micasa", session_id: "s-r" }, thread: "micasa", body: "Investigación lista." });
  assert.deepEqual(research.message.author, { agent: "research-micasa", role: "research" });
  assert.equal((await call("thread_post", { actor: { agent: "research-workia", session_id: "s-r" }, thread: "micasa", body: "x" })).__error, "THREAD_FORBIDDEN");
  assert.equal((await call("thread_post", { actor: { agent: "nobody-here", session_id: "s-x" }, thread: "micasa", body: "x" })).__error, "THREAD_FORBIDDEN");
  assert.equal((await call("thread_post", { actor: po, thread: "no-such", body: "x" })).__error, "THREAD_NOT_FOUND");

  const asis = { agent: "asistente", session_id: "s-a" };
  for (const thread of ["company", "micasa", "workia", "filmia"]) {
    const out = await call("thread_post", { actor: asis, thread, body: `Nota para ${thread}` });
    assert.equal(out.__error, undefined, thread);
  }
  const read = await call("thread_read", { actor: asis, thread: "micasa" });
  assert.equal(read.project, "micasa");
  assert.ok(read.messages.some((m: Message) => m.author.agent === "po-micasa"));
  const mine = await call("thread_read", { actor: po, thread: "micasa", after: read.messages.at(-2).id });
  assert.equal(mine.messages.length, 1);

  // Unread counts what Jorge has not seen; opening the thread marks it read.
  const before = await threadOf("micasa");
  assert.equal(before.unread, 3);
  assert.equal(before.last!.author_role, "asistente");
  const view = (await (await get(`/api/threads/${before.id}`)).json()) as { id: string; kind: string; project: string; messages: Message[] };
  assert.deepEqual(Object.keys(view).sort(), ["id", "kind", "messages", "project"]);
  assert.deepEqual(Object.keys(view.messages[0]!).sort(), ["action_state", "actions", "at", "author", "body", "id", "links", "question_id"]);
  assert.equal((await threadOf("micasa")).unread, 0);
});

test("I32-3 #3: a runner's finish leaves a line with links in its project thread; its add_result before did too, once", async () => {
  const taller = (await raw.query(`select id from agents where slug = 'taller-micasa'`)).rows[0].id;
  const micasa = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  const run = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, started_at) values ($1, $2, 'taller', 'running', now() - interval '1 minute') returning id`, [taller, micasa])).rows[0].id as string;
  // The session a run writes as today (16 hex, PLA-I60-1); the 8-hex form is covered in i32-thread-actions.
  const actor = { agent: "taller-micasa", session_id: runSession(run) };
  const created = (await writes.createTask(db, { project: "micasa", title: "Página de precios", scope: "s", checks: ["La página muestra tres planes"], status: "Ready" } as never, { actor })) as { key: string };
  await writes.claim(db, { project: "micasa", key: created.key } as never, { actor });

  const first = await call("add_result", { actor, project: "micasa", key: created.key, kind: "test", verdict: "pass", cite: "pnpm test: 12 pass", check_ns: [1] });
  assert.equal(first.__error, undefined, JSON.stringify(first));
  await call("add_result", { actor, project: "micasa", key: created.key, kind: "test", verdict: "pass", cite: "pnpm test: 12 pass otra vez" });
  const done = await call("finish", {
    actor,
    project: "micasa",
    key: created.key,
    pr_url: "https://github.com/example/micasa/pull/7",
    result: { kind: "test", verdict: "pass", cite: "pnpm test: 12 pass, pnpm build ok" },
  });
  assert.equal(done.__error, undefined, JSON.stringify(done));

  const thread = await threadOf("micasa");
  const view = (await (await get(`/api/threads/${thread.id}`)).json()) as { messages: Message[] };
  const lines = view.messages.filter((m) => m.author.agent === "taller-micasa");
  assert.equal(lines.length, 2, "one line from add_result, one from finish");
  const last = lines.at(-1)!;
  assert.deepEqual(last.author, { agent: "taller-micasa", role: "taller" });
  assert.match(last.body, new RegExp(`${created.key} queda En revisión`));
  assert.match(last.body, /pnpm build ok/);
  // PLA-43: the line names the button it will get.
  assert.match(last.body, /Necesito: que lo revises \(Aprobar y pasar a prueba o Pedir cambios\)\./);
  assert.deepEqual(last.links.map((l) => [l.kind, l.ref]), [["ticket", created.key], ["pr", "https://github.com/example/micasa/pull/7"]]);
  assert.deepEqual(last.actions, ["fusionar", "cambios"], "a code ticket In review with a PR can be merged or sent back");

  // PLA-I32-4: the same run's question lands in the thread too, with the question attached.
  const other = (await writes.createTask(db, { project: "micasa", title: "Nombre del plan caro", scope: "s", checks: ["c"], work_type: "ops" } as never, { actor })) as { key: string };
  const asked = await call("ask", { actor, project: "micasa", key: other.key, question: "¿Premium o Pro?" });
  assert.ok(asked.question_id, JSON.stringify(asked));
  const afterAsk = ((await (await get(`/api/threads/${thread.id}`)).json()) as { messages: Message[] }).messages;
  assert.equal(afterAsk.filter((m) => m.question_id === asked.question_id).length, 1, "a 16-hex run session's question is posted");

  // A session that is not a runner run leaves no line.
  const before = afterAsk.length;
  await call("add_result", { actor: { agent: "taller-micasa", session_id: "manual" }, project: "micasa", key: created.key, kind: "test", verdict: "pass", cite: "manual" });
  assert.equal(((await (await get(`/api/threads/${thread.id}`)).json()) as { messages: Message[] }).messages.length, before);
});

// PLA-53: deliveries nobody could see.
test("PLA-53: a finish from a session that is not a runner leaves the delivery line, and the ticket gets its card", async () => {
  const { decisionsRead } = await import("../src/api/company-decisions.js");
  const actor = { agent: "Claude Code", session_id: "cc-manual-53" };
  const created = (await writes.createTask(db, { project: "micasa", title: "Arreglo a mano", scope: "s", checks: ["Queda arreglado"], status: "Ready" } as never, { actor })) as { key: string };
  await writes.claim(db, { project: "micasa", key: created.key } as never, { actor });
  const thread = await threadOf("micasa");
  const count = async () => ((await (await get(`/api/threads/${thread.id}`)).json()) as { messages: Message[] }).messages;
  const before = (await count()).length;
  await call("add_result", { actor, project: "micasa", key: created.key, kind: "test", verdict: "pass", cite: "pnpm test: 3 pass", check_ns: [1] });
  assert.equal((await count()).length, before, "its add_result stays silent");
  const done = await call("finish", { actor, project: "micasa", key: created.key, pr_url: "https://github.com/example/micasa/pull/53", result: { kind: "test", verdict: "pass", cite: "pnpm test: 3 pass" } });
  assert.equal(done.__error, undefined, JSON.stringify(done));
  const last = (await count()).at(-1)!;
  assert.match(last.body, new RegExp(`${created.key} queda En revisión`));
  assert.deepEqual(last.author, { agent: "claude-code", role: "sesion" });
  assert.deepEqual(last.actions, ["fusionar", "cambios"]);
  const card = (await decisionsRead(db, new Date())).find((d) => d.id === `m-${last.id}`);
  assert.ok(card, "the delivery has its card");

  // 205 newer lines about other tickets: the open delivery is still read (it used to fall out of the newest 200).
  const other = (await writes.createTask(db, { project: "micasa", title: "Otro", scope: "s", checks: ["c"] } as never, { actor })) as { key: string };
  await raw.query(
    `insert into thread_messages (thread_id, author_agent, author_role, body, links, at)
     select $1, 'taller-micasa', 'taller', 'nota ' || g, $2::jsonb, now() + (g || ' seconds')::interval from generate_series(1, 205) g`,
    [thread.id, JSON.stringify([{ kind: "ticket", ref: other.key, title: "Otro" }])],
  );
  assert.ok((await decisionsRead(db, new Date())).some((d) => d.id === `m-${last.id}`), "still carded behind 205 newer messages");
});

test("PLA-53: restart --check names what a restart would kill, and passes with nothing in flight", async () => {
  const { spawnSync } = await import("node:child_process");
  const { inFlight } = await import("../src/ops/in-flight.js");
  const check = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/restart.ts", "--check"], { env: { ...process.env, PLANIA_JOBS: "0" }, encoding: "utf8" });
  await raw.query(`update agent_runs set status = 'ok', ended_at = now() where status = 'running'`);
  await raw.query(`delete from qa_lanes where status = 'checking'`);
  assert.deepEqual(await inFlight(db), []);
  const quiet = check();
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /Nada en curso/);

  const micasa = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  const taller = (await raw.query(`select id from agents where slug = 'taller-micasa'`)).rows[0].id;
  const actor = { agent: "Claude Code", session_id: "cc-manual-53b" };
  const a = (await writes.createTask(db, { project: "micasa", title: "Con run", scope: "s", checks: ["c"] } as never, { actor })) as { key: string };
  const b = (await writes.createTask(db, { project: "micasa", title: "Con QA", scope: "s", checks: ["c"] } as never, { actor })) as { key: string };
  const c = (await writes.createTask(db, { project: "micasa", title: "Con fotos", scope: "s", checks: ["c"] } as never, { actor })) as { key: string };
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, started_at, task_key) values ($1, $2, 'taller', 'running', now(), $3)`, [taller, micasa, a.key]);
  await raw.query(`insert into qa_lanes (project_id, task_id, task_key, status) select $1, id, key, 'checking' from tasks where key = $2`, [micasa, b.key]);
  await raw.query(`update projects set settings = settings || '{"capture":{"start_command":"x","port":3000,"ready_path":"/","pages":[]}}'::jsonb where id = $1`, [micasa]);
  await raw.query(`update tasks set status = 'In review', muestra = '{"frase":"f","vistas":[{"key":"a","label":"A","path":"/"}],"pasos":["1","2","3"]}'::jsonb, probador = $1::jsonb where key = $2`, [
    JSON.stringify({ state: "tomando", attempts: 0, error: null, commit: null, at: new Date().toISOString() }),
    c.key,
  ]);
  const found = await inFlight(db);
  assert.deepEqual(found.map((f) => f.kind).sort(), ["fotos", "qa", "run"]);
  const busy = check();
  assert.equal(busy.status, 1);
  for (const k of [a.key, b.key, c.key]) assert.ok(busy.stdout.includes(k), `${k} is named`);
  // PLA-102: a pass 10 minutes in still holds a restart (MIA-I10-3's ran past 6 and was cut).
  await raw.query(`update tasks set probador = jsonb_set(probador, '{at}', to_jsonb((now() - interval '10 minutes')::text)) where key = $1`, [c.key]);
  assert.ok((await inFlight(db)).some((f) => f.kind === "fotos"), "a long pass is still in flight");
  // A «tomando» with nobody behind it (older than PASS_MS) does not hold a restart: the sweep takes it again.
  await raw.query(`update tasks set probador = jsonb_set(probador, '{at}', to_jsonb((now() - interval '25 minutes')::text)) where key = $1`, [c.key]);
  assert.deepEqual((await inFlight(db)).map((f) => f.kind).sort(), ["qa", "run"]);
  await raw.query(`update agent_runs set status = 'ok', ended_at = now() where status = 'running'`);
  await raw.query(`delete from qa_lanes where status = 'checking'`);
  await raw.query(`update projects set settings = settings - 'capture' where id = $1`, [micasa]);
});
