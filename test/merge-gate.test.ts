// PLA-I38-2: merge-gate scans a temporary bare clone and refuses a moved head.
// Values are synthetic. The matched text must not appear in the output.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { webCtx } from "../src/mcp/tx.js";
import { recordAllowlistException } from "../src/mcp/scan-allow.js";
import { parseMergeArgs } from "../src/lib/scan/merge-cli.js";
import { projectForTicket } from "../src/lib/scan/merge-record.js";
import { gitAuthHeader, mergeGateExit, redact, renderMergeJson, runMergeGate, type FetchLike } from "../src/lib/scan/merge-gate.js";
import type { ScanReport } from "../src/lib/scan/report.js";

const EMAIL = "fixture@scan-demo.co";
const script = path.resolve(import.meta.dirname, "../scripts/merge-gate.ts");

function git(repo: string, ...args: string[]) {
  const ran = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
}

function shaOf(repo: string, ref: string): string {
  const ran = spawnSync("git", ["-C", repo, "rev-parse", ref], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

function pull(sha: string) {
  return { head: { sha, ref: "feature" }, base: { ref: "main" } };
}

const cleanScan = async (): Promise<ScanReport> => ({
  version: 1,
  ok: true,
  mode: "diff",
  repo: null,
  base: "main",
  head: "feature",
  diff: null,
  gitleaksRange: null,
  findings: [],
  gitleaks: { ran: true, version: "8.30.1", pinned: "8.30.1", skipped: false, error: null },
  error: null,
});

let repo: string;
let home: string;
let head = "";
const previousAllow = process.env.PLANIA_SCAN_ALLOWLIST;
const previousHashes = process.env.PLANIA_SCAN_HASHES;
const previousInline = process.env.PLANIA_SCAN_HASHES_JSON;

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "plania-merge-src-"));
  home = mkdtempSync(path.join(tmpdir(), "plania-merge-home-"));
  process.env.PLANIA_SCAN_ALLOWLIST = path.join(home, "missing-allowlist");
  process.env.PLANIA_SCAN_HASHES = "";
  delete process.env.PLANIA_SCAN_HASHES_JSON;
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "scan@example.com");
  git(repo, "config", "user.name", "scan test");
  git(repo, "config", "uploadpack.allowFilter", "true");
  writeFileSync(path.join(repo, "README.md"), "# scratch\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "feature");
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  if (previousAllow === undefined) delete process.env.PLANIA_SCAN_ALLOWLIST;
  else process.env.PLANIA_SCAN_ALLOWLIST = previousAllow;
  if (previousHashes === undefined) delete process.env.PLANIA_SCAN_HASHES;
  else process.env.PLANIA_SCAN_HASHES = previousHashes;
  if (previousInline === undefined) delete process.env.PLANIA_SCAN_HASHES_JSON;
  else process.env.PLANIA_SCAN_HASHES_JSON = previousInline;
});

test("usage exits 2 and names the command", () => {
  assert.equal(parseMergeArgs([]).ok, false);
  const ran = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8" });
  assert.equal(ran.status, 2);
  assert.match(ran.stderr, /pnpm merge-gate <owner\/repo> <pr-number>/);
  assert.equal(ran.stdout, "");
});

test("a clean range passes, gitleaks ran, and the temp clone is removed", async () => {
  writeFileSync(path.join(repo, "clean.ts"), "export const n = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "clean");
  head = shaOf(repo, "feature");
  const before = readdirSync(tmpdir()).filter((name) => name.startsWith("plania-merge-gate-"));
  const result = await runMergeGate(
    { repo: "example/app", pr: 4 },
    {
      token: null,
      origin: repo,
      headRefspec: "refs/heads/feature",
      fetch: async () => ({ ok: true, status: 200, json: async () => pull(head) }),
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.gitleaks.ran, true);
  assert.equal(result.gitleaks.error, null);
  assert.equal(result.head, head);
  assert.equal(result.merged, false);
  assert.deepEqual(result.findings, []);
  assert.equal(mergeGateExit(result), 0);
  const after = readdirSync(tmpdir()).filter((name) => name.startsWith("plania-merge-gate-"));
  assert.deepEqual(after, before);
});

test("a finding blocks, the value is absent, and an allowlist path lets the same range pass", async () => {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.join(repo, "src"), { recursive: true });
  writeFileSync(path.join(repo, "src", "note.ts"), `export const contact = "${EMAIL}";\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "note");
  head = shaOf(repo, "feature");
  const fetchOnce: FetchLike = async () => ({ ok: true, status: 200, json: async () => pull(head) });
  const blocked = await runMergeGate({ repo: "example/app", pr: 4 }, { token: null, origin: repo, headRefspec: "refs/heads/feature", fetch: fetchOnce });
  assert.equal(blocked.ok, false);
  assert.equal(mergeGateExit(blocked), 1);
  assert.equal(blocked.findings.some((finding) => finding.file === "src/note.ts" && finding.rule.length > 0 && finding.line > 0), true);
  const printed = renderMergeJson(blocked);
  assert.equal(printed.includes(EMAIL), false);
  assert.equal(printed.includes("scan-demo"), false);
  assert.throws(() => recordAllowlistException({ actor: { agent: "taller", session_id: "s" }, human: true }, "path:src/note.ts"), /HUMAN_ONLY/);
  const list = path.join(home, "allow");
  process.env.PLANIA_SCAN_ALLOWLIST = list;
  const recorded = recordAllowlistException(webCtx, "path:src/note.ts", list);
  assert.equal(recorded.entry_kind, "path");
  const passed = await runMergeGate({ repo: "example/app", pr: 4 }, { token: null, origin: repo, headRefspec: "refs/heads/feature", fetch: fetchOnce });
  assert.equal(passed.ok, true, JSON.stringify(passed));
  assert.equal(passed.gitleaks.ran, true);
  assert.equal(passed.gitleaks.error, null);
  assert.deepEqual(passed.findings, []);
});

test("a changed head is not merged", async () => {
  const scanned = shaOf(repo, "feature");
  let merges = 0;
  let reads = 0;
  const result = await runMergeGate(
    { repo: "example/app", pr: 4, method: "squash" },
    {
      token: null,
      origin: repo,
      headRefspec: "refs/heads/feature",
      scan: cleanScan,
      fetch: async (url) => {
        if (url.endsWith("/merge")) {
          merges += 1;
          return { ok: true, status: 200, json: async () => ({ merged: true }) };
        }
        reads += 1;
        const sha = reads === 1 ? scanned : "b".repeat(40);
        return { ok: true, status: 200, json: async () => pull(sha) };
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "head changed");
  assert.equal(result.merged, false);
  assert.equal(merges, 0);
  assert.equal(mergeGateExit(result), 2);
});

test("an unchanged head is merged with sha pinned to the scanned head", async () => {
  const scanned = shaOf(repo, "feature");
  let sent: { sha?: string; merge_method?: string } = {};
  const result = await runMergeGate(
    { repo: "example/app", pr: 4, method: "squash" },
    {
      token: null,
      origin: repo,
      headRefspec: "refs/heads/feature",
      scan: cleanScan,
      fetch: async (url, init) => {
        if (url.endsWith("/merge")) {
          sent = JSON.parse(init?.body ?? "{}") as { sha?: string; merge_method?: string };
          return { ok: true, status: 200, json: async () => ({ merged: true }) };
        }
        return { ok: true, status: 200, json: async () => pull(scanned) };
      },
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.merged, true);
  assert.equal(result.method, "squash");
  assert.equal(sent.sha, scanned);
  assert.equal(sent.merge_method, "squash");
  assert.equal(renderMergeJson(result).includes(EMAIL), false);
});

test("--record sends the redacted report, command merge-gate, and the scanned head", async () => {
  const scanned = shaOf(repo, "feature");
  const recorded: { ticket: string; commit: string; cite: string; command: string; verdict: string }[] = [];
  const result = await runMergeGate(
    { repo: "example/app", pr: 4, ticket: "FIL-1" },
    {
      token: null,
      origin: repo,
      headRefspec: "refs/heads/feature",
      scan: cleanScan,
      record: async (input) => {
        recorded.push(input);
      },
      fetch: async () => ({ ok: true, status: 200, json: async () => pull(scanned) }),
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.ticket, "FIL-1");
  assert.equal(recorded[0]!.commit, scanned);
  assert.equal(recorded[0]!.command, "merge-gate");
  assert.equal(recorded[0]!.verdict, "pass");
  const cite = JSON.parse(recorded[0]!.cite) as { head: string; findings: unknown[] };
  assert.equal(cite.head, scanned);
  assert.deepEqual(cite.findings, []);
  assert.equal(recorded[0]!.cite.includes(EMAIL), false);
  assert.equal(parseMergeArgs(["example/app", "4", "--record", "FIL-1", "--merge", "squash"]).ok, true);
  assert.equal(projectForTicket([{ slug: "filmia", key_prefix: "FIL" }, { slug: "other", key_prefix: "F" }], "FIL-1"), "filmia");
});

test("a failed record does not merge", async () => {
  const scanned = shaOf(repo, "feature");
  let merges = 0;
  const result = await runMergeGate(
    { repo: "example/app", pr: 4, method: "squash", ticket: "FIL-1" },
    {
      token: null,
      origin: repo,
      headRefspec: "refs/heads/feature",
      scan: cleanScan,
      record: async () => {
        throw new Error("plania record failed");
      },
      fetch: async (url) => {
        if (url.endsWith("/merge")) {
          merges += 1;
          return { ok: true, status: 200, json: async () => ({ merged: true }) };
        }
        return { ok: true, status: 200, json: async () => pull(scanned) };
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.merged, false);
  assert.equal(merges, 0);
  assert.equal(result.error, "plania record failed");
});

test("PLA-13: git auth uses basic x-access-token, never bearer, and is redacted", () => {
  const header = gitAuthHeader("gho_example123");
  assert.equal(header, `AUTHORIZATION: basic ${Buffer.from("x-access-token:gho_example123").toString("base64")}`);
  assert.doesNotMatch(header, /bearer/i);
  const leaked = `fatal: unable to access: ${header.replace("AUTHORIZATION: ", "")} failed`;
  assert.doesNotMatch(redact(leaked), /eC1hY2Nlc3MtdG9rZW46/);
});
