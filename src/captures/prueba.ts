// PLA-I46-8: Encenderla. The floor's Ventana can start a project's test copy on this Mac, and only when Jorge
// clicks. The test copy is Plania's own worktree of origin/sandbox (<worktrees>/<slug>/_prueba, detached, outside
// every repo), never main and never Jorge's checkout. It runs settings.capture.start_command on the first free port
// from settings.capture.port up (skipping ports another copy, a registered server or anything listening already
// holds), with the shell basics only (checkoutEnv: none of Plania's secrets). Once it answers, fresh stills are
// taken and the Ventana says «En vivo». The process is a registered footprint (port:N, teardown kill -TERM -<pgid>)
// and stops when Jorge turns it off, when nobody has looked at the floor for IDLE_MS, or when Plania stops.
// Everything here is in memory: one Plania server per Mac. Tests inject every outside call (setPruebaDeps).
import { exitAfterDrain } from "../ops/shutdown.js";
import { spawn as nodeSpawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
import { ENV_FILES, scrub as scrubLine, secretValues as secretValuesOf, type MaquinasSettings } from "../maquinas/env.js";

export const BRANCH = "sandbox";
export const IDLE_MS = 20 * 60_000; // nobody looked at the floor for this long: the copy stops
const READY_MS = 180_000; // a first Next.js compile can take a while
const POLL_MS = 1_000;
const PORT_SPAN = 50; // ports tried from settings.capture.port up
// Plania's own servers and the local databases: never handed to a test copy.
const RESERVED = new Set([3737, 3738, 3791, 3792, 5173, 5432, 5433]);
const SESSION = "plania-prueba";
// PLA-I48-1: the output kept per copy (Bitácora) and the part the Ventana's «Ver detalle» shows.
export const TAIL_LINES = 200;
const DETAIL_LINES = 12;

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

// PLA-I52-2: two lanes per project. «sandbox» is Encenderla's copy (the before, and what the Ventana shows);
// «entrega» is the delivery under review (a PR branch), warm while the owner decides, at most one per project.
export type Lane = "sandbox" | "entrega";
const idOf = (slug: string, lane: Lane) => (lane === "sandbox" ? slug : `${slug}::entrega`);

type Copy = {
  id: string;
  lane: Lane;
  ref: string; // the branch it runs: sandbox, or the delivery's branch
  taskKey: string | null; // the delivery's ticket (entrega only)
  slug: string;
  phase: Phase;
  managed: boolean;
  port: number | null;
  pid: number | null;
  worktree: string | null;
  repo: string | null;
  command: string | null;
  commit: string | null;
  startedAt: number;
  seenAt: number;
  error: string | null;
  tail: string[];
  stopping: boolean;
  // The server footprint being written for this copy, so a failure can wait for it and release it.
  registering: Promise<unknown> | null;
  // PLA-75: a delivery copy's own database (settings.capture.database): the variable and URL it runs with.
  dbEnv: Record<string, string> | null;
  // PLA-78: the hash of the muestra's datos loaded into this copy's database, so a retake does not load them twice
  // and another delivery gets a clean copy.
  datos: string | null;
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
    detail: c.tail.length ? c.tail.slice(-DETAIL_LINES).join("\n") : null,
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
  const c = newCopy(slug, "sandbox", BRANCH, null, "starting", true);
  copies.set(c.id, c);
  hook();
  void start(db, c, p, s).catch((e) => fail(db, c, `No se pudo encender: ${short(e)}`));
  return read(c);
}

// Error shows only once the process is stopped and its footprint released (a footprint still being written is
// waited for first), so whoever reads «failed» never finds the copy still registered.
function newCopy(slug: string, lane: Lane, ref: string, taskKey: string | null, phase: Phase, managed: boolean, port: number | null = null): Copy {
  return { id: idOf(slug, lane), lane, ref, taskKey, slug, phase, managed, port, pid: null, worktree: null, repo: null, command: null, commit: null, startedAt: now(), seenAt: now(), error: null, tail: [], stopping: false, registering: null, dbEnv: null, datos: null };
}

async function fail(db: Db, c: Copy, error: string): Promise<void> {
  if (copies.get(c.id) !== c) return;
  c.error = error;
  if (c.registering) await c.registering;
  await stopProcess(db, c);
  if (copies.get(c.id) === c) c.phase = "failed";
}

async function start(db: Db, c: Copy, p: typeof projects.$inferSelect, s: CaptureSettings): Promise<void> {
  const g = git();
  const repo = repoPathOf(p.slug, p.settings, env());
  c.repo = repo;
  if (!existsSync(repo)) return fail(db, c, `No encuentro el repo de ${p.title} en ${repo}`);
  const wt = path.join(worktreeRoot(env()), p.slug, c.lane === "sandbox" ? "_prueba" : "_entrega");
  const ref = c.ref;
  const what = c.lane === "sandbox" ? "La copia de prueba" : "La copia de la entrega";
  if (isInside(wt, repo)) return fail(db, c, "La copia de prueba quedaría dentro del repo");
  c.worktree = wt;

  // The test copy is origin/sandbox (or the delivery's origin/<branch>), detached. Never main, never a checkout
  // Jorge works in.
  if ((await g(["fetch", "origin", ref], repo)).code !== 0) return fail(db, c, `No se pudo traer ${ref} de origin`);
  if (existsSync(wt)) {
    const dirty = await g(["status", "--porcelain", "--untracked-files=no"], wt);
    if (dirty.code !== 0) return fail(db, c, `No se pudo leer ${what.toLowerCase()}`);
    if (dirty.stdout.trim()) return fail(db, c, `${what} tiene cambios sin guardar; no la toco`);
    if ((await g(["checkout", "--detach", `origin/${ref}`], wt)).code !== 0) return fail(db, c, `No se pudo poner ${what.toLowerCase()} en ${ref}`);
  } else {
    mkdirSync(path.dirname(wt), { recursive: true });
    if ((await g(["worktree", "add", "--detach", wt, `origin/${ref}`], repo)).code !== 0) return fail(db, c, `No se pudo crear ${what.toLowerCase()}`);
    if (deps.footprints !== false) {
      await registerFootprint(
        db,
        { project: p.slug, kind: "worktree", locator: wt, purpose: c.lane === "sandbox" ? `Copia de prueba de ${p.title} (${BRANCH}), para Encenderla` : `Copia de la entrega de ${p.title}, para El Probador`, teardown: `git -C ${repo} worktree remove --force ${wt}` },
        ctx(),
      ).catch(() => undefined);
    }
  }
  const head = (await g(["rev-parse", "HEAD"], wt)).stdout.trim();
  c.commit = head || null;
  const want = (await g(["rev-parse", `origin/${ref}`], repo)).stdout.trim();
  const detached = (await g(["rev-parse", "--abbrev-ref", "HEAD"], wt)).stdout.trim();
  if (!head || head !== want || detached !== "HEAD") return fail(db, c, `${what} no está en ${ref}`);
  if (copies.get(c.id) !== c || c.stopping) return;

  // PLA-38: the app's own env file (untracked, so not in a fresh worktree): its database and keys.
  const envFile = syncEnvFile(repo, wt, p.settings.maquinas);

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
  if (copies.get(c.id) !== c || c.stopping) return;

  // PLA-75: a delivery whose branch changes the database runs on its own copy of the app's database, migrated to
  // the branch. Without it the delivery's pages crashed on the new columns and El Probador photographed the error.
  // PLA-77: the sandbox copy too (<db>_prueba, migrated to sandbox): once a delivery with a migration was merged,
  // the app's own database lagged behind sandbox and «Antes» crashed («Sin antes» on MIA-I9-2).
  if (s.database) {
    const made = await entregaDatabase(db, c, p.slug, wt, envFile, s.database, c.lane === "sandbox" ? "_prueba" : "_entrega");
    if (!made.ok) return fail(db, c, made.error);
    if (copies.get(c.id) !== c || c.stopping) return;
  }

  // PLA-52: one copy picks at a time, and holds its port before the next one looks: El Probador starts the test copy
  // and the delivery's copy together, and both took the same free port (the second one died at start).
  const picking = portLock.then(async () => {
    const n = await pickPort(db, s.port);
    if (n && copies.get(c.id) === c && !c.stopping) c.port = n;
    return n;
  });
  portLock = picking.catch(() => null);
  const port = await picking;
  if (!port) return fail(db, c, `No hay un puerto libre entre ${s.port} y ${s.port + PORT_SPAN - 1}`);
  if (copies.get(c.id) !== c || c.stopping) return;
  const command = s.start_command.replaceAll("{port}", String(port));
  c.command = command;
  let child: ChildLike;
  try {
    child = (deps.spawn ?? defaultSpawn)(command, { cwd: wt, env: checkoutEnv({ PORT: String(port), ...(c.dbEnv ?? {}) }) });
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
    if (copies.get(c.id) !== c || c.stopping) return;
    void fail(db, c, c.phase === "starting" ? `${what} se cerró al arrancar (${exited})` : `${what} se apagó (${exited})`);
  });
  if (deps.footprints !== false) {
    c.registering = registerFootprint(
      db,
      {
        project: p.slug,
        kind: "server",
        locator: `port:${port}`,
        purpose: c.lane === "sandbox" ? `Copia de prueba de ${p.title} (${BRANCH}), encendida desde el piso` : `Copia de la entrega ${c.taskKey ?? ""} de ${p.title} (${ref}), para El Probador`,
        teardown: `kill -TERM -${child.pid}`,
        details: { pid: child.pid, pgid: child.pid, server_pid: process.pid, worktree: wt, command, commit: head, branch: ref, lane: c.lane, ...(c.taskKey ? { task_key: c.taskKey } : {}) },
      },
      ctx(),
    ).catch(() => undefined);
    await c.registering;
    c.registering = null;
    // It may have exited (or been turned off) while the footprint was being written: release it again.
    if (copies.get(c.id) !== c || c.stopping || c.phase === "failed" || exited) {
      await releaseFootprint(db, { project: p.slug, kind: "server", locator: `port:${port}` }, ctx()).catch(() => undefined);
      return;
    }
  }

  // Wait until it answers.
  const ready = urlOf(port) + (s.ready_path ?? "/");
  const until = now() + (deps.readyMs ?? READY_MS);
  for (;;) {
    if (copies.get(c.id) !== c || c.stopping || exited) return;
    if (await (deps.up ?? defaultUp)(ready)) break;
    if (now() > until) return fail(db, c, `${what} no respondió en ${Math.round((deps.readyMs ?? READY_MS) / 1000)} s`);
    await new Promise((r) => setTimeout(r, deps.pollMs ?? POLL_MS));
  }

  // The delivery's copy is En vivo as soon as it answers; its stills are the Probador's (PLA-I52-3), not the Ventana's.
  if (c.lane === "entrega") {
    c.phase = "live";
    return;
  }
  // Fresh stills, then En vivo.
  c.phase = "capturing";
  try {
    await (deps.capture ?? runCapture)(db, { project: p.slug, checkout: wt, base_url: urlOf(port), commit: head, branch: BRANCH, actor: ctx().actor, env: c.dbEnv ?? {} });
  } catch (e) {
    c.error = `No se pudo tomar la captura: ${short(e)}`;
  }
  if (copies.get(c.id) === c && !c.stopping && c.phase === "capturing") c.phase = "live";
}

function tailOf(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter(Boolean)
    .slice(-TAIL_LINES)
    .map((l) => l.slice(0, 240));
}

// PLA-38: copy the project's env file (settings.maquinas.env_file, else the first of ENV_FILES) from the repo
// into a copy's worktree when it is missing there or the repo's is newer. Mode 0600. It stays untracked (env files
// are ignored in the app repos) and it is the app's own file: Plania's environment never reaches it.
export function syncEnvFile(repo: string, wt: string, s?: MaquinasSettings): string | null {
  const names = s?.env_file ? [s.env_file] : ENV_FILES;
  for (const f of names) {
    const from = path.join(repo, f);
    const to = path.join(wt, f);
    if (!from.startsWith(repo + path.sep) || !to.startsWith(wt + path.sep) || !existsSync(from)) continue;
    try {
      if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) return f;
      copyFileSync(from, to);
      chmodSync(to, 0o600);
      return f;
    } catch {
      return null;
    }
  }
  return null;
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

let portLock: Promise<unknown> = Promise.resolve();

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

// PLA-I48-1: what Máquinas adds to the read: how the copy was started, on which commit, and where.
export function pruebaInfo(slug: string): { command: string | null; commit: string | null; branch: string; worktree: string | null; started_by: string | null } | null {
  const c = copies.get(slug);
  if (!c) return null;
  return { command: c.command, commit: c.commit, branch: BRANCH, worktree: c.worktree, started_by: c.managed ? "Plania, desde el piso" : null };
}

// The kept output (at most TAIL_LINES), with every value of Plania's own environment and every secret-looking
// value scrubbed: the app may print what it read, and nothing of Plania's may reach the screen.
export function pruebaLog(slug: string, secrets: string[] = []): string[] {
  const c = copies.get(slug);
  if (!c) return [];
  const own = secretValuesOf(env());
  return c.tail.slice(-TAIL_LINES).map((l) => scrubLine(l, [...own, ...secrets]));
}

// Reiniciar: Apagar, then Encenderla, with the same port rule (the first free port from settings.capture.port up).
export async function reiniciar(db: Db, slug: string): Promise<PruebaRead> {
  const { s } = await settingsOf(db, slug);
  const c = copies.get(slug);
  const outside = !c && (await pruebaRead(slug, s)).phase === "running";
  if (outside || (c && !c.managed)) throw new ToolError("INVALID_FILTER", { field: "prueba", hint: "la app no la encendió Plania; no la puedo reiniciar" });
  await apagar(db, slug);
  return encender(db, slug);
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
    void (deps.capture ?? runCapture)(db, { project: slug, checkout: had.worktree!, base_url: urlOf(had.port!), branch: BRANCH, actor: ctx().actor, env: had.dbEnv ?? {} })
      .catch((e) => (had.error = `No se pudo tomar la captura: ${short(e)}`))
      .finally(() => {
        if (copies.get(slug) === had && had.phase === "capturing") had.phase = "live";
      });
    return read(had);
  }
  const c = newCopy(slug, "sandbox", BRANCH, null, "capturing", false, s.port);
  copies.set(c.id, c);
  void (deps.capture ?? runCapture)(db, { project: slug, checkout: repoPathOf(p.slug, p.settings, env()), base_url: urlOf(s.port), actor: ctx().actor })
    .catch(() => undefined)
    .finally(() => {
      if (copies.get(slug) === c) copies.delete(slug);
    });
  return read(c);
}

// ---- La copia de la entrega (PLA-I52-2)

export type EntregaRead = PruebaRead & { key: string | null; branch: string | null; commit: string | null; worktree: string | null };

function readEntrega(c: Copy): EntregaRead {
  return { ...read(c), key: c.taskKey, branch: c.ref, commit: c.commit, worktree: c.worktree };
}

// Starts the delivery's copy (its PR branch, next to sandbox's), or returns the one already running for the same
// ticket and branch. A different delivery in the same project replaces it: one delivery copy per project.
// PLA-94 (guided test PLA-86, F-17): a copy kept for the same ticket and branch is only reused while it runs the
// branch's head. MIA-I10-1 came back from Taller on a new commit while the live copy turned on for its first delivery
// still ran the old one; El Probador reused it and photographed the old commit, and the card held «Aceptar» with
// «Las fotos son de un commit anterior». The head is the caller's (the PR's) when it knows it, else origin's after a
// fetch. A copy still starting (no commit yet) is kept: it is on its way to the head it fetched.
async function atHead(c: Copy, branch: string, head?: string | null): Promise<boolean> {
  if (!c.commit) return true;
  let want = head?.trim() || "";
  if (!want && c.repo) {
    const g = git();
    if ((await g(["fetch", "origin", branch], c.repo)).code !== 0) return true;
    want = (await g(["rev-parse", `origin/${branch}`], c.repo)).stdout.trim();
  }
  if (!want) return true;
  return c.commit.startsWith(want.slice(0, 7)) || want.startsWith(c.commit.slice(0, 7));
}

export async function encenderEntrega(db: Db, slug: string, delivery: { key: string; branch: string; head?: string | null }): Promise<EntregaRead> {
  const { p, s } = await settingsOf(db, slug);
  const branch = delivery.branch.trim();
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new ToolError("INVALID_FILTER", { field: "branch", hint: "a plain branch name" });
  }
  if (branch === "main" || branch === BRANCH) throw new ToolError("INVALID_FILTER", { field: "branch", hint: `the delivery's copy runs the PR branch, never ${branch}` });
  const id = idOf(slug, "entrega");
  const had = copies.get(id);
  if (had && had.taskKey === delivery.key && had.ref === branch && had.phase !== "failed" && (await atHead(had, branch, delivery.head))) {
    had.seenAt = now();
    return readEntrega(had);
  }
  if (had) await stopId(db, id);
  const c = newCopy(slug, "entrega", branch, delivery.key, "starting", true);
  copies.set(id, c);
  hook();
  void start(db, c, p, s).catch((e) => fail(db, c, `No se pudo encender: ${short(e)}`));
  return readEntrega(c);
}

// What El Probador shows. Reading it counts as somebody looking (the idle clock starts again).
export function entregaRead(slug: string): EntregaRead | null {
  const c = copies.get(idOf(slug, "entrega"));
  if (!c) return null;
  c.seenAt = now();
  return readEntrega(c);
}

export async function apagarEntrega(db: Db, slug: string): Promise<PruebaRead> {
  return stopId(db, idOf(slug, "entrega"));
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
  return stopId(db, idOf(slug, "sandbox"));
}

async function stopId(db: Db, id: string): Promise<PruebaRead> {
  const c = copies.get(id);
  // PLA-I52-5: the live proxy goes with the delivery's copy.
  if (c?.lane === "entrega") await import("./vivo.js").then((m) => m.stopVivo(c.slug)).catch(() => undefined);
  if (c && c.managed) {
    c.stopping = true;
    copies.delete(id);
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
    await stopId(db, c.id);
    gone.push(c.id);
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
      // Keep Node's default: a signal ends the server; PLA-111: once the requests in flight have finished.
      exitAfterDrain(sig === "SIGINT" ? 130 : 143);
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
    if (copies.has(r.project) || copies.has(idOf(r.project, "entrega"))) continue;
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

// ---- PLA-75: the delivery copy's own database

/** The value of one variable in an env file (KEY=value, optional export and quotes); null when it is not there. */
export function envValue(text: string, name: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line);
    if (!m) continue;
    const v = m[1]!.trim();
    return v.replace(/^(['"])(.*)\1$/, "$2") || null;
  }
  return null;
}

/** The delivery database's URL: the app's URL with its database name + _entrega. Null for anything unexpected. */
export function entregaUrl(base: string, suffix: "_entrega" | "_prueba" = "_entrega"): { url: string; name: string } | null {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]{1,50}$/.test(name)) return null;
  const host = u.hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(host)) return null; // a local database only
  u.pathname = `/${name}${suffix}`;
  return { url: u.toString(), name: `${name}${suffix}` };
}

export const PG_DIRS = ["/opt/homebrew/opt/postgresql@17/bin", "/opt/homebrew/opt/postgresql@16/bin", "/opt/homebrew/opt/libpq/bin", "/usr/local/opt/libpq/bin"];

async function entregaDatabase(
  db: Db,
  c: Copy,
  slug: string,
  wt: string,
  envFile: string | null,
  cfg: { env_var: string; migrate_command: string },
  suffix: "_entrega" | "_prueba" = "_entrega",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = envFile ? path.join(wt, envFile) : null;
  const base = file && existsSync(file) ? envValue(readFileSync(file, "utf8"), cfg.env_var) : null;
  if (!base) return { ok: false, error: `La copia de la entrega no encuentra ${cfg.env_var} en el archivo de entorno de la app` };
  const target = entregaUrl(base, suffix);
  if (!target) return { ok: false, error: `${cfg.env_var} no es una base local de Postgres; la entrega no se prueba sobre ella` };
  const exec = deps.exec ?? shellExec;
  const pgPath = [...PG_DIRS.filter((d) => existsSync(d)), checkoutEnv().PATH ?? ""].join(":");
  // The URLs go in the environment, never in the command line.
  const copyCmd = `psql "$PLANIA_BASE_URL" -v ON_ERROR_STOP=1 -q -c 'drop database if exists ${target.name} with (force)' -c 'create database ${target.name}' && pg_dump --no-owner --no-privileges "$PLANIA_BASE_URL" | psql -v ON_ERROR_STOP=1 -q "$PLANIA_NEW_URL"`;
  const copied = await exec(copyCmd, { cwd: wt, timeoutMs: 300_000, env: checkoutEnv({ PATH: pgPath, PLANIA_BASE_URL: base, PLANIA_NEW_URL: target.url }) });
  if (copied.code !== 0) {
    c.tail = tailOf(copied.stderr || copied.stdout);
    return { ok: false, error: `No se pudo copiar la base de la app para la entrega (${target.name})` };
  }
  const migrated = await exec(cfg.migrate_command, { cwd: wt, timeoutMs: 300_000, env: checkoutEnv({ [cfg.env_var]: target.url }) });
  if (migrated.code !== 0) {
    c.tail = tailOf(migrated.stderr || migrated.stdout);
    return { ok: false, error: `Las migraciones de la entrega fallaron (${cfg.migrate_command})` };
  }
  c.dbEnv = { [cfg.env_var]: target.url };
  if (deps.footprints !== false) {
    const u = new URL(target.url);
    await registerFootprint(
      db,
      { project: slug, kind: "database", locator: `${target.name}@${u.hostname || "127.0.0.1"}:${u.port || "5432"}`, purpose: suffix === "_prueba" ? `Base de la copia de prueba de ${slug} (copia de la de la app, con las migraciones de sandbox)` : `Base de la copia de la entrega de ${slug} (copia de la de la app, con las migraciones de la rama), para El Probador`, teardown: `dropdb --if-exists -h ${u.hostname || "localhost"} -p ${u.port || "5432"} ${target.name}` },
      ctx(),
    ).catch(() => undefined);
  }
  return { ok: true };
}

/** PLA-75: what a command run in the delivery copy needs to reach its own database (empty when it has none). */
export function entregaEnv(slug: string): Record<string, string> {
  return copies.get(idOf(slug, "entrega"))?.dbEnv ?? {};
}

/** PLA-77: the same for the sandbox copy (Antes, Encenderla). */
export function pruebaEnv(slug: string): Record<string, string> {
  return copies.get(idOf(slug, "sandbox"))?.dbEnv ?? {};
}

// ---- PLA-78: the muestra's fake rows

export const hashDatos = (sql: string | null | undefined): string | null => (sql ? createHash("sha256").update(sql).digest("hex").slice(0, 16) : null);

/** Which datos (hash) a copy's database carries, or null when it is clean or not running. */
export function datosDe(slug: string, lane: Lane): string | null {
  return copies.get(idOf(slug, lane))?.datos ?? null;
}

/** The copy's own database name when it is one of Plania's throwaway copies (<db>_entrega, <db>_prueba), else null. */
export function copyDatabase(env: Record<string, string> | null): { url: string; name: string } | null {
  const url = env ? Object.values(env)[0] : undefined;
  if (!url) return null;
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return /^[A-Za-z0-9_]+_(entrega|prueba)$/.test(name) ? { url, name } : null;
  } catch {
    return null;
  }
}

/** Loads a muestra's SQL into a live copy's own database, in one transaction. Never the app's own database: a copy
 * without settings.capture.database is refused. Loading the same datos twice is a no-op. */
export async function cargarDatos(slug: string, lane: Lane, sql: string): Promise<{ ok: true; skipped?: true } | { ok: false; error: string }> {
  const c = copies.get(idOf(slug, lane));
  if (!c || c.phase !== "live") return { ok: false, error: "la copia no está encendida" };
  const target = copyDatabase(c.dbEnv);
  if (!target) return { ok: false, error: "la copia no tiene base propia (settings.capture.database); los datos nunca van a la base de la app" };
  const hash = hashDatos(sql)!;
  if (c.datos === hash) return { ok: true, skipped: true };
  if (c.datos) return { ok: false, error: "la copia ya tiene los datos de otra muestra" };
  const exec = deps.exec ?? shellExec;
  const pgPath = [...PG_DIRS.filter((d) => existsSync(d)), checkoutEnv().PATH ?? ""].join(":");
  const r = await exec(`psql "$PLANIA_COPY_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f -`, {
    cwd: c.worktree ?? process.cwd(),
    stdin: sql,
    timeoutMs: 60_000,
    env: checkoutEnv({ PATH: pgPath, PLANIA_COPY_URL: target.url }),
  });
  if (r.code !== 0) {
    const line = (r.stderr || r.stdout).split("\n").map((l) => l.trim()).find((l) => /ERROR/.test(l)) ?? (r.stderr || r.stdout).trim().split("\n")[0] ?? `código ${r.code}`;
    return { ok: false, error: line.replace(/^psql:[^:]*:\d+:\s*/, "").slice(0, 200) };
  }
  c.datos = hash;
  return { ok: true };
}
