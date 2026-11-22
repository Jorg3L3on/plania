// PLA-I73-4: a fresh copy of the app (a Taller worktree, a photo copy) gets its node_modules as a copy-on-write clone
// of a checkout with the same lockfile instead of a fresh install. On APFS (`cp -c`) the clone is near instant and
// takes almost no disk until a file changes; the guided-test Mac had 555 MB of modules per copy and a 91 % full disk.
// Elsewhere, or when the lockfiles differ, it does nothing and the caller installs as before.
// PLA-I74-6: and only when the checkout's modules were installed by the tool its lockfile names (npm for
// package-lock.json, pnpm for pnpm-lock.yaml, yarn for yarn.lock): the tool and the lockfile hash must both match.
import { exec } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
export type Tool = "npm" | "pnpm" | "yarn";
/** The package manager each lockfile names. */
export const LOCK_TOOL: Record<string, Tool> = { "package-lock.json": "npm", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn" };

/** PLA-I74-6: the tool that installed a folder's node_modules, from the marker each one leaves; null when unknown.
 * A pnpm-installed checkout of an npm-locked project lent its pnpm layout to the copies and a project test went flaky. */
export function installedBy(dir: string): Tool | null {
  const nm = path.join(dir, "node_modules");
  if (!existsSync(nm)) return null;
  if (existsSync(path.join(nm, ".modules.yaml")) || existsSync(path.join(nm, ".pnpm"))) return "pnpm";
  if (existsSync(path.join(nm, ".yarn-integrity")) || existsSync(path.join(nm, ".yarn-state.yml"))) return "yarn";
  if (existsSync(path.join(nm, ".package-lock.json"))) return "npm";
  return null;
}

/** The lockfile a folder has (the first of LOCKFILES) and the tool it names; null when there is none. */
export function lockTool(dir: string): { lockfile: string; tool: Tool } | null {
  const f = LOCKFILES.find((x) => existsSync(path.join(dir, x)));
  return f ? { lockfile: f, tool: LOCK_TOOL[f]! } : null;
}
type Exec = (cmd: string, opts: { cwd: string; timeoutMs: number }) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/** The lockfile both folders have, when its bytes are the same; null otherwise. */
export function sameLockfile(from: string, to: string): string | null {
  for (const f of LOCKFILES) {
    const a = path.join(from, f);
    const b = path.join(to, f);
    if (existsSync(a) || existsSync(b)) {
      if (!existsSync(a) || !existsSync(b)) return null;
      return readFileSync(a).equals(readFileSync(b)) ? f : null;
    }
  }
  return null;
}

const execCp: Exec = (cmd, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });

export async function cloneModules(from: string, to: string, run: Exec = execCp, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (platform !== "darwin") return false;
  const src = path.join(from, "node_modules");
  if (!existsSync(src) || path.resolve(from) === path.resolve(to)) return false;
  const lock = sameLockfile(from, to);
  if (!lock) return false;
  // PLA-I74-6: only modules the lockfile's own tool installed are lent; anything else installs fresh.
  if (installedBy(from) !== LOCK_TOOL[lock]) return false;
  const dst = path.join(to, "node_modules");
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  const q = (p: string) => `'${p.replaceAll("'", `'\\''`)}'`;
  const r = await run(`cp -c -R ${q(src)} ${q(dst)}`, { cwd: to, timeoutMs: 120_000 }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (r.code !== 0) {
    rmSync(dst, { recursive: true, force: true });
    return false;
  }
  return true;
}
