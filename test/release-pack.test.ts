// PLA-I2-17: the release package, its version, the notices and the service files. No database, no network: the
// pack copies this checkout into a temp folder with a stand-in built screen, and the service plans are asserted
// without running launchctl or systemctl.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { releaseRoutes } from "../src/api/release.js";
import { collectNotices, renderNotices } from "../src/packaging/notices.js";
import { buyerPackageJson, pack, PackError } from "../src/packaging/pack.js";
import {
  applyPlan,
  installPlan,
  launchdPlist,
  restartCommand,
  servicePath,
  servicePlatform,
  systemdUnit,
  uninstallPlan,
  type ServiceEnv,
} from "../src/packaging/service.js";
import { isPackage, readRelease } from "../src/release.js";
import { healthUi, rebuildReason } from "../src/ui-build.js";

(globalThis as { React?: unknown }).React = React;
const ROOT = path.resolve(import.meta.dirname, "..");
const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), `plania-${p}-`));

// A stand-in for dist/ui: what vite build leaves (index.html, the stamp, one asset).
function fakeDist(): string {
  const d = path.join(tmp("dist"), "ui");
  mkdirSync(path.join(d, "assets"), { recursive: true });
  writeFileSync(path.join(d, "index.html"), "<!doctype html><title>Plania</title>");
  writeFileSync(path.join(d, "build.json"), JSON.stringify({ commit: "abc", dirty: false, built_at: "2026-11-18T00:00:00Z" }));
  writeFileSync(path.join(d, "assets/index-1234.js"), "console.log(1)");
  return d;
}

const NOW = new Date("2026-11-18T12:00:00Z");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("release package", () => {
  const out = tmp("release");
  const archived: string[][] = [];
  const r = pack({
    root: ROOT,
    outDir: out,
    distDir: fakeDist(),
    commit: COMMIT,
    now: NOW,
    notices: () => "NOTICES\n",
    archive: (dir, name, archiveName) => {
      archived.push([dir, name, archiveName]);
      writeFileSync(path.join(dir, archiveName), "fake archive");
    },
  });
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const has = (f: string) => existsSync(path.join(r.dir, f));

  test("the manifest names the version, the commit, the build time and the last migration", () => {
    assert.equal(path.basename(r.dir), `plania-${pkg.version}`);
    const m = JSON.parse(readFileSync(path.join(r.dir, "release.json"), "utf8"));
    assert.deepEqual(m, r.manifest);
    assert.equal(m.format, 1);
    assert.equal(m.version, pkg.version);
    assert.equal(m.commit, COMMIT);
    assert.equal(m.built_at, NOW.toISOString());
    assert.equal(m.node, pkg.engines.node);
    assert.match(m.migrations ?? "", /^\d{4}_.*\.sql$/);
    assert.ok(has(`drizzle/migrations/${m.migrations}`));
    assert.equal(readFileSync(path.join(r.dir, "VERSION"), "utf8"), `${pkg.version}\n`);
  });

  test("it carries the built screen, migrations, kit, prompts, config, buyer scripts, licence and notes", () => {
    for (const f of [
      "dist/ui/index.html",
      "dist/ui/build.json",
      "dist/ui/assets/index-1234.js",
      "drizzle/migrations/0000_curvy_wolfpack.sql",
      "kit/README.md",
      "prompts/morning-brief",
      "config/plania-gitleaks.toml",
      "docs/templates/product-owner.md",
      "src/app.ts",
      "ui/src/lib/falta.ts",
      "scripts/dev.ts",
      "scripts/install.ts",
      "scripts/migrate.ts",
      "scripts/service.ts",
      "scripts/restart.ts",
      "scripts/update.ts",
      "scripts/restore.ts",
      "scripts/seed-org.ts",
      "scripts/kit.ts",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".env.example",
      "LICENSE",
      "THIRD_PARTY_NOTICES",
      "CHANGELOG.md",
    ]) {
      assert.ok(has(f), `${f} should ship`);
    }
  });

  test("no tests, no .env, no dev tooling, no screen sources outside ui/src/lib", () => {
    for (const f of ["test", "spike", "replay", ".env", "node_modules", "vite.config.ts", "drizzle.config.ts", "components.json", "ui/src/pages", "ui/src/App.tsx", "docs/adr", "CLAUDE.md", ".github", "scripts/seed.ts", "scripts/release-pack.ts", "scripts/mcp-table.ts", "scripts/scan"]) {
      assert.ok(!has(f), `${f} should not ship`);
    }
    assert.ok(!r.files.some((f) => /\.test\.ts$/.test(f) || /(^|\/)\.env(\.|$)(?!example)/.test(f)), "no test or .env file anywhere");
  });

  test("package.json keeps the dependencies (the lockfile still matches) and only scripts whose file ships", () => {
    const shipped = JSON.parse(readFileSync(path.join(r.dir, "package.json"), "utf8"));
    assert.deepEqual(shipped.dependencies, pkg.dependencies);
    assert.ok(shipped.dependencies.tsx, "tsx runs the server, so it is a production dependency");
    for (const s of ["start", "plania:install", "db:migrate", "service:install", "service:uninstall", "server:restart", "machine:check", "update:plania", "restore:plania", "help:report", "uninstall:plania"]) assert.ok(shipped.scripts[s], s);
    for (const s of ["dev", "dev:api", "dev:ui", "build", "test", "seed", "release:pack", "mcp-table", "db:generate", "notices"]) assert.equal(shipped.scripts[s], undefined, s);
    for (const cmd of Object.values(shipped.scripts) as string[]) {
      for (const m of cmd.matchAll(/scripts\/([\w.-]+\.ts)/g)) assert.ok(has(`scripts/${m[1]}`), `${cmd} needs scripts/${m[1]}`);
    }
  });

  test("the archive is made from the folder, with its sha256 beside it", () => {
    assert.deepEqual(archived, [[out, `plania-${pkg.version}`, `plania-${pkg.version}.tar.gz`]]);
    assert.equal(r.archive, path.join(out, `plania-${pkg.version}.tar.gz`));
    assert.match(readFileSync(`${r.archive}.sha256`, "utf8"), new RegExp(`^${r.sha256}  plania-${pkg.version}\\.tar\\.gz\\n$`));
  });

  test("the packed server never rebuilds the screen, even inside a git repository, and reports its release", () => {
    assert.ok(isPackage(r.dir));
    assert.equal(rebuildReason(r.dir, path.join(r.dir, "dist/ui"), { packaged: isPackage, head: () => ({ commit: "other", dirty: true }) }), null);
    const h = healthUi(r.dir, path.join(r.dir, "dist/ui"));
    assert.deepEqual(h.version, { version: pkg.version, commit: COMMIT, built_at: NOW.toISOString(), packaged: true });
    assert.equal(h.head, null);
    assert.equal(h.ui?.commit, "abc");
  });

  test("a checkout still rebuilds when the stamp is not HEAD", () => {
    const head = () => ({ commit: "new", dirty: false });
    assert.match(rebuildReason(ROOT, path.join(r.dir, "dist/ui"), { packaged: () => false, head }) ?? "", /HEAD is new/);
  });

  test("it refuses without a built screen", () => {
    assert.throws(() => pack({ root: ROOT, outDir: tmp("x"), distDir: tmp("empty"), commit: null, now: NOW, notices: () => "" }), PackError);
  });

  test("scripts referring to files that do not ship are dropped", () => {
    const p = buyerPackageJson({ scripts: { start: "tsx scripts/dev.ts", seed: "tsx scripts/seed.ts", "dev:ui": "vite", build: "tsc && vite build" } });
    assert.deepEqual(p.scripts, { start: "tsx scripts/dev.ts" });
  });
});

describe("version", () => {
  test("a checkout reads package.json and the commit; no manifest means not packaged", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.deepEqual(readRelease(ROOT, () => "c0ffee"), { version: pkg.version, commit: "c0ffee", built_at: null, packaged: false });
  });

  test("GET /api/release returns the manifest's version and the CHANGELOG", async () => {
    const dir = tmp("rel");
    writeFileSync(path.join(dir, "release.json"), JSON.stringify({ format: 1, version: "1.2.3", commit: "abc", built_at: "2026-11-18T12:00:00Z" }));
    writeFileSync(path.join(dir, "CHANGELOG.md"), "# Novedades\n\n## 1.2.3\n\n- Algo nuevo.\n");
    const body = (await (await releaseRoutes(dir, async () => null).request("/")).json()) as Record<string, unknown>;
    assert.equal(body.version, "1.2.3");
    assert.equal(body.packaged, true);
    assert.match(String(body.notes), /Algo nuevo/);
  });

  test("the repo's CHANGELOG has an entry for package.json's version", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.match(readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), new RegExp(`^## ${pkg.version.replace(/\./g, "\\.")}$`, "m"));
  });

  test("the screen shows the version in Plomería's words and on Novedades", async () => {
    const words = (await import(new URL("../ui/src/lib/version.ts", import.meta.url).href)) as typeof import("../ui/src/lib/version.js");
    assert.equal(words.versionLine({ version: "1.2.3", built_at: "2026-11-18T12:00:00Z", packaged: true }), "Versión 1.2.3, armada el 18 de noviembre de 2026");
    assert.equal(words.versionLine({ version: "0.1.0", built_at: null, packaged: false }), "Versión 0.1.0, copia de trabajo");
    const page = (await import(new URL("../ui/src/pages/novedades.tsx", import.meta.url).href)) as Record<string, any>;
    const h = React.createElement;
    const html = renderToStaticMarkup(
      h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, null, h(page.NovedadesView, { release: { version: "1.2.3", commit: "abc", built_at: "2026-11-18T12:00:00Z", packaged: true, notes: "## 1.2.3\n\n- Algo nuevo." } }))),
    );
    assert.match(html, /data-version="1\.2\.3"/);
    assert.match(html, /Versión 1\.2\.3, armada el 18 de noviembre de 2026/);
    assert.match(html, /Algo nuevo/);
  });
});

describe("third-party notices", () => {
  // A tiny pnpm-like tree: root depends on a, a on b; c is a dev dependency; a-darwin is a platform binary.
  function tree(): string {
    const root = tmp("notices");
    const pkgAt = (dir: string, json: object, license?: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "package.json"), JSON.stringify(json));
      if (license) writeFileSync(path.join(dir, "LICENSE"), license);
    };
    pkgAt(root, { name: "app", dependencies: { a: "1" }, devDependencies: { c: "1" } });
    pkgAt(path.join(root, "node_modules/a"), { name: "a", version: "1.0.0", license: "MIT", dependencies: { b: "1" }, optionalDependencies: { "a-darwin": "1" } }, "MIT text of a");
    pkgAt(path.join(root, "node_modules/a/node_modules/b"), { name: "b", version: "2.0.0", license: { type: "ISC" }, repository: "git+https://example.test/b.git" });
    pkgAt(path.join(root, "node_modules/a-darwin"), { name: "a-darwin", version: "1.0.0", license: "MIT", os: ["darwin"] });
    pkgAt(path.join(root, "node_modules/c"), { name: "c", version: "1.0.0", license: "MIT" }, "c");
    return root;
  }

  test("only production dependencies, transitively, without platform binaries", () => {
    const n = collectNotices(tree());
    assert.deepEqual(n.map((x) => `${x.name}@${x.version} ${x.license}`), ["a@1.0.0 MIT", "b@2.0.0 ISC"]);
    const text = renderNotices(n);
    assert.match(text, /MIT text of a/);
    assert.match(text, /Source: https:\/\/example\.test\/b/);
    assert.match(text, /No licence file in the package; its package\.json declares ISC/);
  });

  test("the repo has a LICENSE and a generated THIRD_PARTY_NOTICES", () => {
    assert.ok(readFileSync(path.join(ROOT, "LICENSE"), "utf8").length > 0);
    const notices = readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES"), "utf8");
    assert.match(notices, /^THIRD-PARTY SOFTWARE NOTICES/);
    for (const dep of ["hono", "react", "pg", "tsx"]) assert.match(notices, new RegExp(`^${dep} \\d`, "m"), dep);
  });
});

describe("service", () => {
  const base: ServiceEnv = {
    platform: "darwin",
    home: "/Users/ana",
    uid: 501,
    root: "/Users/ana/plania-0.1.0",
    node: "/opt/homebrew/bin/node",
    path: "/opt/homebrew/bin:/usr/bin:/bin",
    port: 3737,
    systemd: false,
    wsl: false,
  };
  const io = () => {
    const log: string[] = [];
    return {
      log,
      io: {
        mkdir: (d: string) => log.push(`mkdir ${d}`),
        write: (f: string) => log.push(`write ${f}`),
        remove: (f: string) => log.push(`rm ${f}`),
        run: (cmd: string, args: string[]) => {
          log.push(`${cmd} ${args.join(" ")}`);
          if (args[0] === "bootout") throw new Error("not loaded");
        },
      },
    };
  };

  test("macOS: a launchd agent that starts at login, restarts on a crash and logs in ~/Library/Logs", () => {
    const plist = launchdPlist(base);
    assert.match(plist, /<key>Label<\/key>\s*<string>com\.plania\.server<\/string>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>\s*<string>--env-file=\/Users\/ana\/plania-0\.1\.0\/\.env<\/string>\s*<string>--import<\/string>\s*<string>tsx<\/string>\s*<string>\/Users\/ana\/plania-0\.1\.0\/scripts\/dev\.ts<\/string>/);
    assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/ana\/plania-0\.1\.0<\/string>/);
    assert.match(plist, /<key>StandardOutPath<\/key>\s*<string>\/Users\/ana\/Library\/Logs\/plania\/server\.log<\/string>/);
    assert.match(plist, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin:\/bin<\/string>/);
    const { log, io: fake } = io();
    applyPlan(installPlan(base), fake);
    assert.deepEqual(log, [
      "mkdir /Users/ana/Library/LaunchAgents",
      "mkdir /Users/ana/Library/Logs/plania",
      "write /Users/ana/Library/LaunchAgents/com.plania.server.plist",
      "launchctl bootout gui/501/com.plania.server",
      "launchctl bootstrap gui/501 /Users/ana/Library/LaunchAgents/com.plania.server.plist",
    ]);
  });

  test("macOS: paths with & or spaces stay valid XML", () => {
    assert.match(launchdPlist({ ...base, root: "/Users/ana/A & B" }), /<string>\/Users\/ana\/A &amp; B<\/string>/);
  });

  test("Linux: a systemd user unit, enabled and started; --at-boot adds lingering", () => {
    const linux = { ...base, platform: "linux" as const, home: "/home/ana", root: "/home/ana/plania 0.1.0", node: "/usr/bin/node", systemd: true };
    const unit = systemdUnit(linux);
    assert.match(unit, /^ExecStart="\/usr\/bin\/node" "--env-file=\/home\/ana\/plania 0\.1\.0\/\.env" "--import" "tsx" "\/home\/ana\/plania 0\.1\.0\/scripts\/dev\.ts" "--port" "3737"$/m);
    assert.match(unit, /^WorkingDirectory="\/home\/ana\/plania 0\.1\.0"$/m);
    assert.match(unit, /^Restart=on-failure$/m);
    assert.match(unit, /^WantedBy=default\.target$/m);
    const plan = installPlan(linux, { atBoot: true });
    assert.deepEqual(plan.files.map((f) => f.path), ["/home/ana/.config/systemd/user/plania.service"]);
    assert.deepEqual(plan.commands.map((c) => `${c.cmd} ${c.args.join(" ")}`), [
      "systemctl --user daemon-reload",
      "systemctl --user enable plania.service",
      "systemctl --user restart plania.service",
      "loginctl enable-linger",
    ]);
    assert.match(unit, /^StandardOutput=append:\/home\/ana\/\.local\/state\/plania\/server\.log$/m);
    assert.match(plan.lines.join("\n"), /\.local\/state\/plania\/server\.log/);
    const { log, io: fake } = io();
    applyPlan(uninstallPlan(linux), fake);
    assert.deepEqual(log, ["systemctl --user disable --now plania.service", "rm /home/ana/.config/systemd/user/plania.service", "systemctl --user daemon-reload"]);
  });

  test("WSL without systemd and Windows change nothing and say why", () => {
    assert.equal(servicePlatform({ platform: "linux", systemd: false, wsl: true }), "wsl-no-systemd");
    assert.equal(servicePlatform({ platform: "linux", systemd: true, wsl: true }), "linux");
    for (const env of [{ ...base, platform: "linux" as const, wsl: true }, { ...base, platform: "win32" as const }]) {
      const plan = installPlan(env);
      assert.deepEqual([plan.files, plan.commands], [[], []]);
      assert.ok(plan.lines.length > 0);
    }
    assert.match(installPlan({ ...base, platform: "linux", wsl: true }).lines.join("\n"), /systemd=true/);
  });

  test("restart: kickstart on macOS, systemctl on Linux, none elsewhere", () => {
    assert.deepEqual(restartCommand({ platform: "darwin", uid: 501, systemd: false, wsl: false }), { cmd: "launchctl", args: ["kickstart", "-k", "gui/501/com.plania.server"] });
    assert.deepEqual(restartCommand({ platform: "linux", uid: 1000, systemd: true, wsl: true }), { cmd: "systemctl", args: ["--user", "restart", "plania.service"] });
    assert.equal(restartCommand({ platform: "win32", uid: 0, systemd: false, wsl: false }), null);
  });

  test("the service PATH drops pnpm's node_modules/.bin folders", () => {
    assert.equal(servicePath("/x/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/opt/homebrew/bin"), "/opt/homebrew/bin:/usr/bin");
  });
});
