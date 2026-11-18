// PLA-100 (guided test PLA-86, F-25): the live copy loads the muestra's rows once it is live, as El Probador's pass does.
import assert from "node:assert/strict";
import { test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { loadWhenLive } = await import("../src/captures/entrega.js");

test("PLA-100: rows load once the copy is live; a failed or vanished copy loads nothing", async () => {
  const phases = ["starting", "starting", "live"];
  const loaded: string[] = [];
  const ok = await loadWhenLive("mianovia", "insert into x values (1);", {
    read: () => ({ phase: phases.shift() ?? "live" }) as never,
    load: async (_s, lane, sql) => (loaded.push(`${lane}:${sql}`), { ok: true }),
    sleep: async () => undefined,
  });
  assert.equal(ok, true);
  assert.deepEqual(loaded, ["entrega:insert into x values (1);"]);

  const failed = await loadWhenLive("mianovia", "x", { read: () => ({ phase: "failed" }) as never, load: async () => assert.fail("never loads"), sleep: async () => undefined });
  assert.equal(failed, false);
  const gone = await loadWhenLive("mianovia", "x", { read: () => null, load: async () => assert.fail("never loads"), sleep: async () => undefined });
  assert.equal(gone, false);
  const bad = await loadWhenLive("mianovia", "x", { read: () => ({ phase: "live" }) as never, load: async () => ({ ok: false, error: "relation does not exist" }), sleep: async () => undefined });
  assert.equal(bad, false);
});
