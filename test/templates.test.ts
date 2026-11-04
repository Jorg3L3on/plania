// PLA-I25-2: a company template creates a project, a product owner and a Playbook.
// The same slug again is a no-op.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { TEST_BEARER, resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { readProductOwnerTemplate } = await import("../src/mcp/templates.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");

let raw: pg.Client;
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
  const projects = await raw.query("select count(*)::int as n from projects");
  const agents = await raw.query("select count(*)::int as n from agents");
  const docs = await raw.query("select count(*)::int as n from docs");
  const events = await raw.query("select count(*)::int as n from events");
  return {
    projects: projects.rows[0].n as number,
    agents: agents.rows[0].n as number,
    docs: docs.rows[0].n as number,
    events: events.rows[0].n as number,
  };
}

before(async () => {
  raw = await resetTestDb();
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
  await raw?.end();
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

  const owner = await raw.query(
    `select a.note, a.kind, a.capabilities, p.slug as reports_to
     from agents a left join agents p on p.id = a.reports_to where a.slug = 'po-northwind'`,
  );
  assert.equal(owner.rows[0].note, skills);
  assert.equal(owner.rows[0].kind, "bot");
  assert.deepEqual(owner.rows[0].capabilities, ["product-owner"]);
  assert.equal(owner.rows[0].reports_to, "plania");

  const doc = await raw.query(
    `select d.markdown from docs d join projects p on p.id = d.project_id
     where p.slug = 'northwind' and d.title = 'Playbook' and d.task_id is null`,
  );
  assert.equal(doc.rows[0].markdown, playbook);

  const project = await call("get_project", { project: "northwind" });
  assert.equal(project.body, "Company project. The plan lives in Plania.");
  assert.equal(project.version, 2);
  assert.equal(project.key_prefix, "NOR");
});

test("a second call with the same slug is a no-op", async () => {
  const before = await counts();
  const stamp = await raw.query("select version, updated_at::text as updated_at from projects where slug = 'northwind'");
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
  const after = await raw.query("select version, title, updated_at::text as updated_at from projects where slug = 'northwind'");
  assert.equal(after.rows[0].version, stamp.rows[0].version);
  assert.equal(after.rows[0].title, "Northwind");
  assert.equal(after.rows[0].updated_at, stamp.rows[0].updated_at);
  assert.equal((await raw.query("select count(*)::int as n from agents where slug = 'po-northwind'")).rows[0].n, 1);
  assert.equal(
    (await raw.query("select count(*)::int as n from docs d join projects p on p.id = d.project_id where p.slug = 'northwind' and d.title = 'Playbook'")).rows[0].n,
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
  assert.equal((await raw.query("select count(*)::int as n from agents where slug = 'po-micasa'")).rows[0].n, 0);
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
  assert.equal((await raw.query("select count(*)::int as n from projects where slug = 'southwind'")).rows[0].n, 1);

  const bad = await call("create_company_project", { actor: A, slug: "bad_slug", name: "Nope", owner_bot_name: "Owner Bot" });
  assert.equal(bad.__error, "INVALID_FILTER");
});
