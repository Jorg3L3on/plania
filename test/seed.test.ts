// Day-one seed (slice 6): bodies and resume cards from the handoff, safe to rerun.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { SEED, seedProjects } = await import("../scripts/seed.js");

let raw: pg.Client;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let closeDb: () => Promise<void>;

async function project(slug: string) {
  const { rows } = await raw.query("select * from projects where slug = $1", [slug]);
  return rows[0];
}

before(async () => {
  raw = await resetTestDb(); // four projects with empty bodies and cards, like a slice 1 database
  ({ db, close: closeDb } = makeDb());
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

async function pinned(slug: string): Promise<string[]> {
  const { rows } = await raw.query(
    "select d.line from decisions d join projects p on p.id = d.project_id where p.slug = $1 and d.pinned order by d.created_at",
    [slug],
  );
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
  await raw.query("delete from projects");
  const result = await seedProjects(db);
  assert.ok(result.every((r) => r.pinned));
  const { rows } = await raw.query("select slug from projects order by slug");
  assert.deepEqual(rows.map((r) => r.slug), ["filmia", "micasa", "workia", "zigzag"]);
});

test("a rerun restores the body, does not duplicate decisions, and leaves rules alone", async () => {
  await raw.query("update projects set body = 'edited by hand', rules_text = 'Jorge corre las migraciones' where slug = 'micasa'");
  const result = await seedProjects(db);
  assert.equal(result.find((r) => r.slug === "micasa")!.pinned, false);
  const micasa = await project("micasa");
  assert.equal(micasa.body, SEED[0]!.body);
  assert.equal(micasa.rules_text, "Jorge corre las migraciones");
  assert.equal((await pinned("micasa")).length, 1);
});

test("once set_project edited a project, the seed leaves its text alone", async () => {
  await raw.query("update projects set body = 'edited with set_project', version = 2 where slug = 'workia'");
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
