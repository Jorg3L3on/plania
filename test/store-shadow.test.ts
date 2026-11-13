// Devva as a shadow of Postgres (src/store/shadow.ts): first copy, live replay, parity.
// Skipped unless DEVVA_TEST=1 (needs the spike's engine and client build, like store-devva.test.ts).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { pgOnlyFile, resetTestDb, useTestEnv } from "./helpers.js";

pgOnlyFile("devva as a shadow of Postgres");
useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { pgStore } = await import("../src/store/pg.js");
const { Shadow } = await import("../src/store/shadow.js");
type ShadowT = Awaited<ReturnType<typeof Shadow.start>>;
type Reader = import("../src/store/types.js").Reader;
type Drift = import("../src/store/shadow.js").Drift;

const live = process.env.DEVVA_TEST === "1";
let raw: pg.Client;
let shadow: ShadowT;
let projectId = "";

describe("devva shadow", { skip: live ? false : "set DEVVA_TEST=1 with the spike engine running" }, () => {
  before(async () => {
    raw = await resetTestDb();
    projectId = (await raw.query("select id from projects where slug = 'micasa'")).rows[0].id;
    shadow = await Shadow.start(makeDb().db, { prefix: `sh_${Date.now().toString(36)}` }, () => {});
  });
  after(async () => {
    await shadow.devva.purge();
    shadow.close();
    await raw.end();
  });

  test("the first copy brings every row over", async () => {
    await shadow.settled();
    const p = await shadow.parity();
    assert.deepEqual(p.drift, []);
    assert.equal(p.tables, 44);
    assert.ok(p.rows >= 4, "the four seeded projects at least");
    assert.equal(await shadow.devva.read((r: Reader) => r.count("projects")), 4);
  });

  test("writes through the port are replayed, and parity stays clean", async () => {
    await pgStore(makeDb().db).write(projectId, { requestId: "shadow-1", tool: "t" }, async (uow) => {
      await uow.insert("machineState", { key: "shadow", value: { n: 1 } });
      await uow.update("machineState", { key: "shadow" }, { value: { n: 2 } });
      await uow.insert("keyCounters", { projectId, scope: "x", next: 1 });
      await uow.delete("keyCounters", { projectId, scope: "x" });
      return "done";
    });
    await shadow.settled();
    assert.deepEqual((await shadow.devva.read((r: Reader) => r.get("machineState", { key: "shadow" })))?.value, { n: 2 });
    assert.deepEqual((await shadow.parity()).drift, []);
    assert.deepEqual(shadow.errors, []);
  });

  test("a change made outside the port shows up as drift", async () => {
    await raw.query("update projects set title = 'changed behind the port' where slug = 'micasa'");
    await raw.query("insert into machine_state (key, value) values ('raw', '{}')");
    const drift = (await shadow.parity()).drift.sort((a: Drift, b: Drift) => a.table.localeCompare(b.table));
    assert.deepEqual(drift.map((d: Drift) => [d.table, d.missing, d.extra, d.differing, d.columns]), [["machineState", 1, 0, 0, []], ["projects", 0, 0, 1, ["title"]]]);
  });
});
