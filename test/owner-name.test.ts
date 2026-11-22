// PLA-I2-14: the owner has a name of their own. Neutral stored and wire values, one display name, the old spellings
// read for one protocol version with a warning, and migration 0062 for rows written before.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
delete process.env.PLANIA_CEO_NAME;
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { ERRORS } = await import("../src/mcp/errors.js");
const { PROTOCOL_VERSION, instructions } = await import("../src/mcp/protocol.js");
const owner = await import("../src/owner.js");

type Json = Record<string, any>;
const ROOT = path.resolve(import.meta.dirname, "..");
const FIRST = /jorge/i; // the first owner's name, which a fresh install must never show
const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "zigzag" };
const T = { scope: "s", checks: ["c"] };

let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];

async function connect(): Promise<Client> {
  const server = createMcpServer(db);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
async function callWith(client: Client, name: string, args: Json = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...P, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, ...data } : data;
}

before(async () => {
  raw = await resetTestDb();
  db = makeDb().db;
});
after(async () => {
  owner.resetOwnerName(null);
  await raw.end();
});

// Every string a field description carries, at any depth of a JSON schema.
function descriptions(schema: unknown, out: string[] = []): string[] {
  if (schema && typeof schema === "object") {
    for (const [k, v] of Object.entries(schema)) {
      if (k === "description" && typeof v === "string") out.push(v);
      else descriptions(v, out);
    }
  }
  return out;
}

// Code lines of a source file: comments dropped, and the lines that read the old spelling on purpose (tagged).
function codeLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/PLA-I2-14/.test(l))
    .map((l) => l.replace(/\s\/\/ .*$/, ""));
}
const walk = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(f) ? [p] : [];
  });

describe("check 1: a fresh install with another name", () => {
  test("no tool description, field description, protocol line or error text names the first owner; the name reads instead", async () => {
    owner.resetOwnerName("Ana");
    const client = await connect();
    const { tools } = await client.listTools();
    assert.ok(tools.length > 40);
    for (const t of tools) {
      assert.doesNotMatch(t.description ?? "", FIRST, `${t.name} description`);
      for (const d of descriptions(t.inputSchema)) assert.doesNotMatch(d, FIRST, `${t.name} field: ${d}`);
    }
    const proto = client.getInstructions() ?? "";
    assert.doesNotMatch(proto, FIRST);
    assert.match(proto, /Need Ana to decide\? ask/);
    assert.match(proto, /a line that starts with "Owner:" becomes one/);
    assert.match(tools.find((t) => t.name === "ask")!.description!, /^Ask Ana a question/);
    for (const [code, [, text]] of Object.entries(ERRORS)) assert.doesNotMatch(text, FIRST, code);
    await client.close();
  });

  test("without a name the text says the owner, and «el dueño» on screen", () => {
    owner.resetOwnerName(null);
    assert.match(instructions(false), /Need the owner to decide\? ask/);
    assert.equal(owner.ownerName("es", { capital: true }), "El dueño");
    assert.equal(owner.ownerEs("de"), "del dueño");
    assert.equal(owner.ownerEs("a"), "al dueño");
    owner.resetOwnerName("Ana");
    assert.equal(owner.ownerEs("de"), "de Ana");
    assert.equal(owner.personalize("Only the owner ships; the owner's screen; owner_agent stays"), "Only Ana ships; Ana's screen; owner_agent stays");
  });

  test("the screen's wording modules and the server's Spanish text never name the first owner; «Te toca» stays", () => {
    const files = [...walk(path.join(ROOT, "ui/src"), /\.(ts|tsx)$/), ...walk(path.join(ROOT, "src"), /\.ts$/).filter((f) => !f.endsWith(`${path.sep}owner.ts`))];
    const hits = files.flatMap((f) => codeLines(f).filter((l) => /\bJorge\b/.test(l)).map((l) => `${path.relative(ROOT, f)}: ${l.trim().slice(0, 120)}`));
    assert.deepEqual(hits, []);
    assert.match(readFileSync(path.join(ROOT, "src/mcp/progress.ts"), "utf8"), /"Needs owner": "Te toca"/);
  });

  test("the display name is stored once, read at start, and the brief falls back to it", async () => {
    owner.resetOwnerName(null);
    assert.equal(await owner.loadOwnerName(db), null);
    assert.equal(await owner.setOwnerName(db, "  Ana   María "), "Ana María");
    owner.resetOwnerName(null);
    assert.equal(await owner.loadOwnerName(db), "Ana María");
    const { resolveBriefSettings, DEFAULT_SETTINGS } = await import("../src/brief/settings.js");
    assert.equal(resolveBriefSettings(DEFAULT_SETTINGS, {}).owner_name, "Ana María");
    assert.equal(await owner.setOwnerName(db, null), null);
  });
});

describe("check 3: old spellings read the same, with a warning", () => {
  let client: Client;
  before(async () => {
    owner.resetOwnerName("Ana");
    client = await connect();
  });
  after(() => client.close());

  test("delegated_by_jorge moves the ticket like delegated_by_owner, and warns", async () => {
    const make = async (title: string) => (await callWith(client, "create_task", { title, ...T })).key as string;
    const version = async (key: string) => (await callWith(client, "get_task", { key })).version;
    const a = await make("Neutral");
    const b = await make("Old");
    const neutral = await callWith(client, "set_task", { key: a, status: "Won't do", version: await version(a), reason: "ya no hace falta", delegated_by_owner: { message_id: "msg-owner-0901", quote: "márcalo como no se hace" } });
    const old = await callWith(client, "set_task", { key: b, status: "Won't do", version: await version(b), reason: "ya no hace falta", delegated_by_jorge: { message_id: "msg-owner-0902", quote: "márcalo como no se hace" } });
    assert.equal(neutral.status, "Won't do", JSON.stringify(neutral));
    assert.equal(old.status, neutral.status, JSON.stringify(old));
    assert.equal((neutral.warnings ?? []).some((w: Json) => w.code === "OLD_SPELLING"), false);
    const w = old.warnings.find((x: Json) => x.code === "OLD_SPELLING");
    assert.deepEqual({ used: w.used, read_as: w.read_as }, { used: "delegated_by_jorge", read_as: "delegated_by_owner" });
    const ev = await raw.query("select payload from events where type = 'task.delegated_move' and payload->>'message_id' = 'msg-owner-0902'");
    assert.equal(ev.rowCount, 1);
  });

  test("a line that starts with the old name or the display name becomes a blocker like an Owner: line; both warn", async () => {
    const key = (await callWith(client, "create_task", { kind: "initiative", title: "Lines", scope: "s" })).key as string;
    const v = async () => (await callWith(client, "get_task", { key })).version;
    await callWith(client, "set_task", { key, status: "Active", version: await v() });
    const neutral = await callWith(client, "set_task", { key, next_action: "Owner: rotate the token", version: await v() });
    const old = await callWith(client, "set_task", { key, next_action: "Owner: rotate the token\nJorge: sign the form", version: await v() });
    const named = await callWith(client, "set_task", { key, next_action: "Owner: rotate the token\nJorge: sign the form\nAna: approve the listing", version: await v() });
    const codes = (r: Json) => (r.warnings ?? []).map((w: Json) => w.code);
    assert.deepEqual(codes(neutral), ["OWNER_LINE_PARSED"]);
    assert.deepEqual(codes(old), ["OWNER_LINE_PARSED", "OLD_SPELLING"]);
    assert.deepEqual(codes(named), ["OWNER_LINE_PARSED", "OLD_SPELLING"]);
    const rows = await raw.query("select spec from blockers b join tasks t on t.id = b.task_id where t.key = $1 order by b.created_at", [key]);
    assert.deepEqual(rows.rows.map((r) => [r.spec.assignee, r.spec.text]), [["owner", "rotate the token"], ["owner", "sign the form"], ["owner", "approve the listing"]]);
  });

  test("list_tasks reads the old status and says so; an agent may not write as owner or as the old name", async () => {
    const key = (await callWith(client, "create_task", { title: "Asked", ...T, status: "Ready" })).key as string;
    const asked = await callWith(client, "ask", { key, question: "¿Cuál?", options: ["a", "b"] });
    assert.equal(asked.__error, undefined, JSON.stringify(asked));
    const neutral = await callWith(client, "list_tasks", { status: "Needs owner" });
    const old = await callWith(client, "list_tasks", { status: "Needs Jorge" });
    assert.deepEqual(old.tasks.map((t: Json) => t.key), neutral.tasks.map((t: Json) => t.key));
    assert.ok(neutral.tasks.some((t: Json) => t.key === key));
    assert.equal(neutral.warnings, undefined);
    assert.equal(old.warnings[0].code, "OLD_SPELLING");
    for (const agent of ["owner", "Jorge"]) {
      const r = await callWith(client, "set_task", { key, note: "hola", actor: { ...A, agent } });
      assert.equal(r.__error, "RESERVED_ACTOR", agent);
    }
  });
});

describe("check 2: migration 0062 on a database with the old values", () => {
  const SQL = readFileSync(path.join(ROOT, "drizzle/migrations/0062_owner_neutral.sql"), "utf8");
  const snapshot = async () =>
    (
      await raw.query(`select md5(string_agg(x, '|' order by x)) as h from (
        select t::text as x from tasks t union all select e::text from events e union all select b::text from blockers b
        union all select a::text from audit_runs a union all select m::text from thread_messages m union all select c::text from task_comments c
        union all select o::text from owner_profile o) s`)
    ).rows[0].h as string;

  test("old rows read and write correctly after it, and a second run changes nothing", async () => {
    owner.resetOwnerName(null);
    const client = await connect();
    const key = (await callWith(client, "create_task", { title: "Legacy", ...T, status: "Ready" })).key as string;
    const asked = await callWith(client, "ask", { key, question: "¿Sigue?", options: ["sí", "no"] });
    const t = (await raw.query("select id, project_id from tasks where key = $1", [key])).rows[0];
    // What a database from before protocol 2.24 holds.
    await raw.query("update tasks set status = 'Needs Jorge', origin = 'jorge' where id = $1", [t.id]);
    await raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload) values ($1, $2, $3, 'task.status', '{"agent":"jorge","session_id":"web","machine":"screen"}', '{"from":"Ready","to":"Needs Jorge"}')`, [t.project_id, t.id, key]);
    await raw.query(`insert into events (project_id, task_id, task_key, type, actor, payload) values ($1, $2, $3, 'note', '{"agent":"test-agent","session_id":"s1"}', '{"text":"Jorge pidió esto: lo dejo como estaba"}')`, [t.project_id, t.id, key]);
    await raw.query(`insert into blockers (task_id, type, spec) values ($1, 'human_action', '{"assignee":"jorge","text":"firmar","source":"parsed","field":"next_action","line_hash":"abc"}')`, [t.id]);
    await raw.query(`insert into audit_runs (project_id, count, findings) values ($1, 1, '[{"code":"WAITING_ON_JORGE_FREE_TEXT","key":"${key}","detail":"waits on Jorge","fix_hint":"ask"}]') on conflict (project_id) do update set findings = excluded.findings`, [t.project_id]);
    await raw.query("insert into task_comments (task_id, author_agent, body) values ($1, 'jorge', 'Jorge dice hola')", [t.id]);
    const th = (await raw.query("insert into threads (kind, project_id) values ('project', $1) returning id", [t.project_id])).rows[0].id;
    await raw.query("insert into thread_messages (thread_id, author_agent, author_role, body) values ($1, 'jorge', 'ceo', 'hola')", [th]);

    await raw.query(SQL);
    const row = (await raw.query("select status, origin from tasks where id = $1", [t.id])).rows[0];
    assert.deepEqual(row, { status: "Needs owner", origin: "owner" });
    const ev = (await raw.query("select actor->>'agent' as agent, payload from events where task_id = $1 and type in ('task.status', 'note') order by id", [t.id])).rows;
    assert.ok(ev.some((e) => e.agent === "owner" && e.payload.to === "Needs owner"));
    assert.ok(ev.some((e) => e.payload.text === "Jorge pidió esto: lo dejo como estaba"), "free text stays as written");
    assert.equal((await raw.query("select spec->>'assignee' as a from blockers where task_id = $1", [t.id])).rows[0].a, "owner");
    assert.equal((await raw.query("select findings->0->>'code' as c from audit_runs where project_id = $1", [t.project_id])).rows[0].c, "WAITING_ON_OWNER_FREE_TEXT");
    assert.equal((await raw.query("select author_agent from task_comments where task_id = $1", [t.id])).rows[0].author_agent, "owner");
    assert.equal((await raw.query("select author_agent from thread_messages where thread_id = $1", [th])).rows[0].author_agent, "owner");

    // Reads and writes work on the migrated rows.
    assert.equal((await callWith(client, "get_task", { key })).status, "Needs owner");
    assert.ok((await callWith(client, "list_tasks", { status: "Needs owner" })).tasks.some((x: Json) => x.key === key));
    const answered = await callWith(client, "answer", { question_id: asked.question.id, answer: "sí" });
    assert.equal(answered.__error, undefined, JSON.stringify(answered));
    assert.notEqual((await callWith(client, "get_task", { key })).status, "Needs owner");

    const once = await snapshot();
    await raw.query(SQL);
    assert.equal(await snapshot(), once, "a second run changes nothing");
    await client.close();
  });
});

test("check 4: the protocol version moved and the README tables carry the neutral names", () => {
  assert.equal(PROTOCOL_VERSION, "2.26");
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /WAITING_ON_OWNER_FREE_TEXT|Needs owner/);
  assert.doesNotMatch(readme.slice(readme.indexOf("<!-- mcp-tools:start -->"), readme.indexOf("<!-- errors:end -->")), /delegated_by_jorge.*\|.*required|RESERVED_ACTOR.*jorge/i);
});
