// scripts/rekey-v3.ts: filmia's keys move to the 2.1 scheme once, with aliases and events.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { createTask } = await import("../src/mcp/writes.js");
const { findProject, findTask, listEvents } = await import("../src/mcp/queries.js");
const { rekeyProject } = await import("../scripts/rekey-v3.js");

let raw: pg.Client;
const ctx = { actor: { agent: "t", session_id: "s1" } };
const T = { scope: "s", checks: ["c"] };

before(async () => {
  raw = await resetTestDb();
  const { db, close } = makeDb();
  try {
    // filmia on 2026-10-07: one shared FIL-NN sequence for initiatives and tickets, created in number order
    // (FIL-02..04 are the bucket initiative's children; here they are created under it with their old keys).
    await createTask(db, { project: "filmia", kind: "initiative", key: "FIL-01", title: "Catalog split", scope: "PRD" }, ctx);
    for (const n of [1, 2, 3]) await createTask(db, { project: "filmia", key: `FIL-01-F${n}`, title: `F${n}`, ...T, parent_key: "FIL-01", phase: n }, ctx);
    for (const n of [5, 6]) await createTask(db, { project: "filmia", key: `FIL-0${n}`, title: `s${n}`, ...T }, ctx);
    await createTask(db, { project: "filmia", kind: "initiative", key: "FIL-07", title: "Post-QA", scope: "PRD" }, ctx);
    for (const n of [2, 3, 4]) await createTask(db, { project: "filmia", key: `FIL-0${n}`, title: `t${n}`, ...T, parent_key: "FIL-07" }, ctx);
    await createTask(db, { project: "filmia", key: "FIL-08", title: "s8", ...T }, ctx);
  } finally {
    await close();
  }
});

after(async () => {
  await raw?.end();
});

describe("rekey", () => {
  test("dry run plans the renames and changes nothing", async () => {
    const { db, close } = makeDb();
    try {
      const plan = await rekeyProject(db, "filmia", false);
      assert.deepEqual(
        plan.map((r) => `${r.from}→${r.to}`),
        ["FIL-01→FIL-I1", "FIL-07→FIL-I2", "FIL-01-F1→FIL-I1-1", "FIL-01-F2→FIL-I1-2", "FIL-01-F3→FIL-I1-3", "FIL-02→FIL-I2-1", "FIL-03→FIL-I2-2", "FIL-04→FIL-I2-3"],
      );
      const p = await findProject(db, "filmia");
      assert.ok(await findTask(db, p.id, "FIL-01"));
      assert.equal((await findTask(db, p.id, "FIL-I1")), undefined);
    } finally {
      await close();
    }
  });

  test("apply renames, keeps the old keys as aliases and logs task.rekeyed; a rerun is a no-op", async () => {
    const { db, close } = makeDb();
    try {
      const applied = await rekeyProject(db, "filmia", true);
      assert.equal(applied.length, 8);
      const p = await findProject(db, "filmia");
      const old = await findTask(db, p.id, "FIL-04");
      assert.equal(old?.key, "FIL-I2-3");
      assert.equal((await findTask(db, p.id, "FIL-01-F2"))?.key, "FIL-I1-2");
      assert.equal((await findTask(db, p.id, "FIL-05"))?.key, "FIL-05", "standalone keys stay");
      const events = (await listEvents(db, p.id, { types: ["task.rekeyed"] })).events;
      assert.equal(events.length, 8);
      assert.deepEqual(events[0]!.payload, { from: "FIL-01", to: "FIL-I1", reason: "migration" });
      assert.equal(events[0]!.task_key, "FIL-I1");
      assert.deepEqual(await rekeyProject(db, "filmia", true), []);

      // New keys continue after the renamed ones, never reusing an alias.
      const i3 = await createTask(db, { project: "filmia", kind: "initiative", title: "Next", scope: "PRD" }, ctx);
      assert.equal(i3.key, "FIL-I3");
      const s9 = await createTask(db, { project: "filmia", title: "Loose", ...T }, ctx);
      assert.equal(s9.key, "FIL-09");
      const c4 = await createTask(db, { project: "filmia", title: "More", ...T, parent_key: "FIL-07" }, ctx);
      assert.equal(c4.key, "FIL-I2-4", "the parent is found through its alias");
    } finally {
      await close();
    }
  });
});
