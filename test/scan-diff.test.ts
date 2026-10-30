// PLA-04: scan-diff finds personal data and secrets in the lines a branch adds, masks every value,
// passes a clean diff and respects the allowlist. All values are synthetic, and the token-shaped ones
// are built at run time so no secret-shaped string is committed. The repo is a scratch one in tmp.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { addedLines } from "../src/lib/scan/diff.js";
import { envFile, luhn, mask, parseAllowlist, scanLine, validClabe } from "../src/lib/scan/patterns.js";

// A CLABE with a valid check digit, computed here from 17 made-up digits.
function clabe(first17: string): string {
  const w = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(first17[i]) * w[i % 3]!) % 10;
  return first17 + String((10 - (sum % 10)) % 10);
}
const CLABE = clabe("01218000123456789");
const CARD = ["4111", "1111", "1111", "1111"].join(""); // the published Visa test number
const GH_TOKEN = ["gh", "p_", "Zq7".repeat(12)].join("");
const SK_KEY = ["sk", "-", "x9Y".repeat(10)].join("");
const AWS = ["AK", "IA", "Q".repeat(16)].join("");
const PRIVATE = ["-----BEGIN ", "RSA ", "PRIVATE KEY-----"].join("");
const CRED_URL = ["postgres://", "app", ":", "s3cretpw", "@db.internal:5432/app"].join("");
const CURP = "GOMA800101HDFRRN09";
const RFC = "GOMA800101AB1";
const EMAIL = "ana.perez@correo-ficticio.mx";

test("helpers: CLABE check digit, Luhn, mask, env files, allowlist", () => {
  assert.equal(validClabe(CLABE), true);
  assert.equal(validClabe(CLABE.slice(0, 17) + String((Number(CLABE[17]) + 1) % 10)), false);
  assert.equal(luhn(CARD), true);
  assert.equal(luhn("4111111111111112"), false);
  for (const v of [CLABE, CARD, GH_TOKEN, EMAIL, "abc", "abcdefgh"]) {
    const m = mask(v);
    assert.notEqual(m, v);
    assert.equal(m.includes(v), false);
  }
  assert.equal(envFile(".env"), true);
  assert.equal(envFile("apps/web/.env.local"), true);
  assert.equal(envFile(".env.example"), false);
  assert.equal(envFile("src/env.ts"), false);
  const a = parseAllowlist(`# fake values\n${EMAIL}\n/^4111/\n`);
  assert.equal(a.exact.has(EMAIL), true);
  assert.equal(a.patterns.length, 1);
});

test("each pattern is found in an added line", () => {
  const kinds = (line: string) => scanLine(line).map((f) => `${f.kind}:${f.confidence}`);
  assert.deepEqual(kinds(`const t = "${GH_TOKEN}";`), ["token:high"]);
  assert.deepEqual(kinds(`OPENAI=${SK_KEY}`), ["token:high"]);
  assert.deepEqual(kinds(`aws ${AWS}`), ["token:high"]);
  assert.deepEqual(kinds(PRIVATE), ["private_key:high"]);
  assert.deepEqual(kinds(`url: "${CRED_URL}"`), ["credential_url:high"]);
  assert.deepEqual(kinds(`cuenta ${CLABE}`), ["clabe:high"]);
  assert.deepEqual(kinds(`tarjeta ${CARD.replace(/(\d{4})(?=\d)/g, "$1 ")}`), ["card:high"]);
  assert.deepEqual(kinds(`curp: ${CURP}`), ["curp:high"]);
  assert.deepEqual(kinds(`rfc: ${RFC}`), ["rfc:hint"]);
  assert.deepEqual(kinds(`contacto ${EMAIL}`), ["email:hint"]);
  // Not findings: safe email domains, a number that fails both checks, ordinary code.
  assert.deepEqual(kinds("dev@example.com, bot@ci.test, 12345+user@users.noreply.github.com"), []);
  assert.deepEqual(kinds("id 123456789012345678 and 4111111111111112"), []);
  assert.deepEqual(kinds("const total = items.reduce((a, b) => a + b, 0);"), []);
});

test("the allowlist silences a value, literal or /regex/", () => {
  const allow = parseAllowlist(`${EMAIL}\n/^4111/\n`);
  assert.deepEqual(scanLine(`${EMAIL} ${CARD}`, allow), []);
  assert.equal(scanLine(`${EMAIL} ${CLABE}`, allow).length, 1);
});

test("added lines carry the file and the new line number; removed lines are skipped", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -3,0 +4,2 @@",
    "+one",
    "+two",
    "@@ -10 +12 @@",
    "-gone",
    "+three",
    "diff --git a/old.txt b/old.txt",
    "--- a/old.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
  ].join("\n");
  const { lines, files } = addedLines(diff);
  assert.deepEqual(lines, [
    { file: "src/a.ts", line: 4, text: "one" },
    { file: "src/a.ts", line: 5, text: "two" },
    { file: "src/a.ts", line: 12, text: "three" },
  ]);
  assert.deepEqual(files, ["src/a.ts"]);
});

describe("scan-diff on a scratch repo", () => {
  let repo: string;
  let home: string;
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  const run = (env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", path.resolve(import.meta.dirname, "../scripts/scan-diff.ts"), repo, "main"], {
      encoding: "utf8",
      env: { ...process.env, PLANIA_SCAN_ALLOWLIST: path.join(home, "no-allowlist"), ...env },
    });

  before(() => {
    repo = mkdtempSync(path.join(tmpdir(), "plania-scan-"));
    home = mkdtempSync(path.join(tmpdir(), "plania-scan-home-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "scan@example.com");
    git("config", "user.name", "scan test");
    writeFileSync(path.join(repo, "README.md"), "# scratch\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature");
  });

  after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test("a clean diff exits 0", () => {
    writeFileSync(path.join(repo, "clean.ts"), "export const sum = (a: number, b: number) => a + b;\n// owner: dev@example.com\n");
    git("add", ".");
    git("commit", "-q", "-m", "clean");
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PII scan: 0 high, 0 hints/);
  });

  test("findings print masked with file and line, exit 1, and never the full value", () => {
    writeFileSync(path.join(repo, "leak.ts"), [`export const token = "${GH_TOKEN}";`, `// cuenta ${CLABE}`, `// ${EMAIL}`, `const db = "${CRED_URL}";`, ""].join("\n"));
    writeFileSync(path.join(repo, ".env"), "SECRET=1\n");
    git("add", ".");
    git("commit", "-q", "-m", "leak");
    const r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /leak\.ts:1: HIGH token de GitHub /);
    assert.match(r.stdout, /leak\.ts:2: HIGH CLABE válida /);
    assert.match(r.stdout, /leak\.ts:3: hint correo /);
    assert.match(r.stdout, /leak\.ts:4: HIGH URL con credenciales /);
    assert.match(r.stdout, /\.env: HIGH archivo \.env en el diff/);
    assert.match(r.stdout, /PII scan: 4 high, 1 hint/);
    for (const v of [GH_TOKEN, CLABE, EMAIL, CRED_URL, "s3cretpw"]) assert.equal((r.stdout + r.stderr).includes(v), false, `leaked ${v.slice(0, 4)}`);
    // Read-only: the scan left the scratch repo clean.
    assert.equal(spawnSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).stdout, "");
  });

  test("allowlisted values are ignored", () => {
    const list = path.join(home, "scan-allowlist");
    writeFileSync(list, `${EMAIL}\n`);
    const r = run({ PLANIA_SCAN_ALLOWLIST: list });
    assert.match(r.stdout, /PII scan: 4 high, 0 hints/);
    assert.equal(r.stdout.includes("correo"), false);
  });

  test("a bad base is a usage error, not a pass", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", path.resolve(import.meta.dirname, "../scripts/scan-diff.ts"), repo, "no-such-branch"], { encoding: "utf8" });
    assert.equal(r.status, 2);
  });
});
