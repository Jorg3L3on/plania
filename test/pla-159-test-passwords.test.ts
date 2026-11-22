// PLA-159: useTestEnv's scratch password file goes away with the test process; a path a test set itself stays.
// Each case runs a child node process that sets the test environment, writes the file and exits.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const TMP = mkdtempSync(path.join(tmpdir(), "plania-159-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const helpers = new URL("./helpers.ts", import.meta.url).href;

const child = (env: NodeJS.ProcessEnv): string => {
  const script = path.join(TMP, `child-${Date.now()}.mts`);
  writeFileSync(
    script,
    `const { useTestEnv } = await import(${JSON.stringify(helpers)});
useTestEnv();
const { writeFileSync } = await import("node:fs");
writeFileSync(process.env.PLANIA_TEST_PASSWORDS_FILE, "{}", { mode: 0o600 });
console.log(process.env.PLANIA_TEST_PASSWORDS_FILE);
process.exit(0);
`,
  );
  const { PLANIA_TEST_PASSWORDS_FILE: _drop, ...rest } = process.env;
  return execFileSync(process.execPath, ["--import", "tsx", script], { env: { ...rest, ...env }, encoding: "utf8" }).trim().split("\n").at(-1)!;
};

test("PLA-159 #1: the file useTestEnv chose is gone once the test process ends", () => {
  const file = child({});
  assert.match(path.basename(file), /^plania-test-passwords-\d+\.json$/);
  assert.equal(existsSync(file), false);
});

test("PLA-159 #2: a path the test set itself is left alone", () => {
  const own = path.join(TMP, "own-passwords.json");
  assert.equal(child({ PLANIA_TEST_PASSWORDS_FILE: own }), own);
  assert.equal(existsSync(own), true);
});
