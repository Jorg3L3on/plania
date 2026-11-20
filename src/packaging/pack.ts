// PLA-I2-17: a release package. `pnpm release:pack` copies what a buyer's machine needs into release/plania-<version>/,
// writes the manifest (release.json, VERSION) and the third-party notices, then archives it as
// release/plania-<version>.tar.gz with a .sha256 beside it.
//
// What ships: the built screen (dist/ui), the server's TypeScript sources run through tsx (a production dependency,
// so no compile step and the same paths as a checkout), the migrations, the kit, the prompts, the scan config, the
// scripts a buyer runs and the one-line installers (scripts/bootstrap, also put beside the archive), package.json
// (buyer scripts only) with the lockfile, the licence, notices and notes.
// node_modules does not ship: @node-rs/argon2 and esbuild are per-platform binaries, so one archive serves macOS and
// Linux and the install runs `pnpm install --prod --frozen-lockfile` against the lockfile it carries. Nothing is
// built on the buyer's machine.
//
// What never ships: test/, spike/, replay/, docs/ (except the template a run reads), the screen's sources outside
// ui/src/lib, the build and dev configs, .env and anything not listed here.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHANGELOG, MANIFEST, MANIFEST_FORMAT, VERSION_FILE, kitHashes, type Manifest } from "../release.js";

// Folders copied whole. ui/src/lib holds the wording and pure logic the server imports (falta.ts, plain-words.ts…).
export const PACK_DIRS = ["src", "ui/src/lib", "drizzle/migrations", "kit", "prompts", "config", "docs/templates"];

// Files at the root copied as they are (package.json is rewritten, see buyerPackageJson).
export const PACK_FILES = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", ".env.example", "README.md", CHANGELOG, "LICENSE"];

// The scripts a buyer runs: start, install, migrate, the service, restart, the machine check and the owner's tools.
// Seeds (the first owner's projects), generators, replay and scans stay in the repo.
export const BUYER_SCRIPTS = [
  "dev.ts",
  "install.ts",
  "migrate.ts",
  "restart.ts",
  "service.ts",
  // PLA-I2-19: the Windows service's supervisor (the Scheduled Task runs it).
  "service-win.ts",
  "machine-check.ts",
  "hash-password.ts",
  "vapid.ts",
  "register-project.ts",
  "kit.ts",
  "brief-run.ts",
  "brief-doctor.ts",
  // PLA-I2-2: src/auth/first-start.ts imports ORG from here, so the server does not start without it.
  "seed-org.ts",
  // PLA-I2-18: the help report and leaving.
  "help-report.ts",
  "uninstall.ts",
  // PLA-I2-8: updating and restoring.
  "update.ts",
  "restore.ts",
];

// PLA-I2-4 (audit B2): the one-line installers, shipped inside the package and put beside the archive, so the
// release folder can be uploaded as it is: <address>/install.sh, install.ps1, plania-<version>.tar.gz and its .sha256.
export const BOOTSTRAP_SCRIPTS = ["install.sh", "install.ps1"];

// The installer with this release's version, and the download address when one is given (PLANIA_DOWNLOAD_BASE while
// packing); without one the installers keep their default, the latest GitHub Release (PLA-I2-4, from zero).
export function stampBootstrap(text: string, o: { version: string; downloadBase?: string | null }): string {
  let out = text.replace(/^DEFAULT_VERSION=.*$/m, `DEFAULT_VERSION="${o.version}"`).replace(/^\$DefaultVersion = .*$/m, `$DefaultVersion = '${o.version}'`);
  const base = o.downloadBase?.trim().replace(/\/+$/, "");
  if (base) {
    if (!/^https?:\/\/[^\s"'`$]+$/.test(base)) throw new PackError(`PLANIA_DOWNLOAD_BASE "${base}" is not an http(s) address`);
    out = out.replace(/^DEFAULT_BASE=.*$/m, `DEFAULT_BASE="${base}"`).replace(/^\$DefaultBase = .*$/m, `$DefaultBase = '${base}'`);
  }
  return out;
}

// Never copied, even inside a folder that ships (a stray .env in kit/, an editor's backup).
const NEVER = /(^|\/)(\.env(\..*)?|node_modules|\.DS_Store|.*\.test\.ts)$/;

export type PackOptions = {
  root: string;
  outDir: string;
  // The built screen; defaults to <root>/dist/ui. It must hold index.html and build.json.
  distDir?: string;
  commit: string | null;
  now: Date;
  // Writes the THIRD_PARTY_NOTICES text for the production dependencies.
  notices: (root: string) => string;
  // The download address stamped into the installers (PLANIA_DOWNLOAD_BASE); omitted, they keep their default.
  downloadBase?: string | null;
  // Makes <archive> from the folder <dir> (both under outDir); omitted, no archive is made.
  archive?: (outDir: string, dirName: string, archiveName: string) => void;
};

export type PackResult = { dir: string; archive: string | null; sha256: string | null; manifest: Manifest; files: string[]; bootstrap: string[] };

export class PackError extends Error {}

type RootPkg = { version?: string; engines?: { node?: string }; scripts?: Record<string, string>; [k: string]: unknown };

// package.json for the package: the same dependencies (the lockfile must still match), and only the scripts whose
// file ships. Dev scripts (watch, Vite, tests, generators) are dropped.
export function buyerPackageJson(pkg: RootPkg): RootPkg {
  const scripts: Record<string, string> = {};
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (name.startsWith("dev")) continue;
    const refs = [...cmd.matchAll(/scripts\/([\w.-]+\.ts)/g)].map((m) => m[1]!);
    if (refs.length > 0 && refs.every((r) => BUYER_SCRIPTS.includes(r))) scripts[name] = cmd;
  }
  return { ...pkg, scripts };
}

export function lastMigration(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  return files.at(-1) ?? null;
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

export function pack(opts: PackOptions): PackResult {
  const root = path.resolve(opts.root);
  const outDir = path.resolve(opts.outDir);
  if (outDir === root || root.startsWith(outDir + path.sep)) throw new PackError("the output folder cannot hold the source checkout");
  const distDir = path.resolve(opts.distDir ?? path.join(root, "dist/ui"));
  if (!existsSync(path.join(distDir, "index.html"))) throw new PackError(`no built screen in ${distDir}: run pnpm build first`);
  for (const f of ["LICENSE", CHANGELOG]) if (!existsSync(path.join(root, f))) throw new PackError(`${f} is missing at the repo root`);

  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as RootPkg;
  const version = pkg.version;
  if (!version || !/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(version)) throw new PackError(`package.json version "${version}" is not a release number`);

  const name = `plania-${version}`;
  const dir = path.join(outDir, name);
  mkdirSync(outDir, { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const copy = (from: string, to: string) =>
    cpSync(from, to, { recursive: true, filter: (src) => !NEVER.test(path.relative(root, src).split(path.sep).join("/")) });
  for (const d of PACK_DIRS) {
    const from = path.join(root, d);
    if (existsSync(from)) copy(from, path.join(dir, d));
  }
  for (const f of PACK_FILES) {
    const from = path.join(root, f);
    if (existsSync(from)) cpSync(from, path.join(dir, f));
  }
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  for (const s of BUYER_SCRIPTS) {
    const from = path.join(root, "scripts", s);
    if (existsSync(from)) cpSync(from, path.join(dir, "scripts", s));
  }
  mkdirSync(path.join(dir, "scripts/bootstrap"), { recursive: true });
  const bootstrap: string[] = [];
  for (const s of BOOTSTRAP_SCRIPTS) {
    const from = path.join(root, "scripts/bootstrap", s);
    if (!existsSync(from)) throw new PackError(`scripts/bootstrap/${s} is missing`);
    const text = stampBootstrap(readFileSync(from, "utf8"), { version, downloadBase: opts.downloadBase });
    writeFileSync(path.join(dir, "scripts/bootstrap", s), text, { mode: 0o755 });
    const beside = path.join(outDir, s);
    writeFileSync(beside, text, { mode: 0o755 });
    bootstrap.push(beside);
  }
  cpSync(distDir, path.join(dir, "dist/ui"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(buyerPackageJson(pkg), null, 2) + "\n");
  writeFileSync(path.join(dir, "THIRD_PARTY_NOTICES"), opts.notices(root));

  const manifest: Manifest = {
    format: MANIFEST_FORMAT,
    name: "plania",
    version,
    commit: opts.commit,
    built_at: opts.now.toISOString(),
    node: pkg.engines?.node ?? "",
    migrations: lastMigration(path.join(root, "drizzle/migrations")),
    // PLA-I2-8: what every kit file was when shipped, so an update can tell the buyer's edits from ours.
    kit: kitHashes(path.join(dir, "kit")),
  };
  writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(path.join(dir, VERSION_FILE), version + "\n");

  let archive: string | null = null;
  let sha256: string | null = null;
  if (opts.archive) {
    const archiveName = `${name}.tar.gz`;
    archive = path.join(outDir, archiveName);
    rmSync(archive, { force: true });
    opts.archive(outDir, name, archiveName);
    sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(`${archive}.sha256`, `${sha256}  ${archiveName}\n`);
  }
  return { dir, archive, sha256, manifest, files: listFiles(dir), bootstrap };
}
