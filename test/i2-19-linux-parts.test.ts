// PLA-I2-19: the machine-bound parts working on Linux. The machine job reads Linux (ss when lsof is absent, GNU ps,
// /proc for a cwd, systemd user units for LaunchAgents); the base lever runs `systemctl --user` for a Postgres a
// user unit starts; a process's command line comes from /proc; Chrome and Tailscale are found on PATH and in the
// XDG and Playwright caches; gitleaks says what to do on native Windows. Parsers run on recorded output
// (test/fixtures/machine/*-linux.txt); the still is real where Chrome exists, else it skips with its reason.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i2-19-"));
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const parse = await import("../src/jobs/machine/parse.js");
const collect = await import("../src/jobs/machine/collect.js");
const { isPrimary, suggestTeardown } = await import("../src/jobs/machine/infer.js");
const { linkSystemd, systemdUserDir } = await import("../src/jobs/machine/index.js");
const maquinas = await import("../src/maquinas/machines.js");
const support = await import("../src/lib/system-support.js");
const { processCommand } = await import("../src/lib/proc-command.js");
const { findChrome, launchChrome } = await import("../src/captures/chrome.js");
const { tailscaleBin } = await import("../src/captures/vivo.js");
type Directory = import("../src/jobs/machine/infer.js").Directory;
type Run = import("../src/jobs/machine/run.js").Run;
type RunResult = import("../src/jobs/machine/run.js").RunResult;

const fx = (name: string) => readFileSync(new URL(`./fixtures/machine/${name}`, import.meta.url), "utf8");
const ok = (stdout: string): RunResult => ({ ok: true, stdout });
const missing: RunResult = { ok: false, reason: "missing", stdout: "" };
const only = (files: string[]) => (p: string) => files.includes(p);

const ZIG = "/home/ana/dev/zigzag";
const dir = (): Directory =>
  ({
    projects: [{ id: "p-zig", slug: "zigzag", keyPrefix: "ZIG" }],
    repos: [{ name: "zigzag", path: ZIG, projectId: "p-zig", projectSlug: "zigzag" }],
    worktrees: new Map(),
    tasksById: new Map(),
    tasksByKey: new Map(),
    branchOwner: new Map(),
    branchMergedAt: new Map(),
    claimed: [],
  }) as unknown as Directory;

let raw: pg.Client;
after(async () => {
  support.useSystemSupport(null);
  maquinas.setMaquinasDeps({});
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});
before(async () => {
  raw = await resetTestDb();
});

// ---- Check 3: the machine job and Máquinas on Linux

describe("the machine job reads Linux (check 3)", () => {
  test("ss -Htlnp: each listening process with its ports; sockets of other users are left out", () => {
    const l = parse.parseSsListeners(fx("ss-listen-linux.txt"));
    assert.deepEqual(
      l.map((x) => [x.pid, x.command, x.ports]),
      [
        [2101, "postgres", [5433]],
        [2210, "node", [3069]],
      ],
    );
  });

  test("GNU ps -eo pid=,ppid=,lstart=,args= reads like BSD ps", () => {
    const procs = parse.parsePs(fx("ps-linux.txt"));
    assert.equal(procs.length, 4);
    assert.equal(procs[1]!.command, "/usr/lib/postgresql/16/bin/postgres -D /home/ana/.local/share/pg16");
    assert.equal(procs[3]!.startedAt?.getDate(), 5, "a one-digit day keeps its padding");
    assert.equal(parse.classifyProc(procs[3]!.command), "headless_browser");
  });

  test("systemctl --user list-units and a unit's ExecStart", () => {
    const units = parse.parseSystemdUnits(fx("systemctl-user-units.txt"));
    assert.deepEqual(
      units.map((u) => [u.name, u.active, u.sub]),
      [
        ["dbus.service", "active", "running"],
        ["pg-dev.service", "active", "running"],
        ["zigzag-worker.service", "failed", "failed"],
      ],
    );
    assert.equal(parse.unitExecStart("[Service]\nExecStart=-/usr/lib/postgresql/16/bin/postgres -D /pg\n"), "/usr/lib/postgresql/16/bin/postgres -D /pg");
    assert.equal(parse.unitExecStart("[Unit]\nDescription=x\n"), null);
  });

  test("without lsof the ports come from ss, the processes from GNU ps and each cwd from /proc", async () => {
    const calls: string[] = [];
    const run: Run = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "lsof") return missing;
      if (cmd === "ss") return ok(fx("ss-listen-linux.txt"));
      if (cmd === "ps") return ok(fx("ps-linux.txt"));
      return missing;
    };
    const cwds: Record<number, string> = { 2101: "/home/ana/.local/share/pg16", 2210: ZIG, 2300: ZIG };
    const out = await collect.collectProcesses(run, dir(), { selfPid: 1, selfPorts: [3737], platform: "linux", readCwd: (p) => cwds[p] ?? null });
    assert.deepEqual(out.ran, ["ports", "procs"]);
    assert.ok(calls.includes("ps -eo pid=,ppid=,lstart=,args="), calls.join("; "));
    assert.ok(!calls.some((c) => c.includes("-d cwd")), "no lsof for the cwd on Linux");
    const by = Object.fromEntries(out.items.map((i) => [i.locator, i]));
    assert.equal(by["postgres:5433"]?.details.data_dir, "/home/ana/.local/share/pg16");
    assert.equal(by["port:3069"]?.cwd, ZIG);
    assert.equal(by["pid:2300"]?.kind, "browser");
  });

  test("with lsof on Linux its listeners are used, and still no lsof for the cwd", async () => {
    const calls: string[] = [];
    const run: Run = async (cmd, args) => {
      calls.push(cmd);
      if (cmd === "lsof") return ok("p2210\ncnode\nf23\nn*:3069\n");
      if (cmd === "ps") return ok(fx("ps-linux.txt"));
      return missing;
    };
    const out = await collect.collectProcesses(run, dir(), { selfPid: 1, selfPorts: [], platform: "linux", readCwd: () => ZIG });
    assert.deepEqual(calls.sort(), ["lsof", "ps"]);
    assert.ok(out.items.some((i) => i.locator === "port:3069"));
  });

  test("systemd user units are the services: a Postgres unit is a base, its teardown is systemctl, a db server links to it", () => {
    const state = { ran: true, units: parse.parseSystemdUnits(fx("systemctl-user-units.txt")) };
    const files: Record<string, string> = {
      "/u/pg-dev.service": "[Service]\nExecStart=/usr/lib/postgresql/16/bin/postgres -D /home/ana/.local/share/pg16\n",
      "/u/zigzag-worker.service": "[Service]\nExecStart=/usr/bin/node worker.js\n",
    };
    const got = collect.systemdItems(state, ["pg-dev.service", "zigzag-worker.service", "notes.txt"], "/u", ["zigzag"], (f) => files[f.replace(/\\/g, "/")] ?? null);
    assert.deepEqual(got.ran, ["systemd"]);
    assert.deepEqual(
      got.items.map((i) => [i.locator, i.details.status, i.repoHint ?? null]),
      [
        ["systemd:pg-dev.service", "active/running", null],
        ["systemd:zigzag-worker.service", "failed/failed", "zigzag"],
      ],
    );
    assert.equal(collect.groupOf("service", "systemd:pg-dev.service", {}), "systemd");
    assert.equal(isPrimary(got.items[0]!, dir()), true, "a Postgres unit is shared, like a brew service");
    assert.equal(suggestTeardown(got.items[1]!, null), "systemctl --user disable --now zigzag-worker.service");
    const server = { kind: "db_server" as const, locator: "postgres:5433", details: { data_dir: "/home/ana/.local/share/pg16", engine: "postgres", port: 5433 } as Record<string, unknown> };
    linkSystemd([server, ...got.items] as never);
    assert.equal(server.details.systemd_unit, "pg-dev.service");
    assert.equal(suggestTeardown(server as never, null), "systemctl --user stop pg-dev.service");
    assert.equal(systemdUserDir({ XDG_CONFIG_HOME: "/xc" }, "/home/ana"), path.join("/xc", "systemd", "user"));
    assert.equal(systemdUserDir({}, "/home/ana"), path.join("/home/ana", ".config", "systemd", "user"));
  });

  test("the base lever on Linux: systemctl --user for a unit's Postgres; brew or systemctl decide if it is available", async () => {
    assert.equal(support.missingFor("base_lever", { platform: "linux", env: { PATH: "/usr/bin" }, exists: only([path.join("/usr/bin", "systemctl")]) }), null);
    assert.equal(support.missingFor("base_lever", { platform: "linux", env: { PATH: "" }, exists: () => false }), "brew or systemctl");
    assert.equal(support.missingFor("base_lever", { platform: "darwin", env: { PATH: "/usr/bin" }, exists: only([path.join("/usr/bin", "systemctl")]) }), "brew");

    const repo = path.join(TMP, "repo-zig");
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(repo, ".env.local"), "DATABASE_URL=postgres://zig@127.0.0.1:5433/zigzag_dev\n");
    await raw.query(`update projects set settings = settings || $1::jsonb where slug = 'zigzag'`, [JSON.stringify({ local: { repo_path: repo } })]);
    const fp = (kind: string, locator: string, details: object, slug: string | null) =>
      raw.query(`insert into footprints (machine, kind, locator, project_id, details, state, source, last_seen_at) values ('test', $1, $2, (select id from projects where slug = $3), $4::jsonb, 'live', 'observed', now())`, [kind, locator, slug, JSON.stringify(details)]);
    await fp("db_server", "postgres:5433", { engine: "postgres", port: 5433, data_dir: "/home/ana/.local/share/pg16", systemd_unit: "pg-dev.service" }, null);
    await fp("service", "systemd:pg-dev.service", { manager: "systemd", name: "pg-dev.service", exec: "/usr/lib/postgresql/16/bin/postgres -D /home/ana/.local/share/pg16" }, null);
    await fp("database", "zigzag_dev@127.0.0.1:5433", { name: "zigzag_dev", port: 5433 }, "zigzag");
    const execs: string[] = [];
    const busy = new Set<number>();
    support.useSystemSupport(() => true);
    maquinas.setMaquinasDeps({
      portBusy: async (p) => busy.has(p),
      exec: async (command) => {
        execs.push(command);
        if (/ start /.test(command)) busy.add(5433);
        else busy.delete(5433);
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const headers = { Cookie: `${SESSION_COOKIE}=${createSession()}` };
    const read = (await (await app.request("/api/projects/zigzag/maquinas", { headers })).json()) as { base: { service: string; manager: string; lever: { can: boolean } } };
    assert.deepEqual([read.base.service, read.base.manager, read.base.lever.can], ["pg-dev.service", "systemd", true]);
    const on = await app.request("/api/projects/zigzag/maquinas/base/encender", { method: "POST", headers });
    assert.equal(on.status, 200, await on.clone().text());
    assert.equal(((await on.json()) as { base: { state: string } }).base.state, "on");
    await app.request("/api/projects/zigzag/maquinas/base/apagar", { method: "POST", headers });
    assert.deepEqual(execs, ["systemctl --user start pg-dev.service", "systemctl --user stop pg-dev.service"]);

    // A Postgres no user unit starts (the distribution's own service): a plain sentence, never a failure.
    await raw.query(`update footprints set details = details - 'systemd_unit' where locator = 'postgres:5433'`);
    const plain = (await (await app.request("/api/projects/zigzag/maquinas", { headers })).json()) as { base: { lever: { can: boolean; reason: string } } };
    assert.equal(plain.base.lever.can, false);
    assert.match(plain.base.lever.reason, /servicio de brew ni de systemd/);
  });
});

// ---- Leftovers and helpers found on Linux

test("a process's command line: /proc on Linux, ps elsewhere", async () => {
  assert.equal(await processCommand(42, { platform: "linux", readFile: () => "node\0/x/wrapper.mjs\0run-1\0" }), "node /x/wrapper.mjs run-1");
  assert.equal(await processCommand(42, { platform: "linux", readFile: () => "" }), null, "a zombie");
  assert.equal(await processCommand(42, { platform: "linux", readFile: () => { throw new Error("ENOENT"); } }), null, "gone");
  assert.equal(await processCommand(42, { platform: "darwin", ps: async (p) => `ps ${p}` }), "ps 42");
  assert.equal(await processCommand(0, { platform: "linux", readFile: () => "x" }), null);
});

test("Chrome is found on PATH and in the Playwright caches (macOS, XDG, PLAYWRIGHT_BROWSERS_PATH)", () => {
  const home = "/home/ana";
  assert.equal(findChrome({ HOME: home, PATH: "/snap/bin" }, only([path.join("/snap/bin", "chromium")])), path.join("/snap/bin", "chromium"));
  // A real cache folder (the lookup lists it): $XDG_CACHE_HOME/ms-playwright/chromium-*/chrome-linux64/chrome.
  // Only files under TMP count, so a Chrome installed on this machine does not answer first.
  const inTmp = (p: string) => p.startsWith(TMP) && existsSync(p);
  const xc = path.join(TMP, "xc");
  const linux64 = path.join(xc, "ms-playwright", "chromium-1200", "chrome-linux64", "chrome");
  mkdirSync(path.dirname(linux64), { recursive: true });
  writeFileSync(linux64, "");
  assert.equal(findChrome({ HOME: home, PATH: "", XDG_CACHE_HOME: xc }, inTmp), linux64);
  const pwb = path.join(TMP, "pwb");
  const old = path.join(pwb, "chromium-1100", "chrome-linux", "chrome");
  mkdirSync(path.dirname(old), { recursive: true });
  writeFileSync(old, "");
  assert.equal(findChrome({ HOME: home, PATH: "", PLAYWRIGHT_BROWSERS_PATH: pwb }, inTmp), old);
  assert.equal(findChrome({ HOME: home, PATH: "" }, () => false), null);
});

test("Tailscale is found on PATH beyond the fixed paths", () => {
  assert.equal(tailscaleBin({ PATH: "/usr/sbin" }, only([path.join("/usr/sbin", "tailscale")])), path.join("/usr/sbin", "tailscale"));
  assert.equal(tailscaleBin({ PATH: "" }, () => false), null);
  assert.equal(tailscaleBin({ PLANIA_TAILSCALE_BIN: "/opt/ts", PATH: "" }, only(["/opt/ts"])), "/opt/ts");
});

test("gitleaks on native Windows says to use WSL or put it on PATH", { skip: process.platform === "win32" ? false : `the message is native Windows' only; this is ${process.platform}` }, async () => {
  const { resolveGitleaks } = await import("../src/lib/scan/gitleaks.js");
  const r = await resolveGitleaks();
  if ("error" in r) assert.match(r.error, /inside WSL, or put gitleaks/);
  else assert.equal(r.source, "path", "a gitleaks on PATH is used");
});

// ---- Check 1: a still on this system, where Chrome exists

const chrome = findChrome();
test("a real still: headless Chrome opens a page and returns a PNG (check 1)", { skip: chrome ? false : "needs Chrome or Chromium on this system (PLANIA_CHROME_PATH, PATH or the Playwright cache)", timeout: 90_000 }, async () => {
  const server = createServer((_req, res) => res.end("<!doctype html><title>t</title><h1 style='color:teal'>Hola</h1>"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const browser = await launchChrome();
  try {
    await browser.page.setViewport({ width: 390, height: 300, mobile: true, scale: 1 });
    const nav = await browser.page.goto(`http://127.0.0.1:${port}/`);
    assert.equal(nav.status, 200);
    const png = await browser.page.screenshot(false);
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
    assert.ok(png.length > 500);
  } finally {
    await browser.close();
    server.close();
  }
});
