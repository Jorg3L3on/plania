// The store port (src/store): reads, a unit of work with its write set, idempotent retries, rollback.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { pgStore } = await import("../src/store/pg.js");
const { RequestIdReused } = await import("../src/store/types.js");
type Committed = import("../src/store/types.js").Committed;

let raw: pg.Client;
let projectId = "";
const store = () => pgStore(makeDb().db);

before(async () => {
  raw = await resetTestDb();
  projectId = (await raw.query("select id from projects where slug = 'micasa'")).rows[0].id;
});
after(async () => raw.end());

describe("store reads", () => {
  test("get, find with any-of and order, count", async () => {
    await store().read(async (r) => {
      assert.equal((await r.get("projects", { slug: "micasa" }))?.title, "MiCasa");
      assert.equal(await r.get("projects", { slug: "nope" }), undefined);
      const two = await r.find("projects", { slug: ["zigzag", "filmia"] }, { orderBy: [{ column: "slug", desc: true }] });
      assert.deepEqual(two.map((p) => p.slug), ["zigzag", "filmia"]);
      assert.equal((await r.find("projects", {}, { orderBy: [{ column: "slug" }], limit: 1 }))[0]?.slug, "filmia");
      assert.equal(await r.count("projects"), 4);
      assert.equal(await r.count("projects", { slug: [] }), 0);
      const { gt, lte, ne, notNull } = await import("../src/store/types.js");
      assert.deepEqual((await r.find("projects", { slug: gt("micasa") }, { orderBy: [{ column: "slug" }] })).map((p) => p.slug), ["workia", "zigzag"]);
      assert.equal(await r.count("projects", { slug: lte("micasa") }), 2);
      assert.equal(await r.count("projects", { slug: ne("micasa") }), 3);
      assert.equal(await r.count("projects", { createdAt: notNull() }), 4);
    });
  });
});

describe("application defaults", () => {
  test("every defaulted column in the schema has an application default", async () => {
    const schema = await import("../src/db/schema.js");
    const { getTableConfig, PgTable } = await import("drizzle-orm/pg-core");
    const { is } = await import("drizzle-orm");
    const { defaultOf } = await import("../src/store/defaults.js");
    let tables = 0;
    const numberedByStore: string[] = [];
    for (const [name, t] of Object.entries(schema)) {
      if (!is(t, PgTable)) continue;
      tables += 1;
      // defaultOf throws on a SQL default it has no meaning for.
      for (const c of getTableConfig(t).columns) if (defaultOf(c) === "store") numberedByStore.push(`${name}.${c.name}`);
    }
    assert.equal(tables, 44);
    assert.deepEqual(numberedByStore, ["events.id"]);
  });

  test("an insert stores the id, timestamps and empty lists plania chose", async () => {
    let now: Date | undefined;
    const row = await store().write(projectId, {}, async (uow) => {
      now = uow.now;
      return uow.insert("goals", { title: "store defaults" });
    });
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.equal(row.status, "active");
    assert.equal(row.createdAt.getTime(), now!.getTime());
    const { withDefaults } = await import("../src/store/defaults.js");
    const filled = withDefaults("agents", { slug: "x", name: "X" }, new Date(0));
    assert.deepEqual([filled.capabilities, filled.status, (filled.createdAt as Date).getTime()], [[], "idle", 0]);
    assert.notEqual(withDefaults("agents", { slug: "y" }, new Date(0)).capabilities, filled.capabilities, "each row gets its own list");
    await raw.query("delete from goals where title = 'store defaults'");
  });
});

describe("store writes", () => {
  test("a unit of work commits together and reports its write set", async () => {
    const seen: Committed[] = [];
    const off = store().onCommit((c) => seen.push(c));
    const made = await store().write(projectId, {}, async (uow) => {
      const row = await uow.insert("machineState", { key: "store-test", value: { n: 1 } });
      const [changed] = await uow.update("machineState", { key: "store-test" }, { value: { n: 2 } });
      assert.deepEqual(changed?.value, { n: 2 });
      assert.deepEqual((await uow.get("machineState", { key: "store-test" }))?.value, { n: 2 });
      return row.key;
    });
    off();
    assert.equal(made, "store-test");
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]!.changes.map((c) => [c.table, c.op, c.key]), [
      ["machineState", "put", { key: "store-test" }],
      ["machineState", "put", { key: "store-test" }],
    ]);
    assert.deepEqual(seen[0]!.changes[1]!.row?.value, { n: 2 });
    assert.equal((await raw.query("select value from machine_state where key = 'store-test'")).rows[0].value.n, 2);
  });

  test("a composite key is reported whole, and a delete carries no row", async () => {
    const seen: Committed[] = [];
    const off = store().onCommit((c) => seen.push(c));
    await store().write(projectId, {}, async (uow) => {
      await uow.insert("keyCounters", { projectId, scope: "store-test", next: 3 });
      await uow.delete("keyCounters", { projectId, scope: "store-test" });
    });
    off();
    assert.deepEqual(seen[0]!.changes.map((c) => [c.op, c.key, c.row === undefined]), [
      ["put", { projectId, scope: "store-test" }, false],
      ["delete", { projectId, scope: "store-test" }, true],
    ]);
  });

  test("a failure rolls everything back and commits nothing", async () => {
    const seen: Committed[] = [];
    const off = store().onCommit((c) => seen.push(c));
    await assert.rejects(
      store().write(projectId, {}, async (uow) => {
        await uow.insert("machineState", { key: "store-rollback", value: {} });
        throw new Error("boom");
      }),
      /boom/,
    );
    off();
    assert.equal(seen.length, 0);
    assert.equal((await raw.query("select 1 from machine_state where key = 'store-rollback'")).rowCount, 0);
  });

  test("a retried request id replays the first reply; another tool is refused", async () => {
    let runs = 0;
    const run = () =>
      store().write(projectId, { requestId: "store-req-1", tool: "t1" }, async () => {
        runs += 1;
        return { n: runs };
      });
    assert.deepEqual(await run(), { n: 1 });
    assert.deepEqual(await run(), { n: 1 });
    assert.equal(runs, 1);
    await assert.rejects(
      store().write(projectId, { requestId: "store-req-1", tool: "t2" }, async () => 0),
      (err: unknown) => err instanceof RequestIdReused && err.tool === "t1",
    );
  });
});
