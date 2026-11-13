// Day-one seed (slice 6): bodies and resume cards from the handoff, safe to rerun.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTestStore, useTestEnv, type TestStore } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { SEED, seedProjects } = await import("../scripts/seed.js");
const { deleteProject } = await import("../src/mcp/project.js");

let store: TestStore;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;

async function project(slug: string) {
  return (await store.get("projects", { slug }))!;
}

before(async () => {
  store = await resetTestStore(); // four projects with empty bodies and cards, like a slice 1 database
  ({ db, close: closeDb } = makeDb());
});

after(async () => {
  await closeDb?.();
  await store?.end();
});

async function pinned(slug: string): Promise<string[]> {
  const p = await store.get("projects", { slug });
  if (!p) return [];
  const rows = await store.find("decisions", { projectId: p.id, pinned: true }, { orderBy: [{ column: "createdAt" }] });
  return rows.map((r) => r.line);
}

test("fills empty slice 1 rows with the handoff bodies and pins each must-keep decision", async () => {
  const result = await seedProjects(db);
  assert.deepEqual(result.map((r) => r.slug), ["micasa", "workia", "filmia", "zigzag"]);
  assert.ok(result.every((r) => r.pinned));
  const micasa = await project("micasa");
  assert.match(micasa.body, /^Finanzas personal y del hogar centrada en quincenas/);
  assert.match(micasa.body, /Repo: https:\/\/github.com\/Jorg3L3on\/micasa\./);
  assert.equal("resume_in_progress" in micasa, false, "the v1 card columns are gone (0022)");
  assert.deepEqual(await pinned("zigzag"), ["El nombre nuevo espera; slug zigzag se queda en v1."]);
  const zigzag = await project("zigzag");
  assert.equal(zigzag.body, "App de recibos; nombre nuevo fuera de v1.");
});

test("inserts missing projects on an empty table", async () => {
  // What `delete from projects` cascaded to, deleted explicitly.
  await store.fix(async (uow) => {
    for (const p of await uow.find("projects")) await deleteProject(uow, p.id);
  });
  const result = await seedProjects(db);
  assert.ok(result.every((r) => r.pinned));
  const rows = await store.find("projects", {}, { orderBy: [{ column: "slug" }] });
  assert.deepEqual(rows.map((r) => r.slug), ["filmia", "micasa", "workia", "zigzag"]);
});

test("a rerun restores the body, does not duplicate decisions, and leaves rules alone", async () => {
  await store.fix((uow) => uow.update("projects", { slug: "micasa" }, { body: "edited by hand", rulesText: "Jorge corre las migraciones" }));
  const result = await seedProjects(db);
  assert.equal(result.find((r) => r.slug === "micasa")!.pinned, false);
  const micasa = await project("micasa");
  assert.equal(micasa.body, SEED[0]!.body);
  assert.equal(micasa.rulesText, "Jorge corre las migraciones");
  assert.equal((await pinned("micasa")).length, 1);
});

test("once set_project edited a project, the seed leaves its text alone", async () => {
  await store.fix((uow) => uow.update("projects", { slug: "workia" }, { body: "edited with set_project", version: 2 }));
  await seedProjects(db);
  assert.equal((await project("workia")).body, "edited with set_project");
});

test("get_project micasa returns the body (slice 6 done-when)", async () => {
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db).connect(s);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(c);
  const r = (await client.callTool({ name: "get_project", arguments: { project: "micasa" } })) as { content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text);
  assert.equal(data.title, "MiCasa");
  assert.equal(data.body, SEED[0]!.body);
  await client.close();
});
