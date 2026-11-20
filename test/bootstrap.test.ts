// PLA-I2-4 (audit B2): the one-line installers. Both parse, the pack stamps them with the release and ships them
// inside the package and beside the archive, and each installs a local package with --from, against a stand-in pnpm
// that only records what it was asked. No network, no database, no real pnpm install.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { BOOTSTRAP_SCRIPTS, pack, PackError, stampBootstrap } from "../src/packaging/pack.js";
import { needs } from "./platform.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SH = path.join(ROOT, "scripts/bootstrap/install.sh");
const PS1 = path.join(ROOT, "scripts/bootstrap/install.ps1");
const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), `plania-${p}-`));
const PNPM = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).packageManager.replace(/^pnpm@/, "").replace(/\+.*$/, "");
const powershell = process.platform === "win32" ? "powershell" : "pwsh";

describe("the installers parse", () => {
  test("install.sh passes sh -n and bash -n", { skip: needs({ tools: ["bash"] }) }, () => {
    for (const shell of ["bash", ...(needs({ tools: ["sh"] }) ? [] : ["sh"])]) {
      const r = spawnSync(shell, ["-n", SH], { encoding: "utf8" });
      assert.equal(r.status, 0, `${shell} -n: ${r.stderr}`);
    }
  });

  test("install.ps1 passes the PowerShell parser", { skip: needs({ tools: [powershell] }) }, () => {
    const cmd = `$e=$null; $t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${PS1.replace(/'/g, "''")}', [ref]$t, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.ToString() }; exit 1 }`;
    const r = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test("install.ps1 is ASCII with no BOM: Windows PowerShell reads it as ANSI, and a BOM breaks irm | iex", () => {
    const bytes = readFileSync(PS1);
    assert.ok(bytes.every((b) => b < 0x80), "a byte above 0x7f");
  });

  test("neither uses corepack, and both default to the latest GitHub Release", () => {
    for (const f of [SH, PS1]) {
      const text = readFileSync(f, "utf8");
      assert.doesNotMatch(text.replace(/^#.*$/gm, ""), /corepack (enable|prepare)/);
      assert.match(text, /^(DEFAULT_BASE="|\$DefaultBase = ')https:\/\/github\.com\/Jorg3L3on\/plania\/releases\/latest\/download["']$/m);
      assert.match(text, /plania-latest\.tar\.gz/, "with no version, the asset every release carries");
      assert.match(text, /PLANIA_DOWNLOAD_BASE/);
    }
  });
});

describe("the pack ships them", () => {
  function fakeDist(): string {
    const d = path.join(tmp("dist"), "ui");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "index.html"), "<!doctype html>");
    writeFileSync(path.join(d, "build.json"), "{}");
    return d;
  }
  const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

  test("inside the package and beside the archive, stamped with the version", () => {
    const out = tmp("release");
    const r = pack({ root: ROOT, outDir: out, distDir: fakeDist(), commit: null, now: new Date(), notices: () => "" });
    assert.deepEqual(r.bootstrap, BOOTSTRAP_SCRIPTS.map((s) => path.join(out, s)));
    for (const s of BOOTSTRAP_SCRIPTS) {
      assert.ok(r.files.includes(`scripts/bootstrap/${s}`), `${s} ships in the package`);
      const beside = readFileSync(path.join(out, s), "utf8");
      assert.equal(readFileSync(path.join(r.dir, "scripts/bootstrap", s), "utf8"), beside);
      assert.match(beside, s.endsWith(".sh") ? new RegExp(`^DEFAULT_VERSION="${version}"$`, "m") : new RegExp(`^\\$DefaultVersion = '${version}'$`, "m"));
      assert.match(beside, /releases\/latest\/download/, "no address given: the GitHub Release stays");
    }
  });

  test("PLANIA_DOWNLOAD_BASE becomes the default address; anything but http(s) is refused", () => {
    const sh = stampBootstrap(readFileSync(SH, "utf8"), { version: "1.2.3", downloadBase: "https://get.example.test/plania/" });
    assert.match(sh, /^DEFAULT_BASE="https:\/\/get\.example\.test\/plania"$/m);
    assert.match(sh, /^DEFAULT_VERSION="1\.2\.3"$/m);
    const ps = stampBootstrap(readFileSync(PS1, "utf8"), { version: "1.2.3", downloadBase: "https://get.example.test/plania" });
    assert.match(ps, /^\$DefaultBase = 'https:\/\/get\.example\.test\/plania'$/m);
    assert.match(ps, /^\$DefaultVersion = '1\.2\.3'$/m);
    assert.throws(() => stampBootstrap("", { version: "1.2.3", downloadBase: "https://x.test/$(whoami)" }), PackError);
    assert.throws(() => stampBootstrap("", { version: "1.2.3", downloadBase: "file:///tmp" }), PackError);
  });
});

// A package like the real one, as far as the installer looks: plania-<version>/package.json pinning pnpm.
function fakePackage(opts: { sha?: "good" | "bad" | "none" } = {}): string {
  const d = tmp("pkg");
  mkdirSync(path.join(d, "plania-9.9.9"));
  writeFileSync(path.join(d, "plania-9.9.9/package.json"), JSON.stringify({ name: "plania", packageManager: `pnpm@${PNPM}` }));
  writeFileSync(path.join(d, "plania-9.9.9/release.json"), "{}");
  const r = spawnSync("tar", ["-czf", "plania-9.9.9.tar.gz", "plania-9.9.9"], { cwd: d });
  assert.equal(r.status, 0, String(r.stderr));
  const archive = path.join(d, "plania-9.9.9.tar.gz");
  const hex = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (opts.sha !== "none") writeFileSync(`${archive}.sha256`, `${opts.sha === "bad" ? "0".repeat(64) : hex}  plania-9.9.9.tar.gz\n`);
  return archive;
}

// A stand-in pnpm on PATH: answers --version with the pinned one and logs every other call.
function fakePnpm(): { bin: string; log: string } {
  const bin = tmp("bin");
  const log = path.join(bin, "calls.log");
  writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${PNPM}; exit 0; fi\necho "$*" >> "${log.replace(/\\/g, "/")}"\n`);
  chmodSync(path.join(bin, "pnpm"), 0o755);
  writeFileSync(path.join(bin, "pnpm.cmd"), `@echo off\r\nif "%1"=="--version" (echo ${PNPM}& exit /b 0)\r\necho %*>>"${log}"\r\n`);
  return { bin, log };
}
const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/).map((l) => l.trim()) : []);

type Run = (args: { from: string; dir: string; bin: string; extra?: string[]; noService?: boolean }) => { status: number | null; out: string };
const runners: [string, string | false, Run][] = [
  [
    "install.sh",
    needs({ posix: true, tools: ["sh", "tar"] }),
    ({ from, dir, bin, extra = [], noService = false }) => {
      const r = spawnSync("sh", [SH, "--from", from, "--dir", dir, "--yes", ...(noService ? ["--no-service"] : []), "--", ...extra], {
        encoding: "utf8",
        env: { ...process.env, PLANIA_BOOTSTRAP_SKIP_DEPS: "1", PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      });
      return { status: r.status, out: r.stdout + r.stderr };
    },
  ],
  [
    "install.ps1",
    needs({ platforms: ["win32"], tools: ["powershell"] }),
    ({ from, dir, bin, extra = [], noService = false }) => {
      const r = spawnSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PS1, "-From", from, "-Dir", dir, "-Yes", ...(noService ? ["-NoService"] : []), ...(extra.length ? ["-InstallArgs", extra.join(",")] : [])],
        { encoding: "utf8", env: { ...process.env, PLANIA_BOOTSTRAP_SKIP_DEPS: "1", PATH: `${bin}${path.delimiter}${process.env.PATH}` } },
      );
      return { status: r.status, out: r.stdout + r.stderr };
    },
  ],
];

for (const [name, skip, run] of runners) {
  describe(`${name} --from`, { skip }, () => {
    test("unpacks into the folder, then installs dependencies from the lockfile and runs the install", () => {
      const { bin, log } = fakePnpm();
      const dir = path.join(tmp("home"), "mi plania");
      const r = run({ from: fakePackage(), dir, bin, extra: ["--url=postgres://u@localhost:5432/plania"] });
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /coincide con su \.sha256/);
      assert.ok(existsSync(path.join(dir, "package.json")), "the package's folder becomes the install folder");
      assert.deepEqual(calls(log), ["install --prod --frozen-lockfile", "plania:install --url=postgres://u@localhost:5432/plania"]);
    });

    test("--no-service tells the install command not to start Plania (it starts a service by default)", () => {
      const { bin, log } = fakePnpm();
      const dir = path.join(tmp("home"), "plania");
      const r = run({ from: fakePackage(), dir, bin, noService: true });
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(calls(log), ["install --prod --frozen-lockfile", "plania:install --no-start"]);
    });

    test("a package that does not match its .sha256 installs nothing", () => {
      const { bin, log } = fakePnpm();
      const dir = path.join(tmp("home"), "plania");
      const r = run({ from: fakePackage({ sha: "bad" }), dir, bin });
      assert.notEqual(r.status, 0);
      assert.match(r.out, /no coincide con su \.sha256/);
      assert.ok(!existsSync(dir));
      assert.deepEqual(calls(log), []);
    });

    test("an existing install or a folder with files is refused", () => {
      const { bin, log } = fakePnpm();
      const dir = tmp("full");
      writeFileSync(path.join(dir, "notes.txt"), "mine");
      const r = run({ from: fakePackage({ sha: "none" }), dir, bin });
      assert.notEqual(r.status, 0);
      assert.match(r.out, /no est.{1,2} vac.{1,2}a/);
      writeFileSync(path.join(dir, "release.json"), "{}");
      assert.match(run({ from: fakePackage(), dir, bin }).out, /pnpm update:plania/);
      assert.deepEqual(calls(log), []);
    });
  });
}
