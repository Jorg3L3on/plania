// Backup on the devva store: the dump, loading it into an empty store, and the nightly job that checks it.
// It needs a running devva engine (deploy/devva/README.md).
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb, useDb } = await import("../src/db/client.js");
const { DevvaStore } = await import("../src/store/devva.js");
const { runBackup, backupState } = await import("../src/jobs/backup.js");
type Store = Awaited<ReturnType<typeof DevvaStore.open>>;

const stamp = Date.now().toString(36);
let store: Store;
let dir = "";

describe("devva backup", () => {
  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "plania-devva-backup-"));
    store = await DevvaStore.open({ prefix: `bk_${stamp}` });
    useDb(store.handle);
    await store.write("", {}, async (uow) => {
      const p = await uow.insert("projects", { slug: "zigzag", title: "Zigzag", keyPrefix: "ZIG" });
      await uow.insert("machineState", { key: "a", value: { n: 1 } });
      await uow.insert("events", { projectId: p.id, type: "x", actor: { agent: "t", session_id: "s" }, payload: {} });
    });
    await store.write("", {}, (uow) => uow.update("machineState", { key: "a" }, { value: { n: 2 } }));
    await store.write("", {}, (uow) => uow.delete("machineState", { key: "a" }));
  });
  after(async () => {
    useDb(null);
    await store.purge();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a dump loads into an empty store and gives the same rows; a damaged dump is refused", async () => {
    const text = await store.dump();
    assert.equal(JSON.parse(text.split("\n")[0]!).commits, 3);
    const copy = await DevvaStore.open({ prefix: `bk_${stamp}_copy` });
    try {
      assert.equal(await copy.restore(text), 3);
      assert.deepEqual([...(await copy.fingerprint())].sort(), [...(await store.fingerprint())].sort());
      assert.equal(await copy.read((r) => r.count("machineState")), 0, "the delete is replayed too");
      await assert.rejects(copy.restore(text), /empty store/);
    } finally {
      await copy.purge();
      copy.close();
    }
    const other = await DevvaStore.open({ prefix: `bk_${stamp}_bad` });
    try {
      const lines = text.trimEnd().split("\n");
      await assert.rejects(other.restore(lines.slice(0, -1).join("\n")), /not a complete/);
      await assert.rejects(other.restore([lines[0], lines[2], lines[1], lines[3]].join("\n")), /out of order/);
      assert.equal(other.commits, 0, "a refused dump writes nothing");
    } finally {
      await other.purge();
      other.close();
    }
  });

  test("the nightly job writes a checked dump once a day and records it", async () => {
    const noon = new Date("2026-11-13T18:00:00Z"); // 12:00 in Mexico City
    assert.deepEqual(await runBackup(makeDb().db, noon, { dir }), { dumped: 1, pruned: 0, failed: 0 });
    assert.deepEqual(readdirSync(dir), ["plania-20261113.devva.jsonl.gz"]);
    const text = gunzipSync(readFileSync(path.join(dir, "plania-20261113.devva.jsonl.gz"))).toString("utf8");
    assert.equal(JSON.parse(text.split("\n")[0]!).plania_devva_dump, 1);
    const state = await backupState(makeDb().db);
    assert.equal(state.day, "2026-11-13");
    assert.equal(state.error, null);
    assert.deepEqual(await runBackup(makeDb().db, noon, { dir }), { dumped: 0, pruned: 0, failed: 0 }, "once per day");
  });
});
