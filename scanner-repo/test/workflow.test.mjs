import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { TARGET_REPOS } from "../src/select.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(join(root, ".github/workflows/plania-scan.yml"), "utf8");
const usage = readFileSync(join(root, ".github/workflows/usage.yml"), "utf8");
const gitleaks = readFileSync(join(root, "src/scan/gitleaks.ts"), "utf8");

test("the scan workflow fast-exits before checkout and pins the gitleaks archive", () => {
  assert.match(workflow, /cron:\s*"0 9 \* \* \*"/);
  assert.match(workflow, /group:\s*plania-scan\n\s*cancel-in-progress:\s*false/);
  assert.match(workflow, /timeout-minutes:\s*10/);
  assert.equal(/uses:[^\n]*gitleaks/i.test(workflow), false);
  assert.equal(workflow.includes("gitleaks/gitleaks-action"), false);
  assert.match(workflow, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  assert.match(gitleaks, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  const guardAt = workflow.indexOf("List unmarked pull requests");
  const checkoutNameAt = workflow.indexOf("Check out the scanner");
  const checkoutAt = workflow.indexOf("actions/checkout");
  const setupAt = workflow.indexOf("actions/setup-node");
  assert.equal(guardAt > 0 && checkoutNameAt > guardAt && checkoutAt > checkoutNameAt && setupAt > checkoutAt, true);
  const guardStep = workflow.slice(guardAt, checkoutNameAt);
  assert.equal(guardStep.includes("uses:"), false);
  assert.match(guardStep, /curl -fsSL/);
  assert.match(guardStep, /select\.mjs guard\.mjs/);
  assert.match(guardStep, /contents\/src\/\$\{name\}/);
  assert.match(guardStep, /node \/tmp\/plania-guard\/guard\.mjs/);
  assert.equal(guardStep.includes("PLANIA_SCAN_HASHES_JSON"), false);
  assert.match(workflow, /if: steps\.guard\.outputs\.count != '0'/);
  assert.match(workflow, /PLANIA_SCAN_HASHES_JSON/);
  assert.match(workflow, /node --experimental-strip-types src\/run-queue\.ts/);
  assert.deepEqual(TARGET_REPOS.map((repo) => repo.repo), ["filmia", "micasa", "zigzag", "workia"]);
  assert.equal(TARGET_REPOS.every((repo) => repo.owner === "Jorg3L3on"), true);
});

test("the usage workflow is dispatch-only", () => {
  assert.match(usage, /workflow_dispatch:/);
  assert.equal(usage.includes("schedule:"), false);
  assert.match(usage, /timeout-minutes:\s*2/);
  assert.match(usage, /node src\/usage\.mjs --live/);
  assert.equal(usage.includes("PLANIA_SCAN_TOKEN"), false);
});
