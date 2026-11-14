// PLA-I46-8: Encenderla. The floor's Ventana can start a project's test copy on this Mac, and only when Jorge
// clicks. The test copy is Plania's own worktree of origin/sandbox (<worktrees>/<slug>/_prueba, detached, outside
// every repo), never main and never Jorge's checkout. It runs settings.capture.start_command on the first free port
// from settings.capture.port up (skipping ports another copy, a registered server or anything listening already
// holds), with the shell basics only (checkoutEnv: none of Plania's secrets). Once it answers, fresh stills are
// taken and the Ventana says «En vivo». The process is a registered footprint (port:N, teardown kill -TERM -<pgid>)
// and stops when Jorge turns it off, when nobody has looked at the floor for IDLE_MS, or when Plania stops.
// Everything here is in memory: one Plania server per Mac. Tests inject every outside call (setPruebaDeps).
import { spawn as nodeSpawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { hostname } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { footprints, projects } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { registerFootprint, releaseFootprint } from "../mcp/footprint.js";
import type { Ctx } from "../mcp/tx.js";
import { defaultGit, isInside, repoPathOf, worktreeRoot, type GitFn } from "../runner/worktree.js";
import { checkoutEnv, runCapture, shellExec, type CaptureInput, type CaptureSummary, type Exec } from "./run.js";
import type { CaptureSettings } from "./settings.js";

export const BRANCH = "sandbox";
export const IDLE_MS = 20 * 60_000; // nobody looked at the floor for this long: the copy stops
const READY_MS = 180_000; // a first Next.js compile can take a while
const POLL_MS = 1_000;
const PORT_SPAN = 50; // ports tried from settings.capture.port up
// Plania's own servers and the local databases: never handed to a test copy.
const RESERVED = new Set([3737, 3738, 3791, 3792, 5173, 5432, 5433]);
const SESSION = "plania-prueba";

export type Phase = "starting" | "capturing" | "live" | "failed";
export type PruebaPhase = Phase | "off" | "running"; // running: something else serves settings.capture.port
export type PruebaRead = {
  phase: PruebaPhase;
  managed: boolean; // Plania started it (Apagar works)
  port: number | null;
  url: string | null;
  started_at: string | null;
  error: string | null;
  detail: string | null; // the last lines the start printed, for Ver detalle
};

export type ChildLike = {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
};

export type PruebaDeps = {
  git?: GitFn;
  // sh -c command, detached in its own process group (so the whole tree stops together).
  spawn?: (command: string, opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildLike;
  kill?: (pid: number, signal: NodeJS.Signals) => void; // pid is the group leader: signals -pid
  alive?: (pid: number) => boolean;
  exec?: Exec; // the install command
  up?: (url: string) => Promise<boolean>; // the app answers below 500
  portBusy?: (port: number) => Promise<boolean>;
  capture?: (db: Db, input: CaptureInput) => Promise<CaptureSummary>;
  footprints?: boolean; // false: no register/release (tests without a machine row)
  env?: NodeJS.ProcessEnv;
  readyMs?: number;
  pollMs?: number;
  idleMs?: number;
  stopGraceMs?: number;
  now?: () => number;
  sweep?: boolean; // false: no minute timer (tests call sweepIdle)
  signals?: boolean; // false: no exit/signal hooks (tests)
};

type Copy = {
  slug: string;
  phase: Phase;
  managed: boolean;
  port: number | null;
  pid: number | null;
  worktree: string | null;
  repo: string | null;
  command: string | null;
  startedAt: number;
  seenAt: number;
  error: string | null;
  tail: string[];
  stopping: boolean;
};

let deps: PruebaDeps = {};
const copies = new Map<string, Copy>();
let sweeper: NodeJS.Timeout | null = null;
let hooked = false;

export function setPruebaDeps(d: PruebaDeps): void {
  deps = d;
}
// Tests: forget every copy (their fake processes are gone with the test).
export function resetPrueba(): void {
  copies.clear();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

const now = () => (deps.now ?? Date.now)();
const env = () => deps.env ?? process.env;
const git = () => deps.git ?? defaultGit;
const ctx = (): Ctx => ({ actor: { agent: "plania", session_id: SESSION, machine: hostname() }, system: true, tool: "prueba" });

const defaultSpawn: NonNullable<PruebaDeps["spawn"]> = (command, { cwd, env: e }) =>
  nodeSpawn("/bin/sh", ["-c", command], { cwd, env: e, detached: true, stdio: ["ignore", "pipe", "pipe"] });
const defaultKill: NonNullable<PruebaDeps["kill"]> = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
};
const defaultAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const defaultUp = async (url: string) => {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
    return r.status < 500;
  } catch {
    return false;
  }
};
const knock = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ host, port });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(500, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
const defaultPortBusy = async (port: number) => (await knock("127.0.0.1", port)) || (await knock("::1", port));

const urlOf = (port: number) => `http://localhost:${port}`;
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

function read(c: Copy): PruebaRead {
  return {
    phase: c.phase,
    managed: c.managed,
    port: c.port,
    url: c.port ? urlOf(c.port) : null,
    started_at: new Date(c.startedAt).toISOString(),
    error: c.error,
    detail: c.tail.length ? c.tail.join("\n") : null,
  };
}

async function settingsOf(db: Db, slug: string): Promise<{ p: typeof projects.$inferSelect; s: CaptureSettings }> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug));
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  const s = p.settings.capture;
  if (!s) throw new ToolError("INVALID_FILTER", { field: "settings.capture", hint: "the project has no capture settings (set_project settings.capture)" });
  return { p, s };
}

// What the Ventana shows. Reading it counts as somebody looking (the idle clock starts again).
export async function pruebaRead(slug: string, settings: CaptureSettings | undefined): Promise<PruebaRead> {
  const c = copies.get(slug);
  if (c) {
    c.seenAt = now();
    return read(c);
  }
  const off: PruebaRead = { phase: "off", managed: false, port: null, url: null, started_at: null, error: null, detail: null };
  if (!settings) return off;
  const up = await (deps.up ?? defaultUp)(urlOf(settings.port) + (settings.ready_path ?? "/"));
  return up ? { ...off, phase: "running", port: settings.port, url: urlOf(settings.port) } : off;
}

export function pruebaOf(slug: string): PruebaRead | null {
  const c = copies.get(slug);
  return c ? read(c) : null;
}

// ---- Encenderla

// Starts the test copy, or returns the one already starting or running. The work goes on in the background;
// the Ventana reads its phase (starting → capturing → live, or failed).
export async function encender(db: Db, slug: string): Promise<PruebaRead> {
  const { p, s } = await settingsOf(db, slug);
  const had = copies.get(slug);
  if (had && had.phase !== "failed") return read(had);
  if (had) await apagar(db, slug); // Reintentar after a failed start: clean up first
  const c: Copy = { slug, phase: "starting", managed: true, port: null, pid: null, worktree: null, repo: null, command: null, startedAt: now(), seenAt: now(), error: null, tail: [], stopping: false };
  copies.set(slug, c);
  hook();
  void start(db, c, p, s).catch((e) => fail(db, c, `No se pudo encender: ${short(e)}`));
  return read(c);
}

async function fail(db: Db, c: Copy, error: string): Promise<void> {
  if (copies.get(c.slug) !== c) return;
  c.error = error;
  c.phase = "failed";
  await stopProcess(db, c);
}

async function start(db: Db, c: Copy, p: typeof projects.$inferSelect, s: CaptureSettings): Promise<void> {
  const g = git();
  const repo = repoPathOf(p.slug, p.settings, env());
  c.repo = repo;
  if (!existsSync(repo)) return fail(db, c, `No encuentro el repo de ${p.title} en ${repo}`);
  const wt = path.join(worktreeRoot(env()), p.slug, "_prueba");
  if (isInside(wt, repo)) return fail(db, c, "La copia de prueba quedaría dentro del repo");
  c.worktree = wt;

  // The test copy is origin/sandbox, detached. Never main, never a branch Jorge works on.
  if ((await g(["fetch", "origin", BRANCH], repo)).code !== 0) return fail(db, c, `No se pudo traer ${BRANCH} de origin`);
  if (existsSync(wt)) {
    const dirty = await g(["status", "--porcelain", "--untracked-files=no"], wt);
    if (dirty.code !== 0) return fail(db, c, "No se pudo leer la copia de prueba");
    if (dirty.stdout.trim()) return fail(db, c, "La copia de prueba tiene cambios sin guardar; no la toco");
    if ((await g(["checkout", "--detach", `origin/${BRANCH}`], wt)).code !== 0) return fail(db, c, `No se pudo poner la copia de prueba en ${BRANCH}`);
  } else {
    mkdirSync(path.dirname(wt), { recursive: true });
    if ((await g(["worktree", "add", "--detach", wt, `origin/${BRANCH}`], repo)).code !== 0) return fail(db, c, "No se pudo crear la copia de prueba");
    if (deps.footprints !== false) {
      await registerFootprint(
        db,
        { project: p.slug, kind: "worktree", locator: wt, purpose: `Copia de prueba de ${p.title} (${BRANCH}), para Encenderla`, teardown: `git -C ${repo} worktree remove --force ${wt}` },
        ctx(),
      ).catch(() => undefined);
    }
  }
  const head = (await g(["rev-parse", "HEAD"], wt)).stdout.trim();
  const want = (await g(["rev-parse", `origin/${BRANCH}`], repo)).stdout.trim();
  const ref = (await g(["rev-parse", "--abbrev-ref", "HEAD"], wt)).stdout.trim();
  if (!head || head !== want || ref !== "HEAD") return fail(db, c, `La copia de prueba no está en ${BRANCH}`);
  if (copies.get(c.slug) !== c || c.stopping) return;

  // Dependencies, once per lockfile.
  const install = installCommand(wt, s);
  if (install) {
    const mark = path.join(wt, "node_modules", ".plania-prueba");
    const hash = install.hash;
    const had = existsSync(mark) ? readFileSync(mark, "utf8").trim() : null;
    if (had !== hash) {
      const r = await (deps.exec ?? shellExec)(install.command, { cwd: wt, timeoutMs: 600_000, env: checkoutEnv() });
      if (r.code !== 0) {
        c.tail = tailOf(r.stderr || r.stdout);
        return fail(db, c, `No se pudieron instalar las dependencias (${install.command})`);
      }
      mkdirSync(path.dirname(mark), { recursive: true });
      writeFileSync(mark, hash);
    }
  }
  if (copies.get(c.slug) !== c || c.stopping) return;

  const port = await pickPort(db, s.port);
  if (!port) return fail(db, c, `No hay un puerto libre entre ${s.port} y ${s.port + PORT_SPAN - 1}`);
  c.port = port;
  const command = s.start_command.replaceAll("{port}", String(port));
  c.command = command;
  let child: ChildLike;
  try {
    child = (deps.spawn ?? defaultSpawn)(command, { cwd: wt, env: checkoutEnv({ PORT: String(port) }) });
  } catch (e) {
    return fail(db, c, `No se pudo arrancar: ${short(e)}`);
  }
  if (!child.pid) return fail(db, c, "No se pudo arrancar el proceso");
  c.pid = child.pid;
  const keep = (d: unknown) => {
    c.tail = tailOf([...c.tail, ...String(d).split("\n")].join("\n"));
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited: string | null = null;
  child.once("error", (e) => (exited = short(e)));
  child.once("exit", (code, signal) => {
    exited = signal ? `señal ${signal}` : `código ${code}`;
    c.pid = null;
    if (copies.get(c.slug) !== c || c.stopping) return;
    void fail(db, c, c.phase === "starting" ? `La copia de prueba se cerró al arrancar (${exited})` : `La copia de prueba se apagó (${exited})`);
  });
  if (deps.footprints !== false) {
    await registerFootprint(
      db,
      {
        project: p.slug,
        kind: "server",
        locator: `port:${port}`,
        purpose: `Copia de prueba de ${p.title} (${BRANCH}), encendida desde el piso`,
        teardown: `kill -TERM -${child.pid}`,
        details: { pid: child.pid, pgid: child.pid, server_pid: process.pid, worktree: wt, command, commit: head, branch: BRANCH },
      },
      ctx(),
    ).catch(() => undefined);
    // It may have exited (or been turned off) while the footprint was being written: release it again.
    if (copies.get(c.slug) !== c || c.stopping || c.phase === "failed") {
      await releaseFootprint(db, { project: p.slug, kind: "server", locator: `port:${port}` }, ctx()).catch(() => undefined);
      return;
    }
  }

  // Wait until it answers.
  const ready = urlOf(port) + (s.ready_path ?? "/");
  const until = now() + (deps.readyMs ?? READY_MS);
  for (;;) {
    if (copies.get(c.slug) !== c || c.stopping || exited) return;
    if (await (deps.up ?? defaultUp)(ready)) break;
    if (now() > until) return fail(db, c, `La copia de prueba no respondió en ${Math.round((deps.readyMs ?? READY_MS) / 1000)} s`);
    await new Promise((r) => setTimeout(r, deps.pollMs ?? POLL_MS));
  }

  // Fresh stills, then En vivo.
  c.phase = "capturing";
  try {
    await (deps.capture ?? runCapture)(db, { project: p.slug, checkout: wt, base_url: urlOf(port), commit: head, branch: BRANCH, actor: ctx().actor });
  } catch (e) {
    c.error = `No se pudo tomar la captura: ${short(e)}`;
  }
  if (copies.get(c.slug) === c && !c.stopping && c.phase === "capturing") c.phase = "live";
}

function tailOf(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter(Boolean)
    .slice(-12)
    .map((l) => l.slice(0, 240));
}

// The install command for the test copy: the setting, or the lockfile's own tool. Its hash is the lockfile's,
// so a changed lockfile installs again.
export function installCommand(wt: string, s: Pick<CaptureSettings, "install_command">): { command: string; hash: string } | null {
  const locks: [string, string][] = [
    ["package-lock.json", "npm ci"],
    ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
    ["yarn.lock", "yarn install --frozen-lockfile"],
  ];
  const found = locks.find(([f]) => existsSync(path.join(wt, f)));
  const command = s.install_command ?? found?.[1];
  if (!command) return null;
  const h = createHash("sha256").update(command);
  if (found) h.update(readFileSync(path.join(wt, found[0])));
  return { command, hash: h.digest("hex") };
}

// The first port from base up that no copy, no registered server and nothing listening holds.
export async function pickPort(db: Db, base: number): Promise<number | null> {
  const mine = new Set([...copies.values()].map((c) => c.port).filter((x): x is number => x !== null));
  const rows = await db
    .select({ locator: footprints.locator })
    .from(footprints)
    .where(and(eq(footprints.kind, "server"), isNull(footprints.releasedAt)));
  const registered = new Set(rows.map((r) => Number(r.locator.replace(/^port:/, ""))));
  const busy = deps.portBusy ?? defaultPortBusy;
  for (let port = base; port < base + PORT_SPAN && port <= 65535; port++) {
    if (RESERVED.has(port) || mine.has(port) || registered.has(port)) continue;
    if (await busy(port)) continue;
    return port;
  }
  return null;
}

// ---- Volver a tomar (Reintentar on a capture error)

// Takes the stills again from whatever serves the app: Plania's copy when it is on, else settings.capture.port.
export async function tomar(db: Db, slug: string): Promise<PruebaRead> {
  const { p, s } = await settingsOf(db, slug);
  const had = copies.get(slug);
  if (had && had.phase !== "live") return read(had);
  if (had) {
    had.phase = "capturing";
    had.error = null;
    void (deps.capture ?? runCapture)(db, { project: slug, checkout: had.worktree!, base_url: urlOf(had.port!), branch: BRANCH, actor: ctx().actor })
      .catch((e) => (had.error = `No se pudo tomar la captura: ${short(e)}`))
      .finally(() => {
        if (copies.get(slug) === had && had.phase === "capturing") had.phase = "live";
      });
    return read(had);
  }
  const c: Copy = { slug, phase: "capturing", managed: false, port: s.port, pid: null, worktree: null, repo: null, command: null, startedAt: now(), seenAt: now(), error: null, tail: [], stopping: false };
  copies.set(slug, c);
  void (deps.capture ?? runCapture)(db, { project: slug, checkout: repoPathOf(p.slug, p.settings, env()), base_url: urlOf(s.port), actor: ctx().actor })
    .catch(() => undefined)
    .finally(() => {
      if (copies.get(slug) === c) copies.delete(slug);
    });
  return read(c);
}

// ---- Apagar

async function stopProcess(db: Db, c: Copy): Promise<void> {
  const pid = c.pid;
  const kill = deps.kill ?? defaultKill;
  if (pid) {
    kill(pid, "SIGTERM");
    const grace = deps.stopGraceMs ?? 5_000;
    const alive = deps.alive ?? defaultAlive;
    const t = setTimeout(() => {
      if (alive(pid)) kill(pid, "SIGKILL");
    }, grace);
    t.unref?.();
    c.pid = null;
  }
  if (c.port && c.managed && deps.footprints !== false) {
    await releaseFootprint(db, { project: c.slug, kind: "server", locator: `port:${c.port}` }, ctx()).catch(() => undefined);
  }
}

// Turns the copy off (Jorge's Apagar, the idle sweep, Reintentar after a failure). The worktree stays for next time.
export async function apagar(db: Db, slug: string): Promise<PruebaRead> {
  const c = copies.get(slug);
  if (c && c.managed) {
    c.stopping = true;
    copies.delete(slug);
    await stopProcess(db, c);
  }
  return { phase: "off", managed: false, port: null, url: null, started_at: null, error: null, detail: null };
}

// Copies nobody has looked at for IDLE_MS stop. Run every minute while any copy exists.
export async function sweepIdle(db: Db): Promise<string[]> {
  const idle = deps.idleMs ?? IDLE_MS;
  const gone: string[] = [];
  for (const c of [...copies.values()]) {
    if (!c.managed || now() - c.seenAt < idle) continue;
    await apagar(db, c.slug);
    gone.push(c.slug);
  }
  if (!copies.size && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  return gone;
}

// Plania stopping: every copy's process group gets SIGTERM, synchronously. Their footprints are released at
// the next start (reapOrphans), since the database may be gone by then.
export function stopAll(): void {
  const kill = deps.kill ?? defaultKill;
  for (const c of copies.values()) if (c.pid) kill(c.pid, "SIGTERM");
  copies.clear();
}

function hook(): void {
  if (!sweeper && deps.sweep !== false) {
    sweeper = setInterval(() => {
      void import("../db/client.js").then(({ withDb }) => withDb((db) => sweepIdle(db))).catch(() => undefined);
    }, 60_000);
    sweeper.unref();
  }
  if (hooked || deps.signals === false) return;
  hooked = true;
  process.once("exit", stopAll);
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.once(sig, () => {
      stopAll();
      // Keep Node's default: a signal ends the server.
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

// At Plania's start: a copy an earlier server left running (a crash, kill -9) is stopped and its footprint
// released. Only when the Plania server that started it is gone (a dev server on the same database must not stop
// the live one's copy), and only processes whose command line still is the one this module started are signalled.
export async function reapOrphans(db: Db, cmdOf: (pid: number) => Promise<string | null> = psCommand): Promise<number> {
  const rows = await db
    .select({ locator: footprints.locator, machine: footprints.machine, details: footprints.details, project: projects.slug })
    .from(footprints)
    .innerJoin(projects, eq(projects.id, footprints.projectId))
    .where(and(eq(footprints.kind, "server"), isNull(footprints.releasedAt), sql`${footprints.holder}->>'session_id' = ${SESSION}`));
  let n = 0;
  for (const r of rows) {
    if (copies.has(r.project)) continue;
    const declared = (r.details.declared ?? r.details) as { pid?: number; command?: string; server_pid?: number };
    const owner = Number(declared.server_pid);
    if (Number.isInteger(owner) && owner > 1 && owner !== process.pid && (deps.alive ?? defaultAlive)(owner)) continue;
    const pid = Number(declared.pid);
    if (Number.isInteger(pid) && pid > 1) {
      const cmd = await cmdOf(pid);
      if (cmd && declared.command && cmd.includes(declared.command)) (deps.kill ?? defaultKill)(pid, "SIGTERM");
    }
    const c = ctx();
    await releaseFootprint(db, { project: r.project, kind: "server", locator: r.locator }, { ...c, actor: { ...c.actor, machine: r.machine } }).catch(() => undefined);
    n += 1;
  }
  return n;
}

const psCommand = (pid: number) =>
  new Promise<string | null>((resolve) => {
    execFile("ps", ["-o", "command=", "-p", String(pid)], { timeout: 5_000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
