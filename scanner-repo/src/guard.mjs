// PLA-I38-3: list open pull requests with gh and keep heads that have no plania-scan status.
// The workflow runs this before checkout, setup-node, or the gitleaks download.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TARGET_REPOS, pullTarget, unmarkedTargets } from "./select.mjs";

export function ghJson(path, env, spawn = spawnSync) {
  const result = spawn("gh", ["api", "--paginate", path], {
    encoding: "utf8",
    env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    const http = /HTTP (\d{3})/.exec(`${result.stderr ?? ""}`);
    throw new Error(`github list failed${http ? ` (${http[1]})` : ""}`);
  }
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    throw new Error("github list was not json");
  }
}

export function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  throw new Error("github list was not a list");
}

export async function collectTargets(repos, load, nowMs, staleMs) {
  const pulls = [];
  const statusesBySha = new Map();
  for (const repo of repos) {
    const listed = rowsOf(await load.pulls(repo));
    for (const row of listed) {
      const target = pullTarget(repo.owner, repo.repo, row);
      if (!target) continue;
      pulls.push(target);
      if (!statusesBySha.has(target.headSha)) {
        statusesBySha.set(target.headSha, rowsOf(await load.statuses(target)));
      }
    }
  }
  return unmarkedTargets(pulls, statusesBySha, nowMs, staleMs);
}

export function writeGuardOutput(targets, env, file = "/tmp/plania-targets.json") {
  writeFileSync(file, `${JSON.stringify(targets)}\n`, { mode: 0o600 });
  const line = `count=${targets.length}\n`;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, line);
  return line;
}

export async function runGuard(options) {
  const token = options.token ?? "";
  if (!token) return { code: 2, count: 0, error: "missing token" };
  const repos = options.repos ?? TARGET_REPOS;
  const nowMs = options.nowMs ?? Date.now();
  try {
    const targets = await collectTargets(repos, options.load, nowMs, options.staleMs);
    const line = (options.writeOutput ?? writeGuardOutput)(targets, options.env ?? {});
    return { code: 0, count: targets.length, targets, line };
  } catch (error) {
    const message = error instanceof Error ? error.message : "guard failed";
    return { code: 1, count: 0, error: message };
  }
}

function defaultLoad(env) {
  return {
    pulls(repo) {
      return ghJson(`repos/${repo.owner}/${repo.repo}/pulls?state=open&per_page=100`, env);
    },
    statuses(target) {
      return ghJson(`repos/${target.owner}/${target.repo}/commits/${target.headSha}/statuses?per_page=100`, env);
    },
  };
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (invokedDirectly()) {
  const env = process.env;
  if (!env.GH_TOKEN) {
    process.stderr.write("missing token\n");
    process.exit(2);
  }
  mkdirSync("/tmp", { recursive: true });
  const result = await runGuard({ token: env.GH_TOKEN, env, load: defaultLoad(env) });
  if (result.error) process.stderr.write(`${result.error}\n`);
  else process.stdout.write(`unmarked=${result.count}\n`);
  process.exit(result.code);
}
