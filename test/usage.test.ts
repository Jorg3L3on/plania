// PLA-I25-1: reported token totals. Migration 0037 runs twice on a private database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pg from "pg";
import type pgTypes from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { ToolError } = await import("../src/mcp/errors.js");
const { reportTokens } = await import("../src/mcp/usage.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");

let raw: pgTypes.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s-i25" };
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data;
}

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "usage-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

test("0037_token_usage.sql applies twice on a throwaway database", async () => {
  const name = "plania_mig_0037";
  const adminUrl = `postgres://${userInfo().username}@localhost:5432/postgres`;
  const dir = path.resolve(import.meta.dirname, "../drizzle/migrations");
  const sql0037 = readFileSync(path.join(dir, "0037_token_usage.sql"), "utf8");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const mig = new pg.Client({ connectionString: `postgres://${userInfo().username}@localhost:5432/${name}` });
  await mig.connect();
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0037").sort();
    for (const f of files) await mig.query(readFileSync(path.join(dir, f), "utf8"));
    const project = await mig.query("insert into projects (slug, title, key_prefix) values ('mig', 'Mig', 'MIG') returning id");
    const projectId = project.rows[0].id as string;

    await mig.query(sql0037);
    const cols = await mig.query(
      "select column_name from information_schema.columns where table_name = 'token_usage'",
    );
    const names = cols.rows.map((row) => row.column_name as string);
    for (const column of ["agent", "task_key", "run_id", "model", "input", "output", "at"]) {
      assert.equal(names.includes(column), true, column);
    }
    await mig.query(
      `insert into token_usage (project_id, agent, task_key, run_id, model, input, output, at)
       values ($1, 'cursor', 'MIG-1', 'run-1', 'fake-model', 10, 4, now())`,
      [projectId],
    );

    await mig.query(sql0037);
    assert.equal((await mig.query("select count(*)::int as n from token_usage")).rows[0].n, 1);
    assert.equal((await mig.query("select input from token_usage where run_id = 'run-1'")).rows[0].input, 10);
    await assert.rejects(
      mig.query(
        `insert into token_usage (project_id, agent, task_key, run_id, model, input, output, at)
         values ($1, 'cursor', 'MIG-1', 'run-bad', 'fake-model', -1, 0, now())`,
        [projectId],
      ),
    );
    await mig.query(sql0037);
    assert.equal((await mig.query("select count(*)::int as n from token_usage")).rows[0].n, 1);
  } finally {
    await mig.end();
    const drop = new pg.Client({ connectionString: adminUrl });
    await drop.connect();
    await drop.query(`drop database if exists ${name} with (force)`);
    await drop.end();
  }
});

test("report_tokens stores a run and a repeat replaces it", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "micasa",
    title: "Uso",
    scope: "Scope",
    checks: ["Done"],
  });
  assert.equal(created.__error, undefined);
  const key = created.key as string;
  const first = await call("report_tokens", {
    actor: A,
    project: "micasa",
    agent: "cursor",
    task_key: key,
    run_id: "run-a",
    model: "fake-model",
    input: 100,
    output: 40,
    at: "2026-03-02T18:00:00.000Z",
  });
  assert.equal(first.__error, undefined);
  assert.equal(first.label, "reportado");
  assert.equal(first.input, 100);
  assert.equal(first.output, 40);

  const again = await call("report_tokens", {
    actor: A,
    project: "micasa",
    agent: "cursor",
    task_key: key,
    run_id: "run-a",
    model: "fake-model",
    input: 15,
    output: 5,
    at: "2026-03-02T18:00:00.000Z",
  });
  assert.equal(again.input, 15);
  const rows = await raw.query("select count(*)::int as n from token_usage where run_id = 'run-a'");
  assert.equal(rows.rows[0].n, 1);
});

test("usage_summary totals per agent, project and week", async () => {
  const mic = await call("create_task", { actor: A, project: "micasa", title: "Semana", scope: "Scope", checks: ["Done"] });
  const wrk = await call("create_task", { actor: A, project: "workia", title: "Semana", scope: "Scope", checks: ["Done"] });
  assert.equal(mic.__error, undefined);
  assert.equal(wrk.__error, undefined);
  const base = { actor: A, model: "fake-model" };
  await call("report_tokens", { ...base, project: "micasa", agent: "reporter", task_key: mic.key, run_id: "w1", input: 100, output: 40, at: "2026-03-02T18:00:00.000Z" });
  await call("report_tokens", { ...base, project: "micasa", agent: "reporter", task_key: mic.key, run_id: "w1b", input: 5, output: 5, at: "2026-03-03T18:00:00.000Z" });
  await call("report_tokens", { ...base, project: "micasa", agent: "reporter", task_key: mic.key, run_id: "w2", input: 7, output: 1, at: "2026-03-09T18:00:00.000Z" });
  await call("report_tokens", { ...base, project: "workia", agent: "coder", task_key: wrk.key, run_id: "w1c", input: 3, output: 2, at: "2026-03-04T18:00:00.000Z" });

  const all = await call("usage_summary");
  assert.equal(all.label, "reportado");
  const cursorWeeks = (all.totals as { agent: string; project: string; week: string; input: number; output: number }[]).filter(
    (row) => row.agent === "reporter" && row.project === "micasa",
  );
  assert.equal(cursorWeeks.length, 2);
  const early = cursorWeeks.find((row) => row.input === 105);
  const later = cursorWeeks.find((row) => row.input === 7);
  assert.ok(early);
  assert.equal(early.output, 45);
  assert.match(early.week, /^\d{4}-W\d{2}$/);
  assert.ok(later);
  assert.notEqual(early.week, later.week);

  const filtered = await call("usage_summary", { project: "micasa", agent: "reporter", week: early.week });
  assert.deepEqual(filtered.totals, [early]);
  const text = JSON.stringify(filtered);
  assert.equal(text.includes("budget"), false);
  assert.equal(text.includes("pause"), false);
  assert.equal(text.includes("quota"), false);
  assert.equal(text.includes("remaining"), false);
});

test("a negative count is refused and the screen route needs a session", async () => {
  await assert.rejects(
    () =>
      reportTokens(
        db,
        { project: "micasa", agent: "cursor", task_key: "MIC-1", run_id: "nope", model: "fake-model", input: -1, output: 0 },
        { actor: A, tool: "report_tokens" },
      ),
    (err: unknown) => err instanceof ToolError && err.code === "INVALID_FILTER",
  );
  const missing = await app.request("/api/usage");
  assert.equal(missing.status, 401);
  const bearer = await app.request("/api/usage", { headers: { Authorization: `Bearer ${TEST_BEARER}` } });
  assert.equal(bearer.status, 401);
  const res = await app.request("/api/usage", { headers: { Cookie: cookie() } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { label: string; totals: unknown[] };
  assert.equal(body.label, "reportado");
  assert.ok(body.totals.length >= 1);
});

test("the usage module has no cap or stop logic", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const files = ["src/mcp/usage.ts", "src/api/usage.ts", "ui/src/components/team/usage-card.tsx"].map((file) =>
    readFileSync(path.join(root, file), "utf8"),
  );
  const blob = files.join("\n");
  assert.equal(/\bbudget\b|\bpause\b|\bquota\b/i.test(blob), false);
});
