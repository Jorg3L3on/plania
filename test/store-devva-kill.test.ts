// What a crash leaves behind on the devva store, and what boot does about it.
// Skipped unless DEVVA_TEST=1. The engine test also needs DEVVA_TEST_CONTAINER (the engine's container name):
// it kills and restarts that container, so point it only at a throwaway engine.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DevvaStore } from "../src/store/devva.js";

const live = process.env.DEVVA_TEST === "1";
const container = process.env.DEVVA_TEST_CONTAINER;
const prefix = `kill_${Date.now().toString(36)}`;
const writer = path.resolve(import.meta.dirname, "fixtures", "devva-writer.ts");

function run(count: number, env: Record<string, string> = {}): { done: Promise<{ exit: number | null; acked: number[] }> } {
  const p = spawn(process.execPath, ["--import", "tsx", writer, prefix, String(count)], { env: { ...process.env, ...env } });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  return { done: new Promise((resolve) => p.on("close", (exit) => resolve({ exit, acked: [...out.matchAll(/^ACK (\d+)$/gm)].map((m) => Number(m[1])) }))) };
}
async function open(): Promise<DevvaStore> {
  for (let i = 0; ; i++) {
    try {
      return await DevvaStore.open({ prefix });
    } catch (e) {
      if (i > 40) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
// The projection, as devva holds it, against the state the log folds to.
async function consistent(store: DevvaStore): Promise<void> {
  const rows = await store.read((r) => r.find("machineState"));
  const projected = (await store.bucket("company")).filter((b) => b.table === "machineState");
  assert.deepEqual(projected.map((b) => b.row.key).sort(), rows.map((r) => r.key).sort());
  assert.equal(await store.read((r) => r.count("events")), rows.length, "each write's two rows committed together");
}

describe("devva store after a crash", { skip: live ? false : "set DEVVA_TEST=1 with the spike engine running" }, () => {
  after(async () => {
    const store = await open();
    await store.purge();
    store.close();
  });

  test("plania dies right after the commit: boot applies it", async () => {
    const { exit, acked } = await run(1, { PLANIA_DEVVA_CRASH: "after-commit" }).done;
    assert.equal(exit, 137);
    assert.deepEqual(acked, []);
    const store = await open();
    try {
      assert.equal(await store.read((r) => r.count("machineState")), 1, "the commit is in the log");
      assert.ok(store.recovered.repaired >= 1, "boot wrote what the dead process had not");
      await consistent(store);
    } finally {
      store.close();
    }
  });

  test("plania dies after the first projection write: boot finishes the rest", async () => {
    const { exit } = await run(1, { PLANIA_DEVVA_CRASH: "mid-apply" }).done;
    assert.equal(exit, 137);
    const store = await open();
    try {
      assert.equal(await store.read((r) => r.count("machineState")), 2);
      assert.ok(store.recovered.repaired >= 1);
      await consistent(store);
    } finally {
      store.close();
    }
  });

  test("the engine is killed mid-stream: every acknowledged write is there after it restarts", { skip: container ? false : "set DEVVA_TEST_CONTAINER to a throwaway engine's container" }, async () => {
    const writing = run(400);
    await new Promise((r) => setTimeout(r, 2500));
    execFileSync("docker", ["kill", "-s", "KILL", container!]);
    const { acked } = await writing.done;
    execFileSync("docker", ["start", container!]);
    const store = await open();
    try {
      assert.ok(acked.length > 0, "the writer got somewhere before the kill");
      const keys = new Set((await store.read((r) => r.find("machineState"))).map((r) => r.key));
      for (const n of acked) assert.ok(keys.has(`k${n}`), `acknowledged write ${n} survived`);
      await consistent(store);
      await store.write("", {}, (uow) => uow.insert("machineState", { key: "after-restart", value: {} }));
    } finally {
      store.close();
    }
  });
});
