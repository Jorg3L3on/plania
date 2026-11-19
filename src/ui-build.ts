// PLA-I46-1: which commit the served UI (dist/ui) was built from, and whether it is behind the checkout.
// The launchd service only serves dist/ui; restarting it on a newer HEAD used to keep the old bundle
// on screen until someone ran `pnpm build` by hand. scripts/dev.ts now rebuilds at start when this says stale.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isPackage, readRelease, type ReleaseInfo } from "./release.js";

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

// PLA-I2-17: the start-up decision in one place. A release package (release.json at its root) never rebuilds:
// it ships dist/ui built and has no dev tools, and it may sit inside some unrelated git repository. Outside a
// package this is staleReason against the checkout's HEAD (null outside git: serve what is there).
export function rebuildReason(
  rootDir: string,
  distDir: string,
  deps: { packaged: (dir: string) => boolean; head: (dir: string) => { commit: string; dirty: boolean } | null } = {
    packaged: isPackage,
    head: gitState,
  },
): string | null {
  if (deps.packaged(rootDir)) return null;
  return staleReason(readUiBuild(distDir), deps.head(rootDir), existsSync(path.join(distDir, "index.html")));
}

// PLA-I2-17: the body of GET /health/ui: the release, the served build's stamp and, in a checkout, its HEAD.
export function healthUi(rootDir: string, distDir: string): { version: ReleaseInfo; ui: UiBuild | null; head: { commit: string; dirty: boolean } | null } {
  const packaged = isPackage(rootDir);
  return { version: readRelease(rootDir), ui: readUiBuild(distDir), head: packaged ? null : gitState(rootDir) };
}
