// PLA-I1-4: register_footprint / release_footprint, the footprint in get_task and get_context, and
// the port lease shown on the observed server.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { releaseFootprint, normalizeLocator } = await import("../src/mcp/footprint.js");
const { reconcile } = await import("../src/jobs/machine/reconcile.js");
const { machineInventory, machineTotals } = await import("../src/jobs/machine/index.js");
const { bus } = await import("../src/events.js");
const { webCtx } = await import("../src/mcp/tx.js");

import type { Directory, Observed } from "../src/jobs/machine/infer.js";

type Json = Record<string, any>;
const A = { agent: "claude", session_id: "s1", machine: "test-mac" };
const B = { agent: "codex", session_id: "s2", machine: "test-mac" };
const P = { project: "zigzag" };
const T = { scope: "s", checks: ["c"] };

let client: Client;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  let data: Json;
  try {
    data = JSON.parse(r.content[0]!.text);
  } catch {
    return { __error: "INVALID_INPUT", __text: r.content[0]!.text };
  }
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}
const rows = async (locator: string) => (await raw.query("select * from footprints where locator = $1 order by created_at", [locator])).rows;

// The job's side, by hand: what a tick would pass to reconcile for one machine.
const emptyDir = (): Directory => ({ projects: [], repos: [], worktrees: new Map(), tasksById: new Map(), tasksByKey: new Map(), branchOwner: new Map(), claimed: [] });
async function observe(items: Observed[], min: number, machine = "test-mac") {
  const dir = emptyDir();
  return reconcile(db, {
    machine,
    now: new Date(Date.UTC(2026, 9, 9, 12, min, 0)),
    dir,
    inferred: items.map((item) => ({ item, owner: { projectId: null, taskId: null, sessionId: null, repo: null, via: "none" as const }, repoPath: null })),
    ran: new Set(["ports", "procs"]),
  });
}
const server = (port: number, extra: Record<string, unknown> = {}): Observed => ({ kind: "server", locator: `port:${port}`, details: { port, pid: 1000 + port, ...extra } });

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  await call("create_task", { ...P, kind: "initiative", title: "Scratch", scope: "PRD", integration_branch: "jl/scratch" }); // ZIG-I1
  await call("create_task", { ...P, title: "One", ...T, parent_key: "ZIG-I1", status: "Ready" }); // ZIG-I1-1
  await call("create_task", { ...P, title: "Two", ...T, parent_key: "ZIG-I1", status: "Ready" }); // ZIG-I1-2
  await call("claim", { ...P, key: "ZIG-I1-1", workspace: { worktree_path: "/w/one", branch: "jl/scratch" } });
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("locators", () => {
  test("accepted spellings become the forms the job writes", () => {
    assert.equal(normalizeLocator("server", "3069"), "port:3069");
    assert.equal(normalizeLocator("server", ":3069"), "port:3069");
    assert.equal(normalizeLocator("server", "localhost:3069"), "port:3069");
    assert.equal(normalizeLocator("db_server", "5433"), "postgres:5433");
    assert.equal(normalizeLocator("db_server", "redis:6379"), "redis:6379");
    assert.equal(normalizeLocator("database", "zigzag_zig_i1_scratch"), "zigzag_zig_i1_scratch@127.0.0.1:5432");
    assert.equal(normalizeLocator("database", "zigzag@5433"), "zigzag@127.0.0.1:5433");
    assert.equal(normalizeLocator("database", "zigzag@localhost:5433"), "zigzag@127.0.0.1:5433");
    assert.equal(normalizeLocator("database", "zigzag@127.0.0.1:5433"), "zigzag@127.0.0.1:5433");
    assert.equal(normalizeLocator("worktree", "/w/one/"), "/w/one");
    assert.equal(normalizeLocator("browser", "4242"), "pid:4242");
    assert.equal(normalizeLocator("service", "BREW:postgresql@17"), "brew:postgresql@17");
    assert.equal(normalizeLocator("container", "pg-test"), "docker:pg-test");
  });

  test("a locator that does not fit its kind is INVALID_FOOTPRINT", async () => {
    for (const [kind, locator] of [["server", "web"], ["server", "70000"], ["worktree", "relative/path"], ["service", "postgresql"], ["database", "a b@x"]] as const) {
      const r = await call("register_footprint", { ...P, kind, locator, purpose: "p", teardown: "t" });
      assert.equal(r.__error, "INVALID_FOOTPRINT", `${kind} ${locator}`);
      assert.equal(r.__status, 400);
      assert.equal(r.field, "locator");
    }
    assert.equal((await call("register_footprint", { ...P, kind: "server", locator: "3069", purpose: "  ", teardown: "t" })).field, "purpose");
    assert.equal((await call("register_footprint", { ...P, kind: "server", locator: "3069", purpose: "p", teardown: " " })).field, "teardown");
    const noMachine = await call("register_footprint", { ...P, kind: "server", locator: "3069", purpose: "p", teardown: "t", actor: { agent: "claude", session_id: "s1" } });
    assert.deepEqual([noMachine.__error, noMachine.field], ["INVALID_FOOTPRINT", "machine"]);
  });
});

describe("register_footprint", () => {
  test("a declaration with no observed row is its own row; the task defaults to the session's only claim", async () => {
    const heard: string[] = [];
    const off = bus.subscribe((e) => heard.push(`${e.type}:${e.project}`));
    const r = await call("register_footprint", { ...P, kind: "container", locator: "pg-test", purpose: "scratch Postgres", teardown: "docker rm -f pg-test", details: { image: "postgres:17" } });
    off();
    assert.equal(r.footprint.locator, "docker:pg-test");
    assert.deepEqual([r.footprint.source, r.footprint.state, r.footprint.task_key, r.merged], ["declared", "live", "ZIG-I1-1", false]);
    assert.ok(heard.includes("footprint:"));
    const [row] = await rows("docker:pg-test");
    assert.deepEqual([row.machine, row.session_id, row.holder.agent, row.details.image, row.details.declared.image], ["test-mac", "s1", "claude", "postgres:17", "postgres:17"]);
    assert.ok(row.declared_at);
    const ev = await raw.query("select type, task_key, payload from events where type = 'footprint.declared'");
    assert.equal(ev.rows.length, 1);
    assert.deepEqual([ev.rows[0].task_key, ev.rows[0].payload.locator, ev.rows[0].payload.teardown], ["ZIG-I1-1", "docker:pg-test", "docker rm -f pg-test"]);
  });

  test("with zero or several claims the task stays empty; task_key names it; an unknown key is TASK_NOT_FOUND", async () => {
    const none = await call("register_footprint", { ...P, kind: "tunnel", locator: "9001", purpose: "demo", teardown: "kill 9001", actor: B });
    assert.equal(none.footprint.task_key, null);
    await call("claim", { ...P, key: "ZIG-I1-2", workspace: { worktree_path: "/w/two", branch: "jl/scratch" } });
    const two = await call("register_footprint", { ...P, kind: "tunnel", locator: "9002", purpose: "demo", teardown: "kill 9002" });
    assert.equal(two.footprint.task_key, null, "s1 now holds two claims");
    const named = await call("register_footprint", { ...P, kind: "tunnel", locator: "9002", purpose: "demo", teardown: "kill 9002", task_key: "ZIG-I1-2" });
    assert.equal(named.footprint.task_key, "ZIG-I1-2");
    assert.equal((await call("register_footprint", { ...P, kind: "tunnel", locator: "9003", purpose: "d", teardown: "t", task_key: "ZIG-99" })).__error, "TASK_NOT_FOUND");
    await call("claim", { ...P, key: "ZIG-I1-2", action: "release" });
  });

  test("something the job already sees merges into its row (source both) and survives the next tick", async () => {
    await observe([server(3069, { command: "next dev" })], 0);
    const [seen] = await rows("port:3069");
    assert.deepEqual([seen.source, seen.state, seen.holder, seen.task_id], ["observed", "orphan", null, null]);

    const r = await call("register_footprint", { ...P, kind: "server", locator: ":3069", purpose: "zigzag dev server", teardown: "kill 1069", details: { flavor: "next" } });
    assert.deepEqual([r.merged, r.footprint.source, r.footprint.state, r.footprint.task_key], [true, "both", "live", "ZIG-I1-1"]);
    assert.equal((await rows("port:3069")).length, 1, "one row, not two");
    const merged = (await rows("port:3069"))[0];
    assert.equal(merged.id, seen.id);
    assert.deepEqual([merged.purpose, merged.teardown, merged.session_id, merged.details.pid, merged.details.declared.flavor], ["zigzag dev server", "kill 1069", "s1", 4069, "next"]);

    // The job keeps seeing it: its details refresh, the declaration is not overwritten.
    await observe([server(3069, { command: "next dev --turbopack" })], 1);
    const after = (await rows("port:3069"))[0];
    assert.deepEqual([after.source, after.state, after.purpose, after.teardown, after.task_id === merged.task_id, after.details.command, after.details.declared.flavor], ["both", "live", "zigzag dev server", "kill 1069", true, "next dev --turbopack", "next"]);
    // Gone logic skips declared rows: two ticks that do not see it leave it as it was.
    await observe([], 2);
    await observe([], 3);
    assert.equal((await rows("port:3069"))[0].state, "live");
  });

  test("a declared-only row is confirmed as both once the job sees it", async () => {
    await call("register_footprint", { ...P, kind: "server", locator: "3070", purpose: "second dev server", teardown: "kill 1070" });
    assert.equal((await rows("port:3070"))[0].source, "declared");
    await observe([server(3070)], 4);
    const row = (await rows("port:3070"))[0];
    assert.deepEqual([row.source, row.state, row.purpose], ["both", "live", "second dev server"]);
  });

  test("another live session gets FOOTPRINT_HELD with the holder and purpose; the holder updates its own", async () => {
    const held = await call("register_footprint", { ...P, kind: "server", locator: "3070", purpose: "mine now", teardown: "kill 1", actor: B });
    assert.deepEqual([held.__error, held.__status, held.holder.session_id, held.purpose], ["FOOTPRINT_HELD", 409, "s1", "second dev server"]);
    const again = await call("register_footprint", { ...P, kind: "server", locator: "3070", purpose: "second dev server (v2)", teardown: "kill 1070" });
    assert.equal(again.footprint.purpose, "second dev server (v2)");
    assert.equal((await rows("port:3070")).length, 1);
  });

  test("when the holder's session no longer holds a claim, another session may take the row over", async () => {
    await call("register_footprint", { ...P, kind: "tunnel", locator: "9100", purpose: "old", teardown: "kill 9100", actor: B }); // s2 holds no claim
    const taken = await call("register_footprint", { ...P, kind: "tunnel", locator: "9100", purpose: "new owner", teardown: "kill 9100" });
    assert.equal(taken.footprint.purpose, "new owner");
    const ev = await raw.query("select payload from events where type = 'footprint.declared' and payload->>'locator' = 'pid:9100' order by id desc limit 1");
    assert.equal(ev.rows[0].payload.took_over_from.session_id, "s2");
  });

  test("the caller's machine spelled differently lands on the job's row", async () => {
    await observe([server(3071)], 5, "Test-Mac-2.local");
    const r = await call("register_footprint", { ...P, kind: "server", locator: "3071", purpose: "p", teardown: "t", actor: { ...A, machine: "test-mac-2" } });
    assert.equal(r.merged, true);
    assert.equal((await rows("port:3071")).length, 1);
    assert.equal((await rows("port:3071"))[0].machine, "Test-Mac-2.local");
  });
});

describe("release_footprint", () => {
  test("only the holder or Jorge releases: another session gets FOOTPRINT_HELD, the holder and the screen succeed", async () => {
    await call("register_footprint", { ...P, kind: "container", locator: "redis-test", purpose: "cache", teardown: "docker rm -f redis-test" });
    const held = await call("release_footprint", { ...P, locator: "docker:redis-test", actor: B });
    assert.deepEqual([held.__error, held.holder.session_id], ["FOOTPRINT_HELD", "s1"]);
    assert.equal((await rows("docker:redis-test"))[0].released_at, null);

    const human = await releaseFootprint(db, { project: "zigzag", locator: "redis-test", machine: "test-mac" }, { ...webCtx });
    assert.deepEqual([human.released, human.kind], [true, "container"]);
    const row = (await rows("docker:redis-test"))[0];
    assert.deepEqual([row.state, row.released_at !== null], ["released", true]);
    const ev = await raw.query("select task_key, payload from events where type = 'footprint.released' and payload->>'locator' = 'docker:redis-test'");
    assert.equal(ev.rows.length, 1);
    assert.equal(ev.rows[0].payload.reason, "released by Jorge");

    const mine = await call("release_footprint", { ...P, locator: "docker:pg-test", kind: "container" });
    assert.deepEqual([mine.released, mine.footprint.state], [true, "released"]);
  });

  test("an unknown locator is {released: false}; a bad one is INVALID_FOOTPRINT", async () => {
    assert.deepEqual(await call("release_footprint", { ...P, locator: "3999" }), { locator: "3999", released: false });
    assert.equal((await call("release_footprint", { ...P, locator: "not a locator!", kind: "server" })).__error, "INVALID_FOOTPRINT");
  });

  test("a bare number that fits several kinds needs kind", async () => {
    await call("register_footprint", { ...P, kind: "browser", locator: "4000", purpose: "playwright", teardown: "kill 4000" });
    await call("register_footprint", { ...P, kind: "server", locator: "4000", purpose: "dev", teardown: "kill 1" });
    const r = await call("release_footprint", { ...P, locator: "4000" });
    assert.deepEqual([r.__error, r.field, r.kinds.sort()], ["INVALID_FOOTPRINT", "kind", ["browser", "server"]]);
    assert.equal((await call("release_footprint", { ...P, locator: "4000", kind: "browser" })).released, true);
    assert.equal((await call("release_footprint", { ...P, locator: "4000" })).kind, "server", "only one left: no ambiguity");
  });

  test("releasing something still running: the next tick sees it again as a new observed row", async () => {
    await observe([server(3080)], 6);
    await call("register_footprint", { ...P, kind: "server", locator: "3080", purpose: "dev", teardown: "kill 1080" });
    assert.equal((await call("release_footprint", { ...P, locator: "3080" })).released, true);
    assert.equal((await machineInventory(db, "test-mac")).some((r) => r.locator === "port:3080"), false, "out of the inventory");

    const tick = await observe([server(3080)], 7);
    assert.equal(tick.seen, 1);
    const all = await rows("port:3080");
    assert.equal(all.length, 2);
    assert.deepEqual([all[0].released_at !== null, all[0].source], [true, "both"]);
    assert.deepEqual([all[1].released_at, all[1].source, all[1].holder, all[1].state], [null, "observed", null, "orphan"]);
    assert.equal((await machineInventory(db, "test-mac")).filter((r) => r.locator === "port:3080").length, 1);
  });

  test("an observed row has no holder: a session of the project may say it is gone", async () => {
    await observe([server(3081)], 8);
    const r = await call("release_footprint", { ...P, locator: "3081", actor: B });
    assert.equal(r.released, true);
  });
});

describe("footprint in get_task, get_context and the inventory", () => {
  test("get_task lists the ticket's live footprint; released rows drop out", async () => {
    const t = await call("get_task", { ...P, key: "ZIG-I1-1" });
    const by = Object.fromEntries(t.footprint.map((f: Json) => [f.locator, f]));
    assert.ok(by["port:3069"] && by["port:3070"] && by["pid:9100"]);
    assert.deepEqual(Object.keys(by["port:3069"]).sort(), ["kind", "last_seen_at", "locator", "machine", "purpose", "source", "state", "teardown"]);
    assert.deepEqual([by["port:3069"].purpose, by["port:3069"].teardown, by["port:3069"].source], ["zigzag dev server", "kill 1069", "both"]);
    assert.equal(by["docker:pg-test"], undefined, "released");
    assert.deepEqual((await call("get_task", { ...P, key: "ZIG-I1-2", view: "full" })).footprint.map((f: Json) => f.locator), ["pid:9002"]);
  });

  test("get_context carries the tickets' footprint and, separately, what the calling session registered", async () => {
    const c = await call("get_context", { ...P, workspace: { branch: "jl/scratch", worktree_path: "/w/one", machine: "test-mac" }, session_id: "s1" });
    const mine = c.my_footprint.map((f: Json) => f.locator);
    assert.ok(mine.includes("port:3069") && mine.includes("port:3070"));
    assert.ok(c.footprint.every((f: Json) => ["ZIG-I1-1", "ZIG-I1-2", "ZIG-I1"].includes(f.task_key)));
    assert.ok(c.footprint.some((f: Json) => f.locator === "port:3069" && f.task_key === "ZIG-I1-1"));
    const other = await call("get_context", { ...P, workspace: { branch: "jl/scratch" }, session_id: "s9" });
    assert.deepEqual(other.my_footprint, []);
  });

  test("a port lease shows on the server seen on that port, read at join time", async () => {
    await observe([server(3090, { command: "vite" })], 9);
    const before = (await machineInventory(db, "test-mac")).find((r) => r.locator === "port:3090")!;
    assert.equal(before.lease, null);
    await call("lease_resource", { ...P, name: "port:3090", purpose: "zigzag preview", ttl_minutes: 30 });
    const row = (await machineInventory(db)).find((r) => r.locator === "port:3090")!;
    assert.deepEqual([row.lease?.name, row.lease?.purpose, row.lease?.holder.session_id, row.lease?.project], ["port:3090@test-mac", "zigzag preview", "s1", "zigzag"]);
    await call("release_resource", { ...P, name: "port:3090" });
    assert.equal((await machineInventory(db)).find((r) => r.locator === "port:3090")!.lease, null, "released leases leave the row");
    await call("lease_resource", { ...P, name: "port:3090@elsewhere", purpose: "x" });
    assert.equal((await machineInventory(db)).find((r) => r.locator === "port:3090")!.lease, null, "another machine's lease is not this server");
  });

  test("the inventory names the initiative above the ticket, and the totals count servers, databases, worktree disk, orphans", async () => {
    const inv = await machineInventory(db, "test-mac");
    const dev = inv.find((r) => r.locator === "port:3069")!;
    assert.deepEqual([dev.task_key, dev.initiative_key, dev.initiative_title], ["ZIG-I1-1", "ZIG-I1", "Scratch"]);
    const totals = machineTotals([
      { kind: "server", state: "live", details: {} },
      { kind: "server", state: "gone", details: {} },
      { kind: "database", state: "orphan", details: {} },
      { kind: "worktree", state: "live", details: { size_kb: 1000 } },
      { kind: "worktree", state: "stale", details: { size_kb: 500 } },
    ]);
    assert.deepEqual(totals, { servers: 1, databases: 1, worktree_kb: 1500, orphan: 1, stale: 1 });
  });
});
