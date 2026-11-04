// PLA-I1-6: the ticket's live footprint follows it through handoff, Done / Won't do (a warning, not a
// gate) and the claim.expiring event.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { setTask } = await import("../src/mcp/writes.js");
const { warnExpiringLeases } = await import("../src/jobs/leases.js");
const { webCtx } = await import("../src/mcp/tx.js");

type Json = Record<string, any>;
const A = { agent: "claude", session_id: "s1", machine: "test-mac" };
const P = { project: "zigzag" };

let client: Client;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;

async function call(name: string, args: Json): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, ...data } : data;
}
const register = (kind: string, locator: string, teardown: string, key?: string) =>
  call("register_footprint", { ...P, kind, locator, purpose: `${kind} for the test`, teardown, ...(key ? { task_key: key } : {}) });

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
  for (const title of ["One", "Two", "Three", "Four"]) {
    await call("create_task", { ...P, title, scope: "s", work_type: "decision-needed", parent_key: "ZIG-I1", status: "Ready" }); // ZIG-I1-1..4
  }
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("handoff carries the live footprint", () => {
  test("the reply and the stored handoff list what the ticket still has running; gone and released rows are left out", async () => {
    await call("claim", { ...P, key: "ZIG-I1-1", workspace: { worktree_path: "/w/one", branch: "jl/scratch" } });
    await register("server", "4200", "kill 4200", "ZIG-I1-1");
    await register("container", "pg-hand", "docker rm -f pg-hand", "ZIG-I1-1");
    await register("tunnel", "4300", "kill 4300", "ZIG-I1-1");
    await register("browser", "4400", "kill 4400", "ZIG-I1-1");
    await raw.query("update footprints set state = 'gone' where locator = 'pid:4300'");
    await call("release_footprint", { ...P, locator: "4400", kind: "browser" });

    const h = await call("handoff", { ...P, key: "ZIG-I1-1", to: "open", note: "server on 4200 is running; the scratch Postgres is in docker" });
    const listed = h.footprint.map((f: Json) => f.locator).sort();
    assert.deepEqual(listed, ["docker:pg-hand", "port:4200"]);
    assert.deepEqual(h.handoff.footprint.map((f: Json) => f.locator).sort(), listed, "the stored handoff holds the same list");
    const server = h.footprint.find((f: Json) => f.locator === "port:4200");
    assert.deepEqual([server.kind, server.teardown, server.purpose], ["server", "kill 4200", "server for the test"]);

    // the receiver gets it back with the claim
    const taken = await call("claim", { ...P, key: "ZIG-I1-1", actor: { ...A, session_id: "s2" }, workspace: { worktree_path: "/w/one", branch: "jl/scratch" } });
    assert.deepEqual(taken.handoff.footprint.map((f: Json) => f.locator).sort(), listed);
    const stored = (await raw.query("select handoff from tasks where key = 'ZIG-I1-1'")).rows[0];
    assert.equal(stored.handoff, null, "claimed: the hold is cleared");
    const ev = await raw.query("select payload from events where type = 'claim.handoff' and task_key = 'ZIG-I1-1'");
    assert.deepEqual(ev.rows[0].payload.footprint.map((f: Json) => f.locator).sort(), listed);
  });

  test("a ticket with nothing running hands off an empty list", async () => {
    await call("claim", { ...P, key: "ZIG-I1-4", workspace: { worktree_path: "/w/four", branch: "jl/scratch" } });
    const h = await call("handoff", { ...P, key: "ZIG-I1-4", to: "open", note: "nothing running" });
    assert.deepEqual([h.footprint, h.handoff.footprint], [[], []]);
  });
});

describe("Done and Won't do warn about what is still running", () => {
  test("Done succeeds, with one FOOTPRINT_LIVE warning per live item naming its kind, locator and teardown", async () => {
    await call("claim", { ...P, key: "ZIG-I1-2", workspace: { worktree_path: "/w/two", branch: "jl/scratch" } });
    await register("server", "4201", "kill 4201", "ZIG-I1-2");
    await register("database", "zigzag_zig_i1_2_copy@5433", "dropdb -p 5433 zigzag_zig_i1_2_copy", "ZIG-I1-2");
    await register("browser", "4401", "kill 4401", "ZIG-I1-2");
    await register("tunnel", "4301", "kill 4301", "ZIG-I1-2");
    await raw.query("update footprints set state = 'gone' where locator = 'pid:4401'");
    await call("release_footprint", { ...P, locator: "4301", kind: "tunnel" });

    const t = await call("get_task", { ...P, key: "ZIG-I1-2" });
    const done = await call("set_task", { ...P, key: "ZIG-I1-2", status: "Done", version: t.version });
    assert.equal(done.__error, undefined);
    assert.equal(done.status, "Done", "a warning, not a gate");
    const warnings = done.warnings.filter((w: Json) => w.code === "FOOTPRINT_LIVE");
    assert.deepEqual(
      warnings.map((w: Json) => [w.kind, w.locator, w.teardown]).sort(),
      [["database", "zigzag_zig_i1_2_copy@127.0.0.1:5433", "dropdb -p 5433 zigzag_zig_i1_2_copy"], ["server", "port:4201", "kill 4201"]],
    );
    assert.deepEqual(Object.keys(warnings[0]).sort(), ["code", "kind", "locator", "teardown"]);
    // the row is still there: Plania only names it
    assert.equal((await raw.query("select 1 from footprints where locator = 'port:4201' and released_at is null")).rowCount, 1);
  });

  test("a ticket with nothing live closes with no warnings at all", async () => {
    await call("claim", { ...P, key: "ZIG-I1-3", workspace: { worktree_path: "/w/three", branch: "jl/scratch" } });
    const t = await call("get_task", { ...P, key: "ZIG-I1-3" });
    const done = await call("set_task", { ...P, key: "ZIG-I1-3", status: "Done", version: t.version });
    assert.equal(done.status, "Done");
    assert.equal(done.warnings, undefined);
  });

  test("Won't do from the screen names what is left to clean", async () => {
    await register("server", "4202", "kill 4202", "ZIG-I1-4");
    const t = await call("get_task", { ...P, key: "ZIG-I1-4" });
    const reply = await setTask(db, { project: "zigzag", key: "ZIG-I1-4", status: "Won't do", version: t.version, reason: "en pantalla" }, { ...webCtx, verbose: true });
    assert.equal(reply.status, "Won't do");
    assert.deepEqual(reply.warnings, [{ code: "FOOTPRINT_LIVE", kind: "server", locator: "port:4202", teardown: "kill 4202" }]);
  });

  test("a status change that is not closing does not warn", async () => {
    await call("create_task", { ...P, title: "Five", scope: "s", work_type: "decision-needed", parent_key: "ZIG-I1", status: "Backlog" });
    await register("server", "4203", "kill 4203", "ZIG-I1-5");
    const t = await call("get_task", { ...P, key: "ZIG-I1-5" });
    const moved = await call("set_task", { ...P, key: "ZIG-I1-5", status: "Ready", version: t.version });
    assert.equal(moved.warnings, undefined);
  });
});

describe("claim.expiring carries the footprint", () => {
  test("the event payload lists the ticket's live footprint as kind, locator and teardown", async () => {
    await call("create_task", { ...P, title: "Six", scope: "s", work_type: "decision-needed", parent_key: "ZIG-I1", status: "Ready" }); // ZIG-I1-6
    await call("claim", { ...P, key: "ZIG-I1-6", ttl_minutes: 5, workspace: { worktree_path: "/w/six", branch: "jl/scratch" } });
    await register("server", "4204", "kill 4204", "ZIG-I1-6");
    await register("service", "launchagent:com.example.six", "launchctl unload ~/Library/LaunchAgents/com.example.six.plist", "ZIG-I1-6");
    await register("cache", "fixtures/six", "rm -rf fixtures/six", "ZIG-I1-6");
    await call("release_footprint", { ...P, locator: "fixtures/six", kind: "cache" });

    assert.equal(await warnExpiringLeases(db, new Date()), 1);
    const ev = (await call("list_events", { ...P, key: "ZIG-I1-6", types: ["claim.expiring"] })).events;
    assert.equal(ev.length, 1);
    assert.deepEqual(
      ev[0].payload.footprint.sort((a: Json, b: Json) => a.locator.localeCompare(b.locator)),
      [
        { kind: "service", locator: "launchagent:com.example.six", teardown: "launchctl unload ~/Library/LaunchAgents/com.example.six.plist" },
        { kind: "server", locator: "port:4204", teardown: "kill 4204" },
      ].sort((a, b) => a.locator.localeCompare(b.locator)),
    );
    assert.equal(ev[0].payload.owner.session_id, "s1");
  });

  test("a ticket with nothing running gets an empty list", async () => {
    await call("create_task", { ...P, title: "Seven", scope: "s", work_type: "decision-needed", parent_key: "ZIG-I1", status: "Ready" }); // ZIG-I1-7
    await call("claim", { ...P, key: "ZIG-I1-7", ttl_minutes: 5, workspace: { worktree_path: "/w/seven", branch: "jl/scratch" } });
    assert.equal(await warnExpiringLeases(db, new Date()), 1);
    const ev = (await call("list_events", { ...P, key: "ZIG-I1-7", types: ["claim.expiring"] })).events;
    assert.deepEqual(ev[0].payload.footprint, []);
  });
});
