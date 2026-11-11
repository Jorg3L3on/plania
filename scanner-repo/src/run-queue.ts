// PLA-I38-3: scan unmarked heads one at a time and post pending, then success or failure.
// A head that does not fit in the time budget stays unmarked so a later run can take it.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchPull } from "./fetch-pr.mjs";
import { postStatus } from "./github.mjs";
import { execute } from "./scan/run.ts";
import { resultFromFindings, statusRequest } from "./select.mjs";

export const SCAN_BUDGET_MS = 7 * 60 * 1000;

export type ScanTarget = {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  baseRef: string;
  baseSha: string | null;
};

export type Posted = { state: string; description: string };

type Deps = {
  now: () => number;
  post: (target: ScanTarget, body: { state: string; context: string; description: string }) => Promise<void>;
  fetchPull: (target: ScanTarget) => Promise<string> | string;
  scan: (dir: string) => Promise<{ findings: { rule: string }[]; error: string | null }>;
  log: (line: string) => void;
  remove: (dir: string) => void;
};

export async function scanTargets(targets: ScanTarget[], deps: Deps, budgetMs = SCAN_BUDGET_MS): Promise<number> {
  const started = deps.now();
  let failures = 0;
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    if (!target) continue;
    if (deps.now() - started > budgetMs) {
      deps.log(`left ${targets.length - index} unmarked`);
      break;
    }
    const label = `${target.owner}/${target.repo}#${target.number}`;
    let dir: string | null = null;
    let pending = false;
    try {
      const pendingBody = statusRequest({ phase: "pending" });
      await deps.post(target, pendingBody);
      pending = true;
      deps.log(`${label} pending`);
      dir = await deps.fetchPull(target);
      const report = await deps.scan(dir);
      const body = statusRequest(resultFromFindings(report.findings, Boolean(report.error)));
      await deps.post(target, body);
      pending = false;
      deps.log(`${label} ${body.state} ${body.description}`);
      if (report.error || body.state === "failure") failures += report.error ? 1 : 0;
    } catch {
      failures += 1;
      deps.log(`${label} scan did not finish`);
      if (pending) {
        try {
          await deps.post(target, statusRequest({ phase: "result", error: true, findingCount: 0, ruleCount: 0 }));
        } catch {
          deps.log(`${label} status update failed`);
        }
      }
    } finally {
      if (dir) deps.remove(dir);
    }
  }
  return failures;
}

function readTargets(argv: string[]): ScanTarget[] {
  const file = argv[0];
  if (!file) throw new Error("targets file is missing");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("targets file is not a list");
  return parsed as ScanTarget[];
}

const invoked = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (invoked) {
  const token = process.env.PLANIA_SCAN_TOKEN ?? process.env.GH_TOKEN ?? "";
  const inline = process.env.PLANIA_SCAN_HASHES_JSON ?? "";
  delete process.env.PLANIA_SCAN_HASHES_JSON;
  if (!token) {
    process.stderr.write("missing token\n");
    process.exit(2);
  } else {
    let hashDir: string | null = null;
    let hashesPath: string | undefined;
    if (inline.trim()) {
      hashDir = mkdtempSync(join(tmpdir(), "plania-hashes-"));
      hashesPath = join(hashDir, "hashes.json");
      writeFileSync(hashesPath, inline, { mode: 0o600 });
    }
    try {
      const targets = readTargets(process.argv.slice(2));
      const failures = await scanTargets(targets, {
        now: () => Date.now(),
        async post(target, body) {
          await postStatus(fetch, token, target, body, process.env);
        },
        fetchPull(target) {
          return fetchPull(target, token);
        },
        scan(dir) {
          return execute({
            repo: dir,
            mode: "diff",
            base: "refs/plania/base",
            head: "refs/plania/head",
            noGitleaks: false,
            hashesPath,
          });
        },
        log(line) {
          process.stderr.write(`${line}\n`);
        },
        remove(dir) {
          rmSync(dir, { recursive: true, force: true });
        },
      });
      process.exitCode = failures > 0 ? 1 : 0;
    } catch {
      process.stderr.write("scan did not finish\n");
      process.exitCode = 1;
    } finally {
      if (hashDir) rmSync(hashDir, { recursive: true, force: true });
    }
  }
}
