// 2.10 item 1: "Jorge:" lines become human_action blockers, and the inbox speaks in three tones.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { parseJorgeLines } = await import("../src/mcp/jorge-lines.js");
const { resolveHumanAction } = await import("../src/mcp/blockers.js");
const { findProject } = await import("../src/mcp/queries.js");
const { WEB_ACTOR, webCtx, writeTx } = await import("../src/mcp/tx.js");
const { inbox } = await import("../src/mcp/inbox.js");
const { auditProject } = await import("../src/mcp/audit.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s1", machine: "MacBook-Air" };
const P = { project: "zigzag" };
const T = { scope: "s", checks: ["c"] };

let client: Client;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  return r.isError ? { __error: data.error, ...data } : data;
}
const get = (key: string) => call("get_task", { ...P, key });
const humanActions = async (key: string) => (await get(key)).blocked_by.filter((b: Json) => b.type === "human_action");

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("parseJorgeLines", () => {
  test("the seven live findings of 2026-10-15", () => {
    // FIL-I2 next_action
    assert.deepEqual(
      parseJorgeLines("Jorge: crear el cliente OAuth de Google y poner GOOGLE_CLIENT_ID/SECRET en Vercel producción (hoy googleEnabled:false). Luego un agente prueba FIL-04 (web, PWA iOS, alta nueva → /bienvenida).").map((l) => l.text),
      ["crear el cliente OAuth de Google y poner GOOGLE_CLIENT_ID/SECRET en Vercel producción (hoy googleEnabled:false). Luego un agente prueba FIL-04 (web, PWA iOS, alta nueva → /bienvenida)."],
    );
    // ZIG-I21-1..4 blocked_note: the sentence that says it waits on him.
    for (const what of ["phone capture", "phone test"]) {
      const lines = parseJorgeLines(`Prod now contains df2f69a (main 09bc321 deployed 2026-10-15 05:47 UTC). Only check 2 is left and it is Jorge's ${what}, so this waits on him as a human action.`);
      assert.deepEqual(lines.map((l) => l.text), [`Only check 2 is left and it is Jorge's ${what}, so this waits on him as a human action.`]);
    }
    // ZIG-I21 next_action: two asks in one line.
    const i21 = parseJorgeLines(
      "Claim ZIG-I21-6 (Ready): install the Android emulator with Jorge's OK, have him sign in once, run the checklist over adb against prod and record the evidence on I21-1…4 and I21-5. Then Jorge's phone run (human action on I21-5), close the five tickets and mark the initiative Done. ZIG-I21-7 (test aviso button) is optional.",
    );
    assert.equal(i21.length, 2);
    assert.match(i21[0]!.text, /^Claim ZIG-I21-6/);
    assert.match(i21[1]!.text, /^Then Jorge's phone run/);
    // ZIG-I22 next_action: "when Jorge says so".
    const i22 = parseJorgeLines("On hold by Jorge: no phase is to be claimed. The Android SDK and emulator are installed by ZIG-I21-6 (ZIG-I21) so the tooling is ready. When Jorge says so, move ZIG-I22 back to Active and ZIG-I22-1 + ZIG-I22-3 to Ready.");
    assert.deepEqual(i22.map((l) => l.text), ["When Jorge says so, move ZIG-I22 back to Active and ZIG-I22-1 + ZIG-I22-3 to Ready."]);
  });

  test("conservative: list markers and case, but no reports of what Jorge did", () => {
    assert.deepEqual(parseJorgeLines("- JORGE: merge sandbox → main\n2. jorge: rotate the key").map((l) => l.text), ["merge sandbox → main", "rotate the key"]);
    assert.deepEqual(parseJorgeLines("Jorge approved the plan. Jorge decided to drop Vercel."), []);
    // Present-tense asks from the live data of 2026-10-15 (MIC-I1, PLA-I3).
    assert.equal(parseJorgeLines("Jorge releases sandbox → main; then the MIC-I1-4 device check on prod").length, 1);
    assert.equal(parseJorgeLines("Waits for PLA-I2 (2.9). Jorge sets settings.release per project first").length, 1);
    assert.deepEqual(parseJorgeLines("Ask the team about it"), []);
    assert.deepEqual(parseJorgeLines(""), []);
    const twice = parseJorgeLines("Jorge: merge it\nJorge:  merge   it");
    assert.equal(twice.length, 1, "same line twice, one action");
  });
});

describe("parsed blockers", () => {
  test("a Jorge line in next_action becomes a human action, warns, and the initiative keeps its status", async () => {
    await call("create_task", { ...P, kind: "initiative", title: "Release", scope: "s" }); // ZIG-I1
    let i = await get("ZIG-I1");
    let r = await call("set_task", { ...P, key: "ZIG-I1", status: "Active", version: i.version });
    i = await get("ZIG-I1");
    r = await call("set_task", { ...P, key: "ZIG-I1", next_action: "Jorge: merge sandbox → main\nThen an agent checks prod.", version: i.version });
    assert.equal(r.status, "Active");
    const w = r.warnings.find((x: Json) => x.code === "JORGE_LINE_PARSED");
    assert.ok(w, "warns");
    assert.equal(w.field, "next_action");
    assert.equal(w.fix_hint, "use blocked_by human_action next time");
    const ha = await humanActions("ZIG-I1");
    assert.equal(ha.length, 1);
    assert.equal(ha[0].text, "merge sandbox → main");
    assert.equal(ha[0].source, "parsed");
    assert.equal(ha[0].id, w.blocker_id);
    const events = await call("list_events", { ...P, key: "ZIG-I1" });
    assert.ok(events.events.some((e: Json) => e.type === "blocker.parsed"));
  });

  test("resynced per write: an unchanged line stays, a removed one drops, a done one stays as history", async () => {
    let i = await get("ZIG-I1");
    let r = await call("set_task", { ...P, key: "ZIG-I1", next_action: "Jorge: merge sandbox → main\nJorge: rotate the token", version: i.version });
    assert.equal(r.warnings.filter((x: Json) => x.code === "JORGE_LINE_PARSED").length, 1, "only the new line warns");
    assert.equal((await humanActions("ZIG-I1")).length, 2);
    const rotate = (await humanActions("ZIG-I1")).find((b: Json) => b.text === "rotate the token");
    const p = await findProject(db, "zigzag");
    await writeTx(db, p, webCtx, (tx, emit) => resolveHumanAction(tx, emit, p.id, rotate.id, WEB_ACTOR, "rotated in 1Password"));
    i = await get("ZIG-I1");
    r = await call("set_task", { ...P, key: "ZIG-I1", next_action: "An agent checks prod.", version: i.version });
    const left = await humanActions("ZIG-I1");
    assert.deepEqual(left.map((b: Json) => [b.text, b.satisfied]), [["rotate the token", true]]);
    const log = await call("list_events", { ...P, key: "ZIG-I1" });
    const note = log.events.find((e: Json) => e.type === "note" && e.payload.text === "rotated in 1Password");
    assert.ok(note, "Jorge's note lands in the log");
    assert.equal(note.actor.agent, WEB_ACTOR.agent);
  });

  test("a parsed line does not hold a Ready ticket; one in blocked_note behaves like any blocker", async () => {
    await call("create_task", { ...P, title: "Phone check", ...T, parent_key: "ZIG-I1", status: "Ready", summary: "Jorge: run the checklist on his phone" }); // ZIG-I1-1
    let t = await get("ZIG-I1-1");
    assert.equal(t.status, "Ready");
    assert.equal(t.blocked_by[0].gating, false);
    const c = await call("claim", { ...P, key: "ZIG-I1-1" });
    assert.equal(c.status, "In progress", "claimable");
    t = await get("ZIG-I1-1");
    await call("set_task", { ...P, key: "ZIG-I1-1", status: "Blocked", note: "Only the phone capture is left, so this waits on Jorge.", version: t.version });
    t = await get("ZIG-I1-1");
    assert.equal(t.status, "Blocked");
    const gating = t.blocked_by.find((b: Json) => b.field === "blocked_note");
    assert.equal(gating.gating, true);
    assert.equal((await call("claim", { ...P, key: "ZIG-I1-1" })).__error, "NOT_CLAIMABLE");
    const p = await findProject(db, "zigzag");
    await writeTx(db, p, webCtx, (tx, emit) => resolveHumanAction(tx, emit, p.id, gating.id, WEB_ACTOR));
    assert.equal((await get("ZIG-I1-1")).status, "Ready", "back to Ready once Jorge marks it done");
  });

  test("blocked_by keeps parsed blockers and does not duplicate them", async () => {
    const t = await get("ZIG-I1-1");
    const summary = t.blocked_by.find((b: Json) => b.field === "summary");
    await call("set_task", { ...P, key: "ZIG-I1-1", blocked_by: [{ human_action: { text: summary.text } }, { time_after: "2026-01-01T00:00:00Z" }], version: t.version });
    const after = (await get("ZIG-I1-1")).blocked_by;
    assert.equal(after.filter((b: Json) => b.type === "human_action" && b.text === summary.text).length, 1);
    assert.equal(after.find((b: Json) => b.type === "human_action" && b.text === summary.text).id, summary.id);
  });

  test("a note with a Jorge line parses too; a headline only warns", async () => {
    const r = await call("set_task", { ...P, key: "ZIG-I1", note: "Jorge: approve the Play Store listing" });
    assert.ok(r.warnings.some((w: Json) => w.code === "JORGE_LINE_PARSED" && w.field === "note"));
    const p = await call("get_project", P);
    const h = await call("set_project", { ...P, headline: "Jorge: ship the release", version: p.version });
    assert.ok(h.warnings.some((w: Json) => w.code === "JORGE_LINE_PARSED" && w.field === "headline"));
    const { rows } = await raw.query("select count(*)::int as n from blockers where spec->>'text' = 'ship the release'");
    assert.equal(rows[0].n, 0);
  });
});

describe("inbox tones", () => {
  test("decisiones, pasos, limpieza; count is decisiones + pasos, chores the rest", async () => {
    await call("ask", { ...P, key: "ZIG-I1-1", question: "Which phone?" });
    const p = await findProject(db, "zigzag");
    await raw.query(
      "insert into footprints (project_id, machine, kind, locator, state, first_seen_at, declared_at, details) values ($1, 'MacBook-Air', 'server', 'localhost:9999', 'orphan', now() - interval '2 days', null, '{}')",
      [p.id],
    );
    const box = await inbox(db, p);
    const groups = Object.fromEntries(["decisiones", "pasos", "limpieza"].map((g) => [g, box.items.filter((i) => i.group === g).map((i) => i.kind)]));
    assert.deepEqual(groups.decisiones, ["question"]);
    assert.ok(groups.pasos!.length >= 2 && groups.pasos!.every((k) => k === "human_action"));
    assert.deepEqual(groups.limpieza, ["footprint"]);
    assert.equal(box.count, groups.decisiones!.length + groups.pasos!.length);
    assert.equal(box.chores, 1);
    assert.equal(box.by_project.zigzag, box.count);
  });

  test("the audit stays quiet once a write parsed the line, and says so before", async () => {
    await call("create_task", { ...P, kind: "initiative", title: "Later", scope: "s" }); // ZIG-I2
    // As if written before 2.10: straight into the row, no parse.
    await raw.query("update tasks set next_action = 'When Jorge says so, move it to Active.' where key = 'ZIG-I2'");
    const p = await findProject(db, "zigzag");
    let f = (await auditProject(db, p)).filter((x) => x.code === "WAITING_ON_JORGE_FREE_TEXT" && x.key === "ZIG-I2");
    assert.equal(f.length, 1);
    assert.match(f[0]!.detail, /parser makes it one on the next write/);
    await call("set_task", { ...P, key: "ZIG-I2", note: "touch" });
    f = (await auditProject(db, p)).filter((x) => x.code === "WAITING_ON_JORGE_FREE_TEXT" && x.key === "ZIG-I2");
    assert.equal(f.length, 0, "one write of any kind parses it");
  });
});
