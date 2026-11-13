// The devva adapter of the store port (src/store/devva.ts), against a live engine.
// Skipped unless DEVVA_TEST=1: it needs the spike's engine (spike/devva-commit-log/compose.yml) and client build.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { DevvaStore } from "../src/store/devva.js";
import { gt, lte, ne, notNull, RequestIdReused, type Committed } from "../src/store/types.js";

const live = process.env.DEVVA_TEST === "1";
const prefix = `t_${Date.now().toString(36)}`;
const P1 = randomUUID();
const P2 = randomUUID();
let store: DevvaStore;

describe("devva store", { skip: live ? false : "set DEVVA_TEST=1 with the spike engine running" }, () => {
  before(async () => {
    store = await DevvaStore.open({ prefix });
    await store.write(P1, {}, async (uow) => {
      await uow.insert("projects", { id: P1, slug: "micasa", title: "MiCasa", keyPrefix: "MIC" });
      await uow.insert("projects", { id: P2, slug: "zigzag", title: "Zigzag", keyPrefix: "ZIG" });
    });
  });
  after(async () => {
    await store.purge();
    store.close();
  });

  test("reads: get, find with any-of and order, count; rows are copies", async () => {
    await store.read(async (r) => {
      const micasa = await r.get("projects", { slug: "micasa" });
      assert.equal(micasa?.title, "MiCasa");
      assert.ok(micasa!.createdAt instanceof Date);
      assert.equal(micasa!.version, 1, "a literal default is filled");
      micasa!.title = "changed outside a write";
      assert.equal((await r.get("projects", { slug: "micasa" }))?.title, "MiCasa");
      assert.deepEqual((await r.find("projects", { slug: ["zigzag", "micasa"] }, { orderBy: [{ column: "slug", desc: true }] })).map((p) => p.slug), ["zigzag", "micasa"]);
      assert.equal(await r.count("projects"), 2);
      assert.equal(await r.count("projects", { slug: [] }), 0);
      assert.equal(await r.count("projects", { slug: gt("micasa") }), 1);
      assert.equal(await r.count("projects", { slug: lte("micasa"), createdAt: notNull() }), 1);
      assert.equal(await r.count("projects", { slug: ne("micasa") }), 1);
      assert.equal(await r.count("projects", { keyPrefix: notNull(), version: gt(5) }), 0);
      await assert.rejects(r.find("projects", { nope: 1 } as never), /no column nope/);
    });
  });

  test("a write commits together, reports its write set and reads its own changes", async () => {
    const seen: Committed[] = [];
    const off = store.onCommit((c) => seen.push(c));
    await store.write(P1, {}, async (uow) => {
      await uow.insert("machineState", { key: "k", value: { n: 1 } });
      const [changed] = await uow.update("machineState", { key: "k" }, { value: { n: 2 } });
      assert.deepEqual(changed?.value, { n: 2 });
      await uow.insert("keyCounters", { projectId: P1, scope: "standalone", next: 3 });
      await uow.delete("keyCounters", { projectId: P1, scope: "standalone" });
      assert.equal(await uow.get("keyCounters", { projectId: P1, scope: "standalone" }), undefined);
    });
    off();
    assert.deepEqual(seen[0]!.changes.map((c) => [c.table, c.op]), [["machineState", "put"], ["machineState", "put"], ["keyCounters", "put"], ["keyCounters", "delete"]]);
    assert.deepEqual((await store.read((r) => r.get("machineState", { key: "k" })))?.value, { n: 2 });
  });

  test("a failure commits nothing", async () => {
    await assert.rejects(
      store.write(P1, {}, async (uow) => {
        await uow.insert("machineState", { key: "rollback", value: {} });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await store.read((r) => r.get("machineState", { key: "rollback" })), undefined);
  });

  test("keys and unique columns are enforced with the code handlers look for", async () => {
    const dup = (fn: Parameters<DevvaStore["write"]>[2]) => assert.rejects(store.write(P1, {}, fn), (e: unknown) => (e as { code?: string }).code === "23505");
    await dup((uow) => uow.insert("projects", { id: P1, slug: "other", title: "x", keyPrefix: "X" }));
    await dup((uow) => uow.insert("projects", { slug: "micasa", title: "x", keyPrefix: "X" }));
    await dup((uow) => uow.update("projects", { id: P2 }, { slug: "micasa" }));
  });

  test("a retried request id replays the first reply; another tool is refused", async () => {
    let runs = 0;
    const run = () =>
      store.write(P1, { requestId: "req-1", tool: "t1" }, async (uow) => {
        runs += 1;
        await uow.insert("machineState", { key: `req-${runs}`, value: {} });
        return { n: runs };
      });
    assert.deepEqual(await run(), { n: 1 });
    assert.deepEqual(await run(), { n: 1 });
    assert.equal(runs, 1);
    await assert.rejects(store.write(P1, { requestId: "req-1", tool: "t2" }, async () => 0), (e: unknown) => e instanceof RequestIdReused && e.tool === "t1");
  });

  test("events are numbered by the store, in order, across writes", async () => {
    const actor = { agent: "test", session_id: "s" };
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) {
      await store.write(P1, {}, async (uow) => {
        for (const type of ["a", "b"]) ids.push((await uow.insert("events", { projectId: P1, type, actor, payload: {} })).id);
      });
    }
    assert.deepEqual(ids, [1, 2, 3, 4]);
  });

  test("a second store on the same lobes sees the same state, and the projection matches it", async () => {
    const again = await DevvaStore.open({ prefix });
    try {
      assert.equal(again.recovered.repaired, 0);
      assert.equal(await again.read((r) => r.count("events")), 4);
      assert.deepEqual((await again.read((r) => r.get("machineState", { key: "k" })))?.value, { n: 2 });
      const bucket = await again.bucket(P1);
      assert.equal(bucket.filter((b) => b.table === "events").length, 4);
      assert.ok(bucket.find((b) => b.table === "projects" && b.row.slug === "micasa")!.row.createdAt instanceof Date);
      assert.equal((await again.bucket("company")).filter((b) => b.table === "machineState").length, 2);
      // The next number continues after a restart.
      const next = await again.write(P1, {}, async (uow) => (await uow.insert("events", { projectId: P1, type: "c", actor: { agent: "t", session_id: "s" }, payload: {} })).id);
      assert.equal(next, 5);
    } finally {
      again.close();
    }
  });

  test("two stores writing in turn never share a commit: the loser catches up and retries", async () => {
    const other = await DevvaStore.open({ prefix });
    try {
      const bump = (s: DevvaStore) =>
        s.write(P1, {}, async (uow) => {
          const row = await uow.get("machineState", { key: "counter" });
          if (row) await uow.update("machineState", { key: "counter" }, { value: { n: (row.value as { n: number }).n + 1 } });
          else await uow.insert("machineState", { key: "counter", value: { n: 1 } });
        });
      await Promise.all(Array.from({ length: 20 }, (_, i) => bump(i % 2 ? store : other)));
      const fresh = await DevvaStore.open({ prefix });
      try {
        assert.deepEqual((await fresh.read((r) => r.get("machineState", { key: "counter" })))?.value, { n: 20 });
      } finally {
        fresh.close();
      }
      assert.ok(store.stats.conflicts + other.stats.conflicts > 0, "the race happened");
    } finally {
      other.close();
    }
  });
});
