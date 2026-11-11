import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkFiles, checkRuleset } from "../rulesets/check.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "rulesets");

test("the three prepared rulesets differ only by enforcement", () => {
  assert.deepEqual(checkFiles(dir), []);
  const broken = {
    name: "plania-scan",
    target: "branch",
    enforcement: "active",
    bypass_actors: [
      { actor_id: 4, actor_type: "RepositoryRole", bypass_mode: "always" },
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
    ],
    conditions: { ref_name: { include: ["refs/heads/main"] } },
    rules: [{ type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "plania-scan", integration_id: 1 }] } }],
  };
  const errors = checkRuleset(broken, "active");
  assert.equal(errors.includes("bypass count"), true);
  assert.equal(errors.includes("integration_id"), true);
  assert.equal(errors.includes("strict"), true);
});
