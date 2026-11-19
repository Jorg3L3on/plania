// PLA-I2-18: the help report and leaving. Secrets are planted in .env, the process environment, project settings, a
// ticket's scope, run failure text and the server log; none may reach the report. Every outside call is a fake: the
// programs (a spy that answers --version), fetch (a spy that must never be called), the service, the processes and
// the database drop of the uninstall.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { makeDb } = await import("../src/db/client.js");
const { buildHelpReport, localOnly, renderHelpReport, parseDotEnv } = await import("../src/help-report/index.js");
const { makeRedactor, HIDDEN } = await import("../src/help-report/redact.js");
const { helpReportRoutes } = await import("../src/api/help-report.js");
const uninstallMod = await import("../src/uninstall/index.js");
const { Hono } = await import("hono");
type ExecFn = import("../src/brief/doctor.js").ExecFn;

// The planted secrets. Each must be absent from every report.
const ENV_FILE_SECRET = "planted-env-file-value-7f3a9c2e";
const PROCESS_SECRET = "planted-process-value-41be77d0";
const DB_PASSWORD = "hunter2-db-password";
const SETTINGS_SECRET = "settings-pass-9z8y7x6w";
const SETTINGS_PATH_SECRET = "/home/ana/secret-client-folder";
const GH_TOKEN = `ghp_${"A1b2C3d4E5".repeat(4)}`;
const ARGON = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";
const SCOPE_TEXT = "SCOPE-ONLY-TEXT-never-in-report";
const THREAD_TEXT = "THREAD-ONLY-TEXT-never-in-report";
const LOG_BEARER = "logbearer0123456789abcdefXYZ";
const EMAIL = "ana.perez@gmail.com";
const PLANTED = [ENV_FILE_SECRET, PROCESS_SECRET, DB_PASSWORD, SETTINGS_SECRET, SETTINGS_PATH_SECRET, GH_TOKEN, ARGON, SCOPE_TEXT, THREAD_TEXT, LOG_BEARER, EMAIL];

const assertClean = (text: string) => {
  for (const s of PLANTED) assert.ok(!text.includes(s), `the report holds a planted secret: ${s.slice(0, 12)}…`);
};

/** A Plania folder: package.json, a .env with secrets, a server log with secrets. */
function install(): { root: string; log: string } {
  const root = mkdtempSync(path.join(tmpdir(), "plania-help-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "plania", version: "0.9.1" }));
  writeFileSync(
    path.join(root, ".env"),
    [
      "# comment",
      `DATABASE_URL=postgres://plania:${DB_PASSWORD}@localhost:5432/plania`,
      `PLANIA_PLANTED='${ENV_FILE_SECRET}'`,
      `PLANIA_PASSWORD_HASH='${ARGON}'`,
      "export PLANIA_TZ=America/Mexico_City",
      "",
    ].join("\n"),
  );
  const log = path.join(root, "server.log");
  writeFileSync(
    log,
    [
      "[server] listening on 3737",
      `[runner] spawn failed with env PLANIA_PLANTED=${ENV_FILE_SECRET}`,
      `[http] Authorization: Bearer ${LOG_BEARER}`,
      `[gh] push refused for token ${GH_TOKEN}`,
      `[auth] hash ${ARGON}`,
      `[db] connect postgres://plania:${DB_PASSWORD}@localhost:5432/plania failed`,
      `[mail] owner is ${EMAIL}`,
      `[process] value ${PROCESS_SECRET} seen`,
      `[capture] login with ${SETTINGS_SECRET} at ${SETTINGS_PATH_SECRET}`,
      "[server] ready",
      "",
    ].join("\n"),
  );
  return { root, log };
}

/** A program runner that answers --version and records every call; anything else is a failure of the test. */
function programs() {
  const calls: string[] = [];
  const exec: ExecFn = async (cmd, args) => {
    calls.push(`${path.basename(cmd)} ${args.join(" ")}`);
    if (args[0] === "--version") return { code: 0, stdout: `${path.basename(cmd)} version 1.2.3\n`, stderr: "" };
    if (args[0] === "rev-parse" && args.includes("HEAD")) return { code: 0, stdout: "0123456789ab\n", stderr: "" };
    if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "remote") return { code: 0, stdout: "git@github.com:someone/repo.git\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { exec, calls };
}

/** fetch replaced by a spy for the length of fn. */
async function noFetch<T>(fn: () => Promise<T>): Promise<{ value: T; fetches: number }> {
  const real = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("the help report must not call the network");
  }) as typeof fetch;
  try {
    return { value: await fn(), fetches };
  } finally {
    globalThis.fetch = real;
  }
}

const NETWORK = /^(?:gh auth|git ls-remote|git fetch|git push|claude -p|.* -p )/;

let raw: pg.Client;
before(async () => {
  raw = await resetTestDb();
  await raw.query(`update projects set settings = $1 where slug = 'micasa'`, [
    JSON.stringify({ capture: { login: { password: SETTINGS_SECRET } }, local: { repo_path: SETTINGS_PATH_SECRET } }),
  ]);
  await raw.query(`update projects set body = $1, rules_text = $1 where slug = 'workia'`, [SCOPE_TEXT]);
  const [{ id: agent, project_id: project }] = (await raw.query(`insert into agents (slug, name, role, kind, project_id, role_template) select 'taller-micasa', 'Taller', 'taller', 'coder', id, 'taller' from projects where slug = 'micasa' returning id, project_id`)).rows;
  await raw.query(`insert into tasks (project_id, key, title, scope, status) values ($1, 'MIC-99', 'A ticket', $2, 'Ready')`, [project, SCOPE_TEXT]).catch(() => undefined);
  const summaries = [
    `fail: git push refused with ${GH_TOKEN} (session 491bc14d)`,
    `fail: env PLANIA_PLANTED=${ENV_FILE_SECRET} rejected`,
    `fail: capture login ${SETTINGS_SECRET} wrong\n${THREAD_TEXT}`,
    `fail: error_max_turns (41 turns)`,
  ];
  for (const [i, s] of summaries.entries())
    await raw.query(`insert into agent_runs (agent_id, project_id, task_key, role, status, summary, exit_code, queued_at, ended_at) values ($1, $2, 'MIC-99', 'taller', 'fail', $3, 1, now() - ($4 || ' minutes')::interval, now() - ($4 || ' minutes')::interval)`, [agent, project, s, String(10 - i)]);
});
after(async () => {
  await raw.end();
});

describe("the help report", () => {
  test("#1 #4: planted secrets in .env, the environment, settings, runs and the log never reach it, and nothing calls the network", async () => {
    const { root, log } = install();
    const { exec, calls } = programs();
    const env = { ...process.env, PLANIA_PROCESS_SECRET: PROCESS_SECRET, GITHUB_TOKEN: GH_TOKEN };
    const { db } = makeDb();
    const { value: report, fetches } = await noFetch(() => buildHelpReport({ root, env, exec, db, logFile: log }));
    const text = renderHelpReport(report);
    const json = JSON.stringify(report);
    assertClean(text);
    assertClean(json);
    assert.equal(fetches, 0);
    for (const c of calls) assert.ok(!NETWORK.test(c), `a network call was made: ${c}`);
    assert.ok(calls.length > 0 && calls.every((c) => / --version$/.test(c) || c.startsWith("git rev-parse") || c.startsWith("git remote get-url")), calls.join("\n"));

    // What it should hold.
    assert.deepEqual(report.plania, { version: "0.9.1", commit: "0123456789ab" });
    assert.equal(report.database.state, "ok");
    assert.ok(report.env_names.includes("PLANIA_PLANTED") && report.env_names.includes("PLANIA_PROCESS_SECRET") && report.env_names.includes("GITHUB_TOKEN"));
    assert.ok(!report.env_names.includes("PATH"));
    assert.deepEqual(report.projects?.map((p) => p.slug), ["filmia", "micasa", "workia", "zigzag"]);
    assert.equal(report.failed_runs?.length, 4);
    assert.ok(report.failed_runs!.every((f) => f.project === "micasa" && f.ticket === "MIC-99" && f.role === "taller"));
    assert.ok(report.failed_runs!.some((f) => f.reason === "error_max_turns (41 turns)"));
    assert.ok(report.log.found && report.log.lines.includes("[server] ready"));
    assert.ok(text.includes(HIDDEN));
    // gh and Claude's session need the network: reported as not checked, not as missing.
    assert.equal(report.machine.find((m) => m.id === "claude_session")?.state, "not_checked");
    assert.equal(report.machine.find((m) => m.id === "gh")?.state, "not_checked");
  });

  test("#4: the runner the report hands on refuses every network command without starting it", async () => {
    const { exec, calls } = programs();
    const local = localOnly(exec);
    const o = { env: {}, cwd: ".", timeoutMs: 1 };
    for (const [cmd, args] of [["gh", ["auth", "status"]], ["git", ["ls-remote", "--heads", "origin", "main"]], ["claude", ["-p", "hi"]], ["git", ["fetch"]]] as const) {
      const r = await local(cmd, [...args], o);
      assert.equal(r.code, null);
    }
    assert.deepEqual(calls, []);
    await local("git", ["--version"], o);
    assert.deepEqual(calls, ["git --version"]);
  });

  test("#2: with the database out of reach it says so and keeps what it could read", async () => {
    const { root, log } = install();
    const { exec } = programs();
    const env = { ...process.env, DATABASE_URL: "postgres://nobody@127.0.0.1:1/none", PLANIA_PROCESS_SECRET: PROCESS_SECRET };
    let opened = false;
    const { value: report, fetches } = await noFetch(() =>
      buildHelpReport({
        root,
        env,
        exec,
        logFile: log,
        openDb: async () => {
          opened = true;
          throw new Error("connect ECONNREFUSED");
        },
      }),
    );
    assert.ok(opened);
    assert.equal(fetches, 0);
    assert.equal(report.database.state, "unreachable");
    assert.equal(report.projects, null);
    assert.equal(report.failed_runs, null);
    assert.equal(report.plania.version, "0.9.1");
    assert.ok(report.machine.length > 0);
    assert.ok(report.env_names.includes("PLANIA_PLANTED"));
    assert.ok(report.log.lines.includes("[server] ready"));
    const text = renderHelpReport(report);
    // Without the database the projects' settings are not read, so their values are not known as secrets.
    for (const s of PLANTED.filter((x) => x !== SETTINGS_SECRET && x !== SETTINGS_PATH_SECRET)) assert.ok(!text.includes(s), `the report holds a planted secret: ${s.slice(0, 12)}…`);
    assert.match(text, /No responde/);
  });

  test("#2: `pnpm help:report` runs with an unreachable database and prints a clean report", { timeout: 120_000 }, async () => {
    const { log } = install();
    // This folder's .env is not the planted one: the values reach the command through its environment instead.
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `postgres://nobody:${DB_PASSWORD}@127.0.0.1:1/none`, PLANIA_LOG_FILE: log, PLANIA_PROCESS_SECRET: PROCESS_SECRET, PLANIA_PLANTED: ENV_FILE_SECRET };
    const out = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
      execFile(process.execPath, ["--import", "tsx", path.join(REPO_ROOT, "scripts", "help-report.ts"), "--out", "-"], { cwd: REPO_ROOT, env, timeout: 110_000 }, (err, stdout, stderr) =>
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
      ),
    );
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /# Informe de ayuda de Plania/);
    assert.match(out.stdout, /No responde/);
    assert.match(out.stdout, /\[server\] ready/);
    // Without the database the projects' settings cannot be read, so a settings value is not known as a secret;
    // every other planted value is.
    for (const s of PLANTED.filter((x) => x !== SETTINGS_SECRET && x !== SETTINGS_PATH_SECRET)) assert.ok(!out.stdout.includes(s), `the report holds a planted secret: ${s.slice(0, 12)}…`);
  });

  test("the screen's route returns it as a file to download, behind the session", async () => {
    const { root, log } = install();
    const { exec } = programs();
    const env = { ...process.env, PLANIA_PROCESS_SECRET: PROCESS_SECRET };
    const routes = new Hono().route("/api/help-report", helpReportRoutes({ root, env, exec, logFile: log }));
    const res = await noFetch(async () => routes.request("/api/help-report"));
    assert.equal(res.fetches, 0);
    assert.equal(res.value.status, 200);
    assert.match(res.value.headers.get("content-disposition") ?? "", /^attachment; filename="plania-ayuda-\d{4}-\d{2}-\d{2}\.txt"$/);
    const text = await res.value.text();
    assert.match(text, /# Informe de ayuda de Plania/);
    assertClean(text);
    assert.equal((await app.request("/api/help-report")).status, 401);
  });

  test("the redactor hides the shapes a secret takes", () => {
    const r = makeRedactor(["literal-secret-123"]);
    assert.equal(r("token=abc literal-secret-123"), `token=${HIDDEN} ${HIDDEN}`);
    assert.equal(r("MY_API_KEY: 'zzz'"), `MY_API_KEY=${HIDDEN}`);
    assert.equal(r(`x ${"ab12".repeat(10)} y`), `x ${HIDDEN} y`);
    assert.equal(r("/Users/someone/Library/Logs/plania/server.log ready"), "/Users/someone/Library/Logs/plania/server.log ready");
    assert.ok(r("x".repeat(1000)).length <= 301);
    assert.deepEqual([...parseDotEnv("A=1\nexport B='two'\n# C=3\n").entries()], [["A", "1"], ["B", "two"]]);
  });
});

describe("leaving", () => {
  test("export-all gives every project in one file, each as the one-project export gives it", async () => {
    const cookie = `${SESSION_COOKIE}=${createSession()}`;
    const res = await app.request("/api/export-all", { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /plania-todo-\d{4}-\d{2}-\d{2}\.json/);
    const body = (await res.json()) as { format: string; projects: { format: string; project: { slug: string } }[] };
    assert.equal(body.format, "plania-export-all");
    assert.deepEqual(body.projects.map((p) => p.project.slug), ["filmia", "micasa", "workia", "zigzag"]);
    assert.ok(body.projects.every((p) => p.format === "plania-export"));
    const one = (await (await app.request("/api/export/micasa.json", { headers: { cookie } })).json()) as { project: unknown; tasks: unknown[] };
    const micasa = body.projects.find((p) => p.project.slug === "micasa") as unknown as { project: unknown; tasks: unknown[] };
    assert.deepEqual(micasa.project, one.project);
    assert.equal(micasa.tasks.length, one.tasks.length);
    assert.equal((await app.request("/api/export-all")).status, 401);
  });

  /** A machine for the uninstall: files that exist, every call recorded. */
  function machine(o: { os: string; running?: number[][]; files?: string[] }) {
    const home = "/home/ana";
    const root = "/opt/plania";
    const files = new Set(o.files ?? []);
    const calls: string[] = [];
    const removed: string[] = [];
    const killed: string[] = [];
    const dropped: string[] = [];
    const lines: string[] = [];
    const running = [...(o.running ?? [[]])];
    const deps = {
      os: o.os,
      home,
      root,
      uid: 501,
      env: { DATABASE_URL: "postgres://ana@localhost:5432/plania_casa", HOME: home } as NodeJS.ProcessEnv,
      exec: (async (cmd, args) => (calls.push(`${cmd} ${args.join(" ")}`), { code: 0, stdout: "", stderr: "" })) as ExecFn,
      exists: (p: string) => files.has(p),
      remove: (p: string) => (removed.push(p), files.delete(p)),
      findProcesses: async () => running.shift() ?? [],
      kill: (pid: number, signal: string) => void killed.push(`${pid} ${signal}`),
      dropDatabase: async (_url: string, name: string) => void dropped.push(name),
      log: (l: string) => void lines.push(l),
      wait: async () => undefined,
      prompt: async () => "",
    };
    return { deps, calls, removed, killed, dropped, lines, home, root };
  }

  test("#3 macOS: the launchd agent is booted out and removed, the processes stopped, the database and folders kept", async () => {
    const plist = "/home/ana/Library/LaunchAgents/com.plania.server.plist";
    const m = machine({ os: "darwin", files: [plist, "/home/ana/.config/plania", "/home/ana/plania-backups"], running: [[101, 201], []] });
    const r = await uninstallMod.uninstall({ deleteData: false }, m.deps);
    assert.deepEqual(m.calls, ["launchctl bootout gui/501/com.plania.server"]);
    assert.deepEqual(m.removed, [plist]);
    assert.deepEqual(m.killed, ["101 SIGTERM", "201 SIGTERM"]);
    assert.deepEqual(r.left, []);
    assert.equal(r.database, "kept");
    assert.deepEqual(m.dropped, []);
    assert.ok(m.lines.some((l) => l.includes("plania_casa") && l.includes("siguen ahí")));
    assert.ok(m.lines.some((l) => l.includes("/home/ana/plania-backups")));
  });

  test("#3 Linux: the systemd user unit is disabled, stopped and removed; a process that ignores SIGTERM is killed", async () => {
    const unit = "/home/ana/.config/systemd/user/plania.service";
    const m = machine({ os: "linux", files: [unit], running: [[300], [300], []] });
    const r = await uninstallMod.uninstall({ deleteData: false }, m.deps);
    assert.deepEqual(m.calls, ["systemctl --user disable --now plania.service", "systemctl --user daemon-reload"]);
    assert.deepEqual(m.removed, [unit]);
    assert.deepEqual(m.killed, ["300 SIGTERM", "300 SIGKILL"]);
    assert.deepEqual(r.left, []);
    assert.deepEqual(m.dropped, []);
  });

  test("#3 --delete-data drops nothing unless the database's name is typed back", async () => {
    const m = machine({ os: "linux", files: ["/home/ana/.config/plania"] });
    m.deps.prompt = async () => "plania";
    const r = await uninstallMod.uninstall({ deleteData: true }, m.deps);
    assert.equal(r.database, "not_confirmed");
    assert.deepEqual(m.dropped, []);
    assert.deepEqual(m.removed, []);
  });

  test("#3 --delete-data with the name typed drops the database and Plania's folders, never the backups", async () => {
    const folders = ["/home/ana/.config/plania", "/home/ana/plania-captures", "/home/ana/.local/state/plania", "/home/ana/plania-backups"];
    const m = machine({ os: "linux", files: folders });
    m.deps.prompt = async () => " plania_casa\n";
    const r = await uninstallMod.uninstall({ deleteData: true }, m.deps);
    assert.equal(r.database, "dropped");
    assert.deepEqual(m.dropped, ["plania_casa"]);
    assert.deepEqual(m.removed, folders.slice(0, 3));
    assert.ok(!m.removed.includes("/home/ana/plania-backups"));
  });

  test("the default process finder keeps this folder's server and wrappers, not another checkout's", async () => {
    const root = "/opt/plania";
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === "pgrep" && args[1] === "scripts/dev\\.ts") return { code: 0, stdout: "101\n102\n", stderr: "" };
      if (cmd === "pgrep") return { code: 0, stdout: "201\n", stderr: "" };
      if (cmd === "lsof") return { code: 0, stdout: `p${args[2]}\nfcwd\nn${args[2] === "101" ? root : "/home/ana/other-plania"}\n`, stderr: "" };
      return { code: 1, stdout: "", stderr: "" };
    };
    const ctx = { os: "darwin", home: "/home/ana", uid: 501, root, env: {}, exec, exists: () => false, remove: () => undefined };
    assert.deepEqual(await uninstallMod.defaultFindProcesses(ctx), [101, 201]);
  });

  // PLA-I2-19 (audit B5): native Windows.
  test("#3 Windows: the supervisor is asked to stop, the Scheduled Task deleted and its files removed", async () => {
    // machine()'s home is /home/ana; Windows joins it with backslashes.
    const task = "\\home\\ana\\.config\\plania\\plania-task.xml";
    const config = "\\home\\ana\\.config\\plania\\service.json";
    const m = machine({ os: "win32", files: [task, config], running: [[300], []] });
    m.deps.env.LOCALAPPDATA = "C:\\Users\\ana\\AppData\\Local";
    const r = await uninstallMod.uninstall({ deleteData: false }, m.deps);
    assert.deepEqual(m.calls, [`${process.execPath} --import tsx \\opt\\plania\\scripts\\service-win.ts stop`, "schtasks /Delete /TN Plania /F"]);
    assert.deepEqual(m.removed, [task, config]);
    assert.equal(r.service.length, 1);
    assert.ok(r.service[0]!.includes("Plania"));
    assert.deepEqual(m.killed, ["300 SIGTERM"]);
  });

  test("Windows: the process finder keeps this folder's server, supervisor and wrappers, by command line", async () => {
    const root = "C:\\Users\\ana\\plania";
    const stdout = [
      "101\t\"C:\\Program Files\\nodejs\\node.exe\" --env-file=C:\\Users\\ana\\plania\\.env --import tsx C:\\Users\\ana\\plania\\scripts\\dev.ts --port 3737",
      "102\t\"C:\\Program Files\\nodejs\\node.exe\" --import file:///C:/Users/ana/plania/node_modules/tsx/dist/loader.mjs scripts/dev.ts",
      "103\tnode C:\\Users\\ana\\other\\scripts\\dev.ts",
      "104\tnode --import tsx C:\\Users\\ana\\plania\\scripts\\service-win.ts run",
      "105\tnode C:\\Users\\ana\\plania\\src\\runner\\wrapper.mjs run-1 log exit -- claude",
      "106\tnode C:\\Users\\ana\\plania\\scripts\\uninstall.ts",
      "",
    ].join("\r\n");
    const seen: string[] = [];
    const exec: ExecFn = async (cmd) => (seen.push(cmd), { code: 0, stdout, stderr: "" });
    const ctx = { os: "win32", home: "C:\\Users\\ana", uid: null, root, env: {}, exec, exists: () => false, remove: () => undefined };
    assert.deepEqual(await uninstallMod.defaultFindProcesses(ctx), [101, 102, 104, 105]);
    assert.deepEqual(seen, ["powershell.exe"]);
  });

  test("Windows: Plania's own folders include %LOCALAPPDATA%\\plania; the backups stay", () => {
    const f = uninstallMod.dataFolders("C:\\Users\\ana", "win32", { LOCALAPPDATA: "D:\\Local" });
    assert.deepEqual(f.remove, ["C:\\Users\\ana\\.config\\plania", "C:\\Users\\ana\\plania-captures", "D:\\Local\\plania"]);
    assert.deepEqual(f.keep, ["C:\\Users\\ana\\plania-backups"]);
  });

  test("the database's name comes from DATABASE_URL", () => {
    assert.equal(uninstallMod.databaseName("postgres://a:b@localhost:5432/plania_casa"), "plania_casa");
    assert.equal(uninstallMod.databaseName(undefined), null);
  });
});
