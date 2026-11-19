// PLA-I2-18: which Plania this is, for the help report. Today: the version in package.json and the commit git names.
// PLA-I2-17 (the package) adds a version manifest; when it lands, replace the body of planiaVersion with a read of it
// and keep the signature. Local only: one `git rev-parse`, never a fetch.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExecFn } from "../brief/doctor.js";
import { readManifest } from "../release.js";

export type PlaniaVersion = { version: string | null; commit: string | null };

export async function planiaVersion(root: string, exec: ExecFn, env: NodeJS.ProcessEnv): Promise<PlaniaVersion> {
  // PLA-I2-17/PLA-I2-8: a release package names itself in its manifest; git is asked only in a checkout.
  const m = readManifest(root);
  if (m) return { version: m.version, commit: m.commit ? m.commit.slice(0, 12) : null };
  let version: string | null = null;
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version?: unknown };
    version = typeof pkg.version === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(pkg.version) ? pkg.version : null;
  } catch {
    version = null;
  }
  let commit: string | null = null;
  try {
    const r = await exec("git", ["rev-parse", "--short=12", "HEAD"], { env, cwd: root, timeoutMs: 10_000 });
    const sha = r.stdout.trim();
    commit = r.code === 0 && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
  } catch {
    commit = null;
  }
  return { version, commit };
}
