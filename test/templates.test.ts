// PLA-I25-2: a company template creates a project, a product owner and a Playbook.
// The same slug again is a no-op.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TEST_BEARER, resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { readProductOwnerTemplate } = await import("../src/mcp/templates.js");
const { seedLegacyOrg: seedOrg } = await import("./fixtures/legacy-org.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");

let store: TestStore;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;
let client: Client;

const A = { agent: "test-agent", session_id: "s-i25-2" };
const cookie = () => `${SESSION_COOKIE}=${createSession()}`;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  if (r.isError) return { __error: data.error as string, __status: data.status as number, ...data };
  return data;
}

async function counts() {
  return {
    projects: await store.count("projects"),
    agents: await store.count("agents"),
    docs: await store.count("docs"),
    events: await store.count("events"),
  };
}

// A project's docs titled Playbook, by slug; projectLevelOnly keeps those on no task.
async function playbooks(slug: string, projectLevelOnly: boolean) {
  const project = await store.get("projects", { slug });
  if (!project) return [];
  return store.find("docs", { projectId: project.id, title: "Playbook", ...(projectLevelOnly ? { taskId: null } : {}) });
}

before(async () => {
  store = await resetTestStore();
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(serverSide);
  client = new Client({ name: "templates-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await closeDb?.();
  await store?.end();
});

test("create_company_project adds a project, a product owner and a Playbook", async () => {
  const { skills, playbook } = readProductOwnerTemplate();
  const created = await call("create_company_project", {
    actor: A,
    slug: "northwind",
    name: "Northwind",
    owner_bot_name: "Owner Bot",
  });
  assert.equal(created.__error, undefined);
  assert.equal(created.created, true);
  assert.equal(created.project, "northwind");
  assert.equal(created.name, "Northwind");
  assert.deepEqual(created.owner, { slug: "po-northwind", name: "Owner Bot", role: "product-owner" });
  assert.deepEqual(created.playbook, { title: "Playbook", version: 1 });

  const po = (await store.get("agents", { slug: "po-northwind" }))!;
  const boss = po.reportsTo ? await store.get("agents", { id: po.reportsTo }) : undefined;
  const owner = { note: po.note, kind: po.kind, capabilities: po.capabilities, reports_to: boss?.slug ?? null };
  assert.equal(owner.note, skills);
  assert.equal(owner.kind, "bot");
  assert.deepEqual(owner.capabilities, ["product-owner"]);
  // PLA-I30-1 removed the COO «plania»; the new-project template (PLA-I31-3) points the PO at ceo.
  assert.ok(owner.reports_to === null || owner.reports_to === "ceo");

  const [doc] = await playbooks("northwind", true);
  assert.equal(doc?.markdown, playbook);

  const project = await call("get_project", { project: "northwind" });
  assert.equal(project.body, "Company project. The plan lives in Plania.");
  assert.equal(project.version, 2);
  assert.equal(project.key_prefix, "NOR");
});

test("a second call with the same slug is a no-op", async () => {
  const before = await counts();
  const stamp = (await store.get("projects", { slug: "northwind" }))!;
  const again = await call("create_company_project", {
    actor: A,
    slug: "northwind",
    name: "Other name",
    owner_bot_name: "Other Bot",
  });
  assert.equal(again.created, false);
  assert.equal(again.name, "Northwind");
  assert.equal(again.owner.name, "Owner Bot");
  assert.deepEqual(await counts(), before);
  const after = (await store.get("projects", { slug: "northwind" }))!;
  assert.equal(after.version, stamp.version);
  assert.equal(after.title, "Northwind");
  assert.equal(after.updatedAt.toISOString(), stamp.updatedAt.toISOString());
  assert.equal(await store.count("agents", { slug: "po-northwind" }), 1);
  assert.equal(
    (await playbooks("northwind", false)).length,
    1,
  );
});

test("an existing project slug is left untouched", async () => {
  const before = await counts();
  const again = await call("create_company_project", { actor: A, slug: "micasa", name: "MiCasa", owner_bot_name: "Owner Bot" });
  assert.equal(again.created, false);
  assert.equal(again.project, "micasa");
  assert.equal(again.owner, null);
  assert.deepEqual(await counts(), before);
  assert.equal(await store.count("agents", { slug: "po-micasa" }), 0);
});

test("the screen route creates once and refuses a bearer", async () => {
  const missing = await app.request("/api/templates/company", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "southwind", name: "Southwind", owner_bot_name: "South Bot" }),
  });
  assert.equal(missing.status, 401);
  const bearer = await app.request("/api/templates/company", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_BEARER}` },
    body: JSON.stringify({ slug: "southwind", name: "Southwind", owner_bot_name: "South Bot" }),
  });
  assert.equal(bearer.status, 401);

  const headers = { "Content-Type": "application/json", Cookie: cookie() };
  const body = JSON.stringify({ slug: "southwind", name: "Southwind", owner_bot_name: "South Bot" });
  const created = await app.request("/api/templates/company", { method: "POST", headers, body });
  assert.equal(created.status, 201);
  const first = (await created.json()) as { created: boolean; project: string; owner: { slug: string } };
  assert.equal(first.created, true);
  assert.equal(first.owner.slug, "po-southwind");

  const again = await app.request("/api/templates/company", { method: "POST", headers, body });
  assert.equal(again.status, 200);
  const second = (await again.json()) as { created: boolean; name: string };
  assert.equal(second.created, false);
  assert.equal(second.name, "Southwind");
  assert.equal(await store.count("projects", { slug: "southwind" }), 1);

  const bad = await call("create_company_project", { actor: A, slug: "bad_slug", name: "Nope", owner_bot_name: "Owner Bot" });
  assert.equal(bad.__error, "INVALID_FILTER");
});
