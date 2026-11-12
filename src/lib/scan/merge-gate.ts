// PLA-I38-2: merge an app-repo PR only after scan:diff is clean.
// The clone is a temporary bare partial repo under the system temp dir. It is removed before return.
// Stdout is rule, file, and line. Tokens and matched text are not printed.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oneLine, readTokenFile } from "../../jobs/gh-token.js";
import type { MergeMethod } from "./merge-cli.js";
import { recordScanViaMcp, type ScanRecord } from "./merge-record.js";
import type { ScanReport } from "./report.js";
import { execute } from "./run.js";

const REF = /^[A-Za-z0-9._/-]+$/;
const SHA = /^[0-9a-f]{40}$/;

export type MergeGateResult = {
  ok: boolean;
  repo: string;
  pr: number;
  base: string | null;
  head: string | null;
  method: MergeMethod | null;
  merged: boolean;
  findings: { rule: string; file: string; line: number }[];
  gitleaks: { ran: boolean; error: string | null };
  error: string | null;
};

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type MergeGateDeps = {
  fetch?: FetchLike;
  /** null skips the token file. undefined reads GITHUB_TOKEN, then the token file. */
  token?: string | null;
  origin?: string;
  /** Source ref to fetch as the head. Default is refs/pull/<pr>/head. */
  headRefspec?: string;
  scan?: (repoPath: string, base: string, head: string) => Promise<ScanReport>;
  record?: (input: ScanRecord) => Promise<void>;
};

type Pull = { sha: string; baseRef: string };

export function mergeGateToken(env: Record<string, string | undefined> = process.env): string | null {
  return oneLine(env.GITHUB_TOKEN) ?? oneLine(readTokenFile(undefined, env).token);
}

export function redact(text: string): string {
  const cleaned = text
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/basic\s+\S+/gi, "basic [redacted]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]+\b/g, "[redacted]")
    .replace(/\bgithub_pat_\S+/g, "[redacted]")
    .split(/\r?\n/)
    .filter((line) => !/authorization:/i.test(line) && !/extraheader/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 180) || "merge-gate failed";
}

function git(args: string[]): string {
  const ran = spawnSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (ran.status !== 0) throw new Error(redact(`${ran.stderr || ran.stdout || "git failed"}`));
  return (ran.stdout ?? "").trim();
}

/** Bare partial clone of the base branch and the pull head. No worktree. */
export function fetchBare(input: { dir: string; origin: string; baseRef: string; headRefspec: string }): { baseSha: string; headSha: string } {
  git(["init", "--bare", "--quiet", input.dir]);
  git(["-C", input.dir, "remote", "add", "origin", input.origin]);
  git([
    "-C",
    input.dir,
    "fetch",
    "--filter=blob:none",
    "--no-tags",
    "--quiet",
    "origin",
    `+refs/heads/${input.baseRef}:refs/heads/mg-base`,
    `+${input.headRefspec}:refs/heads/mg-head`,
  ]);
  return {
    baseSha: git(["-C", input.dir, "rev-parse", "refs/heads/mg-base"]),
    headSha: git(["-C", input.dir, "rev-parse", "refs/heads/mg-head"]),
  };
}

/**
 * git-over-https header for a GitHub token. github.com's git endpoint rejects
 * `bearer` for OAuth (gho_) and classic tokens; basic with x-access-token works
 * for every token type (PLA-13).
 */
export function gitAuthHeader(token: string): string {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

function authEnv(token: string | null): () => void {
  const keys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_TERMINAL_PROMPT"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.GIT_TERMINAL_PROMPT = "0";
  if (token) {
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "http.extraheader";
    process.env.GIT_CONFIG_VALUE_0 = gitAuthHeader(token);
  } else {
    delete process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_CONFIG_KEY_0;
    delete process.env.GIT_CONFIG_VALUE_0;
  }
  return () => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function readPull(repo: string, pr: number, token: string | null, fetchImpl: FetchLike): Promise<Pull> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "plania" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${pr}`, { headers });
  if (!res.ok) throw new Error(`github pull request read failed (${res.status})`);
  const data = (await res.json()) as { head?: { sha?: unknown }; base?: { ref?: unknown } };
  const sha = typeof data.head?.sha === "string" ? data.head.sha.toLowerCase() : "";
  const baseRef = typeof data.base?.ref === "string" ? data.base.ref : "";
  if (!SHA.test(sha) || !REF.test(baseRef)) throw new Error("github pull request read failed");
  return { sha, baseRef };
}

async function mergePull(repo: string, pr: number, sha: string, method: MergeMethod, token: string | null, fetchImpl: FetchLike): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "plania",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${pr}/merge`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ sha, merge_method: method }),
  });
  if (res.status === 409) throw new Error("head changed");
  if (!res.ok) throw new Error(`github merge failed (${res.status})`);
  const body = (await res.json().catch(() => null)) as { merged?: unknown } | null;
  if (!body || body.merged !== true) throw new Error("github merge failed");
}

function empty(repo: string, pr: number, method: MergeMethod | null, error: string): MergeGateResult {
  return {
    ok: false,
    repo,
    pr,
    base: null,
    head: null,
    method,
    merged: false,
    findings: [],
    gitleaks: { ran: false, error: null },
    error,
  };
}

function passed(report: ScanReport): boolean {
  return report.ok && report.error === null && report.gitleaks.ran && report.gitleaks.error === null && report.findings.length === 0;
}

export function mergeGateExit(result: MergeGateResult): number {
  if (result.ok) return 0;
  if (result.findings.length > 0 && !result.error && result.gitleaks.ran && !result.gitleaks.error) return 1;
  return 2;
}

export function renderMergeText(result: MergeGateResult): string {
  const lines = result.findings.map((finding) => `${finding.file}:${finding.line} ${finding.rule}`);
  if (result.ok && result.merged) lines.push(`merge-gate: merged ${result.method} ${result.head}`);
  else if (result.ok) lines.push(`merge-gate: pass ${result.head}`);
  else if (result.findings.length > 0 && !result.error) lines.push("merge-gate: blocked");
  else lines.push("merge-gate: error");
  return `${lines.join("\n")}\n`;
}

export function renderMergeJson(result: MergeGateResult): string {
  return `${JSON.stringify(result)}\n`;
}

export async function runMergeGate(
  input: { repo: string; pr: number; method?: MergeMethod; ticket?: string },
  deps: MergeGateDeps = {},
): Promise<MergeGateResult> {
  const method = input.method ?? null;
  const token = deps.token === undefined ? mergeGateToken() : deps.token;
  const fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
  const dir = mkdtempSync(join(tmpdir(), "plania-merge-gate-"));
  const restore = authEnv(token);
  try {
    const first = await readPull(input.repo, input.pr, token, fetchImpl);
    const fetched = fetchBare({
      dir,
      origin: deps.origin ?? `https://github.com/${input.repo}.git`,
      baseRef: first.baseRef,
      headRefspec: deps.headRefspec ?? `refs/pull/${input.pr}/head`,
    });
    if (fetched.headSha.toLowerCase() !== first.sha) return empty(input.repo, input.pr, method, "head changed");
    const scan = deps.scan ?? ((repoPath, base, head) => execute({ repo: repoPath, mode: "diff", base, head, noGitleaks: false }));
    const report = await scan(dir, "refs/heads/mg-base", "refs/heads/mg-head");
    const findings = report.findings.map(({ rule, file, line }) => ({ rule, file, line }));
    const gitleaks = { ran: report.gitleaks.ran, error: report.gitleaks.error };
    const scanError = report.error && !passed(report) ? report.error : null;
    const finished = report.gitleaks.ran && !report.gitleaks.error && !report.error;
    if (input.ticket && finished && SHA.test(first.sha)) {
      const cite = JSON.stringify({
        ok: passed(report),
        repo: input.repo,
        pr: input.pr,
        base: first.baseRef,
        head: first.sha,
        findings,
        gitleaks,
      });
      try {
        await (deps.record ?? recordScanViaMcp)({
          ticket: input.ticket,
          commit: first.sha,
          cite,
          command: "merge-gate",
          verdict: passed(report) ? "pass" : "fail",
        });
      } catch (error) {
        const message = error instanceof Error ? redact(error.message) : "plania record failed";
        return { ok: false, repo: input.repo, pr: input.pr, base: first.baseRef, head: first.sha, method, merged: false, findings, gitleaks, error: message };
      }
    }
    if (!passed(report)) {
      return {
        ok: false,
        repo: input.repo,
        pr: input.pr,
        base: first.baseRef,
        head: first.sha,
        method,
        merged: false,
        findings,
        gitleaks,
        error: findings.length > 0 && report.gitleaks.ran && !report.gitleaks.error ? null : scanError ?? (report.gitleaks.ran ? null : "gitleaks did not run"),
      };
    }
    if (!method) {
      return { ok: true, repo: input.repo, pr: input.pr, base: first.baseRef, head: first.sha, method, merged: false, findings, gitleaks, error: null };
    }
    const again = await readPull(input.repo, input.pr, token, fetchImpl);
    if (again.sha !== first.sha) return { ok: false, repo: input.repo, pr: input.pr, base: first.baseRef, head: first.sha, method, merged: false, findings, gitleaks, error: "head changed" };
    await mergePull(input.repo, input.pr, first.sha, method, token, fetchImpl);
    return { ok: true, repo: input.repo, pr: input.pr, base: first.baseRef, head: first.sha, method, merged: true, findings, gitleaks, error: null };
  } catch (error) {
    const message = error instanceof Error ? redact(error.message) : "merge-gate failed";
    return empty(input.repo, input.pr, method, message);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
}
