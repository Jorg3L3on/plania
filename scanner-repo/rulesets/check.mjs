// Local check for the prepared rulesets. It does not call GitHub.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT = "plania-scan";
const MODES = ["evaluate", "active", "disabled"];

export function checkRuleset(data, mode) {
  const errors = [];
  if (!data || typeof data !== "object") return ["not an object"];
  if (data.name !== CONTEXT) errors.push("name");
  if (data.target !== "branch") errors.push("target");
  if (data.enforcement !== mode) errors.push("enforcement");
  const actors = data.bypass_actors;
  if (!Array.isArray(actors) || actors.length !== 1) errors.push("bypass count");
  else {
    const actor = actors[0];
    if (actor.actor_id !== 5) errors.push("actor_id");
    if (actor.actor_type !== "RepositoryRole") errors.push("actor_type");
    if (actor.bypass_mode !== "always") errors.push("bypass_mode");
  }
  const include = data.conditions?.ref_name?.include;
  if (!Array.isArray(include) || include.length !== 2 || include[0] !== "~DEFAULT_BRANCH" || include[1] !== "refs/heads/sandbox") {
    errors.push("include");
  }
  const rules = data.rules;
  if (!Array.isArray(rules) || rules.length !== 1 || rules[0].type !== "required_status_checks") errors.push("rule");
  else {
    const params = rules[0].parameters ?? {};
    if (params.strict_required_status_checks_policy !== false) errors.push("strict");
    const checks = params.required_status_checks;
    if (!Array.isArray(checks) || checks.length !== 1 || checks[0].context !== CONTEXT) errors.push("context");
    else if (Object.prototype.hasOwnProperty.call(checks[0], "integration_id")) errors.push("integration_id");
  }
  return errors;
}

export function checkFiles(dir) {
  const problems = [];
  for (const mode of MODES) {
    const file = join(dir, `plania-scan.${mode}.json`);
    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      problems.push(`${mode}: unreadable`);
      continue;
    }
    for (const error of checkRuleset(data, mode)) problems.push(`${mode}: ${error}`);
  }
  return problems;
}

function invokedDirectly() {
  const file = process.argv[1];
  if (!file) return false;
  return file.endsWith(`${sep()}rulesets${sep()}check.mjs`) || file.endsWith("rulesets/check.mjs");
}

function sep() {
  return process.platform === "win32" ? "\\" : "/";
}

if (invokedDirectly()) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const problems = checkFiles(dir);
  if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("rulesets ok\n");
}
