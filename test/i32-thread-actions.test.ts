// PLA-I32-4: Aceptar (Done, or merge a PR into sandbox), Pedir cambios and Responder on a thread message,
// from the screen only. Throwaway DB; gh is faked through releaseGh.run, so no real gh ever runs.
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
const { releaseGh } = await import("../src/mcp/release-ship.js");
const writes = await import("../src/mcp/writes.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;
let client: Client;
let thread: string;
const realGh = releaseGh.run;

const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const act = (body: unknown, headers: Record<string, string> = jorge()) => app.request(`/api/threads/${thread}/actions`, { method: "POST", headers, body: JSON.stringify(body) });
type Message = { id: string; links: { kind: string; ref: string }[]; actions: string[]; action_state: { action: string; result: Record<string, unknown> } | null; question_id: string | null };
const messages = async () => ((await (await app.request(`/api/threads/${thread}`, { headers: jorge() })).json()) as { messages: Message[] }).messages;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, ...data };
  return data;
}

const PO = { agent: "po-micasa", session_id: "s-po" };

// A ticket of micasa put In review directly (the review path itself is tested elsewhere), and a PO message on it.
async function reviewTicket(title: string, workType: string, opts: { pr?: string; owner?: string } = {}): Promise<{ key: string; message: string }> {
  const t = (await writes.createTask(db, { project: "micasa", title, scope: "s", checks: ["c"], work_type: workType, ...(opts.owner ? { owner_agent: opts.owner } : {}) } as never, { actor: PO })) as { key: string };
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [t.key, opts.pr ?? null]);
  await raw.query(`update checks set done = true, done_at = now() where task_id = (select id from tasks where key = $1)`, [t.key]);
  const links = [{ kind: "ticket", ref: t.key, title }, ...(opts.pr ? [{ kind: "pr", ref: opts.pr, title: "PR" }] : [])];
  const out = await call("thread_post", { actor: PO, thread: "micasa", body: `${t.key} listo para revisar`, links });
  return { key: t.key, message: out.message.id };
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug = 'micasa'`);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "i32-actions", version: "0" });
  await client.connect(clientSide);
  thread = ((await (await app.request("/api/threads/micasa", { headers: jorge() })).json()) as { id: string }).id;
});

after(async () => {
  releaseGh.run = realGh;
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("I32-4 #3: the action route is Jorge's screen only: Bearer 403 (even with the cookie), no cookie 401, bad body 400", async () => {
  const body = { message_id: "00000000-0000-4000-8000-000000000000", action: "aceptar" };
  assert.equal((await act(body, { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" })).status, 403);
  assert.equal((await act(body, { ...jorge(), Authorization: `Bearer ${TEST_BEARER}` })).status, 403);
  assert.equal((await act(body, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await act({ ...body, action: "borrar" })).status, 400);
  const missing = await act(body);
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: string }).error, "MESSAGE_NOT_FOUND");
});

test("I32-4: aceptar with an open check is refused with the reason and changes nothing", async () => {
  const { key, message } = await reviewTicket("Doc con check abierto", "ops");
  await raw.query(`update checks set done = false, done_at = null where task_id = (select id from tasks where key = $1)`, [key]);
  const res = await act({ message_id: message, action: "aceptar" });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, "CHECKS_OPEN");
  assert.equal((await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status, "In review");
  assert.equal((await messages()).find((m) => m.id === message)!.action_state, null);
});

test("I32-4 #1: aceptar on a doc's ticket moves it to Done; the message keeps the action and loses its buttons", async () => {
  const { key, message } = await reviewTicket("Doc de precios", "ops");
  assert.deepEqual((await messages()).find((m) => m.id === message)!.actions, ["aceptar", "cambios"]);
  const res = await act({ message_id: message, action: "aceptar" });
  assert.equal(res.status, 200, await res.clone().text());
  const out = (await res.json()) as { ok: boolean; action_state: { action: string; result: Record<string, unknown> } };
  assert.equal(out.ok, true);
  assert.deepEqual([out.action_state.action, out.action_state.result], ["aceptar", { ticket: key, status: "Done" }]);
  assert.equal((await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status, "Done");
  const m = (await messages()).find((x) => x.id === message)!;
  assert.deepEqual(m.actions, []);
  assert.equal(m.action_state!.action, "aceptar");
  const again = await act({ message_id: message, action: "aceptar" });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { error: string }).error, "ALREADY_ACTED");
});

test("I32-4 #1: aceptar on a PR merges it into sandbox with gh pr merge --merge and stores the sha; a PR into main is refused", async () => {
  const calls: string[][] = [];
  const views: Record<string, string> = { "9": "sandbox", "10": "main" };
  releaseGh.run = async (args) => {
    calls.push(args);
    const n = args[2]!;
    if (args[1] === "view" && args.includes("baseRefName,state,headRefOid,url")) {
      return { ok: true, stdout: JSON.stringify({ baseRefName: views[n], state: "OPEN", headRefOid: "f".repeat(40), url: `https://github.com/example/micasa/pull/${n}` }), stderr: "" };
    }
    if (args[1] === "merge") return { ok: true, stdout: "", stderr: "" };
    if (args[1] === "view") return { ok: true, stdout: JSON.stringify({ mergeCommit: { oid: "a".repeat(40) }, url: `https://github.com/example/micasa/pull/${n}` }), stderr: "" };
    return { ok: false, stdout: "", stderr: "unexpected" };
  };
  const good = await reviewTicket("Página de precios", "code", { pr: "https://github.com/example/micasa/pull/9" });
  assert.deepEqual((await messages()).find((m) => m.id === good.message)!.actions, ["fusionar", "cambios"]);
  const res = await act({ message_id: good.message, action: "fusionar" });
  assert.equal(res.status, 200, await res.clone().text());
  const out = (await res.json()) as { action_state: { result: Record<string, unknown> } };
  assert.deepEqual(out.action_state.result, { merged: true, pr: "https://github.com/example/micasa/pull/9", base: "sandbox", sha: "a".repeat(40), ticket: good.key });
  const merge = calls.find((a) => a[1] === "merge")!;
  assert.deepEqual(merge, ["pr", "merge", "9", "--repo", "example/micasa", "--merge", "--match-head-commit", "f".repeat(40)]);
  const ev = (await raw.query(`select payload from events where type = 'pr.merged' and task_key = $1`, [good.key])).rows[0].payload;
  assert.deepEqual([ev.number, ev.base, ev.merge_sha, ev.by], [9, "sandbox", "a".repeat(40), "screen"]);

  calls.length = 0;
  const bad = await reviewTicket("Atajo a main", "code", { pr: "https://github.com/example/micasa/pull/10" });
  const refused = await act({ message_id: bad.message, action: "aceptar" });
  assert.equal(refused.status, 409);
  const body = (await refused.json()) as { error: string; base: string };
  assert.deepEqual([body.error, body.base], ["BASE_NOT_SANDBOX", "main"]);
  assert.equal(calls.some((a) => a[1] === "merge"), false, "nothing merged");
  assert.equal((await messages()).find((m) => m.id === bad.message)!.action_state, null);

  // gh failing (no token, no access) is a 409 with the step, and nothing is recorded.
  releaseGh.run = async () => ({ ok: false, stdout: "", stderr: "HTTP 403" });
  const failed = await act({ message_id: bad.message, action: "aceptar" });
  assert.equal(failed.status, 409);
  assert.equal(((await failed.json()) as { error: string }).error, "MERGE_FAILED");
});

test("I32-4 #2: cambios sends the ticket back to Ready with the text as a note and queues its owner's wake", async () => {
  await raw.query(`delete from agent_runs`);
  const { key, message } = await reviewTicket("Plan de lanzamiento", "ops", { owner: "po-micasa" });
  const empty = await act({ message_id: message, action: "cambios" });
  assert.equal(empty.status, 409);
  assert.equal(((await empty.json()) as { error: string }).error, "TEXT_REQUIRED");
  const res = await act({ message_id: message, action: "cambios", text: "Agrega una fecha por fase" });
  assert.equal(res.status, 200);
  assert.equal((await raw.query(`select status from tasks where key = $1`, [key])).rows[0].status, "Ready");
  const note = (await raw.query(`select payload from events where task_key = $1 and type = 'note' order by id desc limit 1`, [key])).rows[0];
  assert.match(JSON.stringify(note?.payload ?? {}), /Agrega una fecha por fase/);
  const runs = (await raw.query(`select a.slug, r.status, r.task_key from agent_runs r join agents a on a.id = r.agent_id`)).rows;
  assert.deepEqual(runs, [{ slug: "po-micasa", status: "queued", task_key: key }]);
});

test("I32-4 #2: a runner's question lands in the thread with Responder; responder answers it", async () => {
  const po = (await raw.query(`select id from agents where slug = 'po-micasa'`)).rows[0].id;
  const micasa = (await raw.query(`select id from projects where slug = 'micasa'`)).rows[0].id;
  const run = (await raw.query(`insert into agent_runs (agent_id, project_id, role, status, started_at) values ($1, $2, 'product-owner', 'ok', now()) returning id`, [po, micasa])).rows[0].id as string;
  const t = (await writes.createTask(db, { project: "micasa", title: "Nombre del plan", scope: "s", checks: ["c"], work_type: "ops" } as never, { actor: PO })) as { key: string };
  const asked = await call("ask", { actor: { agent: "po-micasa", session_id: `run-${run.slice(0, 8)}` }, project: "micasa", key: t.key, question: "¿Plan Básico o Plan Inicial?" });
  assert.ok(asked.question_id, JSON.stringify(asked));
  const m = (await messages()).find((x) => x.question_id === asked.question_id)!;
  assert.deepEqual(m.actions, ["responder"]);
  assert.ok(m.links.some((l) => l.kind === "question" && l.ref === asked.question_id));

  const res = await act({ message_id: m.id, action: "responder", text: "Plan Inicial" });
  assert.equal(res.status, 200);
  const q = (await raw.query(`select answer, answered_at from questions where id = $1`, [asked.question_id])).rows[0];
  assert.equal(q.answer, "Plan Inicial");
  assert.ok(q.answered_at);
  assert.deepEqual((await messages()).find((x) => x.id === m.id)!.actions, []);
});
