// PLA-I46-8: Encenderla. The floor's Ventana can start a project's test copy on this machine, and only when the owner
// clicks. The test copy is Plania's own worktree of origin/sandbox (<worktrees>/<slug>/_prueba, detached, outside
// every repo), never main and never the owner's checkout. It runs settings.capture.start_command on the first free port
// from settings.capture.port up (skipping ports another copy, a registered server or anything listening already
// holds), with the shell basics only (checkoutEnv: none of Plania's secrets). Once it answers, fresh stills are
// taken and the Ventana says «En vivo». The process is a registered footprint (port:N, teardown kill -TERM -<pgid>)
// and stops when the owner turns it off, when nobody has looked at the floor for IDLE_MS, or when Plania stops.
// Everything here is in memory: one Plania server per Mac. Tests inject every outside call (setPruebaDeps).
import { cloneModules } from "../lib/clone-modules.js";
import { DEFAULT_START_BRANCH, startBranchOf } from "../runner/start-branch.js";
import { exitAfterDrain } from "../ops/shutdown.js";
import { spawn as nodeSpawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { pgSearchPath } from "../lib/pg-bin.js";
import { readPg, type PgReading } from "../lib/pg-connect.js";
import { supported } from "../lib/system-support.js";
import { isSelfProject, serverRoot } from "../self/plania-self.js";
import { defaultSelfDbBuild, selfCopyDatabase, selfCopyEnvFile, type SelfDbBuild } from "../self/self-copy.js";
import type { CopySuffix } from "../self/plania-self.js";
import { processCommand } from "../lib/proc-command.js";
import { killTree, shellCommand } from "../lib/proc-tree.js";
import { defineWords, say } from "../words.js";
import { DEFAULT_WAITS, measuredWaits } from "./waits.js";

// PLA-I2-10: why a copy did not start, its footprints' purposes and its refusals, in the install's language; the
// Spanish is unchanged.
export const PRUEBA_WORDS = defineWords({
  es: {
    noStart: (why: string) => `No se pudo encender: ${why}`,
    noRepo: (title: string, repo: string) => `No encuentro el repo de ${title} en ${repo}`,
    testCopy: "La copia de prueba",
    deliveryCopy: "La copia de la entrega",
    insideRepo: "La copia de prueba quedaría dentro del repo",
    noFetch: (ref: string) => `No se pudo traer ${ref} de origin`,
    noRead: (what: string) => `No se pudo leer ${what}`,
    dirty: (what: string) => `${what} tiene cambios sin guardar; no la toco`,
    noCheckout: (what: string, ref: string) => `No se pudo poner ${what} en ${ref}`,
    noCreate: (what: string) => `No se pudo crear ${what}`,
    worktreeTest: (title: string, branch: string) => `Copia de prueba de ${title} (${branch}), para Encenderla`,
    worktreeDelivery: (title: string) => `Copia de la entrega de ${title}, para El Probador`,
    notOn: (what: string, ref: string) => `${what} no está en ${ref}`,
    noInstall: (cmd: string) => `No se pudieron instalar las dependencias (${cmd})`,
    noPort: (from: number, to: number) => `No hay un puerto libre entre ${from} y ${to}`,
    noSpawn: (why: string) => `No se pudo arrancar: ${why}`,
    noProcess: "No se pudo arrancar el proceso",
    signal: (signal: string) => `señal ${signal}`,
    code: (code: number | null) => `código ${code}`,
    closedAtStart: (what: string, why: string) => `${what} se cerró al arrancar (${why})`,
    wentOff: (what: string, why: string) => `${what} se apagó (${why})`,
    serverTest: (title: string, branch: string) => `Copia de prueba de ${title} (${branch}), encendida desde el piso`,
    serverDelivery: (key: string, title: string, ref: string) => `Copia de la entrega ${key} de ${title} (${ref}), para El Probador`,
    noAnswer: (what: string, s: number) => `${what} no respondió en ${s} s`,
    noStill: (why: string) => `No se pudo tomar la captura: ${why}`,
    startedBy: "Plania, desde el piso",
    notMine: "la app no la encendió Plania; no la puedo reiniciar",
    noVar: (name: string) => `La copia de la entrega no encuentra ${name} en el archivo de entorno de la app`,
    notLocal: (name: string) => `${name} no es una base local de Postgres; la entrega no se prueba sobre ella`,
    noCopyDb: (name: string) => `No se pudo copiar la base de la app para la entrega (${name})`,
    migrateFailed: (cmd: string) => `Las migraciones de la entrega fallaron (${cmd})`,
    dbTest: (slug: string) => `Base de la copia de prueba de ${slug} (copia de la de la app, con las migraciones de sandbox)`,
    dbDelivery: (slug: string) => `Base de la copia de la entrega de ${slug} (copia de la de la app, con las migraciones de la rama), para El Probador`,
    copyOff: "la copia no está encendida",
    noOwnDb: "la copia no tiene base propia (settings.capture.database); los datos nunca van a la base de la app",
    otherDatos: "la copia ya tiene los datos de otra muestra",
    // PLA-I72-1: the copy of an open initiative.
    iniCopy: "La copia de la iniciativa",
    worktreeIni: (title: string, key: string, branch: string) => `Copia de ${title} para la iniciativa ${key} (${branch}), en Máquinas`,
    serverIni: (title: string, key: string, branch: string) => `Servidor de la copia de ${title} para la iniciativa ${key} (${branch}), en Máquinas`,
    dbIni: (slug: string, key: string) => `Base de la copia de ${slug} para la iniciativa ${key} (copia de la de inicio, con las migraciones de la rama)`,
    noBranch: "la iniciativa no tiene rama todavía",
    // PLA-158 (F-31)
    dbTaller: (slug: string) => `Base de trabajo de Taller en ${slug} (copia de la de la app), para que sus pruebas y migraciones no toquen la de la app`,
    tallerNotLocal: (name: string) => `${name} no es una base local de Postgres; Taller no trabaja sobre la base de la app`,
    noTallerDb: (name: string) => `No se pudo copiar la base de la app para Taller (${name})`,
  },
  en: {
    noStart: (why: string) => `Could not turn it on: ${why}`,
    noRepo: (title: string, repo: string) => `I can't find ${title}'s repo at ${repo}`,
    testCopy: "The test copy",
    deliveryCopy: "The delivery's copy",
    insideRepo: "The test copy would sit inside the repo",
    noFetch: (ref: string) => `Could not fetch ${ref} from origin`,
    noRead: (what: string) => `Could not read ${what}`,
    dirty: (what: string) => `${what} has unsaved changes; I leave it alone`,
    noCheckout: (what: string, ref: string) => `Could not put ${what} on ${ref}`,
    noCreate: (what: string) => `Could not create ${what}`,
    worktreeTest: (title: string, branch: string) => `Test copy of ${title} (${branch}), to turn it on`,
    worktreeDelivery: (title: string) => `Delivery copy of ${title}, for El Probador`,
    notOn: (what: string, ref: string) => `${what} is not on ${ref}`,
    noInstall: (cmd: string) => `Could not install the dependencies (${cmd})`,
    noPort: (from: number, to: number) => `No free port between ${from} and ${to}`,
    noSpawn: (why: string) => `Could not start: ${why}`,
    noProcess: "Could not start the process",
    signal: (signal: string) => `signal ${signal}`,
    code: (code: number | null) => `code ${code}`,
    closedAtStart: (what: string, why: string) => `${what} closed while starting (${why})`,
    wentOff: (what: string, why: string) => `${what} went off (${why})`,
    serverTest: (title: string, branch: string) => `Test copy of ${title} (${branch}), turned on from the floor`,
    serverDelivery: (key: string, title: string, ref: string) => `Delivery copy ${key} of ${title} (${ref}), for El Probador`,
    noAnswer: (what: string, s: number) => `${what} did not answer in ${s} s`,
    noStill: (why: string) => `Could not take the still: ${why}`,
    startedBy: "Plania, from the floor",
    notMine: "Plania did not turn this app on; I can't restart it",
    noVar: (name: string) => `The delivery's copy can't find ${name} in the app's env file`,
    notLocal: (name: string) => `${name} is not a local Postgres database; the delivery is not tested on it`,
    noCopyDb: (name: string) => `Could not copy the app's database for the delivery (${name})`,
    migrateFailed: (cmd: string) => `The delivery's migrations failed (${cmd})`,
    dbTest: (slug: string) => `Database of ${slug}'s test copy (a copy of the app's, with the test branch's migrations)`,
    dbDelivery: (slug: string) => `Database of ${slug}'s delivery copy (a copy of the app's, with the branch's migrations), for El Probador`,
    copyOff: "the copy is not on",
    noOwnDb: "the copy has no database of its own (settings.capture.database); the data never goes to the app's database",
    otherDatos: "the copy already holds another preview's data",
    iniCopy: "The initiative's copy",
    worktreeIni: (title: string, key: string, branch: string) => `Copy of ${title} for initiative ${key} (${branch}), in Máquinas`,
    serverIni: (title: string, key: string, branch: string) => `Server of ${title}'s copy for initiative ${key} (${branch}), in Máquinas`,
    dbIni: (slug: string, key: string) => `Database of ${slug}'s copy for initiative ${key} (a copy of the start copy's, with the branch's migrations)`,
    noBranch: "the initiative has no branch yet",
    dbTaller: (slug: string) => `Taller's working database on ${slug} (a copy of the app's), so its tests and migrations never touch the app's own`,
    tallerNotLocal: (name: string) => `${name} is not a local Postgres database; Taller does not work on the app's database`,
    noTallerDb: (name: string) => `Could not copy the app's database for Taller (${name})`,
  },
});

// PLA-I2-5: the default; a project's test copy sits on its own working branch, startBranchOf(p.settings).
export const BRANCH = DEFAULT_START_BRANCH;
export const IDLE_MS = 20 * 60_000; // nobody looked at the floor for this long: the copy stops
// A first Next.js compile can take a while. PLA-I74-7: a copy's own start waits twice the last check-up's cold start.
const READY_MS: number = DEFAULT_WAITS.ready_ms;
const POLL_MS = 1_000;
const PORT_SPAN = 50; // ports tried from settings.capture.port up
// Plania's own servers and the local databases: never handed to a test copy.
const RESERVED = new Set([3737, 3738, 3791, 3792, 5173, 5432, 5433]);
const SESSION = "plania-prueba";
// PLA-I48-1: the output kept per copy (Bitácora) and the part the Ventana's «Ver detalle» shows.
export const TAIL_LINES = 200;
const DETAIL_LINES = 12;

export type Phase = "starting" | "capturing" | "live" | "failed";
// running: something else serves settings.capture.port. PLA-I2-4: unavailable: this system cannot run a test copy.
export type PruebaPhase = Phase | "off" | "running" | "unavailable";
export type PruebaRead = {
  phase: PruebaPhase;
  managed: boolean; // Plania started it (Apagar works)
  port: number | null;
  url: string | null;
  started_at: string | null;
  error: string | null;
  detail: string | null; // the last lines the start printed, for Ver detalle
  // PLA-I2-4: set when this system cannot take stills (no Chrome); the Ventana says so instead of an error.
  stills?: "unavailable";
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
  // sh -c command (cmd.exe on Windows), detached in its own process group (so the whole tree stops together).
  spawn?: (command: string, opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildLike;
  kill?: (pid: number, signal: NodeJS.Signals) => void; // pid is the group leader: signals -pid (taskkill /T on Windows)
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
  // PLA-I2-9: the running server's checkout (to tell a copy of Plania itself) and how its copy's database is built.
  serverRoot?: string;
  selfDb?: SelfDbBuild;
  // PLA-I72-5: the server's version and program folder, to pick psql and pg_dump of the same major.
  readPg?: (url: string) => Promise<PgReading>;
};

// PLA-I52-2: two lanes per project. «sandbox» is Encenderla's copy (the before, and what the Ventana shows);
// «entrega» is the delivery under review (a PR branch), warm while the owner decides, at most one per project.
// PLA-I72-1: a third kind, one copy per open initiative («iniciativa»), on its integration branch with its own port,
// worktree and base. Several per project; they are kept in maquina_copias so a restart lists them again.
export type Lane = "sandbox" | "entrega" | "iniciativa";
export const idOf = (slug: string, lane: Lane, key?: string | null) => (lane === "sandbox" ? slug : lane === "entrega" ? `${slug}::entrega` : `${slug}::ini::${key}`);
/** The folder and database suffix of an initiative's copy: _ini_<key lowercased, dashes as underscores>. */
export const iniSuffix = (key: string): `_ini_${string}` => `_ini_${key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30)}`;
const folderOf = (c: { lane: Lane; taskKey: string | null }) => (c.lane === "sandbox" ? "_prueba" : c.lane === "entrega" ? "_entrega" : iniSuffix(c.taskKey ?? ""));

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
  // PLA-110 (F-40): the sandbox copy's own Ventana stills on start. El Probador takes its own «antes» photos, so the
  // copy it starts goes live without them (they were minutes of every pass).
  stills: boolean;
  // PLA-110 (F-40): when each start phase ended, for the log line once the copy answers.
  laps: string[];
  // PLA-97: the earlier accepted steps' datos already loaded into this copy (hashes), so a retake loads none twice.
  earlier: Set<string>;
  // PLA-I72-1: «No apagarla sola»: the idle sweep leaves it on.
  keep: boolean;
  // PLA-I72-1: the copy's own database name (when it has one), for Máquinas and Borrar.
  database: string | null;
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
  pgPaths.clear();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

const now = () => (deps.now ?? Date.now)();
const env = () => deps.env ?? process.env;
const git = () => deps.git ?? defaultGit;
const ctx = (): Ctx => ({ actor: { agent: "plania", session_id: SESSION, machine: hostname() }, system: true, tool: "prueba" });

// PLA-I2-19 (audit B5): sh -c on macOS and Linux, cmd.exe on Windows (src/lib/proc-tree.ts); the tree stops together.
const defaultSpawn: NonNullable<PruebaDeps["spawn"]> = (command, { cwd, env: e }) => {
  const sh = shellCommand(command, process.platform, e);
  return nodeSpawn(sh.file, sh.args, { ...sh.options, cwd, env: e, detached: true, stdio: ["ignore", "pipe", "pipe"] });
};
const defaultKill: NonNullable<PruebaDeps["kill"]> = (pid, signal) => killTree(pid, signal);
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

// PLA-I2-4: the read of a part this system cannot run (src/lib/system-support.ts).
const UNAVAILABLE: PruebaRead = { phase: "unavailable", managed: false, port: null, url: null, started_at: null, error: null, detail: null };
const withStills = (r: PruebaRead): PruebaRead => (supported("stills") ? r : { ...r, stills: "unavailable" });

function read(c: Copy): PruebaRead {
  return withStills({
    phase: c.phase,
    managed: c.managed,
    port: c.port,
    url: c.port ? urlOf(c.port) : null,
    started_at: new Date(c.startedAt).toISOString(),
    error: c.error,
    detail: c.tail.length ? c.tail.slice(-DETAIL_LINES).join("\n") : null,
  });
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
  if (!supported("test_copy")) return withStills(UNAVAILABLE);
  const off: PruebaRead = withStills({ phase: "off", managed: false, port: null, url: null, started_at: null, error: null, detail: null });
  if (!settings) return off;
  // PLA-I72-1: one of Plania's own copies (an initiative's) may hold that port: the start copy is still off.
  if ([...copies.values()].some((x) => x.port === settings.port)) return off;
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
export async function encender(db: Db, slug: string, opts: { stills?: boolean } = {}): Promise<PruebaRead> {
  const { p, s } = await settingsOf(db, slug);
  if (!supported("test_copy")) return withStills(UNAVAILABLE);
  const had = copies.get(slug);
  if (had && had.phase !== "failed") return read(had);
  if (had) await apagar(db, slug); // Reintentar after a failed start: clean up first
  const c = newCopy(slug, "sandbox", startBranchOf(p.settings), null, "starting", true);
  // PLA-I2-4: with no Chrome here the copy still starts and goes En vivo; the Ventana says the stills are unavailable.
  c.stills = opts.stills !== false && supported("stills");
  copies.set(c.id, c);
  hook();
  void start(db, c, p, s).catch((e) => fail(db, c, say(PRUEBA_WORDS).noStart(short(e))));
  return read(c);
}

// Error shows only once the process is stopped and its footprint released (a footprint still being written is
// waited for first), so whoever reads «failed» never finds the copy still registered.
function newCopy(slug: string, lane: Lane, ref: string, taskKey: string | null, phase: Phase, managed: boolean, port: number | null = null): Copy {
  return { id: idOf(slug, lane, taskKey), lane, ref, taskKey, slug, phase, managed, port, pid: null, worktree: null, repo: null, command: null, commit: null, startedAt: now(), seenAt: now(), error: null, tail: [], stopping: false, registering: null, dbEnv: null, datos: null, stills: true, laps: [], earlier: new Set(), keep: false, database: null };
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
  const t0 = now();
  const lap = (what: string) => c.laps.push(`${what} ${Math.round((now() - t0) / 1000)}s`);
  const repo = repoPathOf(p.slug, p.settings, env());
  c.repo = repo;
  const w = say(PRUEBA_WORDS);
  if (!existsSync(repo)) return fail(db, c, w.noRepo(p.title, repo));
  const wt = path.join(worktreeRoot(env()), p.slug, folderOf(c));
  const ref = c.ref;
  const what = c.lane === "sandbox" ? w.testCopy : c.lane === "entrega" ? w.deliveryCopy : w.iniCopy;
  if (isInside(wt, repo)) return fail(db, c, w.insideRepo);
  c.worktree = wt;

  // The test copy is origin/sandbox (or the delivery's origin/<branch>), detached. Never main, never a checkout
  // The owner works in.
  if ((await g(["fetch", "origin", ref], repo)).code !== 0) return fail(db, c, w.noFetch(ref));
  if (existsSync(wt)) {
    const dirty = await g(["status", "--porcelain", "--untracked-files=no"], wt);
    if (dirty.code !== 0) return fail(db, c, w.noRead(what.toLowerCase()));
    if (dirty.stdout.trim()) return fail(db, c, w.dirty(what));
    if ((await g(["checkout", "--detach", `origin/${ref}`], wt)).code !== 0) return fail(db, c, w.noCheckout(what.toLowerCase(), ref));
  } else {
    mkdirSync(path.dirname(wt), { recursive: true });
    if ((await g(["worktree", "add", "--detach", wt, `origin/${ref}`], repo)).code !== 0) return fail(db, c, w.noCreate(what.toLowerCase()));
    if (deps.footprints !== false) {
      await registerFootprint(
        db,
        { project: p.slug, kind: "worktree", locator: wt, purpose: c.lane === "sandbox" ? w.worktreeTest(p.title, BRANCH) : c.lane === "entrega" ? w.worktreeDelivery(p.title) : w.worktreeIni(p.title, c.taskKey ?? "", ref), teardown: `git -C ${repo} worktree remove --force ${wt}` },
        ctx(),
      ).catch(() => undefined);
    }
  }
  const head = (await g(["rev-parse", "HEAD"], wt)).stdout.trim();
  c.commit = head || null;
  const want = (await g(["rev-parse", `origin/${ref}`], repo)).stdout.trim();
  const detached = (await g(["rev-parse", "--abbrev-ref", "HEAD"], wt)).stdout.trim();
  if (!head || head !== want || detached !== "HEAD") return fail(db, c, w.notOn(what, ref));
  if (copies.get(c.id) !== c || c.stopping) return;

  lap("git");
  // PLA-38: the app's own env file (untracked, so not in a fresh worktree): its database and keys.
  const envFile = syncEnvFile(repo, wt, p.settings.maquinas);

  // Dependencies, once per lockfile.
  const install = installCommand(wt, s);
  if (install) {
    const mark = path.join(wt, "node_modules", ".plania-prueba");
    const hash = install.hash;
    const had = existsSync(mark) ? readFileSync(mark, "utf8").trim() : null;
    // PLA-I73-4: the project's own checkout with the same lockfile lends its modules as an instant clone.
    if (had !== hash && (await cloneModules(repo, wt, (cmd, o) => (deps.exec ?? shellExec)(cmd, { ...o, env: checkoutEnv() })))) {
      mkdirSync(path.dirname(mark), { recursive: true });
      writeFileSync(mark, hash);
    } else if (had !== hash) {
      const r = await (deps.exec ?? shellExec)(install.command, { cwd: wt, timeoutMs: 600_000, env: checkoutEnv() });
      if (r.code !== 0) {
        c.tail = tailOf(r.stderr || r.stdout);
        return fail(db, c, w.noInstall(install.command));
      }
      mkdirSync(path.dirname(mark), { recursive: true });
      writeFileSync(mark, hash);
    }
  }
  lap("install");
  if (copies.get(c.id) !== c || c.stopping) return;

  // PLA-75: a delivery whose branch changes the database runs on its own copy of the app's database, migrated to
  // the branch. Without it the delivery's pages crashed on the new columns and El Probador photographed the error.
  // PLA-77: the sandbox copy too (<db>_prueba, migrated to sandbox): once a delivery with a migration was merged,
  // the app's own database lagged behind sandbox and «Antes» crashed («Sin antes» on MIA-I9-2).
  // PLA-I2-9: a copy of Plania itself never uses the live database, not even to copy it: a new one, built by the
  // migrate module from the copy's own files, then its env file is rewritten once the port is known.
  const self = isSelfProject(repo, deps.serverRoot ?? serverRoot());
  if (self) {
    const made = await selfCopyDatabase(env().DATABASE_URL, folderOf(c) as CopySuffix, wt, deps.selfDb ?? defaultSelfDbBuild);
    if (!made.ok) return fail(db, c, made.error);
    c.dbEnv = made.env;
    c.database = made.name;
    if (copies.get(c.id) !== c || c.stopping) return;
  } else if (s.database && c.lane === "iniciativa") {
    const made = await iniciativaDatabase(db, c, p.slug, wt, envFile, s.database);
    if (!made.ok) return fail(db, c, made.error);
    if (copies.get(c.id) !== c || c.stopping) return;
  } else if (s.database) {
    const made = await entregaDatabase(db, c, p.slug, wt, envFile, s.database, c.lane === "sandbox" ? "_prueba" : "_entrega");
    if (!made.ok) return fail(db, c, made.error);
    if (copies.get(c.id) !== c || c.stopping) return;
  }

  lap("base");
  // PLA-52: one copy picks at a time, and holds its port before the next one looks: El Probador starts the test copy
  // and the delivery's copy together, and both took the same free port (the second one died at start).
  const picking = portLock.then(async () => {
    const n = await pickPort(db, s.port);
    if (n && copies.get(c.id) === c && !c.stopping) c.port = n;
    return n;
  });
  portLock = picking.catch(() => null);
  const port = await picking;
  if (!port) return fail(db, c, w.noPort(s.port, s.port + PORT_SPAN - 1));
  if (copies.get(c.id) !== c || c.stopping) return;
  if (self) {
    const ready = selfCopyEnvFile(wt, envFile, c.dbEnv ?? {}, port, env());
    if (!ready.ok) return fail(db, c, ready.error);
    c.dbEnv = ready.env;
  }
  const command = s.start_command.replaceAll("{port}", String(port));
  c.command = command;
  let child: ChildLike;
  try {
    child = (deps.spawn ?? defaultSpawn)(command, { cwd: wt, env: checkoutEnv({ PORT: String(port), ...(c.dbEnv ?? {}) }) });
  } catch (e) {
    return fail(db, c, w.noSpawn(short(e)));
  }
  if (!child.pid) return fail(db, c, w.noProcess);
  c.pid = child.pid;
  const keep = (d: unknown) => {
    c.tail = tailOf([...c.tail, ...String(d).split("\n")].join("\n"));
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited: string | null = null;
  child.once("error", (e) => (exited = short(e)));
  child.once("exit", (code, signal) => {
    exited = signal ? w.signal(signal) : w.code(code);
    c.pid = null;
    if (copies.get(c.id) !== c || c.stopping) return;
    void fail(db, c, c.phase === "starting" ? w.closedAtStart(what, exited) : w.wentOff(what, exited));
  });
  if (deps.footprints !== false) {
    c.registering = registerFootprint(
      db,
      {
        project: p.slug,
        kind: "server",
        locator: `port:${port}`,
        purpose: c.lane === "sandbox" ? w.serverTest(p.title, BRANCH) : c.lane === "entrega" ? w.serverDelivery(c.taskKey ?? "", p.title, ref) : w.serverIni(p.title, c.taskKey ?? "", ref),
        teardown: `kill -TERM -${child.pid}`,
        details: { pid: child.pid, pgid: child.pid, server_pid: process.pid, worktree: wt, command, commit: head, branch: ref, lane: c.lane, copy_id: c.id, ...(c.taskKey ? { task_key: c.taskKey } : {}) },
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
  const readyMs = deps.readyMs ?? (await measuredWaits(db, p.slug)).ready_ms;
  const until = now() + readyMs;
  for (;;) {
    if (copies.get(c.id) !== c || c.stopping || exited) return;
    if (await (deps.up ?? defaultUp)(ready)) break;
    if (now() > until) return fail(db, c, w.noAnswer(what, Math.round(readyMs / 1000)));
    await new Promise((r) => setTimeout(r, deps.pollMs ?? POLL_MS));
  }

  lap("responde");
  console.log(`[prueba] ${c.slug} ${c.lane}: ${c.laps.join(", ")}`);
  // The delivery's copy is En vivo as soon as it answers; its stills are the Probador's (PLA-I52-3), not the Ventana's.
  // PLA-110: so is a test copy El Probador started (it takes its own «antes»). PLA-I72-1: an initiative's copy takes none.
  if (c.lane !== "sandbox" || !c.stills) {
    c.phase = "live";
    return;
  }
  // Fresh stills, then En vivo.
  c.phase = "capturing";
  try {
    await (deps.capture ?? runCapture)(db, { project: p.slug, checkout: wt, base_url: urlOf(port), commit: head, branch: c.ref, actor: ctx().actor, env: c.dbEnv ?? {} });
  } catch (e) {
    c.error = say(PRUEBA_WORDS).noStill(short(e));
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
  return { command: c.command, commit: c.commit, branch: c.ref, worktree: c.worktree, started_by: c.managed ? say(PRUEBA_WORDS).startedBy : null };
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
export async function reiniciar(db: Db, slug: string, opts: { stills?: boolean } = {}): Promise<PruebaRead> {
  const { s } = await settingsOf(db, slug);
  if (!supported("test_copy")) return withStills(UNAVAILABLE);
  const c = copies.get(slug);
  const outside = !c && (await pruebaRead(slug, s)).phase === "running";
  if (outside || (c && !c.managed)) throw new ToolError("INVALID_FILTER", { field: "prueba", hint: say(PRUEBA_WORDS).notMine });
  const keep = c?.keep ?? false;
  await apagar(db, slug);
  const r = await encender(db, slug, opts);
  setKeep(slug, "sandbox", null, keep);
  return r;
}

// ---- Volver a tomar (Reintentar on a capture error)

// Takes the stills again from whatever serves the app: Plania's copy when it is on, else settings.capture.port.
export async function tomar(db: Db, slug: string): Promise<PruebaRead> {
  const { p, s } = await settingsOf(db, slug);
  const had = copies.get(slug);
  // PLA-I2-4: nothing to take on a system without Chrome; the read says so.
  if (!supported("stills")) return had ? read(had) : pruebaRead(slug, s);
  if (had && had.phase !== "live") return read(had);
  if (had) {
    had.phase = "capturing";
    had.error = null;
    void (deps.capture ?? runCapture)(db, { project: slug, checkout: had.worktree!, base_url: urlOf(had.port!), branch: had.ref, actor: ctx().actor, env: had.dbEnv ?? {} })
      .catch((e) => (had.error = say(PRUEBA_WORDS).noStill(short(e))))
      .finally(() => {
        if (copies.get(slug) === had && had.phase === "capturing") had.phase = "live";
      });
    return read(had);
  }
  const c = newCopy(slug, "sandbox", startBranchOf(p.settings), null, "capturing", false, s.port);
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
  if (branch === "main" || branch === BRANCH || branch === startBranchOf(p.settings)) throw new ToolError("INVALID_FILTER", { field: "branch", hint: `the delivery's copy runs the PR branch, never ${branch}` });
  if (!supported("test_copy")) return { ...withStills(UNAVAILABLE), key: delivery.key, branch, commit: null, worktree: null };
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
  void start(db, c, p, s).catch((e) => fail(db, c, say(PRUEBA_WORDS).noStart(short(e))));
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

// Turns the copy off (the owner's Apagar, the idle sweep, Reintentar after a failure). The worktree stays for next time.
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
    if (!c.managed || c.keep || now() - c.seenAt < idle) continue;
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
    const declared = (r.details.declared ?? r.details) as { pid?: number; command?: string; server_pid?: number; copy_id?: string };
    if (copies.has(r.project) || copies.has(idOf(r.project, "entrega")) || (declared.copy_id && copies.has(declared.copy_id))) continue;
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

// PLA-I2-19: /proc on Linux, portable ps elsewhere.
const psCommand = (pid: number) => processCommand(pid);

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
export function entregaUrl(base: string, suffix: CopySuffix | "_taller" | "_plantilla" | "_revision" = "_entrega"): { url: string; name: string } | null {
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

// PLA-I2-4: psql and pg_dump are found on macOS and Linux alike (src/lib/pg-bin.ts), PATH included.
export const pgPathOf = (): string => pgSearchPath(checkoutEnv().PATH);

// PLA-I72-5: psql and pg_dump of the server's own major (and its own program folder first). The newest client on the
// Mac dumps settings an older server rejects (pg_dump 17 → «transaction_timeout» on a 14 server), and every copy of a
// project on that server failed to make its base. Cached per host and port; unknown servers fall back to the search.
const pgPaths = new Map<string, string>();
export async function pgPathFor(url: string): Promise<string> {
  let key = url;
  try {
    const u = new URL(url);
    key = `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return pgPathOf();
  }
  const had = pgPaths.get(key);
  if (had) return had;
  const r = await (deps.readPg ?? readPg)(url).catch(() => ({ ok: false }) as PgReading);
  if (!r.ok) return pgPathOf();
  const found = pgSearchPath(checkoutEnv().PATH, { major: Math.floor(r.versionNum / 10000), ...(r.binDir ? { serverBinDir: r.binDir } : {}) });
  pgPaths.set(key, found);
  return found;
}

// PLA-I73-4: <db>_plantilla, a copy of the app's database that no one connects to, so it can be a template. Rebuilt
// when it is older than PLANTILLA_MS or when this server has not built it yet.
const PLANTILLA_MS = 6 * 60 * 60_000;
const plantillas = new Map<string, number>();
export async function plantillaOf(
  exec: (cmd: string, o: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }) => Promise<{ code: number | null; stdout: string; stderr: string }>,
  cwd: string,
  pgPath: string,
  base: string,
  now = Date.now(),
): Promise<string | null> {
  const t = entregaUrl(base, "_plantilla");
  if (!t) return null;
  const built = plantillas.get(t.url);
  if (built && now - built < PLANTILLA_MS) return t.name;
  const cmd = `psql "$PLANIA_BASE_URL" -v ON_ERROR_STOP=1 -q -c 'drop database if exists ${t.name} with (force)' -c 'create database ${t.name}' && pg_dump --no-owner --no-privileges "$PLANIA_BASE_URL" | psql -v ON_ERROR_STOP=1 -q "$PLANIA_TPL_URL"`;
  const r = await exec(cmd, { cwd, timeoutMs: 300_000, env: checkoutEnv({ PATH: pgPath, PLANIA_BASE_URL: base, PLANIA_TPL_URL: t.url }) }).catch(() => null);
  if (!r || r.code !== 0) {
    plantillas.delete(t.url);
    return null;
  }
  plantillas.set(t.url, now);
  return t.name;
}
export const resetPlantillasForTests = (): void => plantillas.clear();

async function entregaDatabase(
  db: Db,
  c: Copy,
  slug: string,
  wt: string,
  envFile: string | null,
  cfg: { env_var: string; migrate_command: string },
  suffix: "_entrega" | "_prueba" = "_entrega",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = say(PRUEBA_WORDS);
  const file = envFile ? path.join(wt, envFile) : null;
  const base = file && existsSync(file) ? envValue(readFileSync(file, "utf8"), cfg.env_var) : null;
  if (!base) return { ok: false, error: w.noVar(cfg.env_var) };
  const target = entregaUrl(base, suffix);
  if (!target) return { ok: false, error: w.notLocal(cfg.env_var) };
  const exec = deps.exec ?? shellExec;
  const pgPath = await pgPathFor(base);
  // The URLs go in the environment, never in the command line.
  const dumpCmd = `psql "$PLANIA_BASE_URL" -v ON_ERROR_STOP=1 -q -c 'drop database if exists ${target.name} with (force)' -c 'create database ${target.name}' && pg_dump --no-owner --no-privileges "$PLANIA_BASE_URL" | psql -v ON_ERROR_STOP=1 -q "$PLANIA_NEW_URL"`;
  // PLA-I73-4: a template of the app's database, refreshed every few hours, makes each copy a file copy
  // (CREATE DATABASE … TEMPLATE) instead of a dump and restore. Any trouble falls back to the dump.
  const tpl = await plantillaOf(exec, wt, pgPath, base);
  const tplCmd = tpl ? `psql "$PLANIA_BASE_URL" -v ON_ERROR_STOP=1 -q -c 'drop database if exists ${target.name} with (force)' -c 'create database ${target.name} template ${tpl}'` : null;
  const env = checkoutEnv({ PATH: pgPath, PLANIA_BASE_URL: base, PLANIA_NEW_URL: target.url });
  let copied = tplCmd ? await exec(tplCmd, { cwd: wt, timeoutMs: 120_000, env }) : null;
  if (!copied || copied.code !== 0) copied = await exec(dumpCmd, { cwd: wt, timeoutMs: 300_000, env });
  if (copied.code !== 0) {
    c.tail = tailOf(copied.stderr || copied.stdout);
    return { ok: false, error: w.noCopyDb(target.name) };
  }
  const migrated = await exec(cfg.migrate_command, { cwd: wt, timeoutMs: 300_000, env: checkoutEnv({ [cfg.env_var]: target.url }) });
  if (migrated.code !== 0) {
    c.tail = tailOf(migrated.stderr || migrated.stdout);
    return { ok: false, error: w.migrateFailed(cfg.migrate_command) };
  }
  c.dbEnv = { [cfg.env_var]: target.url };
  c.database = target.name;
  if (deps.footprints !== false) {
    const u = new URL(target.url);
    await registerFootprint(
      db,
      { project: slug, kind: "database", locator: `${target.name}@${u.hostname || "127.0.0.1"}:${u.port || "5432"}`, purpose: suffix === "_prueba" ? w.dbTest(slug) : w.dbDelivery(slug), teardown: `dropdb --if-exists -h ${u.hostname || "localhost"} -p ${u.port || "5432"} ${target.name}` },
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
    return /^[A-Za-z0-9_]+_(entrega|prueba|ini_[a-z0-9_]+)$/.test(name) ? { url, name } : null;
  } catch {
    return null;
  }
}

/** Loads a muestra's SQL into a live copy's own database, in one transaction. Never the app's own database: a copy
 * without settings.capture.database is refused. Loading the same datos twice is a no-op. */
export async function cargarDatos(slug: string, lane: Lane, sql: string, opts: { bestEffort?: boolean; earlier?: boolean } = {}): Promise<{ ok: true; skipped?: true; partial?: string } | { ok: false; error: string }> {
  const c = copies.get(idOf(slug, lane));
  if (!c || c.phase !== "live") return { ok: false, error: say(PRUEBA_WORDS).copyOff };
  const target = copyDatabase(c.dbEnv);
  if (!target) return { ok: false, error: say(PRUEBA_WORDS).noOwnDb };
  const hash = hashDatos(sql)!;
  // PLA-97 (guided test PLA-86, F-20): an earlier accepted step's rows, after this delivery's own. Statement by
  // statement, so rows the delivery already made are skipped; they never take the copy's own datos slot.
  if (opts.earlier) {
    if (c.earlier.has(hash) || c.datos === hash) return { ok: true, skipped: true };
    const pgPath0 = await pgPathFor(target.url);
    await (deps.exec ?? shellExec)(`psql "$PLANIA_COPY_URL" -X -q -v ON_ERROR_STOP=0 -f -`, {
      cwd: c.worktree ?? process.cwd(),
      stdin: sql,
      timeoutMs: 60_000,
      env: checkoutEnv({ PATH: pgPath0, PLANIA_COPY_URL: target.url }),
    });
    c.earlier.add(hash);
    return { ok: true };
  }
  if (c.datos === hash) return { ok: true, skipped: true };
  if (c.datos) return { ok: false, error: say(PRUEBA_WORDS).otherDatos };
  const exec = deps.exec ?? shellExec;
  const pgPath = await pgPathFor(target.url);
  const r = await exec(`psql "$PLANIA_COPY_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f -`, {
    cwd: c.worktree ?? process.cwd(),
    stdin: sql,
    timeoutMs: 60_000,
    env: checkoutEnv({ PATH: pgPath, PLANIA_COPY_URL: target.url }),
  });
  if (r.code !== 0) {
    const line = (r.stderr || r.stdout).split("\n").map((l) => l.trim()).find((l) => /ERROR/.test(l)) ?? (r.stderr || r.stdout).trim().split("\n")[0] ?? say(PRUEBA_WORDS).code(r.code);
    const error = line.replace(/^psql:[^:]*:\d+:\s*/, "").slice(0, 200);
    if (!opts.bestEffort) return { ok: false, error };
    // PLA-110 (guided test PLA-86, F-42): the «antes» copy runs the code before the change, so rows for the branch's
    // new columns cannot go in. The one transaction rolled back; each statement is tried on its own, and whatever
    // fits the old schema stays, so «antes» shows the same sample where it can.
    await exec(`psql "$PLANIA_COPY_URL" -X -q -v ON_ERROR_STOP=0 -f -`, {
      cwd: c.worktree ?? process.cwd(),
      stdin: sql,
      timeoutMs: 60_000,
      env: checkoutEnv({ PATH: pgPath, PLANIA_COPY_URL: target.url }),
    });
    c.datos = hash;
    return { ok: true, partial: error };
  }
  c.datos = hash;
  return { ok: true };
}

// ---- PLA-I72-1: one copy per open initiative

export type IniRead = PruebaRead & { key: string; branch: string; commit: string | null; worktree: string | null; database: string | null; keep: boolean };

function readIni(c: Copy): IniRead {
  return { ...read(c), key: c.taskKey ?? "", branch: c.ref, commit: c.commit, worktree: c.worktree, database: c.database, keep: c.keep };
}

/** An initiative copy's live read, or null when it is not in memory (off). Reading it counts as somebody looking. */
export function iniRead(slug: string, key: string, look = true): IniRead | null {
  const c = copies.get(idOf(slug, "iniciativa", key));
  if (!c) return null;
  if (look) c.seenAt = now();
  return readIni(c);
}

/** Every initiative copy of a project that is in memory (starting, live or failed). */
export function iniCopies(slug: string): IniRead[] {
  return [...copies.values()].filter((c) => c.slug === slug && c.lane === "iniciativa").map(readIni);
}

/** Where an initiative's copy lives on this machine (whether or not it was ever started). */
export function iniWorktree(slug: string, key: string): string {
  return path.join(worktreeRoot(env()), slug, iniSuffix(key));
}

const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,200}$/;

/** Starts an initiative's copy on its branch, or returns the one already starting or running. keep: no idle stop. */
export async function encenderIni(db: Db, slug: string, ini: { key: string; branch: string; keep?: boolean }): Promise<IniRead> {
  const { p, s } = await settingsOf(db, slug);
  const branch = ini.branch.trim();
  if (!BRANCH_RE.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new ToolError("INVALID_FILTER", { field: "branch", hint: "a plain branch name" });
  const id = idOf(slug, "iniciativa", ini.key);
  if (!supported("test_copy")) return { ...withStills(UNAVAILABLE), key: ini.key, branch, commit: null, worktree: null, database: null, keep: !!ini.keep };
  const had = copies.get(id);
  if (had && had.phase !== "failed") {
    had.seenAt = now();
    if (ini.keep !== undefined) had.keep = ini.keep;
    return readIni(had);
  }
  if (had) await stopId(db, id);
  const c = newCopy(slug, "iniciativa", branch, ini.key, "starting", true);
  c.keep = !!ini.keep;
  copies.set(id, c);
  hook();
  void start(db, c, p, s).catch((e) => fail(db, c, say(PRUEBA_WORDS).noStart(short(e))));
  return readIni(c);
}

export async function apagarIni(db: Db, slug: string, key: string): Promise<PruebaRead> {
  return stopId(db, idOf(slug, "iniciativa", key));
}

/** «No apagarla sola» on a copy in memory (the start copy or an initiative's). Returns whether a copy was there. */
export function setKeep(slug: string, lane: "sandbox" | "iniciativa", key: string | null, keep: boolean): boolean {
  const c = copies.get(idOf(slug, lane, key));
  if (!c) return false;
  c.keep = keep;
  c.seenAt = now();
  return true;
}
export const keepOf = (slug: string): boolean => copies.get(idOf(slug, "sandbox"))?.keep ?? false;

/** The app's base URL a project's copies are made from (the repo's env file), or Plania's own for Plania itself. */
export function appBaseUrl(p: typeof projects.$inferSelect): string | null {
  const repo = repoPathOf(p.slug, p.settings, env());
  if (isSelfProject(repo, deps.serverRoot ?? serverRoot())) return env().DATABASE_URL ?? null;
  // The copies' variable, else the usual database variables (a project whose copies run on the app's own base).
  const cfg = p.settings.capture?.database;
  const vars = cfg ? [cfg.env_var] : ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "PG_URL", "DB_URL"];
  const names = p.settings.maquinas?.env_file ? [p.settings.maquinas.env_file] : ENV_FILES;
  for (const f of names) {
    const full = path.join(repo, f);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    for (const v of vars) {
      const got = envValue(text, v);
      if (got && /^postgres(ql)?:/.test(got)) return got;
    }
  }
  return null;
}

// ---- PLA-158 (F-31): Taller's own database
// During each Taller run the app's own database got the branch's migrations: its tests, or the dev server reading the
// app's env file, used the app's database variable. A project that declares settings.capture.database gets its
// Taller runs pointed at <db>_taller instead, through the run's process environment (it wins over .env files for
// Next.js and dotenv). The base is made once from the app's, as the copies' are, and is not refreshed: Taller's
// own migrations are what it is for. Not for Plania itself, which has its own rules (PLA-I2-9).
export type TallerDb = { ok: true; env: Record<string, string>; name: string } | { ok: false; error: string } | null;
const tallerMaking = new Map<string, Promise<TallerDb>>();

export function tallerDatabase(db: Db, p: typeof projects.$inferSelect): Promise<TallerDb> {
  const cfg = p.settings.capture?.database;
  if (!cfg || isSelfProject(repoPathOf(p.slug, p.settings, env()), deps.serverRoot ?? serverRoot())) return Promise.resolve(null);
  // Two Taller runs starting together make it once.
  const had = tallerMaking.get(p.slug);
  if (had) return had;
  const job = makeTallerDatabase(db, p, cfg.env_var).finally(() => tallerMaking.delete(p.slug));
  tallerMaking.set(p.slug, job);
  return job;
}

async function makeTallerDatabase(db: Db, p: typeof projects.$inferSelect, envVar: string): Promise<TallerDb> {
  const w = say(PRUEBA_WORDS);
  const base = appBaseUrl(p);
  // The app's env file does not name it: there is no app database for the run to reach through it.
  if (!base) return null;
  const target = entregaUrl(base, "_taller");
  if (!target) return { ok: false, error: w.tallerNotLocal(envVar) };
  const exec = deps.exec ?? shellExec;
  const cwd = repoPathOf(p.slug, p.settings, env());
  const pgPath = await pgPathFor(base);
  const pgEnv = (extra: Record<string, string>) => checkoutEnv({ PATH: pgPath, PLANIA_BASE_URL: base, ...extra });
  // The URLs go in the environment, never in the command line.
  const there = await exec(`psql "$PLANIA_BASE_URL" -X -tA -c "select datname from pg_database where datname = '${target.name}'"`, { cwd, timeoutMs: 30_000, env: pgEnv({}) });
  if (there.code !== 0) return { ok: false, error: w.noTallerDb(target.name) };
  if (!there.stdout.split(/\s+/).includes(target.name)) {
    const make = `psql "$PLANIA_BASE_URL" -X -v ON_ERROR_STOP=1 -q -c 'create database ${target.name}' && pg_dump --no-owner --no-privileges "$PLANIA_BASE_URL" | psql -X -v ON_ERROR_STOP=1 -q "$PLANIA_NEW_URL"`;
    const made = await exec(make, { cwd, timeoutMs: 300_000, env: pgEnv({ PLANIA_NEW_URL: target.url }) });
    if (made.code !== 0) {
      // A half copy would be taken as made next time: drop it.
      await exec(`psql "$PLANIA_BASE_URL" -X -q -c 'drop database if exists ${target.name} with (force)'`, { cwd, timeoutMs: 60_000, env: pgEnv({}) });
      return { ok: false, error: w.noTallerDb(target.name) };
    }
    if (deps.footprints !== false) {
      const u = new URL(target.url);
      await registerFootprint(
        db,
        { project: p.slug, kind: "database", locator: `${target.name}@${u.hostname || "127.0.0.1"}:${u.port || "5432"}`, purpose: w.dbTaller(p.slug), teardown: `dropdb --if-exists -h ${u.hostname || "localhost"} -p ${u.port || "5432"} ${target.name}` },
        ctx(),
      ).catch(() => undefined);
    }
  }
  return { ok: true, env: { [envVar]: target.url }, name: target.name };
}

/** Whether a project's copies get bases of their own (settings.capture.database, or Plania itself). */
export function ownBases(p: typeof projects.$inferSelect): boolean {
  return !!p.settings.capture?.database || isSelfProject(repoPathOf(p.slug, p.settings, env()), deps.serverRoot ?? serverRoot());
}

/** The database name an initiative's copy gets, or null when the project has no base of its own for copies. */
export function iniDatabaseName(p: typeof projects.$inferSelect, key: string): string | null {
  if (!ownBases(p)) return null;
  const base = appBaseUrl(p);
  return base ? (entregaUrl(base, iniSuffix(key)) ?? copyDatabaseUrlLoose(base, iniSuffix(key)))?.name ?? null : null;
}
// Plania's own live URL may sit on a non-loopback host name in odd setups; the name alone is still the rule.
function copyDatabaseUrlLoose(base: string, suffix: CopySuffix): { url: string; name: string } | null {
  try {
    const u = new URL(base);
    const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!/^[A-Za-z0-9_]{1,50}$/.test(name)) return null;
    u.pathname = `/${name}${suffix}`;
    return { url: u.toString(), name: `${name}${suffix}` };
  } catch {
    return null;
  }
}

// An initiative copy's base: made once (copied from the start copy's base when it exists, else from the app's own),
// then migrated to the branch on every start. Kept between starts: what the owner tried stays until Borrar la copia.
async function iniciativaDatabase(db: Db, c: Copy, slug: string, wt: string, envFile: string | null, cfg: { env_var: string; migrate_command: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = say(PRUEBA_WORDS);
  const file = envFile ? path.join(wt, envFile) : null;
  const base = file && existsSync(file) ? envValue(readFileSync(file, "utf8"), cfg.env_var) : null;
  if (!base) return { ok: false, error: w.noVar(cfg.env_var) };
  const target = entregaUrl(base, iniSuffix(c.taskKey ?? ""));
  const startDb = entregaUrl(base, "_prueba");
  if (!target || !startDb) return { ok: false, error: w.notLocal(cfg.env_var) };
  // The start copy rebuilds its base while it starts: wait for it, or this copy would take a half-made base.
  const until = now() + (deps.readyMs ?? READY_MS);
  for (let sb = copies.get(idOf(slug, "sandbox")); sb && sb.phase === "starting" && !sb.stopping && now() < until; sb = copies.get(idOf(slug, "sandbox"))) {
    if (copies.get(c.id) !== c || c.stopping) return { ok: true };
    await new Promise((r) => setTimeout(r, deps.pollMs ?? POLL_MS));
  }
  const exec = deps.exec ?? shellExec;
  const pgPath = await pgPathFor(base);
  const pgEnv = (extra: Record<string, string>) => checkoutEnv({ PATH: pgPath, PLANIA_BASE_URL: base, ...extra });
  const there = await exec(`psql "$PLANIA_BASE_URL" -X -tA -c "select datname from pg_database where datname in ('${target.name}', '${startDb.name}')"`, { cwd: wt, timeoutMs: 30_000, env: pgEnv({}) });
  if (there.code !== 0) {
    c.tail = tailOf(there.stderr || there.stdout);
    return { ok: false, error: w.noCopyDb(target.name) };
  }
  const names = new Set(there.stdout.split(/\s+/).filter(Boolean));
  if (!names.has(target.name)) {
    const from = names.has(startDb.name) ? startDb.url : base;
    const make = `psql "$PLANIA_BASE_URL" -X -v ON_ERROR_STOP=1 -q -c 'create database ${target.name}' && pg_dump --no-owner --no-privileges "$PLANIA_FROM_URL" | psql -X -v ON_ERROR_STOP=1 -q "$PLANIA_NEW_URL"`;
    const made = await exec(make, { cwd: wt, timeoutMs: 300_000, env: pgEnv({ PLANIA_FROM_URL: from, PLANIA_NEW_URL: target.url }) });
    if (made.code !== 0) {
      c.tail = tailOf(made.stderr || made.stdout);
      // A half copy would be taken as made next time: drop it.
      await exec(`psql "$PLANIA_BASE_URL" -X -q -c 'drop database if exists ${target.name} with (force)'`, { cwd: wt, timeoutMs: 60_000, env: pgEnv({}) });
      return { ok: false, error: w.noCopyDb(target.name) };
    }
    if (deps.footprints !== false) {
      const u = new URL(target.url);
      await registerFootprint(
        db,
        { project: slug, kind: "database", locator: `${target.name}@${u.hostname || "127.0.0.1"}:${u.port || "5432"}`, purpose: w.dbIni(slug, c.taskKey ?? ""), teardown: `dropdb --if-exists -h ${u.hostname || "localhost"} -p ${u.port || "5432"} ${target.name}` },
        ctx(),
      ).catch(() => undefined);
    }
  }
  const migrated = await exec(cfg.migrate_command, { cwd: wt, timeoutMs: 300_000, env: checkoutEnv({ [cfg.env_var]: target.url }) });
  if (migrated.code !== 0) {
    c.tail = tailOf(migrated.stderr || migrated.stdout);
    return { ok: false, error: w.migrateFailed(cfg.migrate_command) };
  }
  c.dbEnv = { [cfg.env_var]: target.url };
  c.database = target.name;
  return { ok: true };
}

export type BorrarResult = { database: string | null; worktree: string | null; dropped: boolean; removed: boolean };

/** Borrar la copia: stops the initiative's server, drops its base and removes its worktree, releasing their
 * footprints. The caller has already refused the start copy and any protected base name. */
export async function borrarIni(db: Db, slug: string, key: string, names: { database: string | null; worktree: string | null }): Promise<BorrarResult> {
  const { p } = await settingsOf(db, slug);
  await stopId(db, idOf(slug, "iniciativa", key));
  const exec = deps.exec ?? shellExec;
  const repo = repoPathOf(p.slug, p.settings, env());
  const out: BorrarResult = { database: names.database, worktree: names.worktree, dropped: false, removed: false };
  if (names.database) out.dropped = await dropIniBase(db, slug, names.database);
  const wt = names.worktree;
  const root = worktreeRoot(env());
  if (wt && isInside(wt, root) && path.basename(wt) === iniSuffix(key)) {
    if (existsSync(wt) && existsSync(repo)) await git()(["worktree", "remove", "--force", wt], repo);
    if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
    if (existsSync(repo)) await git()(["worktree", "prune"], repo);
    out.removed = !existsSync(wt);
    if (out.removed && deps.footprints !== false) await releaseFootprint(db, { project: slug, kind: "worktree", locator: wt }, ctx()).catch(() => undefined);
  }
  return out;
}

/** PLA-I72-2: what Máquinas' numbers need of a copy in memory (the process, when it started, where, its output). */
export function copyRuntime(id: string): { pid: number | null; started_at: number; worktree: string | null; port: number | null; phase: Phase; tail: string[] } | null {
  const c = copies.get(id);
  return c ? { pid: c.pid, started_at: c.startedAt, worktree: c.worktree, port: c.port, phase: c.phase, tail: c.tail } : null;
}

/** PLA-I72-4: the env a command run in a copy needs to reach that copy's own base (null when it is not in memory). */
export function copyEnvOf(slug: string, key: string | null): Record<string, string> | null {
  const c = copies.get(key ? idOf(slug, "iniciativa", key) : idOf(slug, "sandbox"));
  return c ? (c.dbEnv ?? {}) : null;
}

/** PLA-I72-5: drops one copy base by name (Borrar la copia, Rehacer desde inicio) and releases its footprint. The
 * caller has refused protected names; the next start makes it again from the start copy's base. */
export async function dropIniBase(db: Db, slug: string, name: string): Promise<boolean> {
  const { p } = await settingsOf(db, slug);
  const base = appBaseUrl(p);
  if (!base || !/^[A-Za-z0-9_]{1,90}$/.test(name)) return false;
  const repo = repoPathOf(p.slug, p.settings, env());
  const r = await (deps.exec ?? shellExec)(`psql "$PLANIA_BASE_URL" -X -v ON_ERROR_STOP=1 -q -c 'drop database if exists ${name} with (force)'`, { cwd: existsSync(repo) ? repo : "/", timeoutMs: 120_000, env: checkoutEnv({ PATH: await pgPathFor(base), PLANIA_BASE_URL: base }) });
  if (r.code !== 0) return false;
  if (deps.footprints !== false) {
    // Found by name: the registered locator may spell the host another way (localhost, 127.0.0.1).
    const held = await db
      .select({ locator: footprints.locator })
      .from(footprints)
      .where(and(eq(footprints.projectId, p.id), eq(footprints.kind, "database"), isNull(footprints.releasedAt), sql`split_part(${footprints.locator}, '@', 1) = ${name}`));
    for (const h of held) await releaseFootprint(db, { project: slug, kind: "database", locator: h.locator }, ctx()).catch(() => undefined);
  }
  return true;
}
