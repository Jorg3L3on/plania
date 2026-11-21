// PLA-I70-4 and -5: a one-branch project gets no derived integration branch, proposals land on the right base, and a
// required check holds on Plania's merges even where the branch rule cannot be turned on (private repo, free plan).
import assert from "node:assert/strict";
import { test } from "node:test";

const { effectiveConfig } = await import("../src/camino/config.js");
const cam = (await import(new URL("../ui/src/lib/camino.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino.js");

test("B4: trunk with no release has no integration branch, even with a start branch", () => {
  const c = effectiveConfig({ start_branch: "sandbox" } as never, {}, { default_branch: "main", merge: null });
  assert.equal(c.model, "trunk");
  assert.equal(c.branches.published, "main");
  assert.equal(c.branches.integration, null);
});
test("B4: a release step still derives integration, and the base follows the model", () => {
  const c = effectiveConfig({ release: { from: "sandbox", into: "main", env: "prod", mode: "merge" } } as never, {}, null);
  assert.equal(c.branches.integration, "sandbox");
  const r = (model: "trunk" | "integ") => ({ config: { ...c, model } }) as never;
  assert.equal(cam.baseBranch(r("integ")), "sandbox");
  assert.equal(cam.baseBranch(r("trunk")), "main");
  assert.deepEqual(cam.baseBranches(r("trunk")), ["main"]);
});

test("B5: required checks hold without the branch rule being on", async () => {
  const guard = await import("../src/camino/guard.js");
  const fake = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ config: { rules: { main: { on: false } }, required_checks: { main: ["test"] } } }] }) }) }) } as never;
  const rules = await guard.mergeRules(fake, { id: "p" } as never);
  assert.deepEqual(rules.required("main"), ["test"]);
  assert.deepEqual(rules.required("other"), []);
});

test("I1: work branches follow the pattern; the default is neutral", async () => {
  const { branchFor, DEFAULT_WORK_PATTERN } = await import("../src/runner/worktree.js");
  assert.equal(DEFAULT_WORK_PATTERN, "plania/<clave>");
  assert.equal(branchFor("PLA-7"), "plania/pla-7");
  assert.equal(branchFor("PLA-7", "feat/<clave>"), "feat/pla-7");
  assert.equal(branchFor("PLA-7", "no-placeholder"), "plania/pla-7");
  assert.equal(branchFor("PLA-7", "../<clave>"), "plania/pla-7");
  assert.equal(effectiveConfig({} as never, {}, null).branches.work_pattern, "plania/<clave>");
  assert.equal(effectiveConfig({} as never, { branches: { work_pattern: "feat/<clave>" } }, null).branches.work_pattern, "feat/<clave>");
});
