// PLA-89: a Research or Artist wake queued for a stage the idea has left ends without a run.
import assert from "node:assert/strict";
import { test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { stageMovedOn } = await import("../src/runner/runner.js");

test("PLA-89: a stage wake runs only while the idea is on that stage", () => {
  assert.equal(stageMovedOn("research", "idea", "research"), null);
  assert.equal(stageMovedOn("artist", "idea", "design"), null);
  // MIA-IDEA4: Research and Artist were queued again after the idea had reached Plan.
  assert.equal(stageMovedOn("research", "idea", "planning"), "planning");
  assert.equal(stageMovedOn("artist", "idea", "planning"), "planning");
  // Sent back to the PO: Artist's queued wake no longer fits.
  assert.equal(stageMovedOn("artist", "idea", "idea"), "idea");
  // Not a stage wake: a PO, a ticket, or an idea with no stage always runs.
  assert.equal(stageMovedOn("product-owner", "idea", "planning"), null);
  assert.equal(stageMovedOn("taller", "ticket", null), null);
  assert.equal(stageMovedOn("artist", "ticket", "design"), null);
  assert.equal(stageMovedOn(null, "idea", "design"), null);
});
