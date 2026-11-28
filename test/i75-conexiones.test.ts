// PLA-I75 (Conexiones, pass 1): a seat's tools beyond Plania. The catalog is pinned (never @latest), reading is on and
// every write tool starts off, keys are names (${NAME} in the config, the value only in the child env), a database
// tool reaches a throwaway copy only, a version change waits for the owner, an agent only asks (request_connection),
// and the run log is what the stream showed. Throwaway DB, fake values, no real claude.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import type pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
process.env.PLANIA_PROMPTS_PROJECT = "tienda";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { ensureTeam } = await import("../src/runner/team.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const cx = await import("../src/runner/conexiones.js");
const store = await import("../src/runner/conexiones-store.js");
const runner = await import("../src/runner/runner.js");
const { StreamReader } = await import("../src/runner/stream.js");
const { denySettings } = await import("../src/runner/deny.js");
const { projectOf } = await import("../src/maquinas/machines.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const owner = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const BASE = "/api/company/projects/tienda/team";
const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = owner()) => {
  const res = await app.request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
};
const agentId = async (slug: string) => (await raw.query(`select id from agents where slug = $1`, [slug])).rows[0].id as string;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
  await raw.query(`insert into agents (slug, name, role, kind) values ('ceo', 'CEO', 'ceo', 'human')`);
  const pid = (await raw.query(`insert into projects (slug, title, key_prefix) values ('tienda', 'Tienda', 'TND') returning id`)).rows[0].id;
  const actor = JSON.stringify({ agent: "test", session_id: "s" });
  for (const t of ["Product owner", "Taller", "Research", "Artist", "QA"]) await raw.query(`insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)`, [pid, `Prompt: ${t}`, `# ${t}`, actor]);
  await ensureTeam(db, { id: pid, slug: "tienda", title: "Tienda" });
});
after(async () => {
  await closeDb();
  await raw.end();
});

test("I75 #1: the migration is the next number and safe to run twice", async () => {
  const dir = new URL("../drizzle/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.at(-1), "0079_agent_connections.sql");
  const sql = readFileSync(new URL("0079_agent_connections.sql", dir), "utf8");
  await raw.query(sql);
  await raw.query(sql);
});

test("I75 #2: every catalog entry is pinned to an exact version; nothing says latest; names are valid and unique", () => {
  const ids = new Set<string>();
  for (const e of cx.CATALOG) {
    assert.ok(cx.SERVER_NAME.test(e.id) && !cx.RESERVED_SERVERS.has(e.id), e.id);
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
    ids.add(e.id);
    assert.ok(cx.isPinned(e.version, e.transport.kind === "http"), `${e.id} ${e.version}`);
    if (e.transport.kind === "stdio") {
      assert.ok(e.transport.args.some((a) => a.includes("{version}")), `${e.id} pins through {version}`);
      assert.ok(e.version !== "remota", e.id);
    }
    assert.doesNotMatch(JSON.stringify(e), /latest/i, e.id);
    // A tool is read, write or never, not two of them.
    const all = [...e.reads, ...e.writes, ...e.never];
    assert.equal(new Set(all).size, all.length, e.id);
  }
  assert.equal(cx.CATALOG.length, 11);
  assert.ok(cx.catalogEntry("github")!.never.includes("merge_pull_request"));
  // The QA browser rides the catalog's pinned Playwright, not @latest.
  assert.deepEqual(runner.browserServer({}).args, ["-y", `@playwright/mcp@${cx.catalogEntry("playwright")!.version}`, "--headless", "--isolated"]);
});

test("I75 #3: a run's config names keys as ${NAME}; write tools start off; a never tool stays off; read-only denies them all", () => {
  const gh: Parameters<typeof cx.serverConfig>[0] = { server: "github", version: "v2.2.0", keys: { GITHUB_PERSONAL_ACCESS_TOKEN: "GH_TOKEN_TIENDA" }, writesOn: [], custom: null, reviewed: true };
  const off = cx.serverConfig(gh) as Json;
  assert.deepEqual(off, { type: "http", url: "https://api.githubcopilot.com/mcp/readonly", headers: { Authorization: "Bearer ${GH_TOKEN_TIENDA}" } });
  const deny = cx.connectionDenyRules(gh);
  assert.ok(deny.includes("mcp__github__create_issue") && deny.includes("mcp__github__merge_pull_request"));
  const on = { ...gh, writesOn: ["create_issue"] };
  assert.equal((cx.serverConfig(on) as Json).url, "https://api.githubcopilot.com/mcp/");
  assert.ok(!cx.connectionDenyRules(on).includes("mcp__github__create_issue"));
  assert.ok(cx.connectionDenyRules(on, true).includes("mcp__github__create_issue"), "a read-only run gets no write tool");
  const sentry = cx.serverConfig({ server: "sentry", version: "0.50.0", keys: {}, writesOn: [], custom: null, reviewed: true }) as Json;
  assert.deepEqual(sentry, { command: "npx", args: ["-y", "@sentry/mcp-server@0.50.0"], env: { SENTRY_ACCESS_TOKEN: "${SENTRY_AUTH_TOKEN}" } });
  // A login-only server never reaches a run.
  assert.equal(cx.serverConfig({ server: "vercel", version: "remota", keys: {}, writesOn: [], custom: null, reviewed: true }), null);
  // The settings carry Plania's own rules and the connection's.
  assert.ok(denySettings(deny).permissions.deny.includes("mcp__github__push_files"));
  // Plania and the QA browser keep their names.
  const conf = runner.mcpConfig("http://x/mcp", null, null, { plania: { command: "evil", args: [] }, shadcn: { command: "npx", args: ["-y", "shadcn@4.23.0", "mcp"] } }) as Json;
  assert.equal(conf.mcpServers.plania.type, "http");
  assert.deepEqual(conf.mcpServers.shadcn.args, ["-y", "shadcn@4.23.0", "mcp"]);
});

test("I75 #4: a database tool reaches a throwaway copy only, never the app's own or Plania's", () => {
  assert.equal(cx.databaseProblem("postgres://localhost/tienda_prueba", "plania"), null);
  assert.equal(cx.databaseProblem("postgres://localhost/tienda_ini_tnd_3", "plania"), null);
  assert.equal(cx.databaseProblem("postgres://localhost/tienda", "plania"), "not-a-copy");
  assert.equal(cx.databaseProblem("postgres://localhost/plania", "plania"), "planias");
  assert.equal(cx.databaseProblem("postgres://localhost/plania_prueba", "plania"), "planias");
  assert.equal(cx.databaseProblem(undefined, null), "missing");
});

test("I75 #5: a custom server is an npm package at an exact version, plain flags, no secret in its arguments", () => {
  assert.equal(cx.customProblem("mi-mcp", { package: "@acme/mcp", version: "1.2.3", args: ["--read-only"] }), null);
  assert.equal(cx.customProblem("mi-mcp", { package: "@acme/mcp", version: "latest", args: [] }), "version");
  assert.equal(cx.customProblem("mi-mcp", { package: "@acme/mcp", version: "^1.2.0", args: [] }), "version");
  assert.equal(cx.customProblem("github", { package: "x", version: "1.0.0", args: [] }), "name");
  assert.equal(cx.customProblem("plania", { package: "x", version: "1.0.0", args: [] }), "name");
  assert.equal(cx.customProblem("mi-mcp", { package: "x", version: "1.0.0", args: ["--token=abc"] }), "args");
  assert.equal(cx.customProblem("mi-mcp", { package: "x", version: "1.0.0", args: ["$(rm -rf ~)"] }), "args");
});

test("I75 #6: the owner connects from the sheet: reading only, write tools one by one, never tools refused, keys by name", async () => {
  const r0 = await call("GET", `${BASE}/taller-tienda/conexiones`);
  assert.equal(r0.status, 200, JSON.stringify(r0.json));
  assert.deepEqual(r0.json.connections, []);
  assert.ok(r0.json.catalog.find((c: Json) => c.id === "shadcn").recommended, "Taller's recommended first");
  assert.ok(!r0.json.catalog.find((c: Json) => c.id === "figma").unattended);

  const login = await call("PUT", `${BASE}/taller-tienda/conexiones/vercel`, {});
  assert.equal(login.status, 409);
  assert.equal(login.json.error, "CONNECTION_NEEDS_LOGIN");
  assert.equal((await call("PUT", `${BASE}/taller-tienda/conexiones/nada`, {})).json.error, "CONNECTION_UNKNOWN");
  const badKey = await call("PUT", `${BASE}/taller-tienda/conexiones/github`, { keys: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_realvalue lower" } });
  assert.equal(badKey.status, 400);
  assert.equal(badKey.json.error, "CONNECTION_INVALID");

  const made = await call("PUT", `${BASE}/taller-tienda/conexiones/github`, { keys: { GITHUB_PERSONAL_ACCESS_TOKEN: "GH_TOKEN_TIENDA" } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const gh = made.json.connections.find((c: Json) => c.server === "github");
  assert.equal(gh.version, "v2.2.0");
  assert.ok(gh.writes.every((w: Json) => w.on === false), "every write tool starts off");
  assert.deepEqual(gh.keys, [{ env: "GITHUB_PERSONAL_ACCESS_TOKEN", name: "GH_TOKEN_TIENDA", optional: false, set: false }]);
  assert.equal(gh.problem, "needs-key");
  assert.equal(made.json.catalog.find((c: Json) => c.id === "github").connected, true);

  const on = await call("PUT", `${BASE}/taller-tienda/conexiones/github/writes/create_issue`, { on: true });
  assert.equal(on.status, 200);
  assert.deepEqual(on.json.connections[0].writes.filter((w: Json) => w.on).map((w: Json) => w.tool), ["create_issue"]);
  const never = await call("PUT", `${BASE}/taller-tienda/conexiones/github/writes/merge_pull_request`, { on: true });
  assert.equal(never.status, 403);
  assert.equal(never.json.error, "CONNECTION_TOOL_NEVER");

  // A Bearer never reaches these routes.
  const bearer = await call("PUT", `${BASE}/taller-tienda/conexiones/shadcn`, {}, { Authorization: `Bearer ${TEST_BEARER}`, "Content-Type": "application/json" });
  assert.equal(bearer.status, 403);
  // No value is stored anywhere: the row holds names.
  const rows = (await raw.query(`select keys::text as k from agent_connections`)).rows;
  assert.ok(rows.every((r) => !/ghp_/.test(r.k)));

  const gone = await call("DELETE", `${BASE}/taller-tienda/conexiones/github`);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.json.connections, []);
  const again = await call("DELETE", `${BASE}/taller-tienda/conexiones/github`);
  assert.equal(again.status, 404);
  assert.equal(again.json.error, "CONNECTION_NOT_FOUND");
});

test("I75 #7: a new catalog version waits for the owner, who reads what it adds, drops or turns into a writer", async () => {
  await call("PUT", `${BASE}/taller-tienda/conexiones/shadcn`, {});
  const id = await agentId("taller-tienda");
  await raw.query(`update agent_connections set version = '4.20.0', tools_seen = $2 where agent_id = $1 and server = 'shadcn'`, [id, JSON.stringify({ reads: ["get_project_registries", "old_tool"], writes: [], never: [] })]);
  const r = await call("GET", `${BASE}/taller-tienda/conexiones`);
  const c = r.json.connections.find((x: Json) => x.server === "shadcn");
  assert.equal(c.change.from, "4.20.0");
  assert.equal(c.change.to, "4.23.0");
  assert.ok(c.change.added.includes("view_items_in_registries"));
  assert.deepEqual(c.change.removed, ["old_tool"]);
  // Until accepted, its runs stay on the old version.
  const p = await projectOf(db, "tienda");
  const run = await store.runConnections(db, { id }, { project: p, env: {}, readOnly: false, planiaDb: "plania", qaBrowser: false });
  assert.deepEqual((run.servers.shadcn as Json).args, ["-y", "shadcn@4.20.0", "mcp"]);
  const ok = await call("POST", `${BASE}/taller-tienda/conexiones/shadcn/version`);
  assert.equal(ok.json.connections.find((x: Json) => x.server === "shadcn").change, null);
  await call("DELETE", `${BASE}/taller-tienda/conexiones/shadcn`);
});

test("I75 #8: a run gets its connections with keys only in its env; a missing key, a real database or an unreviewed one stays out", async () => {
  const id = await agentId("artist-tienda");
  await call("PUT", `${BASE}/artist-tienda/conexiones/github`, {});
  await call("PUT", `${BASE}/artist-tienda/conexiones/base-prueba`, {});
  await call("PUT", `${BASE}/artist-tienda/conexiones/playwright`, {});
  await call("PUT", `${BASE}/artist-tienda/conexiones/github/writes/create_issue`, { on: true });
  const added = await call("POST", `${BASE}/artist-tienda/conexiones-propias`, { server: "mi-mcp", package: "@acme/mcp", version: "1.2.3", args: ["--read-only"] });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.equal(added.json.connections.find((c: Json) => c.server === "mi-mcp").problem, "needs-review");
  const p = await projectOf(db, "tienda");
  const opts = { project: p, readOnly: false, planiaDb: "plania", qaBrowser: false };

  const none = await store.runConnections(db, { id }, { ...opts, env: { DATABASE_URI: "postgres://localhost/tienda" } });
  assert.deepEqual(Object.keys(none.servers), ["playwright"]);
  assert.deepEqual(none.skipped.map((s) => `${s.server}:${s.why}`).sort(), ["base-prueba:not-a-copy", "github:needs-key", "mi-mcp:needs-review"]);

  await call("POST", `${BASE}/artist-tienda/conexiones/mi-mcp/review`);
  const env = { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_fake_value", DATABASE_URI: "postgres://localhost/tienda_prueba" };
  const all = await store.runConnections(db, { id }, { ...opts, env });
  assert.deepEqual(Object.keys(all.servers).sort(), ["base-prueba", "github", "mi-mcp", "playwright"]);
  assert.deepEqual(all.env, env, "the values reach the child env only");
  const text = JSON.stringify(all.servers);
  assert.doesNotMatch(text, /ghp_fake_value|tienda_prueba/, "no value in the config");
  assert.match(text, /\$\{GITHUB_PERSONAL_ACCESS_TOKEN\}/);
  assert.match(text, /\$\{DATABASE_URI\}/);
  assert.ok(!all.deny.includes("mcp__github__create_issue"));
  assert.ok(all.deny.includes("mcp__github__push_files") && all.deny.includes("mcp__github__merge_pull_request"));
  assert.deepEqual((all.servers["mi-mcp"] as Json).args, ["-y", "@acme/mcp@1.2.3", "--read-only"]);

  // A read-only run (QA review, a question): every write denied and the read-only address; the QA browser wins.
  const ro = await store.runConnections(db, { id }, { ...opts, env, readOnly: true, qaBrowser: true });
  assert.ok(ro.deny.includes("mcp__github__create_issue"));
  assert.equal((ro.servers.github as Json).url, "https://api.githubcopilot.com/mcp/readonly");
  assert.ok(!ro.servers.playwright);
  assert.ok(ro.skipped.some((s) => s.server === "playwright" && s.why === "qa-browser"));
  // Plania's own database is never a copy.
  const planias = await store.runConnections(db, { id }, { ...opts, env: { ...env, DATABASE_URI: "postgres://localhost/plania" } });
  assert.ok(planias.skipped.some((s) => s.server === "base-prueba" && s.why === "not-a-copy"));
});

test("I75 #9: an agent asks with request_connection; only the owner's screen connects it", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(b);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(a);
  const ask = async (who: string, server: string, project = "tienda") => {
    const r = (await client.callTool({ name: "request_connection", arguments: { actor: { agent: who, session_id: `s-${who}` }, project, server, reason: "Necesito la documentación al día de la librería de fechas." } })) as { content: { text: string }[] };
    return JSON.parse(r.content[0]!.text) as Json;
  };
  assert.equal((await ask("stranger", "context7")).error, "CONNECTION_REQUEST_NO_SEAT");
  assert.equal((await ask("research-tienda", "nada")).error, "CONNECTION_UNKNOWN");
  const made = await ask("research-tienda", "context7");
  assert.equal(made.request.state, "proposed");
  assert.equal((await ask("research-tienda", "context7")).request.id, made.request.id, "one open request per tool");
  // Nothing on MCP connects or turns on a tool.
  assert.ok(!(await client.listTools()).tools.some((t) => /connect/.test(t.name) && t.name !== "request_connection"));

  const sheet = await call("GET", `${BASE}/research-tienda/conexiones`);
  assert.deepEqual(sheet.json.requests.map((r: Json) => r.server), ["context7"]);
  const yes = await call("POST", `${BASE}/research-tienda/conexiones-pedidos/${made.request.id}`, { accept: true });
  assert.equal(yes.status, 200, JSON.stringify(yes.json));
  assert.deepEqual(yes.json.requests, []);
  assert.deepEqual(yes.json.connections.map((c: Json) => c.server), ["context7"]);
  assert.equal((await call("POST", `${BASE}/research-tienda/conexiones-pedidos/${made.request.id}`, { accept: false })).json.error, "CONNECTION_REQUEST_DECIDED");
  assert.equal((await ask("research-tienda", "context7")).error, "CONNECTION_EXISTS");

  const unknown = await call("POST", `${BASE}/research-tienda/conexiones-pedidos/00000000-0000-0000-0000-000000000000`, { accept: true });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, "CONNECTION_REQUEST_NOT_FOUND");

  const no = await ask("research-tienda", "github");
  const declined = await call("POST", `${BASE}/research-tienda/conexiones-pedidos/${no.request.id}`, { accept: false });
  assert.deepEqual(declined.json.requests, []);
  assert.ok(!declined.json.connections.some((c: Json) => c.server === "github"));
});

test("I75 #10: the run log counts each mcp__ call as ran, failed or blocked, from the stream, and the sheet reads 7 days", async () => {
  const lines = [
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "mcp__context7__get-library-docs", input: {} }, { type: "tool_use", id: "t2", name: "mcp__github__create_issue", input: {} }, { type: "tool_use", id: "t3", name: "mcp__context7__resolve-library-id", input: {} }, { type: "tool_use", id: "t4", name: "mcp__plania__start", input: {} }], usage: {} } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "docs" }] }, { type: "tool_result", tool_use_id: "t2", is_error: true, content: "Permission to use mcp__github__create_issue has been denied." }, { type: "tool_result", tool_use_id: "t3", is_error: true, content: "timeout" }] } },
    { type: "result", subtype: "success", num_turns: 1, modelUsage: {}, permission_denials: [{ tool_name: "mcp__github__create_issue", tool_use_id: "t2", tool_input: {} }] },
  ];
  const reader = new StreamReader();
  reader.feed(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  reader.end();
  const tally = reader.mcpTally();
  assert.deepEqual(tally.context7, { "get-library-docs": { ok: 1, failed: 0, blocked: 0 }, "resolve-library-id": { ok: 0, failed: 1, blocked: 0 } });
  assert.deepEqual(tally.github, { create_issue: { ok: 0, failed: 0, blocked: 1 } });

  const id = await agentId("research-tienda");
  delete tally.plania;
  await raw.query(`insert into agent_runs (agent_id, project_id, role, status, summary, task_key, mcp_calls) select a.id, a.project_id, 'research', 'ok', 'ok', 'TND-1', $2 from agents a where a.id = $1`, [id, JSON.stringify(tally)]);
  const r = await call("GET", `${BASE}/research-tienda/conexiones`);
  const c7 = r.json.connections.find((c: Json) => c.server === "context7");
  assert.deepEqual(c7.usage, { calls: 2, failed: 1, blocked: 0, runs: 1, tools: [{ tool: "get-library-docs", ok: 1, failed: 0, blocked: 0 }, { tool: "resolve-library-id", ok: 0, failed: 1, blocked: 0 }] });
  assert.deepEqual(r.json.blocked.map((b: Json) => `${b.server}:${b.tool}:${b.n}:${b.task}`), ["github:create_issue:1:TND-1"]);
});
