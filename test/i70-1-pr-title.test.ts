// PLA-I70-1: the PR-title workflow's pattern must work under real grep -E for every convention and ticket placement.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { needs } from "./platform.js";

const C = (await import(new URL("../ui/src/lib/camino-commits.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-commits.js");
const { DEFAULT_COMMITS } = await import("../src/camino/config.js");

const conventions = ["conventional", "area", "ticket", "gitmoji", "classic", "kernel"] as const;
const placements = ["no", "prefijo", "final", "trailer"] as const;

test("eres keeps \\d as a bracket expression outside classes and a bare range inside", () => {
  assert.equal(C.eres("^[A-Z]+-\\d+$"), "^[A-Z]+-[0-9]+$");
  assert.equal(C.eres("^[a-z\\d]+$"), "^[a-z0-9]+$");
  assert.doesNotMatch(C.eres("^[A-Z][A-Z0-9]+-[A-Z0-9-]*\\d[A-Z0-9-]*: x$"), /\]\*0-9\[/);
});

test("every convention × ticket placement: valid titles pass, invalid fail, under grep -E", { skip: needs({ posix: true }) }, () => {
  for (const c of conventions) {
    for (const ticket of placements) {
      const st = { ...DEFAULT_COMMITS, convention: c, ticket, scope: "opcional" as const };
      const yml = C.prTitleWorkflow(c, st, "en");
      assert.ok(yml, `${c}/${ticket}`);
      const ere = yml!.match(/grep -Eq '(.+)'; then/)![1]!.replace(/'\\''/g, "'");
      const grep = (t: string) => spawnSync("grep", ["-Eq", ere], { input: t, env: { ...process.env, LC_ALL: "en_US.UTF-8" } }).status;
      const core: Record<string, string> = {
        conventional: "feat(web): add pricing",
        area: "Billing: add pricing",
        ticket: "FAR-221: add pricing",
        gitmoji: "✨ add pricing",
        classic: "Add pricing",
        kernel: "web: add pricing",
      };
      let good = core[c]!;
      if (ticket === "prefijo" && c !== "ticket") good = `FAR-221: ${good}`;
      if (ticket === "final" && c !== "ticket" && c !== "area") good = `${good} (FAR-221)`;
      assert.equal(grep(good), 0, `${c}/${ticket} should accept «${good}» with ${ere}`);
      assert.equal(grep(""), 1, `${c}/${ticket} should reject the empty title`);
      if (c === "ticket") assert.equal(grep("add pricing"), 1, `${c}/${ticket} rejects a title with no key`);
      if (c === "conventional") assert.equal(grep("Add pricing"), 1);
    }
  }
});
