// PLA-I73-4: a fresh copy of the app (a Taller worktree, a photo copy) gets its node_modules as a copy-on-write clone
// of a checkout with the same lockfile instead of a fresh install. On APFS (`cp -c`) the clone is near instant and
// takes almost no disk until a file changes; the guided-test Mac had 555 MB of modules per copy and a 91 % full disk.
// Elsewhere, or when the lockfiles differ, it does nothing and the caller installs as before.
import { exec } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
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
  if (!sameLockfile(from, to)) return false;
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
