// JSON API for the screen and the live event stream, on the v2 contract.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const writes = await import("../src/mcp/writes.js");
const { hashPassword } = await import("../src/auth/password.js");
const { ask } = await import("../src/mcp/questions.js");
const { addDecision } = await import("../src/mcp/decisions.js");
const ctx = { actor: { agent: "test-agent", session_id: "s1" } };
const T = { scope: "s", checks: ["c"] };

let raw: pg.Client;
let cookie: string;
type Json = Record<string, any>;

function req(method: string, path: string, opts: { body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.Cookie = c;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

// In review and Done need every check closed; the screen tests tick them first.
async function tickAll(key: string) {
  await raw.query("update checks set done = true where task_id = (select id from tasks where key = $1)", [key]);
}

async function row(key: string) {
  const { rows } = await raw.query("select status, priority, blocked_note, resolved_at, version from tasks where key = $1", [key]);
  return rows[0];
}

before(async () => {
  process.env.PLANIA_PASSWORD_HASH = await hashPassword("test-password-123");
  raw = await resetTestDb();
  cookie = `${SESSION_COOKIE}=${createSession()}`;
  const { db, close } = makeDb();
  try {
    await writes.createTask(db, { project: "micasa", kind: "initiative", key: "MIC-01", title: "Init", scope: "PRD", summary: "one line", next_action: "na" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F1", title: "F1", scope: "secret scope", checks: ["c"], parent_key: "MIC-01" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-01-F2", title: "F2", ...T, parent_key: "MIC-01", priority: "P0" }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-B-01", title: "Spec", ...T }, ctx);
    await writes.createTask(db, { project: "micasa", key: "MIC-B-02", title: "Held", ...T }, ctx);
    await writes.claim(db, { project: "micasa", key: "MIC-B-02" }, ctx);
    await addDecision(db, { project: "micasa", text: "Solo PDF", task_key: "MIC-01", pin: true }, ctx);
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("session", () => {
  test("every API route but login and logout needs the cookie", async () => {
    for (const [method, path] of [
      ["GET", "/api/session"], ["GET", "/api/projects"], ["GET", "/api/projects/micasa"],
      ["PATCH", "/api/projects/micasa/tasks/MIC-01-F1"], ["GET", "/api/events"], ["GET", "/api/nope"],
    ] as const) {
      const res = await req(method, path, { cookie: null, body: method === "PATCH" ? { status: "Done" } : undefined });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.deepEqual(await res.json(), { error: "UNAUTHORIZED" });
    }
    assert.equal((await row("MIC-01-F1")).status, "Backlog");
  });

  test("the MCP Bearer does not open the API", async () => {
    const res = await req("GET", "/api/projects", { cookie: null, headers: { Authorization: `Bearer ${TEST_BEARER}` } });
    assert.equal(res.status, 401);
  });

  test("login sets the cookie; a wrong password is 401", async () => {
    const bad = await req("POST", "/api/login", { cookie: null, body: { password: "nope" } });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { error: "INVALID_PASSWORD" });
    const good = await req("POST", "/api/login", { cookie: null, body: { password: "test-password-123" } });
    assert.equal(good.status, 204);
    assert.match(good.headers.get("set-cookie") ?? "", /^plania_session=v1\.\d+\..+HttpOnly; Secure; SameSite=Lax/);
    const formLogin = await app.request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "password=test-password-123",
    });
    assert.equal(formLogin.status, 415, "forms cannot post to the API");
  });

  test("session and logout", async () => {
    assert.equal((await req("GET", "/api/session")).status, 204);
    const out = await req("POST", "/api/logout");
    assert.equal(out.status, 204);
    assert.match(out.headers.get("set-cookie") ?? "", /plania_session=; Max-Age=0/);
  });
});

describe("reads", () => {
  test("GET /api/projects lists projects with a generated line and open questions", async () => {
    const list = (await (await req("GET", "/api/projects")).json()) as Json[];
    assert.deepEqual(list.map((p) => p.slug), ["filmia", "micasa", "workia", "zigzag"]);
    const micasa = list.find((p) => p.slug === "micasa")!;
    assert.equal(micasa.line, "En curso: MIC-B-02 (test-agent)");
    assert.equal(micasa.open_questions, 0);
    assert.equal(list.find((p) => p.slug === "zigzag")!.line, "Sin ficha.");
    // Each project carries its tasks without scope, in the same shape as GET /api/projects/:slug.
    const detail = (await (await req("GET", "/api/projects/micasa")).json()) as Json;
    assert.deepEqual(micasa.tasks, detail.tasks);
    assert.ok(!JSON.stringify(list).includes("project_id"));
    assert.deepEqual(list.find((p) => p.slug === "zigzag")!.tasks, []);
    // Inicio: the next claimable ticket, each environment in a line and a week of activity per project.
    assert.equal(micasa.next_claimable?.key ?? null, detail.resume.next_claimable?.key ?? null);
    assert.ok(Array.isArray(micasa.envs));
    assert.equal(micasa.activity.length, 7);
    assert.ok(micasa.activity.every((n: unknown) => typeof n === "number"));
    assert.deepEqual(list.find((p) => p.slug === "zigzag")!.activity, [0, 0, 0, 0, 0, 0, 0]);
    // The city: one note pair per open initiative, as get_resume has them.
    assert.deepEqual(
      micasa.initiatives,
      detail.resume.initiatives.map((i: Json) => ({ key: i.key, in_progress: i.in_progress.note, next_action: i.next_action.note })),
    );
    assert.deepEqual(list.find((p) => p.slug === "zigzag")!.initiatives, []);
  });

  test("GET /api/projects/:slug returns the generated resume, decisions and every task without scope, P0 first", async () => {
    const res = await req("GET", "/api/projects/micasa");
    assert.equal(res.status, 200);
    const p = (await res.json()) as Json;
    assert.equal(p.title, "MiCasa");
    assert.equal(p.tasks[0].key, "MIC-01-F2");
    assert.equal(p.tasks.at(-1).key, "MIC-01");
    const f1 = p.tasks.find((t: Json) => t.key === "MIC-01-F1");
    assert.deepEqual(Object.keys(f1).sort(), [
      "base_branch", "blocked_note", "branch", "claimed_at", "claimed_by", "due_on", "held", "key", "kind", "last_seen_at", "lease_until", "parent_key",
      "pr_url", "priority", "status", "summary", "time_after", "title", "updated_at", "version", "waits_on", "work_type",
    ]);
    assert.deepEqual(f1.waits_on, []);
    assert.equal(f1.held, false);
    assert.equal(f1.parent_key, "MIC-01");
    // Branches feed the "Rama y prod" graph: initiatives carry their base branch.
    assert.equal(p.tasks.find((t: Json) => t.key === "MIC-01").base_branch, "main");
    assert.match(f1.updated_at, /Z$/);
    const held = p.tasks.find((t: Json) => t.key === "MIC-B-02");
    assert.equal(held.claimed_by.session_id, "s1");
    assert.ok(!JSON.stringify(p.tasks).includes("secret scope"));
    const init = p.resume.initiatives.find((i: Json) => i.key === "MIC-01");
    assert.equal(init.next_action.note, "na");
    assert.deepEqual(init.must_keep.map((d: Json) => d.text), ["Solo PDF"]);
    assert.deepEqual(p.decisions.map((d: Json) => d.text), ["Solo PDF"]);
  });

  test("GET /api/projects/:slug/tasks/:key returns the get_task shape", async () => {
    const res = await req("GET", "/api/projects/micasa/tasks/MIC-01");
    assert.equal(res.status, 200);
    const t = (await res.json()) as Json;
    assert.equal(t.scope, "PRD");
    assert.equal(t.kind, "initiative");
    assert.deepEqual(t.child_keys, ["MIC-01-F1", "MIC-01-F2"]);
    assert.equal(t.base_branch, "main");
    assert.ok(t.updated_at);
    const f1 = (await (await req("GET", "/api/projects/micasa/tasks/MIC-01-F1")).json()) as Json;
    assert.equal(f1.scope, "secret scope");
    assert.equal(f1.parent_key, "MIC-01");
    assert.deepEqual(f1.checks.map((c: Json) => c.text), ["c"]);
    const missing = await req("GET", "/api/projects/micasa/tasks/NOPE");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "TASK_NOT_FOUND" });
    assert.equal((await req("GET", "/api/projects/micasa/tasks/MIC-01", { cookie: null })).status, 401);
  });

  test("task rows say which tickets they still wait on and whether another blocker holds them", async () => {
    const { db, close } = makeDb();
    try {
      await writes.createTask(db, { project: "workia", key: "WRK-W1", title: "first", ...T }, ctx);
      await writes.createTask(db, { project: "workia", key: "WRK-W2", title: "second", ...T }, ctx);
      await writes.createTask(db, { project: "workia", key: "WRK-W3", title: "queued", ...T, blocked_by: ["WRK-W2", "WRK-W1"] }, ctx);
      await writes.createTask(db, { project: "workia", key: "WRK-W4", title: "held", ...T, blocked_by: ["WRK-W1", { human_action: { text: "Crear la llave" } }] }, ctx);
      await raw.query("update tasks set status = 'In review' where key = 'WRK-W2'");
    } finally {
      await close();
    }
    const tasks = ((await (await req("GET", "/api/projects/workia")).json()) as Json).tasks as Json[];
    const row = (key: string) => tasks.find((t) => t.key === key)!;
    assert.deepEqual(row("WRK-W3").waits_on, ["WRK-W1"], "In review counts as settled");
    assert.equal(row("WRK-W3").held, false);
    assert.deepEqual(row("WRK-W4").waits_on, ["WRK-W1"]);
    assert.equal(row("WRK-W4").held, true, "an open human action holds it");
  });

  test("unknown project or path is a JSON 404", async () => {
    const res = await req("GET", "/api/projects/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "PROJECT_NOT_FOUND" });
    assert.deepEqual(await (await req("GET", "/api/nope")).json(), { error: "NOT_FOUND" });
  });
});

describe("PATCH /api/projects/:slug/tasks/:key", () => {
  const patch = async (key: string, body: Json, version?: number) =>
    req("PATCH", `/api/projects/micasa/tasks/${key}`, {
      body: { ...body, ...("version" in body ? {} : { version: version ?? (await row(key))?.version ?? 1 }) },
    });

  test("Jorge changes status and priority as jorge, with the version on screen", async () => {
    await tickAll("MIC-01-F1");
    const res = await patch("MIC-01-F1", { status: "In review", priority: "P1" });
    assert.equal(res.status, 200, "the screen may make any move, without evidence");
    const t = (await res.json()) as Json;
    assert.equal(t.status, "In review");
    assert.equal(t.priority, "P1");
    assert.equal(t.scope, "secret scope", "get_task shape");
    const full = (await (await req("GET", "/api/projects/micasa/tasks/MIC-01-F1")).json()) as Json;
    assert.equal(full.log.at(-1).actor.agent, "jorge");
    assert.equal((await row("MIC-01-F1")).priority, "P1");
  });

  test("a stale version changes nothing and says so", async () => {
    const res = await patch("MIC-01-F1", { priority: "P3", version: 1 });
    assert.equal(res.status, 409);
    const body = (await res.json()) as Json;
    assert.equal(body.error, "STALE_VERSION");
    assert.equal(body.current_version, (await row("MIC-01-F1")).version);
    assert.equal((await row("MIC-01-F1")).priority, "P1");
  });

  test("Blocked needs a note; Done stamps resolved_at; Done works on a claimed ticket; initiatives take their own statuses", async () => {
    let res = await patch("MIC-01-F2", { status: "Blocked" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "BLOCKED_REQUIRES_NOTE" });
    res = await patch("MIC-01-F2", { status: "Blocked", note: "waiting on bank" });
    assert.equal(res.status, 200);
    assert.equal((await row("MIC-01-F2")).blocked_note, "waiting on bank");
    res = await patch("MIC-01-F1", { status: "Done" });
    assert.ok((await row("MIC-01-F1")).resolved_at instanceof Date);
    res = await patch("MIC-01", { status: "Shipping" });
    assert.equal(res.status, 200);
    assert.equal((await row("MIC-01")).status, "Shipping");
  });

  test("error codes map to HTTP statuses", async () => {
    const cases: [string, Json, number, string][] = [
      ["MIC-01-F2", { status: "Planning" }, 400, "INVALID_STATUS"],
      ["MIC-01-F2", { priority: "P9" }, 400, "INVALID_PRIORITY"],
      ["NOPE", { status: "Done", version: 1 }, 404, "TASK_NOT_FOUND"],
      ["MIC-01-F2", { status: 7 }, 400, "INVALID_BODY"],
    ];
    for (const [key, body, status, error] of cases) {
      const res = await patch(key, body);
      assert.equal(res.status, status, JSON.stringify(body));
      assert.equal(((await res.json()) as Json).error, error);
    }
  });
});

describe("leases and questions from the screen", () => {
  test("Liberar frees a lease", async () => {
    const res = await req("POST", "/api/projects/micasa/tasks/MIC-B-02/release");
    assert.equal(res.status, 200);
    const t = (await res.json()) as Json;
    assert.equal(t.claim, null);
    assert.equal(t.status, "Ready");
  });

  test("Jorge answers a question; it becomes a decision and the ticket goes back", async () => {
    const { db, close } = makeDb();
    let id = "";
    try {
      await writes.claim(db, { project: "micasa", key: "MIC-B-02" }, ctx);
      id = (await ask(db, { project: "micasa", key: "MIC-B-02", question: "¿CSV también?", options: ["Sí", "No"] }, ctx)).question.id;
    } finally {
      await close();
    }
    const p = (await (await req("GET", "/api/projects/micasa")).json()) as Json;
    assert.deepEqual(p.resume.open_questions.map((q: Json) => q.question), ["¿CSV también?"]);
    const list = (await (await req("GET", "/api/projects")).json()) as Json[];
    assert.equal(list.find((x) => x.slug === "micasa")!.open_questions, 1);

    assert.equal((await req("POST", `/api/projects/micasa/questions/${id}/answer`, { body: { answer: "  " } })).status, 400);
    const res = await req("POST", `/api/projects/micasa/questions/${id}/answer`, { body: { answer: "Sí", decision_text: "CSV también" } });
    assert.equal(res.status, 200);
    const out = (await res.json()) as Json;
    assert.equal(out.decision.text, "CSV también");
    assert.equal(out.decision.actor.agent, "jorge");
    assert.equal(out.task.status, "In progress");
    const again = await req("POST", `/api/projects/micasa/questions/${id}/answer`, { body: { answer: "No" } });
    assert.equal(again.status, 409);
  });

  test("export downloads the project with the session cookie", async () => {
    const res = await req("GET", "/api/export/micasa.json");
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Json).project.slug, "micasa");
    assert.equal((await req("GET", "/api/export/micasa.json", { cookie: null })).status, 401);
  });
});

describe("GET /api/events", () => {
  // Reads SSE frames until one with the given event name arrives.
  async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, name: string): Promise<Json> {
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (event === name) return JSON.parse(data ?? "{}");
      }
    }
    throw new Error(`no ${name} event`);
  }

  test("streams a change when an agent writes over MCP and when the screen writes", async () => {
    const res = await req("GET", "/api/events");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = res.body!.getReader();
    await nextEvent(reader, "ready");

    // An agent write, through the same function the set_task tool calls.
    const { db, close } = makeDb();
    await writes.setTask(db, { project: "micasa", key: "MIC-B-01", status: "Ready", version: (await row("MIC-B-01")).version }, ctx);
    await close();
    assert.deepEqual(await nextEvent(reader, "change"), { type: "task", project: "micasa", key: "MIC-B-01" });

    // A screen write through the API.
    await req("PATCH", "/api/projects/micasa/tasks/MIC-B-01", { body: { priority: "P3", version: (await row("MIC-B-01")).version } });
    assert.deepEqual(await nextEvent(reader, "change"), { type: "task", project: "micasa", key: "MIC-B-01" });

    await reader.cancel();
  });
});

describe("GET /api/machine", () => {
  test("needs the session cookie", async () => {
    const res = await req("GET", "/api/machine", { cookie: null });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "UNAUTHORIZED" });
  });

  test("returns the machine, the header totals and every unreleased row with its ticket, initiative and lease", async () => {
    await raw.query(`insert into footprints (machine, kind, locator, project_id, task_id, session_id, source, state, details, first_seen_at, last_seen_at, teardown)
      select 'test-mac', 'server', 'port:3069', t.project_id, t.id, 's1', 'observed', 'live', '{"port":3069,"pid":10319}', now(), now(), 'kill 10319' from tasks t where t.key = 'MIC-01-F1'`);
    await raw.query(`insert into footprints (machine, kind, locator, source, state, details, first_seen_at, last_seen_at) values
      ('test-mac', 'worktree', '/w/a', 'observed', 'stale', '{"size_kb": 2048, "repo": "plania"}', now(), now()),
      ('test-mac', 'database', 'x@127.0.0.1:5432', 'observed', 'orphan', '{}', now(), now()),
      ('test-mac', 'server', 'port:4000', 'observed', 'gone', '{}', now(), now() - interval '1 hour')`);
    await raw.query(`insert into footprints (machine, kind, locator, source, state, released_at) values ('test-mac', 'server', 'port:4100', 'observed', 'released', now())`);
    await raw.query(`insert into resources (project_id, name, holder, purpose, lease_until)
      select id, 'port:3069@test-mac', '{"agent":"claude","session_id":"s1"}', 'micasa dev', now() + interval '10 minutes' from projects where slug = 'micasa'`);

    const res = await req("GET", "/api/machine");
    assert.equal(res.status, 200);
    const body = (await res.json()) as Json;
    assert.equal(typeof body.machine, "string");
    assert.deepEqual(body.totals, { servers: 1, databases: 1, worktree_kb: 2048, orphan: 1, stale: 1 });
    assert.equal(body.items.length, 4, "released rows are out");
    const dev = body.items.find((i: Json) => i.locator === "port:3069");
    assert.deepEqual([dev.project, dev.task_key, dev.initiative_key, dev.session_id, dev.teardown, dev.lease.purpose], ["micasa", "MIC-01-F1", "MIC-01", "s1", "kill 10319", "micasa dev"]);
    assert.equal(body.items.find((i: Json) => i.locator === "/w/a").repo, "plania");
    assert.equal(body.items.find((i: Json) => i.locator === "port:4000").state, "gone");
    // the findings the project audits cannot hold: rows without a project (the stale worktree, the orphan database)
    assert.deepEqual(body.findings.map((f: Json) => f.code).sort(), ["FOOTPRINT_ORPHAN", "WORKTREE_MERGED_NOT_REMOVED"]);
    assert.ok(body.findings.every((f: Json) => typeof f.detail === "string" && typeof f.fix_hint === "string"));
  });
});
