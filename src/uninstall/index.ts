// PLA-I2-18: leaving Plania. `pnpm uninstall:plania` (scripts/uninstall.ts) stops and removes the service, stops what
// is left of Plania's processes (the server and its runs' wrappers), and keeps the database and every folder. With
// --delete-data, and only after the owner types the database's name, it also drops that database and removes
// Plania's own folders. The backups folder is never removed: it is the copy the owner leaves with.
//
// Every outside call is injected (programs, the filesystem, the prompt, the database drop, the process list), so a
// test sees exactly what would run. The service removal is its own function: PLA-I2-17 sets the service up and can
// pass its own; the default looks for the launchd agent and the systemd user unit by the names the README uses.
import { existsSync, rmSync } from "node:fs";
import { readlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";

// macOS and Linux only (Windows through WSL): the paths below are POSIX on every machine, tests included.
const join = path.posix.join;
import pg from "pg";
import { defaultExec, type ExecFn } from "../brief/doctor.js";

export const LAUNCHD_LABEL = "com.plania.server";
export const SYSTEMD_UNIT = "plania.service";

export type UninstallContext = {
  os: string;
  home: string;
  uid: number | null;
  root: string;
  env: NodeJS.ProcessEnv;
  exec: ExecFn;
  exists: (p: string) => boolean;
  remove: (p: string) => void;
};

export type UninstallDeps = {
  os?: string;
  home?: string;
  uid?: number | null;
  /** Plania's folder. */
  root?: string;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  exists?: (p: string) => boolean;
  remove?: (p: string) => void;
  /** Asks one question in the terminal and returns the answer. */
  prompt?: (question: string) => Promise<string>;
  /** Stops and removes the service; returns one line per thing done. */
  removeService?: (ctx: UninstallContext) => Promise<string[]>;
  /** Plania's processes still running on this machine. */
  findProcesses?: (ctx: UninstallContext) => Promise<number[]>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  dropDatabase?: (url: string, name: string) => Promise<void>;
  log?: (line: string) => void;
  /** Waits between asking processes to stop and checking they did. */
  wait?: (ms: number) => Promise<void>;
};

export type UninstallResult = {
  service: string[];
  stopped: number[];
  left: number[];
  database: "kept" | "dropped" | "not_confirmed";
  removed: string[];
  kept: string[];
};

export const launchdPlist = (home: string) => join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
export const systemdUnit = (home: string) => join(home, ".config", "systemd", "user", SYSTEMD_UNIT);

/** The launchd agent on macOS, the systemd user unit on Linux; each only when its file is there. */
export async function defaultRemoveService(ctx: UninstallContext): Promise<string[]> {
  const done: string[] = [];
  const run = async (cmd: string, args: string[]) => {
    try {
      await ctx.exec(cmd, args, { env: ctx.env, cwd: ctx.home, timeoutMs: 30_000 });
    } catch {
      // A service that is not loaded makes these fail; the file is removed all the same.
    }
  };
  if (ctx.os === "darwin") {
    const plist = launchdPlist(ctx.home);
    if (ctx.exists(plist)) {
      await run("launchctl", ["bootout", `gui/${ctx.uid ?? ""}/${LAUNCHD_LABEL}`]);
      ctx.remove(plist);
      done.push(`Servicio ${LAUNCHD_LABEL} detenido y quitado.`);
    }
  } else {
    const unit = systemdUnit(ctx.home);
    if (ctx.exists(unit)) {
      await run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
      ctx.remove(unit);
      await run("systemctl", ["--user", "daemon-reload"]);
      done.push(`Servicio ${SYSTEMD_UNIT} detenido y quitado.`);
    }
  }
  return done;
}

const pidsOf = (text: string) =>
  text
    .split(/\s+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);

/**
 * The server started from this folder (`scripts/dev.ts` whose working folder is Plania's) and the runs' wrappers (their
 * command line names this folder's wrapper.mjs by its full path). Another checkout's processes are left alone.
 */
export async function defaultFindProcesses(ctx: UninstallContext): Promise<number[]> {
  const pgrep = async (pattern: string) => {
    try {
      const r = await ctx.exec("pgrep", ["-f", pattern], { env: ctx.env, cwd: ctx.root, timeoutMs: 10_000 });
      return r.code === 0 ? pidsOf(r.stdout) : [];
    } catch {
      return [];
    }
  };
  const cwdOf = async (pid: number): Promise<string | null> => {
    try {
      if (ctx.os === "linux") return await readlink(`/proc/${pid}/cwd`);
      const r = await ctx.exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { env: ctx.env, cwd: ctx.root, timeoutMs: 10_000 });
      return /^n(.+)$/m.exec(r.stdout)?.[1] ?? null;
    } catch {
      return null;
    }
  };
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = new Set<number>();
  for (const pid of await pgrep("scripts/dev\\.ts")) if (path.resolve((await cwdOf(pid)) ?? "\0") === path.resolve(ctx.root)) out.add(pid);
  for (const pid of await pgrep(escape(join(ctx.root, "src", "runner", "wrapper.mjs")))) out.add(pid);
  return [...out].sort((a, b) => a - b);
}

/** The database's name in a postgres:// URL. */
export function databaseName(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
}

/** Drops the database from the server's maintenance database, after closing the other connections to it. */
export async function defaultDropDatabase(url: string, name: string): Promise<void> {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [name]);
    await client.query(`drop database if exists ${pg.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}

/** Plania's own folders, outside its install folder. Never the backups. */
export function dataFolders(home: string, os: string, env: NodeJS.ProcessEnv): { remove: string[]; keep: string[] } {
  const remove = [
    join(home, ".config", "plania"),
    env.PLANIA_CAPTURES_DIR?.trim() || join(home, "plania-captures"),
    os === "darwin" ? join(home, "Library", "Logs", "plania") : join(home, ".local", "state", "plania"),
  ];
  const keep = [env.PLANIA_BACKUP_DIR?.trim() || join(home, "plania-backups")];
  return { remove, keep };
}

export async function uninstall(opts: { deleteData: boolean }, deps: UninstallDeps = {}): Promise<UninstallResult> {
  const env = deps.env ?? process.env;
  const ctx: UninstallContext = {
    os: deps.os ?? platform(),
    home: deps.home ?? env.HOME ?? homedir(),
    uid: deps.uid !== undefined ? deps.uid : (process.getuid?.() ?? null),
    root: deps.root ?? process.cwd(),
    env,
    exec: deps.exec ?? defaultExec,
    exists: deps.exists ?? existsSync,
    remove: deps.remove ?? ((p) => rmSync(p, { recursive: true, force: true })),
  };
  const log = deps.log ?? ((line: string) => console.log(line));
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const wait = deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));

  // 1. The service, so nothing starts the server again.
  const service = await (deps.removeService ?? defaultRemoveService)(ctx);
  for (const line of service) log(line);
  if (!service.length) log("No había servicio de Plania instalado.");

  // 2. What is still running: asked to stop, then made to.
  const find = deps.findProcesses ?? defaultFindProcesses;
  const stopped = await find(ctx);
  for (const pid of stopped) {
    try {
      kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  let left: number[] = [];
  if (stopped.length) {
    await wait(3_000);
    left = await find(ctx);
    for (const pid of left) {
      try {
        kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    if (left.length) {
      await wait(1_000);
      left = await find(ctx);
    }
    log(left.length ? `Quedan procesos de Plania que no se detuvieron: ${left.join(", ")}.` : `Procesos de Plania detenidos: ${stopped.length}.`);
  }

  // 3. The data: kept unless asked twice (the flag, then the database's name typed back).
  const folders = dataFolders(ctx.home, ctx.os, env);
  const name = databaseName(env.DATABASE_URL);
  let database: UninstallResult["database"] = "kept";
  const removed: string[] = [];
  if (opts.deleteData) {
    const answer = name && deps.prompt ? (await deps.prompt(`Para borrar la base de datos y las carpetas de Plania, escribe el nombre de la base de datos (${name}): `)).trim() : "";
    if (!name || answer !== name) {
      database = "not_confirmed";
      log("No escribiste el nombre de la base de datos: no se borró nada.");
    } else {
      await (deps.dropDatabase ?? defaultDropDatabase)(env.DATABASE_URL!, name);
      database = "dropped";
      log(`Base de datos ${name} borrada.`);
      for (const dir of folders.remove)
        if (ctx.exists(dir)) {
          ctx.remove(dir);
          removed.push(dir);
          log(`Carpeta borrada: ${dir}`);
        }
    }
  }
  if (database !== "dropped") log(`La base de datos${name ? ` ${name}` : ""} y tus carpetas siguen ahí. Para borrarlas: pnpm uninstall:plania --delete-data`);
  for (const dir of folders.keep) if (ctx.exists(dir)) log(`Tus copias de seguridad se quedan en ${dir}.`);
  log(`Para terminar, borra la carpeta de Plania: ${ctx.root}`);
  return { service, stopped, left, database, removed, kept: folders.keep };
}
