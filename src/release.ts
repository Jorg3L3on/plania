// PLA-I2-17: which release of Plania this is. A package made by `pnpm release:pack` carries `release.json` (the
// manifest) and `VERSION` at its root; a git checkout has neither and reads the version from package.json and the
// commit from git. The server shows it in /health/ui and the screen (Plomería), and serves CHANGELOG.md as the notes.
//
// The manifest's format is the contract the update command (PLA-I2-8) builds on; README "Packaging" describes it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const MANIFEST = "release.json";
export const VERSION_FILE = "VERSION";
export const CHANGELOG = "CHANGELOG.md";
export const MANIFEST_FORMAT = 1;

// What release.json holds. `migrations` is the last migration file in the package, so an update can tell whether it
// brings new ones; `node` is the engines range the package was built for.
export type Manifest = {
  format: number;
  name: "plania";
  version: string;
  commit: string | null;
  built_at: string;
  node: string;
  migrations: string | null;
};

export type ReleaseInfo = {
  version: string;
  commit: string | null;
  built_at: string | null;
  // true when running from a package (release.json present), false in a git checkout.
  packaged: boolean;
};

export const ROOT_DIR = path.resolve(import.meta.dirname, "..");

export function readManifest(rootDir: string): Manifest | null {
  const file = path.join(rootDir, MANIFEST);
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as Partial<Manifest>;
    if (typeof m.version !== "string" || !m.version) return null;
    return {
      format: Number(m.format ?? MANIFEST_FORMAT),
      name: "plania",
      version: m.version,
      commit: typeof m.commit === "string" ? m.commit : null,
      built_at: String(m.built_at ?? ""),
      node: String(m.node ?? ""),
      migrations: typeof m.migrations === "string" ? m.migrations : null,
    };
  } catch {
    return null;
  }
}

// A package never rebuilds the screen and never asks git: its manifest is the truth, even when it was unpacked
// inside some other git repository.
export const isPackage = (rootDir: string): boolean => existsSync(path.join(rootDir, MANIFEST));

export function packageVersion(rootDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function headCommit(rootDir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export function readRelease(rootDir: string = ROOT_DIR, commit: (dir: string) => string | null = headCommit): ReleaseInfo {
  const m = readManifest(rootDir);
  if (m) return { version: m.version, commit: m.commit, built_at: m.built_at || null, packaged: true };
  return { version: packageVersion(rootDir), commit: commit(rootDir), built_at: null, packaged: false };
}

// The release notes, as the owner wrote them (Spanish, markdown). Empty when the file is missing.
export function readChangelog(rootDir: string = ROOT_DIR): string {
  const file = path.join(rootDir, CHANGELOG);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}
