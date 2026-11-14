// PLA-I46-1: which commit the served UI (dist/ui) was built from, and whether it is behind the checkout.
// The launchd service only serves dist/ui; restarting it on a newer HEAD used to keep the old bundle
// on screen until someone ran `pnpm build` by hand. scripts/dev.ts now rebuilds at start when this says stale.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const BUILD_STAMP = "build.json";

export interface UiBuild {
  commit: string | null;
  dirty: boolean;
  built_at: string;
}

// The checkout's HEAD and whether ui/, vite.config.ts or the lockfile have uncommitted changes. Null outside git.
export function gitState(repoDir: string): { commit: string; dirty: boolean } | null {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const changed = execFileSync("git", ["status", "--porcelain", "--", "ui", "vite.config.ts", "pnpm-lock.yaml"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { commit, dirty: changed.length > 0 };
  } catch {
    return null;
  }
}

export function readUiBuild(distDir: string): UiBuild | null {
  const file = path.join(distDir, BUILD_STAMP);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<UiBuild>;
    return { commit: parsed.commit ?? null, dirty: parsed.dirty === true, built_at: String(parsed.built_at ?? "") };
  } catch {
    return null;
  }
}

// Why dist/ui must be rebuilt before serving, or null when it matches the checkout.
// A build from a dirty tree is never trusted: the next start rebuilds from what is committed.
export function staleReason(build: UiBuild | null, head: { commit: string; dirty: boolean } | null, indexExists: boolean): string | null {
  if (!indexExists) return "no build";
  if (!head) return null; // not a git checkout: serve what is there
  if (!build) return "build has no stamp";
  if (build.dirty) return "build came from uncommitted changes";
  if (build.commit !== head.commit) return `build is ${build.commit?.slice(0, 7) ?? "unknown"}, HEAD is ${head.commit.slice(0, 7)}`;
  return null;
}
