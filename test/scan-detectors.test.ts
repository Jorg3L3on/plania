// PLA-I38-1: wallets, balances, hashed names, allowlist paths, redaction, and gitleaks.
// Every fixture is synthetic. Token-shaped strings are built at run time.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { parseArgs } from "../src/lib/scan/cli.js";
import { allowlistToml, findingsFromReport, GITLEAKS_PIN, gitleaksAsset, resolveGitleaks } from "../src/lib/scan/gitleaks.js";
import { hashToken, lineHasKnownString, normalizeToken, parseHashList } from "../src/lib/scan/hashes.js";
import { EMPTY_ALLOWLIST, parseAllowlist, pathAllowed, scanLine } from "../src/lib/scan/patterns.js";
import { renderJson, type ScanReport } from "../src/lib/scan/report.js";
import { decodeBase58, encodeBase58Check, fixtureBytes, syntheticBtcBase58, syntheticBtcBech32, syntheticEvm, syntheticSolana, validBtcBase58, validBtcBech32 } from "../src/lib/scan/wallets.js";

const script = path.resolve(import.meta.dirname, "../scripts/scan-diff.ts");
const hashScript = path.resolve(import.meta.dirname, "../scripts/scan-hashes.ts");

function runScan(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PLANIA_SCAN_ALLOWLIST: "", PLANIA_SCAN_HASHES: "", PLANIA_SCAN_HASHES_JSON: "", ...env },
  });
}

function initRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "plania-scan-"));
  const git = (...gitArgs: string[]) => {
    const ran = spawnSync("git", ["-C", repo, ...gitArgs], { encoding: "utf8" });
    assert.equal(ran.status, 0);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "scan@example.com");
  git("config", "user.name", "scan test");
  writeFileSync(path.join(repo, "README.md"), "# scratch\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  return repo;
}

function fakePrefectToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = createHash("sha256").update("plania-scan-fixture-prefect").digest();
  let body = "";
  for (let i = 0; i < 36; i++) body += alphabet[(bytes[i % bytes.length] ?? 0) % alphabet.length] ?? "";
  return `pnu_${body}`;
}

test("cli accepts the diff form and the path form", () => {
  const diff = parseArgs(["--json", "--base", "main", "--head", "topic", "/work/repo"]);
  assert.equal(diff.ok, true);
  if (!diff.ok) return;
  assert.equal(diff.json, true);
  assert.equal(diff.options.mode, "diff");
  assert.equal(diff.options.base, "main");
  assert.equal(diff.options.head, "topic");
  assert.equal(diff.options.repo, "/work/repo");
  const asPath = parseArgs(["--path", "/work/tree", "--no-gitleaks"]);
  assert.equal(asPath.ok, true);
  if (!asPath.ok) return;
  assert.equal(asPath.options.mode, "path");
  assert.equal(asPath.options.noGitleaks, true);
  assert.equal(parseArgs(["--path", "/work", "/also"]).ok, false);
  assert.equal(parseArgs([]).ok, false);
});

test("wallet shapes match checksums and ignore near-misses", () => {
  const payload = fixtureBytes("codec", 20);
  const encoded = encodeBase58Check(0, payload);
  const decoded = decodeBase58(encoded);
  assert.ok(decoded);
  assert.equal(decoded[0], 0);
  assert.deepEqual(Buffer.from(decoded.subarray(1, 21)), Buffer.from(payload));
  assert.equal(validBtcBase58(encoded), true);

  const evm = syntheticEvm("shape");
  const bech = syntheticBtcBech32("shape");
  const btc = syntheticBtcBase58("shape");
  const sol = syntheticSolana("shape");
  assert.equal(validBtcBech32(bech), true);
  const rules = (line: string) => scanLine(line).map((finding) => finding.rule);
  assert.ok(rules(`pay ${evm}`).includes("plania-evm-address"));
  assert.ok(rules(`pay ${bech}`).includes("plania-btc-bech32"));
  assert.ok(rules(`pay ${btc}`).includes("plania-btc-base58"));
  assert.ok(rules(`pay ${sol}`).includes("plania-solana-address"));
  assert.equal(rules(`0x${"0".repeat(40)}`).includes("plania-evm-address"), false);
  assert.equal(rules(`0x${"ab".repeat(32)}`).includes("plania-evm-address"), false);
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const flipped = `${bech.slice(0, -1)}${charset[(charset.indexOf(bech.slice(-1).toLowerCase()) + 1) % charset.length]}`;
  assert.equal(validBtcBech32(flipped), false);
  assert.equal(rules(flipped).includes("plania-btc-bech32"), false);
  const brokenBtc = `${btc.slice(0, -1)}${btc.endsWith("2") ? "3" : "2"}`;
  assert.equal(validBtcBase58(brokenBtc), false);
  assert.equal(rules(brokenBtc).includes("plania-btc-base58"), false);
});

test("balance amounts need a money word or a currency marker", () => {
  const rules = (line: string) => scanLine(line).filter((finding) => finding.rule === "plania-balance");
  assert.equal(rules("saldo: 1500.00").length, 1);
  assert.equal(rules("saldo: 80").length, 1);
  assert.equal(rules("balance USD 10").length, 1);
  assert.equal(rules("importe MXN 1,500").length, 1);
  assert.equal(rules("pending $20").length, 0);
  assert.equal(rules("const balance = 1").length, 0);
  assert.equal(rules("let balance = 100").length, 0);
  assert.equal(rules("timeout 1500").length, 0);
});

test("hashed names match normalized tokens and n-grams, and the allowlist wins", () => {
  const salt = "example-salt";
  const full = "nombre ejemplo";
  const list = parseHashList(JSON.stringify({ salt, hashes: [hashToken(salt, full), hashToken(salt, "cuenta-demo-000")] }));
  assert.equal(normalizeToken("  Nómbre   Éjemplo "), full);
  assert.equal(lineHasKnownString('owner = "Nómbre Éjemplo"', list, EMPTY_ALLOWLIST), true);
  assert.equal(lineHasKnownString("hola nombre ejemplo extra", list, EMPTY_ALLOWLIST), true);
  assert.equal(lineHasKnownString("solo nombre", list, EMPTY_ALLOWLIST), false);
  assert.equal(lineHasKnownString("id cuenta-demo-000", list, EMPTY_ALLOWLIST), true);
  const allow = parseAllowlist("nombre ejemplo\n");
  assert.equal(lineHasKnownString("nombre ejemplo", list, allow), false);
  assert.throws(() => parseHashList('{"salt":"x","hashes":["nope"]}'));
});

test("path allowlist entries skip a file, a directory, and a suffix", () => {
  const allow = parseAllowlist("path:src/fixtures/\npath:.env\npath:/^vendor\\//\n");
  assert.equal(pathAllowed("src/fixtures/a.ts", allow), true);
  assert.equal(pathAllowed("apps/web/.env", allow), true);
  assert.equal(pathAllowed("vendor/lib.ts", allow), true);
  assert.equal(pathAllowed("src/app.ts", allow), false);
  const value = parseAllowlist("fixture@example.com\n");
  assert.deepEqual(scanLine("fixture@example.com", value), []);
});

test("gitleaks report parsing keeps rule, file, and line only", () => {
  const marker = "SHOULD-NOT-APPEAR";
  const findings = findingsFromReport(JSON.stringify([
    { RuleID: "mock-rule", File: "b/mock.ts", StartLine: 2, Secret: marker, Match: marker, Email: "hidden-person@example.com", Author: "Hidden Person", Message: marker },
  ]), "/repo");
  assert.deepEqual(findings, [{ rule: "mock-rule", file: "mock.ts", line: 2, engine: "gitleaks" }]);
  assert.equal(JSON.stringify(findings).includes(marker), false);
  assert.equal(JSON.stringify(findings).includes("hidden-person"), false);
  const asset = gitleaksAsset();
  assert.ok(asset);
  assert.equal(asset.sha256.length, 64);
  assert.match(asset.file, new RegExp(GITLEAKS_PIN.replaceAll(".", "\\.")));
  const toml = allowlistToml(parseAllowlist("fixture@example.com\npath:scratch/\n"));
  assert.ok(toml.includes("fixture@example\\\\.com"));
  assert.match(toml, /node_modules/);
});

test("the example hash file is the synthetic list and nothing else", () => {
  const example = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../scripts/scan/hashes.example.json"), "utf8")) as { salt: string; hashes: string[] };
  const names = ["persona ficticia", "nombre ejemplo", "cuenta-demo-000"];
  assert.equal(example.salt, "example-salt");
  assert.deepEqual(example.hashes, names.map((name) => hashToken(example.salt, name)));
  const raw = readFileSync(path.resolve(import.meta.dirname, "../scripts/scan/hashes.example.json"), "utf8");
  for (const name of names) assert.equal(raw.includes(name), false);
});

describe("scan-diff cli", () => {
  const repos: string[] = [];
  after(() => {
    for (const repo of repos) rmSync(repo, { recursive: true, force: true });
  });

  test("an email by itself is a finding and the value stays out of the output", () => {
    const repo = initRepo();
    repos.push(repo);
    const email = "persona@correo-ficticio.mx";
    writeFileSync(path.join(repo, "note.ts"), `export const contact = "${email}";\n`);
    spawnSync("git", ["-C", repo, "add", "."], { encoding: "utf8" });
    spawnSync("git", ["-C", repo, "commit", "-q", "-m", "note"], { encoding: "utf8" });
    const ran = runScan(["--no-gitleaks", "--json", repo, "main"]);
    assert.equal(ran.status, 1);
    const report = JSON.parse(ran.stdout) as ScanReport;
    assert.equal(report.ok, false);
    assert.equal(report.version, 1);
    assert.equal(report.mode, "diff");
    assert.equal(report.diff, "main...HEAD");
    assert.equal(report.gitleaksRange, "main..HEAD");
    assert.equal(report.gitleaks.skipped, true);
    assert.equal(report.gitleaks.pinned, GITLEAKS_PIN);
    assert.ok(report.findings.some((finding) => finding.rule === "plania-email" && finding.file === "note.ts" && finding.line === 1 && finding.engine === "plania"));
    assert.equal((ran.stdout + ran.stderr).includes(email), false);
    for (const finding of report.findings) assert.deepEqual(Object.keys(finding).sort(), ["engine", "file", "line", "rule"]);
  });

  test("path mode, hashes, allowlist, and redaction", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-scan-path-"));
    repos.push(dir);
    const email = "persona@correo-ficticio.mx";
    const amount = "1500.00";
    writeFileSync(path.join(dir, "note.ts"), [`export const who = "Nombre Ejemplo";`, `export const saldo = "${amount}";`, `export const contact = "${email}";`, ""].join("\n"));
    writeFileSync(path.join(dir, "skip.ts"), `export const contact = "${email}";\n`);
    const allowPath = path.join(dir, "allow");
    writeFileSync(allowPath, "path:skip.ts\n");
    const hashPath = path.join(dir, "hashes.json");
    const plain = path.join(dir, "plain.txt");
    writeFileSync(plain, "nombre ejemplo\n");
    const built = spawnSync(process.execPath, ["--import", "tsx", hashScript, "--in", plain, "--out", hashPath, "--salt", "example-salt"], { encoding: "utf8" });
    assert.equal(built.status, 0);
    assert.equal(built.stdout.includes("nombre"), false);
    assert.match(built.stderr, /wrote 1 hash/);
    assert.equal(readFileSync(hashPath, "utf8").includes("nombre"), false);
    const ran = runScan(["--path", dir, "--no-gitleaks", "--hashes", hashPath, "--allowlist", allowPath]);
    assert.equal(ran.status, 1);
    assert.match(ran.stdout, /^note\.ts:1 plania-known-string$/m);
    assert.match(ran.stdout, /^note\.ts:2 plania-balance$/m);
    assert.match(ran.stdout, /^note\.ts:3 plania-email$/m);
    assert.equal(ran.stdout.includes("skip.ts"), false);
    const combined = ran.stdout + ran.stderr;
    for (const secret of [email, amount, "Nombre", "Ejemplo", "nombre ejemplo"]) assert.equal(combined.includes(secret), false);
    for (const line of ran.stdout.trim().split("\n")) {
      if (line.startsWith("scan: ")) continue;
      assert.match(line, /^[^:\n]+:\d+ [A-Za-z0-9_.:-]+$/);
    }
  });

  test("a mock gitleaks report is redacted", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plania-scan-mock-"));
    repos.push(dir);
    writeFileSync(path.join(dir, "clean.ts"), "export const ok = 1;\n");
    const bin = path.join(dir, "gitleaks");
    const marker = "SHOULD-NOT-APPEAR";
    writeFileSync(bin, `#!/bin/sh
if [ "$1" = "version" ]; then echo "8.30.1"; exit 0; fi
report=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--report-path" ]; then report=$arg; fi
  prev=$arg
done
printf '%s\\n' '[{"RuleID":"mock-rule","File":"mock.ts","StartLine":2,"Secret":"${marker}","Match":"${marker}","Email":"hidden-person@example.com"}]' > "$report"
exit 1
`);
    chmodSync(bin, 0o755);
    const ran = runScan(["--path", dir, "--json", "--gitleaks-bin", bin]);
    assert.equal(ran.status, 1);
    const report = JSON.parse(ran.stdout) as ScanReport;
    assert.equal(report.gitleaks.ran, true);
    assert.equal(report.gitleaks.version, "8.30.1");
    assert.ok(report.findings.some((finding) => finding.engine === "gitleaks" && finding.rule === "mock-rule" && finding.file === "mock.ts" && finding.line === 2));
    assert.equal((ran.stdout + ran.stderr).includes(marker), false);
    assert.equal((ran.stdout + ran.stderr).includes("hidden-person"), false);
    assert.equal(renderJson(report).includes(marker), false);
  });

  test("gitleaks itself runs when the pinned binary is available", async (t) => {
    const resolved = await resolveGitleaks();
    if ("error" in resolved) {
      if (resolved.error === "gitleaks download failed") {
        t.skip(resolved.error);
        return;
      }
      assert.fail(resolved.error);
    }
    const repo = initRepo();
    repos.push(repo);
    const token = fakePrefectToken();
    const email = "persona@correo-ficticio.mx";
    const allowPath = path.join(repo, "allow.txt");
    writeFileSync(allowPath, `${email}\n`);
    writeFileSync(path.join(repo, "leak.ts"), `export const token = "${token}";\nexport const contact = "${email}";\n`);
    spawnSync("git", ["-C", repo, "add", "leak.ts"], { encoding: "utf8" });
    spawnSync("git", ["-C", repo, "commit", "-q", "-m", "fixture"], { encoding: "utf8" });
    const ran = runScan(["--json", "--gitleaks-bin", resolved.bin, "--allowlist", allowPath, repo, "main"]);
    assert.equal(ran.status, 1);
    const report = JSON.parse(ran.stdout) as ScanReport;
    assert.equal(report.error, null);
    assert.equal(report.gitleaks.ran, true);
    assert.equal(report.gitleaks.error, null);
    assert.equal(report.gitleaks.version, resolved.version);
    assert.ok(report.findings.some((finding) => finding.engine === "gitleaks" && finding.rule === "prefect-api-token"));
    assert.equal(report.findings.some((finding) => finding.rule === "plania-email"), false);
    const combined = ran.stdout + ran.stderr;
    assert.equal(combined.includes(token), false);
    assert.equal(combined.includes(email), false);
  });
});
