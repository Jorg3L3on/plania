// PLA-I21-2: check_in, alive/idle/stuck thresholds, one wake per agent per hour, limpieza for a past lease.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { inbox } = await import("../src/mcp/inbox.js");
const { findProject } = await import("../src/mcp/queries.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const { sweepStuck } = await import("../src/jobs/stuck.js");

let store: TestStore;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s1" };

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number };
  return data.task ? { ...data, ...data.task } : data;
}

async function version(slug: string): Promise<number> {
  return (await store.get("projects", { slug }))!.version;
}
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "stuck-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await store?.end();
});

test("idle threshold: a claim past it is stuck, a wider project setting stays alive, no claim is idle", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "micasa",
    title: "Held by Taller",
    scope: "Scope",
    checks: ["Done"],
    owner_agent: "taller",
    verbose: true,
  });
  await store.fix(async (uow) => {
    await uow.update("tasks", { key: created.key }, { owner: { agent: "Taller", session_id: "s-taller" }, claimedAt: hours(-3), leaseUntil: hours(1), status: "In progress" });
    await uow.update("agents", { slug: "taller" }, { lastCheckInAt: hours(-3) });
  });

  const stuck = await sweepStuck(db, new Date());
  assert.ok(stuck.stuck >= 1);
  const resumeStuck = await call("get_resume", { project: "micasa" });
  const claim = resumeStuck.claims.find((c: { key: string }) => c.key === created.key);
  assert.equal(claim.owner_agent.slug, "taller");
  assert.equal(claim.owner_agent.status, "stuck");

  const widened = await call("set_project", {
    actor: A,
    project: "micasa",
    version: await version("micasa"),
    settings: { team: { idle_minutes: 1000 } },
  });
  assert.equal(widened.__error, undefined);
  await sweepStuck(db, new Date());
  const alive = (await call("get_resume", { project: "micasa" })).claims.find((c: { key: string }) => c.key === created.key);
  assert.equal(alive.owner_agent.status, "alive");

  await store.fix((uow) => uow.update("tasks", { key: created.key }, { owner: null, claimedAt: null, leaseUntil: null, status: "Ready" }));
  await sweepStuck(db, new Date());
  const listed = await call("list_agents");
  assert.equal(listed.agents.find((a: { slug: string }) => a.slug === "taller").status, "idle");

  await store.fix((uow) => uow.update("tasks", { key: created.key }, { owner: { agent: "Taller", session_id: "s-taller" }, claimedAt: hours(0), leaseUntil: hours(1), status: "In progress" }));
  const beat = await call("check_in", { actor: A, agent: "taller", working_on: created.key, note: "en ello" });
  assert.equal(beat.status, "alive");
  assert.equal(beat.working_on, created.key);
  assert.equal(beat.note, "en ello");
  const rows = (await store.find("tasks", { key: created.key })).map((t) => ({ session: t.owner?.session_id ?? null, owned: t.ownerAgent !== null }));
  assert.equal(rows[0]!.session, "s-taller", "check-in does not take the lease");
  assert.equal(rows[0]!.owned, true);
  const task = await call("get_task", { project: "micasa", key: created.key });
  assert.equal(task.owner_agent.slug, "taller");
  assert.equal(task.owner_agent.status, "alive");

  const bad = await call("set_project", {
    actor: A,
    project: "micasa",
    version: await version("micasa"),
    settings: { team: { idle_minutes: 0 } },
  });
  assert.equal(bad.__error, "INVALID_FILTER");
  const missing = await call("check_in", { actor: A, agent: "no-such-agent" });
  assert.equal(missing.__error, "AGENT_NOT_FOUND");
});

test("a stuck agent is woken at most once per hour", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "workia",
    title: "Held by Research",
    scope: "Scope",
    checks: ["Done"],
    verbose: true,
  });
  await store.fix(async (uow) => {
    await uow.update("tasks", { key: created.key }, { owner: { agent: "Research", session_id: "s-claude" }, claimedAt: hours(-3), leaseUntil: hours(3), status: "In progress" });
    await uow.update("agents", { slug: "research" }, { lastCheckInAt: hours(-3), wakeUrl: "http://127.0.0.1/wake/claude" });
    await uow.update("agents", { slug: "artist" }, { lastCheckInAt: hours(-5), wakeUrl: "http://127.0.0.1/wake/artist" });
  });

  const calls: string[] = [];
  const wake: typeof fetch = async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 204 });
  };
  const now = new Date();
  await sweepStuck(db, now, wake);
  assert.deepEqual(calls, ["http://127.0.0.1/wake/claude"]);
  await sweepStuck(db, new Date(now.getTime() + 5 * 60_000), wake);
  assert.deepEqual(calls, ["http://127.0.0.1/wake/claude"]);
  await sweepStuck(db, new Date(now.getTime() + 61 * 60_000), wake);
  assert.deepEqual(calls, ["http://127.0.0.1/wake/claude", "http://127.0.0.1/wake/claude"]);
});

test("a claim past its lease becomes one limpieza item", async () => {
  const created = await call("create_task", {
    actor: A,
    project: "filmia",
    title: "Lease ran out",
    scope: "Scope",
    checks: ["Done"],
    verbose: true,
  });
  await store.fix((uow) =>
    uow.update("tasks", { key: created.key }, { owner: { agent: "Taller", session_id: "s-old" }, claimedAt: hours(-2), leaseUntil: new Date(Date.now() - 60_000), status: "In progress" }),
  );
  await sweepStuck(db, new Date());
  await sweepStuck(db, new Date());
  assert.equal(await store.count("events", { type: "claim.limpieza", taskKey: created.key }), 1);
  const box = await inbox(db, await findProject(db, "filmia"));
  const item = box.items.find((i) => i.kind === "lease" && i.key === created.key);
  assert.ok(item);
  assert.equal(item!.group, "limpieza");
  assert.match(item!.why, /turno venció/);
  assert.equal(box.chores >= 1, true);
});
