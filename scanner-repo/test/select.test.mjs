import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATUS_CONTEXT,
  latestForContext,
  needsScan,
  pullTarget,
  resultFromFindings,
  statusRequest,
  unmarkedTargets,
} from "../src/select.mjs";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

function pull(sha, number = 7) {
  return pullTarget("Jorg3L3on", "filmia", {
    number,
    head: { sha },
    base: { ref: "main", sha: "c".repeat(40) },
  });
}

test("pullTarget keeps a usable pull and drops a bad head", () => {
  const target = pull(SHA);
  assert.equal(target.owner, "Jorg3L3on");
  assert.equal(target.repo, "filmia");
  assert.equal(target.baseRef, "main");
  assert.equal(pullTarget("Jorg3L3on", "filmia", { number: 1, head: { sha: "nope" }, base: { ref: "main" } }), null);
  assert.equal(pullTarget("Jorg3L3on", "filmia", { number: 0, head: { sha: SHA }, base: { ref: "main" } }), null);
});

test("needsScan skips settled statuses and fresh pending, and retries a stale pending", () => {
  assert.equal(needsScan(null, NOW), true);
  assert.equal(needsScan({ state: "success", updated_at: "2026-11-11T11:00:00Z" }, NOW), false);
  assert.equal(needsScan({ state: "failure", updated_at: "2026-11-11T11:00:00Z" }, NOW), false);
  assert.equal(needsScan({ state: "error", updated_at: "2026-11-11T11:00:00Z" }, NOW), false);
  assert.equal(needsScan({ state: "pending", updated_at: "2026-11-11T11:50:00Z" }, NOW), false);
  assert.equal(needsScan({ state: "pending", updated_at: "2026-11-11T11:00:00Z" }, NOW), true);
  assert.equal(needsScan({ state: "pending" }, NOW), true);
  assert.equal(needsScan({ state: "unknown", updated_at: "2026-11-11T11:59:00Z" }, NOW), true);
});

test("the latest plania-scan status wins, and another context does not", () => {
  const statuses = [
    { context: "ci", state: "success", updated_at: "2026-11-11T11:59:00Z" },
    { context: STATUS_CONTEXT, state: "pending", updated_at: "2026-11-11T10:00:00Z" },
    { context: STATUS_CONTEXT, state: "success", updated_at: "2026-11-11T11:40:00Z" },
  ];
  assert.equal(latestForContext(statuses).state, "success");
  const marked = unmarkedTargets([pull(SHA), pull(OTHER, 8)], new Map([[SHA, statuses]]), NOW);
  assert.deepEqual(marked.map((item) => item.headSha), [OTHER]);
});

test("status text is counts or a fixed phrase", () => {
  const leaked = "fixture.scanner@mail-ficticio.mx";
  const pending = statusRequest({ phase: "pending", leaked });
  assert.deepEqual(pending, { state: "pending", context: STATUS_CONTEXT, description: "scan started" });
  const clean = statusRequest({ phase: "result", error: false, findingCount: 0, ruleCount: 0, leaked });
  assert.equal(clean.state, "success");
  assert.equal(clean.description, "0 findings, 0 rules");
  const dirty = statusRequest(resultFromFindings([{ rule: "plania-email", file: "note.md", value: leaked }], false));
  assert.equal(dirty.state, "failure");
  assert.equal(dirty.description, "1 finding, 1 rule");
  assert.equal(dirty.description.includes(leaked), false);
  assert.equal(dirty.description.includes("note.md"), false);
  assert.equal(dirty.description.includes("@"), false);
  const stuck = statusRequest({ phase: "result", error: true, findingCount: 4, ruleCount: 2 });
  assert.equal(stuck.state, "failure");
  assert.equal(stuck.description, "scan did not finish");
  assert.throws(() => statusRequest({ phase: "result", error: false, findingCount: 1.5, ruleCount: 1 }));
});
