// PLA-I26-5: the bot loop is documented, the CEO adapter is none, and list_agents returns adapter fields.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");

let store: TestStore;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, ...data };
  return data;
}

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "i26-protocol", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await store?.end();
});

test("the bot protocol names the loop and the CEO adapter is none", async () => {
  const doc = readFileSync(new URL("../docs/bot-protocol.md", import.meta.url), "utf8");
  const checkIn = doc.indexOf("check_in");
  const claim = doc.indexOf("Claim Ready");
  const report = doc.indexOf("report_tokens");
  const idle = doc.lastIndexOf("check_in");
  assert.ok(checkIn >= 0 && claim > checkIn && report > claim && idle > report);

  const rows = (await store.find("agents")).map((a) => ({ slug: a.slug, adapter: a.adapter, adapter_config: a.adapterConfig, heartbeat_minutes: a.heartbeatMinutes }));
  const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row]));
  assert.equal(bySlug.ceo!.adapter, "none");
  assert.equal(bySlug.ceo!.heartbeat_minutes, null);
  assert.deepEqual(bySlug.ceo!.adapter_config, {});
  // PLA-I30-1: Claude Code only. Every bot role runs claude_code; cadence stays off until the pilot sets it.
  assert.equal(bySlug.cursor, undefined);
  assert.equal(bySlug["claude-code"], undefined);
  assert.equal(bySlug.taller!.adapter, "claude_code");
  assert.deepEqual(bySlug.taller!.adapter_config, { command_env: "CLAUDE_CODE_BIN", args_env: "CLAUDE_CODE_ARGS" });
  assert.equal(bySlug.housi!.adapter, "claude_code");
  assert.equal(bySlug.housi!.heartbeat_minutes, null);
  const text = JSON.stringify(rows);
  assert.equal(text.includes("http://"), false);
  assert.equal(text.includes("@"), false);

  await store.fix((uow) => uow.update("agents", { slug: "taller" }, { adapter: "http", heartbeatMinutes: 5 }));
  await seedOrg(db);
  const kept = (await store.get("agents", { slug: "taller" }))!;
  assert.equal(kept.adapter, "http");
  assert.equal(kept.heartbeatMinutes, 5);
  await store.fix((uow) => uow.update("agents", { slug: "taller" }, { adapter: "claude_code", heartbeatMinutes: 15 }));
});

test("list_agents returns adapter fields and the wake tools describe the loop", async () => {
  const listed = await call("list_agents");
  const ceo = listed.agents.find((agent: { slug: string }) => agent.slug === "ceo");
  const taller = listed.agents.find((agent: { slug: string }) => agent.slug === "taller");
  assert.equal(ceo.adapter, "none");
  assert.equal(ceo.heartbeat_minutes, null);
  assert.deepEqual(ceo.adapter_config, {});
  assert.equal(taller.adapter, "claude_code");
  assert.equal(taller.adapter_config.command_env, "CLAUDE_CODE_BIN");
  assert.equal(taller.heartbeat_minutes, 15);
  assert.equal(JSON.stringify(listed).includes("CLAUDE_CODE_BIN="), false);

  const tools = await client.listTools();
  const wake = tools.tools.find((tool) => tool.name === "wake_agent");
  const runs = tools.tools.find((tool) => tool.name === "list_heartbeat_runs");
  assert.match(wake?.description ?? "", /check_in/);
  assert.match(wake?.description ?? "", /report_tokens/);
  assert.match(runs?.description ?? "", /check_in/);
  assert.match(wake?.description ?? "", /docs\/bot-protocol\.md/);
});
