import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const header = "// Vendored from src/lib/scan for the private scanner repo. No plaintext patterns.\n";

test("vendored scan modules match src/lib/scan aside from import suffixes and the config path", () => {
  const sourceDir = join(root, "src/lib/scan");
  const vendorDir = join(root, "scanner-repo/src/scan");
  const names = readdirSync(sourceDir).filter((name) => name.endsWith(".ts")).sort();
  assert.deepEqual(readdirSync(vendorDir).filter((name) => name.endsWith(".ts")).sort(), names);
  for (const name of names) {
    let vendored = readFileSync(join(vendorDir, name), "utf8");
    assert.equal(vendored.startsWith(header), true, name);
    vendored = vendored.slice(header.length).replaceAll('.ts"', '.js"');
    if (name === "gitleaks.ts") {
      vendored = vendored.replace(
        'new URL("../../config/plania-gitleaks.toml", import.meta.url)',
        'new URL("../../../config/plania-gitleaks.toml", import.meta.url)',
      );
    }
    assert.equal(vendored, readFileSync(join(sourceDir, name), "utf8"), name);
  }
  assert.equal(
    readFileSync(join(root, "scanner-repo/config/plania-gitleaks.toml"), "utf8"),
    readFileSync(join(root, "config/plania-gitleaks.toml"), "utf8"),
  );
});
