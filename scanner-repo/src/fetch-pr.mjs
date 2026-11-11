// PLA-I38-3: shallow, partial fetch of one pull request. The token stays in gh, not in the remote URL.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function assertSafeRef(ref) {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) throw new Error("ref is not usable");
  if (/[\s\u0000:~^?*\[\]\\]/.test(ref) || ref.startsWith("-") || ref.includes("..") || ref.includes("@{") || ref.includes(":")) {
    throw new Error("ref is not usable");
  }
  return ref;
}

export function fetchRefspecs(target) {
  if (!target || !Number.isInteger(target.number) || target.number < 1) throw new Error("pull number is not usable");
  const base = assertSafeRef(target.baseRef);
  return {
    head: `pull/${target.number}/head:refs/plania/head`,
    base: `refs/heads/${base}:refs/plania/base`,
  };
}

export function redactGitError(text) {
  const line = `${text ?? ""}`.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  if (!line) return "git failed";
  if (/ghp_|gho_|ghu_|ghs_|github_pat_|Bearer |Authorization/i.test(line)) return "git failed";
  return line.slice(0, 180);
}

function run(cmd, args, cwd, env, spawn) {
  const result = spawn(cmd, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(redactGitError(result.stderr || result.stdout));
}

function mergeBase(dir, env, spawn) {
  const result = spawn("git", ["merge-base", "refs/plania/base", "refs/plania/head"], { cwd: dir, env, encoding: "utf8" });
  return result.status === 0;
}

export function fetchPull(target, token, options = {}) {
  const spawn = options.spawn ?? spawnSync;
  const specs = fetchRefspecs(target);
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "plania-pr-"));
  const env = { ...process.env, ...options.env, GH_TOKEN: token, GIT_TERMINAL_PROMPT: "0" };
  const remote = `https://github.com/${target.owner}/${target.repo}.git`;
  run("git", ["init", "-q", "-b", "scan"], dir, env, spawn);
  run("git", ["remote", "add", "origin", remote], dir, env, spawn);
  run("gh", ["auth", "setup-git", "--hostname", "github.com", "--force"], dir, env, spawn);
  const fetchArgs = (refspec) => ["fetch", "--filter=blob:none", "--depth", "80", "origin", refspec];
  run("git", fetchArgs(specs.head), dir, env, spawn);
  run("git", fetchArgs(specs.base), dir, env, spawn);
  if (!mergeBase(dir, env, spawn)) {
    run("git", ["fetch", "--filter=blob:none", "--deepen=400", "origin"], dir, env, spawn);
  }
  if (!mergeBase(dir, env, spawn)) throw new Error("merge base not found");
  return dir;
}
