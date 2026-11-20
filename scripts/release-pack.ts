// PLA-I2-17: pnpm release:pack — makes the numbered release package (src/packaging/pack.ts).
//   pnpm release:pack                 type-check and build the screen, then pack into release/
//   pnpm release:pack --skip-build    pack the dist/ui already built
//   pnpm release:pack --out <dir>     another output folder
//   pnpm release:pack --allow-dirty   pack with uncommitted changes (the manifest then names no commit)
// The version is package.json's: bump it and add a CHANGELOG.md entry before packing.
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { collectNotices, renderNotices } from "../src/packaging/notices.js";
import { pack, PackError } from "../src/packaging/pack.js";
import { gitState } from "../src/ui-build.js";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    "skip-build": { type: "boolean", default: false },
    "allow-dirty": { type: "boolean", default: false },
  },
  strict: true,
});
const root = path.resolve(import.meta.dirname, "..");
const git = gitState(root);
const dirty = git ? execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0 : false;
if (dirty && !values["allow-dirty"]) {
  console.error("The checkout has uncommitted changes: commit them, or pass --allow-dirty.");
  process.exit(1);
}
if (!values["skip-build"]) {
  // pnpm build: both type-checks, then vite build (which stamps dist/ui/build.json with the commit).
  try {
    execSync("pnpm build", { cwd: root, stdio: "inherit" });
  } catch {
    console.error("pnpm build failed: nothing was packed.");
    process.exit(1);
  }
}
if (/^PLACEHOLDER/.test(readFileSync(path.join(root, "LICENSE"), "utf8"))) {
  console.warn("LICENSE still holds the placeholder: write the owner's licence text before a buyer gets this package.");
}
try {
  const r = pack({
    root,
    outDir: values.out ? path.resolve(values.out) : path.join(root, "release"),
    commit: dirty ? null : (git?.commit ?? null),
    now: new Date(),
    notices: (dir) => renderNotices(collectNotices(dir)),
    // PLA-I2-4: where releases are downloaded from is a setting; unset, the installers keep the latest GitHub Release.
    downloadBase: process.env.PLANIA_DOWNLOAD_BASE ?? null,
    // Relative names with cwd set: tar on every system, no drive letters.
    archive: (outDir, dirName, archiveName) => execFileSync("tar", ["-czf", archiveName, dirName], { cwd: outDir, stdio: "inherit" }),
  });
  console.log(`Packed ${r.manifest.version} (${r.manifest.commit?.slice(0, 7) ?? "uncommitted"}): ${r.files.length} files`);
  console.log(`  ${r.archive}`);
  console.log(`  sha256 ${r.sha256}`);
  for (const b of r.bootstrap) console.log(`  ${b}`);
} catch (e) {
  if (e instanceof PackError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
