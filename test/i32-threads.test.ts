// PLA-I32-3: threads on the screen (cookie only) and for bots (thread_post / thread_read), the wakes a
// message from Jorge queues, and the closing line a runner's finish leaves. Throwaway DB; nothing spawns.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TEST_BEARER, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");

type Db = ReturnType<typeof makeDb>["db"];
let store: TestStore;
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
const runsOf = async (slug: string) => {
  const agent = await store.get("agents", { slug });
  if (!agent) return [];
  const projects = new Map((await store.find("projects")).map((p) => [p.id, p.slug]));
  return (await store.find("agentRuns", { agentId: agent.id }, { orderBy: [{ column: "queuedAt" }] }))
    .filter((r) => projects.has(r.projectId))
    .map((r) => ({ status: r.status, task_key: r.taskKey, role: r.role, project: projects.get(r.projectId) }));
};

before(async () => {
  store = await resetTestStore();
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
  await store?.end();
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
  assert.equal((await store.get("projects", { slug: "zigzag" }))!.runsPaused, true);
  const company = await threadOf(null);
  const res = await post(`/api/threads/${company.id}/messages`, { body: "Micasa: quiero el plan de lanzamiento" });
  assert.equal(res.status, 201);
  const out = (await res.json()) as { message: Message; created: unknown; wake: string };
  assert.equal(out.created, null);
  assert.equal(out.wake, "queued");
  assert.deepEqual(out.message.author, { agent: "jorge", role: "ceo" });
  assert.deepEqual(out.message.actions, []);
  assert.deepEqual(await runsOf("asistente"), [{ status: "queued", task_key: null, role: "asistente", project: "zigzag" }]);
  const ev = (await store.find("events", { type: "thread.message" })).map((r) => r.payload);
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.thread_kind, "company");
  assert.equal(ev[0]!.author, "jorge");
  assert.equal((await store.find("events", { type: "wake.queued" })).filter((e) => e.payload.agent === "asistente").length, 1);
  // "company" works as the thread id too, and a second message coalesces into the queued run.
  assert.equal((await post(`/api/threads/company/messages`, { body: "y también el brief" })).status, 201);
  assert.equal((await runsOf("asistente")).length, 1);
});

test("I32-3 #1: Jorge's message in a project thread makes a Ready ticket for its PO, origin jorge, and queues the PO's wake", async () => {
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { runsPaused: false }));
  const micasa = await threadOf("micasa");
  const res = await post(`/api/threads/${micasa.id}/messages`, { body: "Arma el borrador de precios\ncon tres planes" });
  assert.equal(res.status, 201);
  const out = (await res.json()) as { message: Message; created: { kind: string; key: string }; wake: string };
  assert.equal(out.created.kind, "ticket");
  assert.equal(out.wake, "queued");
  assert.deepEqual(out.message.links, [{ kind: "ticket", ref: out.created.key, title: "Arma el borrador de precios" }]);
  const row = await store.get("tasks", { key: out.created.key });
  const owner = row?.ownerAgent ? await store.get("agents", { id: row.ownerAgent }) : undefined;
  const t = row && owner && { status: row.status, origin: row.origin, owner: owner.slug };
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
  const taller = (await store.get("agents", { slug: "taller-micasa" }))!.id;
  const micasa = await store.projectId("micasa");
  const run = (await store.fix((uow) => uow.insert("agentRuns", { agentId: taller, projectId: micasa, role: "taller", status: "running", startedAt: new Date(Date.now() - 60_000) }))).id;
  const actor = { agent: "taller-micasa", session_id: `run-${run.slice(0, 8)}` };
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

  // A session that is not a runner run leaves no line.
  const before = view.messages.length;
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
  await store.fix(async (uow) => {
    for (let g = 1; g <= 205; g++) {
      await uow.insert("threadMessages", {
        threadId: thread.id,
        authorAgent: "taller-micasa",
        authorRole: "taller",
        body: `nota ${g}`,
        links: [{ kind: "ticket", ref: other.key, title: "Otro" }],
        at: new Date(uow.now.getTime() + g * 1000),
      });
    }
  });
  assert.ok((await decisionsRead(db, new Date())).some((d) => d.id === `m-${last.id}`), "still carded behind 205 newer messages");
});

test("PLA-53: restart --check names what a restart would kill, and passes with nothing in flight", async () => {
  const { spawnSync } = await import("node:child_process");
  const { inFlight } = await import("../src/ops/in-flight.js");
  const { createHash } = await import("node:crypto");
  // The script opens this file's lobes: the prefix test/helpers.ts gives them.
  const prefix = `t_${createHash("sha1").update(`${import.meta.dirname}|${process.argv[1] ?? ""}`).digest("hex").slice(0, 10)}`;
  const check = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/restart.ts", "--check"], { env: { ...process.env, PLANIA_JOBS: "0", PLANIA_DEVVA_PREFIX: prefix }, encoding: "utf8" });
  const settle = () =>
    store.fix(async (uow) => {
      await uow.update("agentRuns", { status: "running" }, { status: "ok", endedAt: uow.now });
      await uow.delete("qaLanes", { status: "checking" });
    });
  await settle();
  assert.deepEqual(await inFlight(db), []);
  const quiet = check();
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /Nada en curso/);

  const micasa = await store.projectId("micasa");
  const taller = (await store.get("agents", { slug: "taller-micasa" }))!.id;
  const actor = { agent: "Claude Code", session_id: "cc-manual-53b" };
  const a = (await writes.createTask(db, { project: "micasa", title: "Con run", scope: "s", checks: ["c"] } as never, { actor })) as { key: string };
  const b = (await writes.createTask(db, { project: "micasa", title: "Con QA", scope: "s", checks: ["c"] } as never, { actor })) as { key: string };
  const c = (await writes.createTask(db, { project: "micasa", title: "Con fotos", scope: "s", checks: ["c"] } as never, { actor })) as { key: string };
  const capture = { start_command: "x", port: 3000, ready_path: "/", pages: [] };
  await store.fix(async (uow) => {
    await uow.insert("agentRuns", { agentId: taller, projectId: micasa, role: "taller", status: "running", startedAt: uow.now, taskKey: a.key });
    const tb = (await uow.get("tasks", { projectId: micasa, key: b.key }))!;
    await uow.insert("qaLanes", { projectId: micasa, taskId: tb.id, taskKey: tb.key, status: "checking" });
    const p = (await uow.get("projects", { id: micasa }))!;
    await uow.update("projects", { id: micasa }, { settings: { ...p.settings, capture } as never });
    await uow.update(
      "tasks",
      { projectId: micasa, key: c.key },
      {
        status: "In review",
        muestra: { frase: "f", vistas: [{ key: "a", label: "A", path: "/" }], pasos: ["1", "2", "3"] } as never,
        probador: { state: "tomando", attempts: 0, error: null, commit: null, at: new Date().toISOString() } as never,
      },
    );
  });
  const found = await inFlight(db);
  assert.deepEqual(found.map((f) => f.kind).sort(), ["fotos", "qa", "run"]);
  const busy = check();
  assert.equal(busy.status, 1);
  for (const k of [a.key, b.key, c.key]) assert.ok(busy.stdout.includes(k), `${k} is named`);
  // A «tomando» with nobody behind it (older than a whole pass) does not hold a restart: the sweep takes it again.
  await store.fix(async (uow) => {
    const t = (await uow.get("tasks", { projectId: micasa, key: c.key }))!;
    await uow.update("tasks", { id: t.id }, { probador: { ...t.probador!, at: new Date(uow.now.getTime() - 10 * 60_000).toISOString() } });
  });
  assert.deepEqual((await inFlight(db)).map((f) => f.kind).sort(), ["qa", "run"]);
  await settle();
  await store.fix(async (uow) => {
    const { capture: _gone, ...settings } = (await uow.get("projects", { id: micasa }))!.settings;
    await uow.update("projects", { id: micasa }, { settings });
  });
});
