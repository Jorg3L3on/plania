import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkFiles, checkRuleset } from "../rulesets/check.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "rulesets");

test("default rulesets have no bypass, and the admin file is the only exception", () => {
  assert.deepEqual(checkFiles(dir), []);
  const broken = {
    name: "plania-scan",
    target: "branch",
    enforcement: "active",
    bypass_actors: [
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
    ],
    conditions: { ref_name: { include: ["refs/heads/main"] } },
    rules: [{ type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "plania-scan", integration_id: 1 }] } }],
  };
  const errors = checkRuleset(broken, "active");
  assert.equal(errors.includes("bypass count"), true);
  assert.equal(errors.includes("integration_id"), true);
  assert.equal(errors.includes("strict"), true);
  const admin = JSON.parse(readFileSync(join(dir, "plania-scan.active.admin-bypass.json"), "utf8"));
  assert.deepEqual(checkRuleset(admin, "active", "admin"), []);
  assert.equal(checkRuleset(admin, "active", "none").includes("bypass count"), true);
});

test("the README keeps the empty bypass, the disable command, and the status-source warning", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /plania-scan\.active\.admin-bypass\.json/);
  assert.match(readme, /Bots merge as the repository owner/);
  assert.match(readme, /--input rulesets\/plania-scan\.disabled\.json/);
  assert.match(readme, /realistic path on this Free account is `disabled`, then `active`/);
  assert.match(readme, /anyone with commit statuses write/);
  assert.equal(readme.includes("bypass_mode: always` is the quota hatch"), false);
});
