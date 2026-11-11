// PLA-I38-1: run the official gitleaks CLI (MIT, https://github.com/gitleaks/gitleaks). The binary
// is not vendored. A copy on PATH wins; otherwise the pinned release is downloaded and checked
// against the checksums published for that tag. The JSON report can contain secrets, so only rule,
// file, and line are copied out, and the report file is deleted.

import { spawnSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Allowlist } from "./patterns.js";
import { type ScanFinding } from "./report.js";

export const GITLEAKS_PIN = "8.30.1";
export const GITLEAKS_CONFIG = fileURLToPath(new URL("../../../config/plania-gitleaks.toml", import.meta.url));

const RELEASE = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_PIN}`;
const ASSETS: Record<string, { file: string; sha256: string }> = {
  "linux-x64": { file: `gitleaks_${GITLEAKS_PIN}_linux_x64.tar.gz`, sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" },
  "linux-arm64": { file: `gitleaks_${GITLEAKS_PIN}_linux_arm64.tar.gz`, sha256: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080" },
  "darwin-x64": { file: `gitleaks_${GITLEAKS_PIN}_darwin_x64.tar.gz`, sha256: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709" },
  "darwin-arm64": { file: `gitleaks_${GITLEAKS_PIN}_darwin_arm64.tar.gz`, sha256: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5" },
};

export type ResolvedGitleaks = { bin: string; version: string; source: "bin" | "path" | "download" };

const digestEquals = (actual: string, expected: string) => {
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

export function gitleaksAsset(): { file: string; sha256: string } | null {
  const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : null;
  if (!arch || (process.platform !== "linux" && process.platform !== "darwin")) return null;
  return ASSETS[`${process.platform}-${arch}`] ?? null;
}

function readVersion(bin: string): string | null {
  const ran = spawnSync(bin, ["version"], { encoding: "utf8", timeout: 15_000 });
  if (ran.status !== 0) return null;
  const line = `${ran.stdout}${ran.stderr}`.trim().split(/\r?\n/).find(Boolean) ?? "";
  const match = /(\d+\.\d+\.\d+)/.exec(line);
  return match?.[1] ?? null;
}

function cachePath(): string | null {
  const asset = gitleaksAsset();
  if (!asset) return null;
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "plania", "gitleaks", GITLEAKS_PIN, `${process.platform}-${process.arch}`, "gitleaks");
}

async function downloadPinned(): Promise<ResolvedGitleaks | { error: string }> {
  const asset = gitleaksAsset();
  const dest = cachePath();
  if (!asset || !dest) return { error: `gitleaks ${GITLEAKS_PIN} has no binary for ${process.platform}/${process.arch}` };
  if (existsSync(dest) && readVersion(dest) === GITLEAKS_PIN) return { bin: dest, version: GITLEAKS_PIN, source: "download" };
  let response: Response;
  try {
    response = await fetch(`${RELEASE}/${asset.file}`);
  } catch {
    return { error: "gitleaks download failed" };
  }
  if (!response.ok) return { error: "gitleaks download failed" };
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!digestEquals(actual, asset.sha256)) return { error: `gitleaks archive checksum did not match the pinned ${GITLEAKS_PIN} digest` };
  const dir = mkdtempSync(join(tmpdir(), "plania-gitleaks-bin-"));
  try {
    const archive = join(dir, "gitleaks.tar.gz");
    writeFileSync(archive, bytes, { mode: 0o600 });
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", dir, "gitleaks"], { encoding: "utf8" });
    if (extracted.status !== 0) return { error: "gitleaks archive could not be extracted" };
    mkdirSync(join(dest, ".."), { recursive: true });
    const unpacked = join(dir, "gitleaks");
    writeFileSync(dest, readFileSync(unpacked), { mode: 0o755 });
    chmodSync(dest, 0o755);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (readVersion(dest) !== GITLEAKS_PIN) return { error: "gitleaks binary did not report the pinned version" };
  return { bin: dest, version: GITLEAKS_PIN, source: "download" };
}

/** Explicit binary, then a pinned binary (PATH or the checked download). Any other PATH binary is the fallback when the download cannot run. */
export async function resolveGitleaks(explicit?: string): Promise<ResolvedGitleaks | { error: string }> {
  if (explicit) {
    const version = readVersion(explicit);
    if (!version) return { error: "gitleaks binary could not be run" };
    return { bin: explicit, version, source: "bin" };
  }
  const cached = cachePath();
  if (cached && existsSync(cached) && readVersion(cached) === GITLEAKS_PIN) return { bin: cached, version: GITLEAKS_PIN, source: "download" };
  const onPath = readVersion("gitleaks");
  if (onPath === GITLEAKS_PIN) return { bin: "gitleaks", version: onPath, source: "path" };
  const downloaded = await downloadPinned();
  if (!("error" in downloaded)) return downloaded;
  if (onPath) return { bin: "gitleaks", version: onPath, source: "path" };
  return downloaded;
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

function goRegex(re: RegExp): string {
  let prefix = "";
  if (re.flags.includes("i")) prefix += "(?i)";
  if (re.flags.includes("m")) prefix += "(?m)";
  if (re.flags.includes("s")) prefix += "(?s)";
  return prefix + re.source;
}

/** Allowlist tables appended to the pinned config, including dependency directories. */
export function allowlistToml(allow: Allowlist): string {
  const regexes = [...allow.exact].map((value) => `^${escapeRegex(value)}$`).concat(allow.patterns.map(goRegex));
  const paths = [
    "(?:^|/)node_modules(?:$|/)",
    "(?:^|/)\\.git(?:$|/)",
    "(?:^|/)dist(?:$|/)",
    ...allow.paths.map((entry) => {
      const trimmed = entry.replace(/\/$/, "");
      return `(?:^|/)${escapeRegex(trimmed)}(?:$|/)`;
    }),
    ...allow.pathPatterns.map(goRegex),
  ];
  if (regexes.length === 0 && paths.length === 0) return "";
  const lines = ["[[allowlists]]", 'description = "plania scan allowlist"', 'condition = "OR"'];
  if (regexes.length > 0) {
    lines.push('regexTarget = "secret"', "regexes = [");
    for (const regex of regexes) lines.push(`  ${tomlString(regex)},`);
    lines.push("]");
  }
  if (paths.length > 0) {
    lines.push("paths = [");
    for (const path of paths) lines.push(`  ${tomlString(path)},`);
    lines.push("]");
  }
  return `${lines.join("\n")}\n`;
}

function cleanRule(rule: string): string {
  const clean = rule.replace(/[\r\n]/g, "").trim();
  if (!clean || clean.length > 80) return "gitleaks";
  return clean;
}

function cleanFile(file: string, repo: string): string {
  let path = file.replace(/\\/g, "/").replace(/[\r\n]/g, "");
  if (path.startsWith("b/")) path = path.slice(2);
  const root = repo.replace(/\\/g, "/").replace(/\/$/, "");
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  return path;
}

/** Copy rule, file, and line. Every other gitleaks field is dropped. */
export function findingsFromReport(text: string, repo: string): ScanFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("gitleaks report was not json");
  }
  if (!Array.isArray(parsed)) throw new Error("gitleaks report was not a list");
  const out: ScanFinding[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as { RuleID?: unknown; File?: unknown; StartLine?: unknown };
    const file = cleanFile(typeof row.File === "string" ? row.File : "", repo);
    if (!file) continue;
    const line = typeof row.StartLine === "number" && Number.isFinite(row.StartLine) ? row.StartLine : 0;
    const rule = cleanRule(typeof row.RuleID === "string" ? row.RuleID : "");
    out.push({ rule, file, line, engine: "gitleaks" });
  }
  return out;
}

function safeError(stderr: string, fallback: string): string {
  const line = stderr.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  if (!line) return fallback;
  if (/@|ghp_|gho_|AKIA|BEGIN |-----|0x[a-fA-F0-9]{16,}/i.test(line)) return fallback;
  if (/[A-Za-z0-9+/]{24,}/.test(line)) return fallback;
  return line.slice(0, 180);
}

export async function runGitleaks(input: {
  bin?: string;
  repo: string;
  mode: "diff" | "path";
  base: string;
  head: string;
  allow: Allowlist;
}): Promise<{ findings: ScanFinding[]; version: string | null; error: string | null }> {
  const resolved = await resolveGitleaks(input.bin);
  if ("error" in resolved) return { findings: [], version: null, error: resolved.error };
  const dir = mkdtempSync(join(tmpdir(), "plania-gitleaks-"));
  try {
    const configPath = join(dir, "gitleaks.toml");
    const reportPath = join(dir, "report.json");
    const base = readFileSync(GITLEAKS_CONFIG, "utf8");
    writeFileSync(configPath, `${base}\n${allowlistToml(input.allow)}`, { mode: 0o600 });
    const args = [
      input.mode === "diff" ? "git" : "dir",
      "--config", configPath,
      "--report-format", "json",
      "--report-path", reportPath,
      "--redact=100",
      "--no-banner",
      "--no-color",
      "--log-level", "error",
      "--exit-code", "1",
    ];
    if (input.mode === "diff") args.push("--log-opts", `${input.base}..${input.head}`, input.repo);
    else args.push(input.repo);
    const ran = spawnSync(resolved.bin, args, { encoding: "utf8", cwd: input.repo, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
    if (ran.error) return { findings: [], version: resolved.version, error: "gitleaks scan failed" };
    const report = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
    let findings: ScanFinding[] = [];
    if (report.trim()) findings = findingsFromReport(report, input.repo);
    if (ran.status === 0) return { findings, version: resolved.version, error: null };
    if (ran.status === 1 && report.trim()) {
      const stderr = `${ran.stderr ?? ""}`;
      const failed = /failed to scan|unknown flag|could not create|fatal:/i.test(stderr);
      return { findings, version: resolved.version, error: failed ? safeError(stderr, "gitleaks scan failed") : null };
    }
    return { findings, version: resolved.version, error: safeError(`${ran.stderr ?? ""}`, "gitleaks scan failed") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "gitleaks scan failed";
    return { findings: [], version: resolved.version, error: safeError(message, "gitleaks scan failed") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
