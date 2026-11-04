// PLA-I22-2: the why chain on get_task, get_context, and (via the same shape) the task sheet.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");

type Json = Record<string, any>;
const A = { agent: "test-agent", session_id: "s-why", machine: "ci" };

let client: Client;
let raw: import("pg").Client;
let closeDb: () => Promise<void>;

async function tool(name: string, args: Json = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}

const write = (name: string, args: Json) => tool(name, { actor: A, ...args });

before(async () => {
  raw = await resetTestDb();
  const opened = makeDb();
  closeDb = opened.close;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(opened.db).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await raw?.end();
});

describe("why chain", () => {
  test("a linked ticket shows task → initiative → project goal → company goal; an unlinked task hides it", async () => {
    const company = await write("set_goal", { title: "Meta de la empresa", why: "el porqué de la empresa" });
    const project = await write("set_goal", {
      project: "workia",
      parent_id: company.id,
      title: "Meta del proyecto",
      why: "el porqué del proyecto",
    });
    const init = await write("create_task", {
      project: "workia",
      kind: "initiative",
      title: "La iniciativa",
      scope: "PRD",
      goal_id: project.id,
      integration_branch: "jl/por-que",
    });
    assert.equal(init.__error, undefined, JSON.stringify(init));
    const ticket = await write("create_task", {
      project: "workia",
      title: "El ticket",
      scope: "alcance",
      work_type: "decision-needed",
      parent_key: init.key,
      status: "Backlog",
    });
    assert.equal(ticket.__error, undefined, JSON.stringify(ticket));
    const branched = await write("set_task", { project: "workia", key: ticket.key, branch: "jl/por-que", version: ticket.version });
    assert.equal(branched.__error, undefined, JSON.stringify(branched));

    const expected = [
      { level: "task", key: ticket.key, title: "El ticket", why: null },
      { level: "initiative", key: init.key, title: "La iniciativa", why: null },
      { level: "project_goal", key: null, title: "Meta del proyecto", why: "el porqué del proyecto" },
      { level: "company_goal", key: null, title: "Meta de la empresa", why: "el porqué de la empresa" },
    ];
    const full = await tool("get_task", { project: "workia", key: ticket.key });
    assert.deepEqual(full.why_chain, expected);
    const summary = await tool("get_task", { project: "workia", key: ticket.key, view: "summary" });
    assert.deepEqual(summary.why_chain, expected);

    const initFull = await tool("get_task", { project: "workia", key: init.key });
    assert.deepEqual(
      initFull.why_chain,
      expected.filter((link) => link.level !== "task"),
    );

    const loose = await write("create_task", {
      project: "workia",
      kind: "initiative",
      title: "Sin meta",
      scope: "PRD",
      integration_branch: "jl/sin-meta",
    });
    const looseTicket = await write("create_task", {
      project: "workia",
      title: "Ticket suelto",
      scope: "alcance",
      work_type: "decision-needed",
      status: "Backlog",
    });
    const idea = await write("create_task", { project: "workia", kind: "idea", title: "Una idea" });
    assert.equal(loose.__error, undefined, JSON.stringify(loose));
    assert.equal(looseTicket.__error, undefined, JSON.stringify(looseTicket));
    assert.equal(idea.__error, undefined, JSON.stringify(idea));

    for (const key of [loose.key, looseTicket.key, idea.key]) {
      assert.equal((await tool("get_task", { project: "workia", key })).why_chain, null, key);
      assert.equal((await tool("get_task", { project: "workia", key, view: "summary" })).why_chain, null, key);
    }

    const linked = await tool("get_context", { project: "workia", workspace: { branch: "jl/por-que" } });
    assert.equal(linked.__error, undefined, JSON.stringify(linked));
    assert.deepEqual(linked.why_chain, expected.filter((link) => link.level !== "task"));
    assert.deepEqual(linked.initiative.why_chain, linked.why_chain);
    const onBranch = linked.tickets.find((t: Json) => t.key === ticket.key);
    assert.deepEqual(onBranch.why_chain, expected);

    const hidden = await tool("get_context", { project: "workia", workspace: { branch: "jl/sin-meta" } });
    assert.equal(hidden.__error, undefined, JSON.stringify(hidden));
    assert.equal(hidden.why_chain, null);
    assert.equal(hidden.initiative.why_chain, null);
  });
});
