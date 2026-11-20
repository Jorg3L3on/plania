// PLA-I2-1: install Plania on a new machine in one command.
//   pnpm plania:install                       database `plania` on localhost:5432, created here
//   pnpm plania:install --database <name>     another database name (an existing one is used only when named)
//   pnpm plania:install --url postgres://user@host:5432/<name>
//   PLANIA_INSTALL_URL=<address> pnpm plania:install   the same, from the one-line installer (never printed)
//   pnpm plania:install --port <n>            the port Plania answers on (3737)
//   pnpm plania:install --no-start            do not start Plania at the end
//   pnpm plania:install --no-open             do not open the browser at the end
// Machine check, create the database, write .env with generated secrets and the tool paths it found, migrate, build
// the screen when it is missing, then start Plania (as a service where the system supports one, PLA-I2-17) and open
// the first-start page with the one-time code. Node only, so it runs the same from PowerShell and bash. Safe to run
// again. --service is still accepted: starting as a service is now the default (F4).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv, parseArgs } from "node:util";
import { findChrome } from "../src/captures/chrome.js";
import { install, InstallError, INSTALL_WORDS, type MachineCheck } from "../src/db/install.js";
import { withDatabase } from "../src/db/migrate.js";
import { terminalAsk, workingAddress } from "../src/install/connect.js";
import { browserCommand, finishInstall, FINISH_WORDS } from "../src/install/finish.js";
import { followSystemLocale, installLanguage } from "../src/language.js";
import { pgBinFolder } from "../src/lib/pg-bin.js";
import { formatMachineCheck, installGate, skippedChecks, type MachineItem } from "../src/machine-check/index.js";
import { detectSystem, servicePlatform } from "../src/packaging/service.js";
import { say } from "../src/words.js";
import { words } from "../ui/src/lib/i18n.js";

const repoDir = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repoDir, ".env");
const examplePath = path.join(repoDir, ".env.example");
const DEFAULT_URL = "postgres://localhost:5432/plania";

const { values } = parseArgs({
  options: {
    database: { type: "string" },
    url: { type: "string" },
    port: { type: "string" },
    "skip-screen": { type: "boolean" },
    service: { type: "boolean" },
    "no-start": { type: "boolean" },
    "no-open": { type: "boolean" },
  },
  strict: true,
});

// P4: until a language is chosen at first start, the words follow the system's locale.
followSystemLocale();
const language = installLanguage();
const w = say(INSTALL_WORDS, language);
const log = (line: string) => console.log(line);

// The URL: --url, else the one already in .env (a re-run), else the default; --database renames it.
const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")).DATABASE_URL : undefined;
// PLA-I2-4 (from zero): a Postgres the one-line installer just installed comes in PLANIA_INSTALL_URL, not --url, so its
// password is never echoed (pnpm prints a script's command line) nor seen in the process list. --url still wins.
const handed = process.env.PLANIA_INSTALL_URL?.trim() || undefined;
let url = values.url ?? handed ?? (existing || DEFAULT_URL);
if (values.database) url = withDatabase(url, values.database);

// B3: an address that fails on credentials gets the user and password asked here, and the one that works is used.
url = (await workingAddress(url, { ask: terminalAsk(), log, language })).url;

// PLA-I2-12: the machine check runs before anything changes. The database may not exist yet, so Postgres is
// probed through the server's own `postgres` database. F3: when nothing blocks, only what is not ready is shown.
// PLA-I2-4 (from zero): Claude Code missing does not stop the install; it is said again after the closing box.
let later: MachineItem[] = [];
const machineCheck: MachineCheck = async () => {
  const gate = await installGate({ env: { ...process.env, DATABASE_URL: withDatabase(url, "postgres") }, language }, { skip: skippedChecks() });
  if (!gate.proceed) return { ok: false, lines: [gate.text] };
  later = gate.later;
  const notReady = gate.items.filter((i) => i.state !== "ready");
  return { ok: true, lines: notReady.length ? [formatMachineCheck(notReady, language)] : [] };
};

// F3: Vite's log only when the build fails.
async function buildScreen(): Promise<void> {
  if (values["skip-screen"] || existsSync(path.join(repoDir, "dist/ui/index.html"))) return;
  log(w.building);
  try {
    execFileSync(process.execPath, [path.join(repoDir, "node_modules/vite/bin/vite.js"), "build"], { cwd: repoDir, stdio: "pipe" });
  } catch (e) {
    const out = e as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(`${out.stdout?.toString() ?? ""}${out.stderr?.toString() ?? ""}`);
    throw new InstallError(w.buildFailed);
  }
}

const port = Number(values.port ?? process.env.PORT ?? 3737);

try {
  const r = await install({
    url,
    named: Boolean(values.database || values.url || handed),
    envPath,
    examplePath,
    machineCheck,
    buildScreen,
    // F1, B4: the folder of pg_dump (the server's own first) and Chrome, for .env when not set there already.
    tools: ({ major, binDir }) => {
      const found: Record<string, string> = {};
      const pgBin = pgBinFolder(major, { serverBinDir: binDir });
      if (pgBin) found.PLANIA_PG_BIN = pgBin;
      const chrome = findChrome();
      if (chrome) found.PLANIA_CHROME_PATH = chrome;
      return found;
    },
    log,
  });

  // F4: start Plania (a service where `pnpm service:install` supports the system) and open the first-start page.
  const done = await finishInstall({
    port,
    setupCode: r.setupCode,
    language,
    open: !values["no-open"],
    start: !values["no-start"],
    serviceSupported: !["wsl-no-systemd", "unsupported"].includes(servicePlatform({ platform: process.platform, ...detectSystem() })),
    isUp: () =>
      fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_500) })
        .then((res) => res.ok)
        .catch(() => false),
    startService: async () => {
      try {
        execFileSync(process.execPath, ["--import", "tsx", path.join(repoDir, "scripts/service.ts"), "install", "--port", String(port)], { cwd: repoDir, stdio: "pipe" });
      } catch (e) {
        const out = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
        const said = `${out.stderr?.toString() ?? ""}\n${out.stdout?.toString() ?? ""}`.trim();
        throw new Error(said || out.message || String(e));
      }
    },
    openBrowser: (target) => {
      const { cmd, args } = browserCommand(target);
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
    },
    log,
  });
  console.log(`\n${done.box}`);
  if (later.length) console.log(`\n${words(FINISH_WORDS, language).stillMissing}\n${formatMachineCheck(later, language)}`);
} catch (e) {
  if (e instanceof InstallError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
