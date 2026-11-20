// B3, B4, P1, P2, P4, F1-F4: the install command on a new machine. Why Postgres said no, the credentials asked in the
// terminal, pg_dump and Chrome found on Windows too, the tool paths written to .env, quiet output, Plania started and
// the first-start page opened with the code in the fragment, and the words in the system's language. Every outside
// call is a fake, except the readings of this checkout's local Postgres (test/helpers.ts) and its throwaway database.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { parseEnv } from "node:util";
import pg from "pg";
import { ADMIN_URL, TEST_DATABASE_URL, TEST_DB, useTestEnv } from "./helpers.js";

useTestEnv();
const { resetPool } = await import("../src/db/client.js");
const { install, writeSettings } = await import("../src/db/install.js");
const { readMigrations, withDatabase } = await import("../src/db/migrate.js");
const { pgFailureOf, readPg, userOf, withCredentials, isLocalAddress } = await import("../src/lib/pg-connect.js");
const { workingAddress } = await import("../src/install/connect.js");
const { finishInstall, closingBox, firstStartUrl, browserCommand } = await import("../src/install/finish.js");
const { pgToolFor, pgSearchPath, pgBinFolder } = await import("../src/lib/pg-bin.js");
const { findChrome } = await import("../src/captures/chrome.js");
const { machineCheck } = await import("../src/machine-check/index.js");
const lang = await import("../src/language.js");
import type { PgReading } from "../src/lib/pg-connect.js";
import type { MachineCheckDeps } from "../src/machine-check/index.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-install-cmd-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const only = (files: string[]) => (p: string) => files.includes(p);
const GB = 1024 ** 3;

// --- B3: why Postgres said no ---------------------------------------------------------------------------------

test("B3: a connection error is read as not running, wrong password, refused role, or missing database", () => {
  const err = (code: string | undefined, message: string) => Object.assign(new Error(message), code ? { code } : {});
  assert.equal(pgFailureOf(err("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")), "unreachable");
  assert.equal(pgFailureOf(err(undefined, "Connection terminated due to connection timeout")), "unreachable");
  assert.equal(pgFailureOf(err("28P01", 'password authentication failed for user "jorge"')), "bad_password");
  assert.equal(pgFailureOf(err(undefined, "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string")), "bad_password");
  assert.equal(pgFailureOf(err("28000", 'role "jorge" does not exist')), "auth_refused");
  assert.equal(pgFailureOf(err("28000", 'no pg_hba.conf entry for host "10.0.0.2"')), "auth_refused");
  assert.equal(pgFailureOf(err("3D000", 'database "plania" does not exist')), "no_database");
});

test("B3: the local Postgres's own answers: refused port, missing database, missing role", async () => {
  const refused = await readPg("postgres://postgres@127.0.0.1:1/postgres");
  assert.deepEqual([refused.ok, !refused.ok && refused.reason], [false, "unreachable"]);
  const noDb = await readPg(withDatabase(ADMIN_URL, "plania_test_no_such_database"));
  assert.deepEqual([noDb.ok, !noDb.ok && noDb.reason], [false, "no_database"]);
  const noRole = await readPg(withCredentials(ADMIN_URL, "plania_no_such_role", ""));
  assert.equal(noRole.ok, false);
  // With trust auth the role is refused outright (28000); with password auth the server first asks for a password.
  assert.ok(!noRole.ok && ["auth_refused", "bad_password"].includes(noRole.reason!), JSON.stringify(noRole));
  const ok = await readPg(ADMIN_URL);
  assert.ok(ok.ok && ok.versionNum >= 140000);
});

test("B3: addresses: the user they name, credentials set and encoded, and whether the server is on this machine", () => {
  assert.equal(userOf("postgres://localhost:5432/plania"), undefined);
  assert.equal(userOf("postgres://ana@localhost:5432/plania"), "ana");
  const u = withCredentials("postgres://localhost:5432/plania", "ana", "p@ss:w/rd #1");
  assert.equal(decodeURIComponent(new URL(u).password), "p@ss:w/rd #1");
  assert.equal(new URL(u).pathname, "/plania");
  assert.equal(new URL(withCredentials(u, "postgres", "")).password, "");
  for (const local of ["postgres://localhost/x", "postgres://127.0.0.1:5432/x", "postgres://[::1]:5432/x", "postgres:///x?host=/tmp"]) assert.equal(isLocalAddress(local), true, local);
  assert.equal(isLocalAddress("postgres://db.example.com:5432/x"), false);
});

function machine(probe: (url: string) => Promise<PgReading>, extra: Partial<MachineCheckDeps> = {}): MachineCheckDeps {
  return {
    env: { HOME: "/home/someone", DATABASE_URL: "postgres://ana@localhost:5432/postgres", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_PG_BIN: "/fake/pg" },
    exec: async (cmd, args) => {
      const name = path.basename(cmd).replace(/\.exe$/i, "");
      if (name === "pg_dump") return { code: 0, stdout: "pg_dump (PostgreSQL) 18.3\n", stderr: "" };
      if (name === "gh" && args[0] === "--version") return { code: 0, stdout: "gh version 2.45.0\n", stderr: "" };
      if (name === "gh") return { code: 0, stdout: "Logged in\n  - Token scopes: 'repo'\n", stderr: "" };
      if (name === "git") return { code: 0, stdout: "git version 2.43.0\n", stderr: "" };
      if (name === "claude") return { code: 0, stdout: "2.1.302 (Claude Code)\n", stderr: "" };
      return { code: null, stdout: "", stderr: "spawn ENOENT" };
    },
    nodeVersion: "22.11.0",
    pgProbe: probe,
    claudeDryRun: async () => ({ state: "signed_in", structuredOutput: true }),
    freeDisk: async () => 120 * GB,
    totalMemory: () => 16 * GB,
    findChrome: () => null,
    ...extra,
  };
}

test("B3: the machine check names each reason with its own sentence and fix, in both languages", async () => {
  const reasons = ["unreachable", "bad_password", "auth_refused", "no_database"] as const;
  for (const language of ["es", "en"] as const) {
    const items = await Promise.all(
      reasons.map(async (reason) => (await machineCheck(machine(async () => ({ ok: false, reason }), { language }))).find((i) => i.id === "postgres")!),
    );
    assert.deepEqual(items.map((i) => i.reason), [...reasons]);
    assert.ok(items.every((i) => i.state === "missing" && i.fix), language);
    assert.equal(new Set(items.map((i) => i.sentence)).size, 4, language);
    assert.equal(new Set(items.map((i) => i.fix)).size, 4, language);
    // The user in the address is named where it is the problem.
    assert.match(items[1]!.sentence, /\bana\b/);
    assert.match(items[2]!.sentence, /\bana\b/);
  }
  const es = (await machineCheck(machine(async () => ({ ok: false, reason: "bad_password" })))).find((i) => i.id === "postgres")!;
  assert.equal(es.sentence, "Postgres responde, pero no aceptó la contraseña del usuario ana.");
  assert.match(es.fix!, /pnpm plania:install/);
  const down = (await machineCheck(machine(async () => ({ ok: false })))).find((i) => i.id === "postgres")!;
  assert.equal(down.reason, "unreachable");
  assert.doesNotMatch(down.sentence, /contraseña/);
});

test("B4: the machine check runs the pg_dump in the folder the server reports for itself", async () => {
  const ran: string[] = [];
  // A real folder holding the server's pg_dump, so the lookup finds it on any system.
  const own = mkdtempSync(path.join(scratch, "pgbin-"));
  const ownDump = path.join(own, process.platform === "win32" ? "pg_dump.exe" : "pg_dump");
  writeFileSync(ownDump, "");
  const deps = machine(async () => ({ ok: true, versionNum: 180003, binDir: own }));
  const exec = deps.exec!;
  const items = await machineCheck({
    ...deps,
    env: { ...deps.env, PLANIA_PG_BIN: "" },
    exec: async (cmd, args, o) => {
      ran.push(cmd);
      return exec(cmd, args, o);
    },
  });
  assert.ok(ran.includes(ownDump), ran.join(" | "));
  assert.equal(items.find((i) => i.id === "pg_dump")!.state, "ready");
  assert.equal(pgToolFor("pg_dump", 18, { env: { PATH: "" }, serverBinDir: "/srv/pg18/bin", exists: only(["/srv/pg18/bin/pg_dump"]), platform: "linux" }), "/srv/pg18/bin/pg_dump");
});

// --- B3: the credentials asked in the terminal ----------------------------------------------------------------

/** A server that lets in exactly these users with these passwords (empty: trust). */
function server(users: Record<string, string>) {
  const probed: string[] = [];
  const probe = async (url: string): Promise<PgReading> => {
    probed.push(url);
    const u = new URL(url);
    const user = decodeURIComponent(u.username) || "jorge";
    if (!(user in users)) return { ok: false, reason: "auth_refused" };
    if (decodeURIComponent(u.password) !== users[user]) return { ok: false, reason: "bad_password" };
    return { ok: true, versionNum: 180003 };
  };
  return { probe, probed };
}
const answers = (lines: string[], secrets: string[]) => {
  const asked: string[] = [];
  return {
    asked,
    ask: {
      line: async (q: string) => (asked.push(q), lines.shift() ?? ""),
      secret: async (q: string) => (asked.push(q), secrets.shift() ?? ""),
    },
  };
};

test("B3: an address that works is kept, and nothing is asked", async () => {
  const s = server({ jorge: "" });
  const a = answers([], []);
  const logs: string[] = [];
  const r = await workingAddress("postgres://localhost:5432/plania", { probe: s.probe, ask: a.ask, log: (l) => logs.push(l), language: "es" });
  assert.equal(r.url, "postgres://localhost:5432/plania");
  assert.deepEqual([a.asked, logs], [[], []]);
  // The server is reached through its postgres database: the install's own may not exist yet.
  assert.equal(new URL(s.probed[0]!).pathname, "/postgres");
});

test("B3: with no user in the address, `postgres` without a password is tried before asking", async () => {
  const s = server({ postgres: "" });
  const a = answers([], []);
  const logs: string[] = [];
  const r = await workingAddress("postgres://localhost:5432/plania", { probe: s.probe, ask: a.ask, log: (l) => logs.push(l), language: "es" });
  assert.equal(r.url, "postgres://postgres@localhost:5432/plania");
  assert.equal(a.asked.length, 0);
  assert.deepEqual(logs, ["Postgres aceptó al usuario postgres."]);
});

test("B3: a wrong password asks for the user and the password, tests them, and keeps the address that works", async () => {
  const s = server({ postgres: "s3cr:t@x" });
  const a = answers(["", "postgres"], ["wrong", "s3cr:t@x"]);
  const logs: string[] = [];
  const r = await workingAddress("postgres://localhost:5432/plania", { probe: s.probe, ask: a.ask, log: (l) => logs.push(l), language: "es" });
  assert.ok(r.reading.ok);
  const u = new URL(r.url);
  assert.deepEqual([u.username, decodeURIComponent(u.password), u.pathname], ["postgres", "s3cr:t@x", "/plania"]);
  // The first answer is empty: the user offered in brackets is taken.
  assert.deepEqual(a.asked, ["Usuario de Postgres (postgres): ", "Contraseña (no se muestra): ", "Usuario de Postgres (postgres): ", "Contraseña (no se muestra): "]);
  assert.match(logs[0]!, /^Postgres responde, pero /);
  assert.deepEqual(logs.slice(1), ["No funcionó. Prueba otra vez.", "Postgres aceptó al usuario postgres; la dirección queda en .env."]);
});

test("B3: with no terminal, a refused address is left for the machine check; a server that is off is never asked about", async () => {
  const locked = server({ admin: "x" });
  const r = await workingAddress("postgres://localhost:5432/plania", { probe: locked.probe, ask: null, log: () => {}, language: "en" });
  assert.equal(r.url, "postgres://localhost:5432/plania");
  assert.ok(!r.reading.ok);
  const a = answers(["x"], ["y"]);
  const off = await workingAddress("postgres://localhost:5432/plania", { probe: async () => ({ ok: false, reason: "unreachable" }), ask: a.ask, log: () => {}, language: "en" });
  assert.equal(off.url, "postgres://localhost:5432/plania");
  assert.equal(a.asked.length, 0);
  // Three wrong tries, then the original address goes on to the machine check.
  const b = answers([], ["1", "2", "3", "4"]);
  const tired = await workingAddress("postgres://localhost:5432/plania", { probe: locked.probe, ask: b.ask, log: () => {}, language: "en" });
  assert.equal(tired.url, "postgres://localhost:5432/plania");
  assert.equal(b.asked.filter((q) => q.startsWith("Password")).length, 3);
});

// --- B4, P2: pg_dump on Windows and the server's major -------------------------------------------------------

test("B4: pg_dump in Laragon's and the EDB installer's folders on Windows, the server's own folder first", () => {
  const env = { PATH: "", ProgramFiles: "C:\\Program Files" };
  const laragon = "C:\\laragon\\bin\\pgsql\\pgsql-18\\bin\\pg_dump.exe";
  const edb17 = "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe";
  const listDir = (dir: string) => (dir === "C:\\Program Files\\PostgreSQL" ? ["16", "17"] : dir === "C:\\laragon\\bin\\pgsql" ? ["pgsql-18"] : []);
  assert.equal(pgToolFor("pg_dump", 18, { env, platform: "win32", exists: only([laragon, edb17]), listDir }), laragon);
  assert.equal(pgToolFor("pg_dump", 17, { env, platform: "win32", exists: only([laragon, edb17]), listDir }), edb17);
  // Major unknown: the newest installed, EDB's before Laragon's.
  assert.equal(pgToolFor("pg_dump", 0, { env, platform: "win32", exists: only([edb17]), listDir }), edb17);
  assert.equal(pgToolFor("pg_dump", 0, { env, platform: "win32", exists: only([laragon]), listDir }), laragon);
  // The folder the server reports wins over the versioned ones.
  const own = "D:\\pg\\bin";
  assert.equal(pgToolFor("pg_dump", 18, { env, platform: "win32", exists: only([laragon, `${own}\\pg_dump.exe`]), listDir, serverBinDir: own }), `${own}\\pg_dump.exe`);
  // PLANIA_PG_BIN still comes first.
  assert.equal(pgToolFor("pg_dump", 18, { env: { ...env, PLANIA_PG_BIN: "E:\\tools" }, platform: "win32", exists: only([laragon]), listDir }), path.join("E:\\tools", "pg_dump"));
  // F1: the folder to write in .env, or null when only the bare name is left.
  assert.equal(pgBinFolder(18, { env, platform: "win32", exists: only([laragon]), listDir }), "C:\\laragon\\bin\\pgsql\\pgsql-18\\bin");
  assert.equal(pgBinFolder(18, { env, platform: "win32", exists: () => false, listDir: () => [] }), null);
});

test("P2: the search PATH puts the server's major first and knows 18", () => {
  const brew = (m: number) => `/opt/homebrew/opt/postgresql@${m}/bin`;
  const all = only([brew(14), brew(16), brew(18)]);
  const first = (major?: number) => pgSearchPath("/usr/bin", { env: {}, platform: "darwin", exists: all, listDir: () => [], major }).split(path.delimiter)[0];
  assert.equal(first(16), brew(16));
  assert.equal(first(), brew(18));
  const win = pgSearchPath("", { env: { ProgramFiles: "C:\\Program Files" }, platform: "win32", exists: only(["C:\\laragon\\bin\\pgsql\\pgsql-18\\bin"]), listDir: () => [], major: 18 });
  assert.equal(win, "C:\\laragon\\bin\\pgsql\\pgsql-18\\bin");
});

// --- P1: Chrome on Windows ------------------------------------------------------------------------------------

test("P1: Chrome under Program Files, Program Files (x86) and the user's own LOCALAPPDATA", () => {
  const env = { PATH: "", HOME: scratch, ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local" };
  const at = (dir: string) => `${dir}\\Google\\Chrome\\Application\\chrome.exe`;
  assert.equal(findChrome(env, only([at("C:\\Program Files")])), at("C:\\Program Files"));
  assert.equal(findChrome(env, only([at("C:\\Program Files (x86)")])), at("C:\\Program Files (x86)"));
  assert.equal(findChrome(env, only([at("C:\\Users\\ana\\AppData\\Local")])), at("C:\\Users\\ana\\AppData\\Local"));
  assert.equal(findChrome({ ...env, PLANIA_CHROME_PATH: "D:\\c.exe" }, only(["D:\\c.exe", at("C:\\Program Files")])), "D:\\c.exe");
  assert.equal(findChrome(env, () => false), null);
});

// --- F1: the tool paths in .env -------------------------------------------------------------------------------

test("F1: the tool paths found are written to .env, a value already set is kept, an empty one is not written", () => {
  const envPath = path.join(scratch, "tools.env");
  writeFileSync(envPath, "DATABASE_URL=postgres://localhost/plania\nSESSION_SECRET=s\nMCP_BEARER_TOKEN=t\nPLANIA_PG_BIN=/mine\nPLANIA_CHROME_PATH=\n");
  const keys = writeSettings(envPath, undefined, "postgres://localhost/plania", () => "x", { PLANIA_PG_BIN: "/found", PLANIA_CHROME_PATH: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", OTHER: " " });
  assert.deepEqual(keys, ["PLANIA_CHROME_PATH"]);
  const env = parseEnv(readFileSync(envPath, "utf8"));
  assert.equal(env.PLANIA_PG_BIN, "/mine");
  assert.equal(env.PLANIA_CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  assert.equal("OTHER" in env, false);
});

test("F1, F3: the install writes the tools it was given, reads the server's major, and says one line for the migrations", async () => {
  await resetPool();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  let superuser = false;
  try {
    await admin.query(`drop database if exists ${TEST_DB} with (force)`);
    superuser = (await admin.query("select rolsuper from pg_roles where rolname = current_user")).rows[0]?.rolsuper === true;
  } finally {
    await admin.end();
  }
  const envPath = path.join(scratch, "install.env");
  const logs: string[] = [];
  const seen: { major: number; binDir: string | null }[] = [];
  const r = await install({
    url: TEST_DATABASE_URL,
    named: false,
    envPath,
    log: (l) => logs.push(l),
    tools: (s) => {
      seen.push(s);
      return { PLANIA_PG_BIN: "/found/pg/bin", PLANIA_CHROME_PATH: "/found/chrome" };
    },
  });
  const n = readMigrations().length;
  assert.equal(r.applied.length, n);
  assert.ok(seen[0]!.major >= 14);
  // A superuser on this machine is told the server's own folder.
  if (superuser) assert.ok(seen[0]!.binDir && seen[0]!.binDir.length > 0, JSON.stringify(seen));
  const env = parseEnv(readFileSync(envPath, "utf8"));
  assert.deepEqual([env.PLANIA_PG_BIN, env.PLANIA_CHROME_PATH], ["/found/pg/bin", "/found/chrome"]);
  assert.ok(logs.some((l) => l === `${n} migraciones aplicadas.` || l === `${n} migrations applied.`), logs.join(" | "));
  assert.ok(!logs.some((l) => /^Migración |^Migration /.test(l)), "no line per file");
  // Again: nothing new, and the tool values already set stay.
  logs.length = 0;
  const again = await install({ url: TEST_DATABASE_URL, named: false, envPath, log: (l) => logs.push(l), tools: () => ({ PLANIA_PG_BIN: "/other" }) });
  assert.deepEqual(again.envKeys, []);
  assert.equal(parseEnv(readFileSync(envPath, "utf8")).PLANIA_PG_BIN, "/found/pg/bin");
  assert.ok(logs.some((l) => /ya estaban al día|already up to date/.test(l)));
});

// --- F3, F4: start, open, the closing box ---------------------------------------------------------------------

function finish(o: { up?: boolean[]; supported?: boolean; startFails?: boolean; open?: boolean; start?: boolean; code?: string | null } = {}) {
  const up = [...(o.up ?? [false, true])];
  const calls: string[] = [];
  const logs: string[] = [];
  const deps = {
    port: 3737,
    setupCode: o.code === undefined ? "K7Q2-9XPM" : o.code,
    language: "es" as const,
    open: o.open ?? true,
    start: o.start ?? true,
    serviceSupported: o.supported ?? true,
    isUp: async () => up.shift() ?? false,
    startService: async () => {
      calls.push("service");
      if (o.startFails) throw new Error("launchctl failed\nmore");
    },
    openBrowser: (url: string) => void calls.push(`open ${url}`),
    sleep: async () => {},
    waitTries: 3,
    log: (l: string) => void logs.push(l),
  };
  return { deps, calls, logs };
}

test("F4: not running → started as a service, then the browser opens on first start with the code in the fragment", async () => {
  const f = finish();
  const r = await finishInstall(f.deps);
  assert.equal(r.started, "service");
  assert.deepEqual(f.calls, ["service", "open http://localhost:3737/primer-arranque#code=K7Q2-9XPM"]);
  assert.ok(r.opened);
  assert.ok(r.box.includes("Abre: http://localhost:3737/primer-arranque#code=K7Q2-9XPM"));
  assert.ok(r.box.includes("Código de un solo uso: K7Q2-9XPM"));
  assert.ok(!r.box.includes("pnpm start"));
});

test("F4: already running → not started again; --no-open opens nothing; an owner already made → the screen, no code", async () => {
  const running = finish({ up: [true] });
  assert.equal((await finishInstall(running.deps)).started, "already");
  assert.deepEqual(running.calls, ["open http://localhost:3737/primer-arranque#code=K7Q2-9XPM"]);
  const quiet = finish({ up: [true], open: false });
  const r = await finishInstall(quiet.deps);
  assert.deepEqual([quiet.calls, r.opened], [[], false]);
  const owner = finish({ up: [true], code: null });
  const o = await finishInstall(owner.deps);
  assert.deepEqual(owner.calls, ["open http://localhost:3737/"]);
  assert.ok(!o.box.includes("Código"));
});

test("F4: where no service is supported, or it fails, or --no-start: nothing opens and the box says how to start it", async () => {
  for (const f of [finish({ supported: false }), finish({ startFails: true }), finish({ start: false })]) {
    const r = await finishInstall(f.deps);
    assert.equal(r.started, "not_started");
    assert.equal(r.opened, false);
    assert.ok(!f.calls.some((c) => c.startsWith("open")));
    assert.ok(r.box.includes("Enciéndela con: pnpm start"));
    assert.ok(r.box.includes("K7Q2-9XPM"));
  }
  const failed = finish({ startFails: true });
  await finishInstall(failed.deps);
  assert.ok(failed.logs.includes("No se pudo dejar Plania como servicio (launchctl failed)."), failed.logs.join(" | "));
  // A service that never answers: said, and nothing opens.
  const slow = finish({ up: [false, false, false, false, false] });
  const s = await finishInstall(slow.deps);
  assert.equal(s.started, "not_started");
  assert.ok(slow.logs.includes("Plania no respondió todavía."));
});

test("F3: the closing box is one width; the URL and the browser command keep the fragment", () => {
  const box = closingBox(["Plania está instalada.", "Abre: http://localhost:3737/primer-arranque#code=AB", "x"]).split("\n");
  assert.equal(new Set(box.map((l) => [...l].length)).size, 1);
  assert.match(box[0]!, /^┌─+┐$/);
  assert.equal(firstStartUrl(3800, "a b"), "http://localhost:3800/primer-arranque#code=a%20b");
  assert.deepEqual(browserCommand("http://x/#code=1", "win32"), { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", "http://x/#code=1"] });
  assert.deepEqual(browserCommand("http://x/#code=1", "darwin"), { cmd: "open", args: ["http://x/#code=1"] });
  assert.deepEqual(browserCommand("http://x/#code=1", "linux"), { cmd: "xdg-open", args: ["http://x/#code=1"] });
});

// --- P4: the system's language before one is chosen -----------------------------------------------------------

test("P4: before a language is chosen, the install's words follow the system locale: Spanish for es*, else English", () => {
  assert.equal(lang.localeLanguage({ LANG: "es_MX.UTF-8" }, "en-US"), "es");
  assert.equal(lang.localeLanguage({ LANG: "en_US.UTF-8" }, "es-MX"), "en");
  assert.equal(lang.localeLanguage({ LC_ALL: "es_ES.UTF-8", LANG: "en_US.UTF-8" }, "en-US"), "es");
  assert.equal(lang.localeLanguage({ LANG: "C.UTF-8" }, "es-419"), "es");
  assert.equal(lang.localeLanguage({}, "es"), "es");
  assert.equal(lang.localeLanguage({}, "de-DE"), "en");
  assert.equal(lang.localeLanguage({}, "estonian-ish"), "en");
  try {
    lang.resetLanguage();
    assert.equal(lang.installLanguage({}), "es", "the server, which never follows the system, keeps Spanish");
    assert.equal(lang.followSystemLocale({}, "en-GB"), "en");
    assert.equal(lang.installLanguage({}), "en");
    assert.equal(lang.languageChosen({}), false, "following the system is not a choice");
    assert.equal(lang.installLanguage({ PLANIA_LANGUAGE: "es" }), "es", "the variable wins");
  } finally {
    lang.resetLanguage();
  }
});
