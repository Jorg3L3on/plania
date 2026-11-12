// PLA-I38-1: scan a git range or a checkout. Gitleaks covers secrets. TypeScript covers the
// personal-data rules and the hashed name list. Nothing is written into the scanned repo.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { addedLines } from "./diff.js";
import { GITLEAKS_PIN, runGitleaks } from "./gitleaks.js";
import { lineHasKnownString, parseHashList, type HashList } from "./hashes.js";
import { EMPTY_ALLOWLIST, envFile, parseAllowlist, pathAllowed, scanLine, type Allowlist } from "./patterns.js";
import { dedupeFindings, type GitleaksInfo, type ScanFinding, type ScanReport } from "./report.js";

export type ScanOptions = {
  repo: string;
  mode: "diff" | "path";
  base: string;
  head: string;
  noGitleaks: boolean;
  gitleaksBin?: string;
  hashesPath?: string;
  allowlistPath?: string;
};

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
const SKIP_EXT = /\.(?:png|jpe?g|gif|webp|pdf|zip|gz|wasm|ico|woff2?|ttf|eot|mp[34]|ico)$/i;
const MAX_BYTES = 1_000_000;

const emptyGitleaks = (skipped: boolean): GitleaksInfo => ({
  ran: false,
  version: null,
  pinned: GITLEAKS_PIN,
  skipped,
  error: null,
});

export function emptyReport(partial: Partial<ScanReport> & { error: string }): ScanReport {
  return {
    version: 1,
    ok: false,
    mode: partial.mode ?? "diff",
    repo: partial.repo ?? null,
    base: partial.base ?? null,
    head: partial.head ?? null,
    diff: partial.diff ?? null,
    gitleaksRange: partial.gitleaksRange ?? null,
    findings: [],
    gitleaks: partial.gitleaks ?? emptyGitleaks(false),
    error: partial.error,
  };
}

/** The allowlist file. Same path scan:diff and merge-gate read. */
export function allowlistPath(explicit?: string): string {
  return explicit || process.env.PLANIA_SCAN_ALLOWLIST || join(homedir(), ".config", "plania", "scan-allowlist");
}

function loadAllowlist(explicit?: string): Allowlist {
  const path = allowlistPath(explicit);
  if (!existsSync(path)) return EMPTY_ALLOWLIST;
  return parseAllowlist(readFileSync(path, "utf8"));
}

function loadHashes(explicit?: string): HashList | null {
  const path = explicit || process.env.PLANIA_SCAN_HASHES;
  if (path) {
    if (!existsSync(path)) throw new Error("hash list file is missing");
    return parseHashList(readFileSync(path, "utf8"));
  }
  const inline = process.env.PLANIA_SCAN_HASHES_JSON;
  if (!inline) return null;
  return parseHashList(inline);
}

function safeRef(ref: string): boolean {
  return ref.length > 0 && ref.length < 200 && !/[\s\u0000]/.test(ref) && !ref.startsWith("-");
}

function findingsFromText(file: string, text: string, allow: Allowlist, hashes: HashList | null): ScanFinding[] {
  if (pathAllowed(file, allow)) return [];
  const out: ScanFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const finding of scanLine(line, allow)) {
      out.push({ rule: finding.rule, file, line: i + 1, engine: "plania" });
    }
    if (hashes && lineHasKnownString(line, hashes, allow)) {
      out.push({ rule: "plania-known-string", file, line: i + 1, engine: "plania" });
    }
  }
  return out;
}

function scanDiff(diff: string, allow: Allowlist, hashes: HashList | null): ScanFinding[] {
  const { lines, files } = addedLines(diff);
  const out: ScanFinding[] = [];
  for (const file of files) {
    if (pathAllowed(file, allow)) continue;
    if (envFile(file)) out.push({ rule: "env-file", file, line: 0, engine: "plania" });
  }
  for (const line of lines) {
    if (pathAllowed(line.file, allow)) continue;
    for (const finding of scanLine(line.text, allow)) {
      out.push({ rule: finding.rule, file: line.file, line: line.line, engine: "plania" });
    }
    if (hashes && lineHasKnownString(line.text, hashes, allow)) {
      out.push({ rule: "plania-known-string", file: line.file, line: line.line, engine: "plania" });
    }
  }
  return out;
}

function walkFiles(abs: string, out: string[]) {
  const info = statSync(abs);
  if (info.isFile()) {
    out.push(abs);
    return;
  }
  if (!info.isDirectory()) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(join(abs, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(join(abs, entry.name));
  }
}

function scanTree(root: string, allow: Allowlist, hashes: HashList | null): ScanFinding[] {
  const files: string[] = [];
  walkFiles(root, files);
  const out: ScanFinding[] = [];
  for (const abs of files) {
    const file = root === abs ? abs.split("/").pop() ?? abs : relative(root, abs).replace(/\\/g, "/");
    if (pathAllowed(file, allow)) continue;
    if (SKIP_EXT.test(file)) continue;
    const info = statSync(abs);
    if (info.size > MAX_BYTES) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue;
    if (envFile(file)) out.push({ rule: "env-file", file, line: 0, engine: "plania" });
    out.push(...findingsFromText(file, buf.toString("utf8"), allow, hashes));
  }
  return out;
}

function finish(report: Omit<ScanReport, "ok">): ScanReport {
  const findings = dedupeFindings(report.findings);
  const error = report.error ?? report.gitleaks.error;
  return { ...report, findings, error, ok: error === null && findings.length === 0 };
}

export async function execute(options: ScanOptions): Promise<ScanReport> {
  const repo = resolve(options.repo);
  const diff = options.mode === "diff" ? `${options.base}...${options.head}` : null;
  const gitleaksRange = options.mode === "diff" ? `${options.base}..${options.head}` : null;
  const baseReport = { version: 1 as const, mode: options.mode, repo, base: options.mode === "diff" ? options.base : null, head: options.mode === "diff" ? options.head : null, diff, gitleaksRange };
  if (options.mode === "diff" && (!safeRef(options.base) || !safeRef(options.head))) {
    return finish({ ...baseReport, findings: [], gitleaks: emptyGitleaks(options.noGitleaks), error: "ref is not usable" });
  }
  if (!existsSync(repo)) return finish({ ...baseReport, findings: [], gitleaks: emptyGitleaks(options.noGitleaks), error: "path does not exist" });

  let allow: Allowlist;
  let hashes: HashList | null;
  try {
    allow = loadAllowlist(options.allowlistPath);
    hashes = loadHashes(options.hashesPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "scan config failed";
    return finish({ ...baseReport, findings: [], gitleaks: emptyGitleaks(options.noGitleaks), error: message });
  }

  let findings: ScanFinding[] = [];
  if (options.mode === "path") {
    findings = scanTree(repo, allow, hashes);
  } else {
    const ran = spawnSync("git", ["-C", repo, "diff", "--unified=0", "--no-color", "--no-ext-diff", `${options.base}...${options.head}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (ran.status !== 0) {
      const detail = (`${ran.stderr || ran.stdout || "git diff failed"}`).split(/\r?\n/).find(Boolean) ?? "git diff failed";
      return finish({ ...baseReport, findings: [], gitleaks: emptyGitleaks(options.noGitleaks), error: `git diff ${options.base}...${options.head} failed in ${repo}: ${detail}` });
    }
    findings = scanDiff(ran.stdout ?? "", allow, hashes);
  }

  let gitleaks = emptyGitleaks(options.noGitleaks);
  if (!options.noGitleaks) {
    const result = await runGitleaks({ bin: options.gitleaksBin, repo, mode: options.mode, base: options.base, head: options.head, allow });
    gitleaks = { ran: result.version !== null, version: result.version, pinned: GITLEAKS_PIN, skipped: false, error: result.error };
    findings = findings.concat(result.findings.filter((finding) => !pathAllowed(finding.file, allow)));
  }
  return finish({ ...baseReport, findings, gitleaks, error: gitleaks.error });
}
