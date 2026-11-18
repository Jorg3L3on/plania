// PLA-106: one delivery copy per project, so El Probador's passes of one project take turns; another project's do not
// wait. Pure: no database, no copy.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

process.env.PLANIA_JOBS = "0";
const { onLane } = await import("../src/captures/probador.js");
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("PLA-106 #1: two passes of one project never overlap, in arrival order; a failed one does not block the next", async () => {
  const log: string[] = [];
  let inside = 0;
  let most = 0;
  const work = (name: string, ms: number, fail = false) => async () => {
    inside++;
    most = Math.max(most, inside);
    log.push(`start ${name}`);
    await tick(ms);
    inside--;
    log.push(`end ${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  const a = onLane("mianovia", work("MIA-40", 40));
  const b = onLane("mianovia", work("MIA-I10-5", 5, true));
  const c = onLane("mianovia", work("MIA-38", 5));
  assert.equal(await a, "MIA-40");
  await assert.rejects(b, /MIA-I10-5/);
  assert.equal(await c, "MIA-38");
  assert.equal(most, 1);
  assert.deepEqual(log, ["start MIA-40", "end MIA-40", "start MIA-I10-5", "end MIA-I10-5", "start MIA-38", "end MIA-38"]);
});

test("PLA-106 #2: another project's pass does not wait", async () => {
  const order: string[] = [];
  const slow = onLane("mianovia", async () => (await tick(60), order.push("mianovia")));
  const other = onLane("filmia", async () => (await tick(5), order.push("filmia")));
  await Promise.all([slow, other]);
  assert.deepEqual(order, ["filmia", "mianovia"]);
});

test("PLA-106 #3: probar runs its pass on the project's lane", async () => {
  const src = await readFile(new URL("../src/captures/probador.ts", import.meta.url), "utf8");
  assert.match(src, /onLane\(slug, \(\) => pass\(db, slug, key, deps\)\)/);
});
