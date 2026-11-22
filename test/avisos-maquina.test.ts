// La máquina's warning on Inicio (ui/src/lib/avisos-maquina.ts): the chips per kind and the amber count on «Ver la
// máquina» count each problem once. An orphan or stale row with no project is in the totals and is also a finding;
// read as both, the count said 2 for one problem.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { avisosMaquina, HALLAZGOS_REPETIDOS } from "../ui/src/lib/avisos-maquina.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const { footprints, projects } = await import("../src/db/schema.js");
const { machineInventory, machineTotals } = await import("../src/jobs/machine/index.js");
const { footprintFindings } = await import("../src/mcp/footprint-audit.js");
const { backupFindings } = await import("../src/jobs/backup.js");

const f = (code: string) => ({ code, key: null, detail: code, fix_hint: "" });

describe("the count, pure", () => {
  test("a finding that repeats an orphan or stale row is not counted again", () => {
    const a = avisosMaquina({
      totals: { orphan: 1, stale: 2 },
      findings: [f("FOOTPRINT_ORPHAN"), f("FOOTPRINT_STALE"), f("WORKTREE_MERGED_NOT_REMOVED"), f("BACKUP_FAILED"), f("SECONDARY_DB_SERVER")],
    });
    assert.deepEqual([a.hallazgos, a.orphan, a.stale, a.total], [2, 1, 2, 5]);
    assert.equal(a.primero?.code, "BACKUP_FAILED", "the line's example is a finding the chips do not already say");
  });

  test("with only repeated findings, the example is still the first finding; nothing found is zero", () => {
    const a = avisosMaquina({ totals: { orphan: 1, stale: 0 }, findings: [f("FOOTPRINT_ORPHAN")] });
    assert.deepEqual([a.hallazgos, a.total, a.primero?.code], [0, 1, "FOOTPRINT_ORPHAN"]);
    assert.deepEqual(avisosMaquina({ totals: { orphan: 0, stale: 0 }, findings: [] }), { hallazgos: 0, orphan: 0, stale: 0, total: 0, primero: null });
  });
});

describe("the count against what GET /api/machine returns", () => {
  let raw: pg.Client;
  let db: ReturnType<typeof makeDb>["db"];
  let closeDb: () => Promise<void>;

  before(async () => {
    raw = await resetTestDb();
    const made = makeDb();
    db = made.db;
    closeDb = made.close;
  });
  after(async () => {
    await closeDb?.();
    await raw?.end();
  });

  test("each real problem counts once, with or without a project, alongside the backup's finding", async () => {
    const [p] = await db.select({ id: projects.id }).from(projects).limit(1);
    assert.ok(p, "the test database holds a project");
    const seen = new Date(Date.now() - 3 * 86_400_000);
    await db.insert(footprints).values([
      // No project: each is in the totals and also a finding.
      { machine: "test-mac", kind: "server", locator: "port:4000", state: "orphan", firstSeenAt: seen },
      { machine: "test-mac", kind: "worktree", locator: "/w/old", state: "stale", details: { merged: true }, firstSeenAt: seen },
      { machine: "test-mac", kind: "database", locator: "db@127.0.0.1:5432/scratch", state: "stale", firstSeenAt: seen },
      // A project's: in the totals only (its project's audit holds the finding).
      { machine: "test-mac", kind: "server", locator: "port:5173", state: "orphan", projectId: p!.id, firstSeenAt: seen },
      // Neither orphan nor stale: no warning.
      { machine: "test-mac", kind: "server", locator: "port:3738", state: "live", firstSeenAt: seen },
    ]);
    // The route's own composition (src/api/routes.ts GET /machine), with a backup that never ran.
    const items = await machineInventory(db);
    const findings = [...backupFindings({ at: null, error: "disk full", attempted_at: new Date().toISOString() }), ...(await footprintFindings(db, { projectless: true }))];
    const totals = machineTotals(items);
    assert.deepEqual([totals.orphan, totals.stale], [2, 2]);

    const a = avisosMaquina({ totals, findings });
    const backup = findings.filter((x) => !HALLAZGOS_REPETIDOS.has(x.code));
    assert.ok(backup.length >= 1, "the failed backup is a finding of its own");
    // 2 orphan + 2 stale + the backup's finding(s): the three projectless rows' findings are not added again.
    assert.deepEqual([a.orphan, a.stale, a.hallazgos], [2, 2, backup.length]);
    assert.equal(a.total, 4 + backup.length);
    assert.equal(findings.length - backup.length, 3, "the server wrote one finding per projectless orphan or stale row, the ones left out");
  });
});
