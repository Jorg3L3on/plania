import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { execute } from "../src/scan/run.ts";
import { syntheticEvm } from "../src/scan/wallets.ts";

const KEYS = ["PLANIA_SCAN_HASHES", "PLANIA_SCAN_HASHES_JSON", "PLANIA_SCAN_ALLOWLIST", "PLANIA_SCAN_HASH_SALT"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function scan(repo: string) {
  return execute({ repo, mode: "path", base: "main", head: "HEAD", noGitleaks: true, allowlistPath: "/dev/null" });
}

test("the clean fixture passes and the failing fixture reports the fake email only as a rule", async () => {
  const clean = await scan(fileURLToPath(new URL("../fixtures/clean", import.meta.url)));
  assert.equal(clean.error, null);
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.findings, []);

  const fail = await scan(fileURLToPath(new URL("../fixtures/fail", import.meta.url)));
  assert.equal(fail.error, null);
  assert.equal(fail.ok, false);
  assert.equal(fail.findings.some((finding) => finding.rule === "plania-email"), true);
  const leaked = "fixture.scanner@mail-ficticio.mx";
  assert.equal(JSON.stringify(fail.findings).includes(leaked), false);
});

test("a synthetic wallet in a temp file is a finding and is not copied into the report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plania-fixture-"));
  const address = syntheticEvm("scanner-fixture");
  writeFileSync(join(dir, "note.txt"), `wallet ${address}\n`, { mode: 0o600 });
  const report = await scan(dir);
  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.rule === "plania-evm-address"), true);
  assert.equal(JSON.stringify(report.findings).includes(address), false);
});
