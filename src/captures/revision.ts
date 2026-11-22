// PLA-I74-6: «Revisar proyecto», the check-up on a fresh copy. A project was called ready after its settings were
// read; the run then hit installed packages from the wrong tool, a cold start slower than the login wait, QA lane
// timeouts, an unseen deploy and an expired host login. Ready now means rehearsed: eight steps, each with a result
// (ok, fallo, aviso, omitido), a measured time and, on a failure, the last lines it printed.
//   1 instalar   a fresh worktree of the start branch; packages installed with the tool the lockfile names (the
//                checkout's own are lent only when that tool installed them and the lockfile is the same)
//   2 comprobar  typecheck, lint and the project's verify list
//   3 build      the production build, with the command the host runs (vercel.json buildCommand, else `run build`)
//   4 base       a throwaway database (<db>_revision), migrated twice from empty, then seeded
//   5 arranque   the copy started on it; its cold start is timed (src/captures/waits.ts reads it, PLA-I74-7)
//   6 foto       the capture user signs in, one photo, and its URL is the page's declared one
//   7 deploy     the last production deploy, read from the host; a missing or refused host token is a fallo
//   8 maquina    gh signed in, free disk, the plan-usage brake
// Each pass is one event (revision.pass) with every step; nothing is migrated. Everything it made (worktree, server,
// database) is registered while it lives and removed at the end. It runs at setup and nightly (src/jobs/revision.ts)
// and from the project's screen. Tests inject every outside call (setRevisionDeps).
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { events, projects, type Project } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { registerFootprint, releaseFootprint } from "../mcp/footprint.js";
import type { Ctx } from "../mcp/tx.js";
import { cloneModules, installedBy, lockTool } from "../lib/clone-modules.js";
import { killTree, shellCommand } from "../lib/proc-tree.js";
import { supported } from "../lib/system-support.js";
import { lastReading, loadSettings, planView, type PlanView } from "../runner/limits.js";
import { startBranchOf } from "../runner/start-branch.js";
import { runVerifyList, tailOf as verifyTail, type VerifyItem } from "../runner/verify.js";
import { defaultGit, repoPathOf, worktreeRoot, type GitFn } from "../runner/worktree.js";
import { isSelfProject, serverRoot } from "../self/plania-self.js";
import { defineWords, say } from "../words.js";
import { entregaUrl, envValue, installCommand, pgPathFor, pickPort, syncEnvFile } from "./prueba.js";
import { checkoutEnv, photoCheck, shellExec, type Exec, type PhotoCheck } from "./run.js";
import type { CaptureSettings } from "./settings.js";
import { measuredWaits, REVISION_EVENT, type Waits } from "./waits.js";

export const REVISION_WORDS = defineWords({
  es: {
    noRepo: (repo: string) => `No encuentro el repo en ${repo}`,
    noFetch: (ref: string) => `No se pudo traer ${ref} de origin`,
    noCopy: "No se pudo crear la copia limpia",
    notNode: "No es un proyecto de Node: no hay nada que instalar",
    cloned: (tool: string) => `Paquetes copiados de tu checkout (los instaló ${tool}, el mismo lockfile)`,
    installed: (cmd: string) => `Instalado con ${cmd}`,
    mixed: (had: string, tool: string) => `Tu checkout tiene paquetes de ${had} pero el lockfile es de ${tool}: no se copiaron`,
    noInstall: (cmd: string) => `No se pudo instalar (${cmd})`,
    afterInstall: "No se hizo: la instalación falló",
    noChecks: "El proyecto no tiene typecheck, lint ni comprobaciones",
    checksOk: (names: string) => `Pasaron: ${names}`,
    checkFailed: (name: string) => `Falló ${name}`,
    noBuild: "El proyecto no tiene build de producción",
    buildOk: (cmd: string) => `El build de producción pasó (${cmd})`,
    buildFailed: (cmd: string) => `El build de producción falló (${cmd})`,
    noDb: "La copia no tiene base propia configurada: no se probaron las migraciones",
    noVar: (name: string) => `No encuentro ${name} en el archivo de entorno de la app`,
    notLocal: (name: string) => `${name} no es una base local de Postgres`,
    noCreate: (name: string) => `No se pudo crear la base de prueba ${name}`,
    migrateFailed: (cmd: string) => `Las migraciones fallaron en una base vacía (${cmd})`,
    migrateTwice: (cmd: string) => `Las migraciones fallan si se corren dos veces (${cmd})`,
    seedFailed: (cmd: string) => `La siembra falló (${cmd})`,
    noSeed: "Migraciones bien dos veces; el proyecto no tiene siembra",
    dbOk: (cmd: string) => `Migraciones bien dos veces y siembra bien (${cmd})`,
    self: "Plania se revisa con sus propias pruebas: esta parte no aplica",
    noCapture: "El proyecto no dice cómo arrancar la app",
    noPort: "No hay un puerto libre para la copia",
    noSpawn: (why: string) => `No se pudo arrancar: ${why}`,
    closed: (why: string) => `La copia se cerró al arrancar (${why})`,
    noAnswer: (s: number) => `La copia no respondió en ${s} s`,
    started: (s: number) => `Arrancó en frío en ${s} s`,
    afterStart: "No se hizo: la copia no arrancó",
    photoOk: (url: string) => `Entró y tomó la foto en ${url}`,
    noHost: "Plania no lee el host de este proyecto",
    noToken: (name: string) => `Falta la llave del host (${name})`,
    tokenRefused: (status: number) => `El host rechazó la llave (respondió ${status}): venció o no sirve`,
    hostError: (status: number) => `El host respondió ${status}`,
    hostDown: (why: string) => `No se pudo leer el host: ${why}`,
    noDeploy: "No hay ningún despliegue a producción",
    deployFailed: (sha: string) => `El último despliegue a producción falló (${sha})`,
    deployBuilding: (sha: string) => `Hay un despliegue a producción en curso (${sha})`,
    deployOk: (sha: string, hours: number) => `Último despliegue a producción: ${sha}, ${hours < 1 ? "hace menos de una hora" : hours < 48 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} días`}`,
    ghOk: "GitHub: sesión de gh bien",
    ghBad: "GitHub: la sesión de gh no sirve (gh auth status falló)",
    diskOk: (gb: number) => `Disco: ${gb} GB libres`,
    diskLow: (gb: number) => `Disco: solo ${gb} GB libres`,
    diskUnknown: "Disco: no se pudo leer",
    planOk: "Uso del plan: con margen",
    planWarn: (pct: number | null) => `Uso del plan: cerca del freno${pct == null ? "" : ` (${pct} %)`}`,
    planStopped: "Uso del plan: el freno está puesto; ningún agente arranca",
    planUnknown: "Uso del plan: sin lectura reciente",
    failed: (why: string) => `La revisión falló: ${why}`,
    dbPurpose: (title: string) => `Base de la revisión de ${title} (vacía, migrada dos veces y sembrada); se borra al terminar`,
    serverPurpose: (title: string) => `Copia de la revisión de ${title}; se apaga al terminar`,
    noProcess: "sin proceso",
    signal: (sig: string) => `señal ${sig}`,
    code: (code: number | null) => `código ${code}`,
  },
  en: {
    noRepo: (repo: string) => `I can't find the repo at ${repo}`,
    noFetch: (ref: string) => `Could not fetch ${ref} from origin`,
    noCopy: "Could not make the clean copy",
    notNode: "Not a Node project: nothing to install",
    cloned: (tool: string) => `Packages copied from your checkout (${tool} installed them, same lockfile)`,
    installed: (cmd: string) => `Installed with ${cmd}`,
    mixed: (had: string, tool: string) => `Your checkout holds ${had} packages but the lockfile is ${tool}'s: not copied`,
    noInstall: (cmd: string) => `Could not install (${cmd})`,
    afterInstall: "Not done: the install failed",
    noChecks: "The project has no typecheck, lint or checks",
    checksOk: (names: string) => `Passed: ${names}`,
    checkFailed: (name: string) => `${name} failed`,
    noBuild: "The project has no production build",
    buildOk: (cmd: string) => `The production build passed (${cmd})`,
    buildFailed: (cmd: string) => `The production build failed (${cmd})`,
    noDb: "The copy has no database of its own configured: migrations not tried",
    noVar: (name: string) => `I can't find ${name} in the app's env file`,
    notLocal: (name: string) => `${name} is not a local Postgres database`,
    noCreate: (name: string) => `Could not create the test database ${name}`,
    migrateFailed: (cmd: string) => `The migrations failed on an empty database (${cmd})`,
    migrateTwice: (cmd: string) => `The migrations fail when run twice (${cmd})`,
    seedFailed: (cmd: string) => `The seed failed (${cmd})`,
    noSeed: "Migrations fine twice; the project has no seed",
    dbOk: (cmd: string) => `Migrations fine twice and the seed fine (${cmd})`,
    self: "Plania checks itself with its own tests: this part does not apply",
    noCapture: "The project does not say how to start the app",
    noPort: "No free port for the copy",
    noSpawn: (why: string) => `Could not start: ${why}`,
    closed: (why: string) => `The copy closed while starting (${why})`,
    noAnswer: (s: number) => `The copy did not answer in ${s} s`,
    started: (s: number) => `Cold start in ${s} s`,
    afterStart: "Not done: the copy did not start",
    photoOk: (url: string) => `Signed in and took the picture at ${url}`,
    noHost: "Plania does not read this project's host",
    noToken: (name: string) => `The host key is missing (${name})`,
    tokenRefused: (status: number) => `The host refused the key (answered ${status}): expired or not valid`,
    hostError: (status: number) => `The host answered ${status}`,
    hostDown: (why: string) => `Could not read the host: ${why}`,
    noDeploy: "There is no production deploy",
    deployFailed: (sha: string) => `The last production deploy failed (${sha})`,
    deployBuilding: (sha: string) => `A production deploy is in progress (${sha})`,
    deployOk: (sha: string, hours: number) => `Last production deploy: ${sha}, ${hours < 1 ? "under an hour ago" : hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`}`,
    ghOk: "GitHub: gh signed in",
    ghBad: "GitHub: the gh session does not work (gh auth status failed)",
    diskOk: (gb: number) => `Disk: ${gb} GB free`,
    diskLow: (gb: number) => `Disk: only ${gb} GB free`,
    diskUnknown: "Disk: could not read",
    planOk: "Plan usage: room to spare",
    planWarn: (pct: number | null) => `Plan usage: close to the brake${pct == null ? "" : ` (${pct} %)`}`,
    planStopped: "Plan usage: the brake is on; no agent starts",
    planUnknown: "Plan usage: no recent reading",
    failed: (why: string) => `The check-up failed: ${why}`,
    dbPurpose: (title: string) => `${title}'s check-up database (empty, migrated twice and seeded); dropped at the end`,
    serverPurpose: (title: string) => `${title}'s check-up copy; turned off at the end`,
    noProcess: "no process",
    signal: (sig: string) => `signal ${sig}`,
    code: (code: number | null) => `code ${code}`,
  },
});

export const STEP_IDS = ["instalar", "comprobar", "build", "base", "arranque", "foto", "deploy", "maquina"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepState = "ok" | "fallo" | "aviso" | "omitido";
export type RevisionStep = { id: StepId; estado: StepState; ms: number; detalle: string | null; tail: string | null };
export type RevisionTrigger = "setup" | "nightly" | "owner";
export type RevisionPass = {
  trigger: RevisionTrigger;
  started_at: string;
  finished_at: string;
  ok: boolean; // no step is a fallo
  branch: string;
  commit: string | null;
  cold_start_ms: number | null;
  steps: RevisionStep[];
};
export type RevisionRunning = { trigger: RevisionTrigger; started_at: string; step: StepId };
export type RevisionRead = { last: RevisionPass | null; running: RevisionRunning | null; waits: Waits; available: boolean };

export type ChildLike = {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
};

export type RevisionDeps = {
  git?: GitFn;
  exec?: Exec;
  spawn?: (command: string, opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildLike;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  up?: (url: string) => Promise<boolean>;
  pickPort?: (db: Db, base: number) => Promise<number | null>;
  photo?: (input: { base_url: string; checkout: string; settings: CaptureSettings; env?: Record<string, string> }) => Promise<PhotoCheck>;
  fetch?: typeof fetch;
  disk?: (dir: string) => Promise<number | null>; // free bytes
  plan?: (db: Db, now: Date) => Promise<PlanView>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  pollMs?: number;
  startMs?: number;
  footprints?: boolean;
  serverRoot?: string;
  pgPathFor?: (url: string) => Promise<string>;
};

let deps: RevisionDeps = {};
export const setRevisionDeps = (d: RevisionDeps): void => {
  deps = d;
};
const running = new Map<string, RevisionRunning>();
export const resetRevision = (): void => running.clear();

const SESSION = "plania-revision";
const ctx = (): Ctx => ({ actor: { agent: "plania", session_id: SESSION, machine: hostname() }, system: true, tool: "revision" });
const env = () => deps.env ?? process.env;
const now = () => (deps.now ?? Date.now)();
const exec = (): Exec => deps.exec ?? shellExec;
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);
const START_MS = 10 * 60_000;
const POLL_MS = 1_000;
const GB = 1024 ** 3;
export const DISK_FAIL_GB = 5;
export const DISK_WARN_GB = 15;
export const FOLDER = "_revision";

const defaultSpawn: NonNullable<RevisionDeps["spawn"]> = (command, { cwd, env: e }) => {
  const sh = shellCommand(command, process.platform, e);
  return nodeSpawn(sh.file, sh.args, { ...sh.options, cwd, env: e, detached: true, stdio: ["ignore", "pipe", "pipe"] });
};
const defaultUp = async (url: string) => {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
    return r.status < 500;
  } catch {
    return false;
  }
};
const defaultDisk = async (dir: string): Promise<number | null> => {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
};
const defaultPlan = async (db: Db, at: Date): Promise<PlanView> => {
  const s = await loadSettings(db);
  return planView(await lastReading(db), s.planGuardPct, at, s.guardOverride);
};

/** The worst of several states: fallo, then aviso, then ok. */
const worst = (states: StepState[]): StepState => (states.includes("fallo") ? "fallo" : states.includes("aviso") ? "aviso" : states.every((s) => s === "omitido") ? "omitido" : "ok");

type PkgJson = { scripts?: Record<string, string>; prisma?: { seed?: string } };
function pkgOf(dir: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as PkgJson;
  } catch {
    return null;
  }
}
const runScript = (tool: string, script: string) => (tool === "npm" ? `npm run ${script}` : `${tool} run ${script}`);

/** Typecheck and lint from package.json (when the verify list does not already run them), then the verify list. */
export function checksOf(p: Pick<Project, "settings">, pkg: PkgJson | null, tool: string): VerifyItem[] {
  const listed = (p.settings?.qa?.verify ?? []) as VerifyItem[];
  const scripts = pkg?.scripts ?? {};
  const extra: VerifyItem[] = [];
  const typecheck = ["typecheck", "type-check", "tsc", "check-types"].find((s) => scripts[s]);
  if (typecheck) extra.push({ name: "typecheck", command: runScript(tool, typecheck) });
  if (scripts.lint) extra.push({ name: "lint", command: runScript(tool, "lint") });
  const has = (item: VerifyItem) => listed.some((l) => l.name === item.name || l.command.includes(item.command.split(" ").pop()!));
  return [...extra.filter((x) => !has(x)), ...listed];
}

/** The build the host runs: vercel.json's buildCommand, else the build script. */
export function buildCommandOf(dir: string, pkg: PkgJson | null, tool: string): string | null {
  try {
    const v = JSON.parse(readFileSync(path.join(dir, "vercel.json"), "utf8")) as { buildCommand?: unknown };
    if (typeof v.buildCommand === "string" && v.buildCommand.trim()) return v.buildCommand.trim();
  } catch {
    // no vercel.json, or not JSON
  }
  return pkg?.scripts?.build ? runScript(tool, "build") : null;
}

/** The seed: db:seed, seed or prisma:seed scripts, else Prisma's own seed. */
export function seedCommandOf(pkg: PkgJson | null, tool: string): string | null {
  const s = ["db:seed", "seed", "prisma:seed"].find((x) => pkg?.scripts?.[x]);
  if (s) return runScript(tool, s);
  return pkg?.prisma?.seed ? "npx prisma db seed" : null;
}

// ---- The pass

export async function revisar(db: Db, slug: string, trigger: RevisionTrigger = "owner"): Promise<RevisionPass> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  if (running.has(slug)) throw new ToolError("INVALID_FILTER", { field: "revision", hint: "a check-up is already running for this project" });
  const started = now();
  const state: RevisionRunning = { trigger, started_at: new Date(started).toISOString(), step: "instalar" };
  running.set(slug, state);
  try {
    return await pass(db, p, trigger, started, state);
  } finally {
    running.delete(slug);
  }
}

/** Starts a pass in the background (the screen's button); false when one is already running. */
export function startRevision(db: Db, slug: string, trigger: RevisionTrigger = "owner"): boolean {
  if (running.has(slug)) return false;
  void revisar(db, slug, trigger).catch((e) => console.log(`[revision] ${slug} failed: ${short(e)}`));
  return true;
}

async function pass(db: Db, p: Project, trigger: RevisionTrigger, started: number, live: RevisionRunning): Promise<RevisionPass> {
  const w = say(REVISION_WORDS);
  const g = deps.git ?? defaultGit;
  const steps: RevisionStep[] = [];
  const s = p.settings.capture;
  const repo = repoPathOf(p.slug, p.settings, env());
  const branch = startBranchOf(p.settings);
  const wt = path.join(worktreeRoot(env()), p.slug, FOLDER);
  const self = isSelfProject(repo, deps.serverRoot ?? serverRoot());
  const fp = deps.footprints !== false;
  let commit: string | null = null;
  let cold: number | null = null;
  let tool = "npm";
  let pkg: PkgJson | null = null;
  let dbEnv: Record<string, string> = {};
  const teardown: (() => Promise<void>)[] = [];

  const step = async (id: StepId, run: () => Promise<Omit<RevisionStep, "id" | "ms">>): Promise<RevisionStep> => {
    live.step = id;
    const t0 = now();
    let out: Omit<RevisionStep, "id" | "ms">;
    try {
      out = await run();
    } catch (e) {
      out = { estado: "fallo", detalle: w.failed(short(e)), tail: null };
    }
    const done = { id, ms: Math.max(0, now() - t0), ...out };
    steps.push(done);
    return done;
  };
  const skip = (detalle: string) => ({ estado: "omitido" as const, detalle, tail: null });
  const tailText = (r: { stdout: string; stderr: string }) => verifyTail(`${r.stdout}\n${r.stderr}`) || null;

  try {
    // 1. A clean copy and its packages.
    const install = await step("instalar", async () => {
      if (!existsSync(repo)) return { estado: "fallo", detalle: w.noRepo(repo), tail: null };
      if ((await g(["fetch", "origin", branch], repo)).code !== 0) return { estado: "fallo", detalle: w.noFetch(branch), tail: null };
      if (existsSync(wt)) {
        await g(["worktree", "remove", "--force", wt], repo);
        if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
        await g(["worktree", "prune"], repo);
      }
      mkdirSync(path.dirname(wt), { recursive: true });
      const made = await g(["worktree", "add", "--detach", wt, `origin/${branch}`], repo);
      if (made.code !== 0) return { estado: "fallo", detalle: w.noCopy, tail: verifyTail(made.stderr) || null };
      teardown.push(async () => {
        await g(["worktree", "remove", "--force", wt], repo).catch(() => null);
        if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
        await g(["worktree", "prune"], repo).catch(() => null);
      });
      commit = (await g(["rev-parse", "HEAD"], wt)).stdout.trim() || null;
      syncEnvFile(repo, wt, p.settings.maquinas);
      pkg = pkgOf(wt);
      const lock = lockTool(wt);
      tool = lock?.tool ?? "npm";
      if (!pkg) return { estado: "ok", detalle: w.notNode, tail: null };
      const cmd = installCommand(wt, s ?? {});
      if (await cloneModules(repo, wt, (c, o) => exec()(c, { ...o, env: checkoutEnv() }))) return { estado: "ok", detalle: w.cloned(tool), tail: null };
      if (!cmd) return { estado: "ok", detalle: w.notNode, tail: null };
      const r = await exec()(cmd.command, { cwd: wt, timeoutMs: 600_000, env: checkoutEnv() });
      if (r.code !== 0) return { estado: "fallo", detalle: w.noInstall(cmd.command), tail: tailText(r) };
      const had = installedBy(repo);
      return { estado: "ok", detalle: had && lock && had !== lock.tool ? `${w.installed(cmd.command)}. ${w.mixed(had, lock.tool)}` : w.installed(cmd.command), tail: null };
    });
    const installed = install.estado === "ok" && !!pkg;

    // 2. Typecheck, lint, the verify list.
    await step("comprobar", async () => {
      if (!installed) return skip(w.afterInstall);
      const items = checksOf(p, pkg, tool);
      if (!items.length) return { estado: "aviso", detalle: w.noChecks, tail: null };
      const out = await runVerifyList(wt, items, exec());
      const bad = out.find((o) => !o.ok);
      if (bad) return { estado: "fallo", detalle: w.checkFailed(bad.name), tail: bad.tail || null };
      return { estado: "ok", detalle: w.checksOk(out.map((o) => o.name).join(", ")), tail: null };
    });

    // 3. The production build, as the host runs it.
    await step("build", async () => {
      if (!installed) return skip(w.afterInstall);
      const cmd = buildCommandOf(wt, pkg, tool);
      if (!cmd) return { estado: "aviso", detalle: w.noBuild, tail: null };
      const r = await exec()(cmd, { cwd: wt, timeoutMs: 15 * 60_000, env: checkoutEnv() });
      return r.code === 0 ? { estado: "ok", detalle: w.buildOk(cmd), tail: null } : { estado: "fallo", detalle: w.buildFailed(cmd), tail: tailText(r) };
    });

    // 4. A throwaway database: migrated twice from empty, then seeded.
    await step("base", async () => {
      if (self) return skip(w.self);
      if (!installed) return skip(w.afterInstall);
      const cfg = s?.database;
      if (!cfg) return { estado: "aviso", detalle: w.noDb, tail: null };
      const file = p.settings.maquinas?.env_file ?? [".env.local", ".env"].find((f) => existsSync(path.join(wt, f)));
      const base = file && existsSync(path.join(wt, file)) ? envValue(readFileSync(path.join(wt, file), "utf8"), cfg.env_var) : null;
      if (!base) return { estado: "fallo", detalle: w.noVar(cfg.env_var), tail: null };
      const target = entregaUrl(base, "_revision");
      if (!target) return { estado: "fallo", detalle: w.notLocal(cfg.env_var), tail: null };
      const pgPath = await (deps.pgPathFor ?? pgPathFor)(base);
      const pgEnv = checkoutEnv({ PATH: pgPath, PLANIA_BASE_URL: base });
      const drop = () => exec()(`psql "$PLANIA_BASE_URL" -X -q -c 'drop database if exists ${target.name} with (force)'`, { cwd: wt, timeoutMs: 60_000, env: pgEnv });
      const made = await exec()(`psql "$PLANIA_BASE_URL" -X -v ON_ERROR_STOP=1 -q -c 'drop database if exists ${target.name} with (force)' -c 'create database ${target.name}'`, { cwd: wt, timeoutMs: 60_000, env: pgEnv });
      if (made.code !== 0) return { estado: "fallo", detalle: w.noCreate(target.name), tail: tailText(made) };
      const u = new URL(target.url);
      const locator = `${target.name}@${u.hostname || "127.0.0.1"}:${u.port || "5432"}`;
      if (fp) await registerFootprint(db, { project: p.slug, kind: "database", locator, purpose: w.dbPurpose(p.title), teardown: `dropdb --if-exists -h ${u.hostname || "localhost"} -p ${u.port || "5432"} ${target.name}` }, ctx()).catch(() => undefined);
      teardown.push(async () => {
        await drop().catch(() => null);
        if (fp) await releaseFootprint(db, { project: p.slug, kind: "database", locator }, ctx()).catch(() => undefined);
      });
      const appEnv = checkoutEnv({ [cfg.env_var]: target.url });
      const first = await exec()(cfg.migrate_command, { cwd: wt, timeoutMs: 300_000, env: appEnv });
      if (first.code !== 0) return { estado: "fallo", detalle: w.migrateFailed(cfg.migrate_command), tail: tailText(first) };
      const second = await exec()(cfg.migrate_command, { cwd: wt, timeoutMs: 300_000, env: appEnv });
      if (second.code !== 0) return { estado: "fallo", detalle: w.migrateTwice(cfg.migrate_command), tail: tailText(second) };
      dbEnv = { [cfg.env_var]: target.url };
      const seed = seedCommandOf(pkg, tool);
      if (!seed) return { estado: "aviso", detalle: w.noSeed, tail: null };
      const seeded = await exec()(seed, { cwd: wt, timeoutMs: 300_000, env: appEnv });
      if (seeded.code !== 0) return { estado: "fallo", detalle: w.seedFailed(seed), tail: tailText(seeded) };
      return { estado: "ok", detalle: w.dbOk(seed), tail: null };
    });

    // 5. Start the copy and time its cold start.
    let base: string | null = null;
    const start = await step("arranque", async () => {
      if (self) return skip(w.self);
      if (!installed) return skip(w.afterInstall);
      if (!s) return { estado: "aviso", detalle: w.noCapture, tail: null };
      const port = await (deps.pickPort ?? pickPort)(db, s.port);
      if (!port) return { estado: "fallo", detalle: w.noPort, tail: null };
      const command = s.start_command.replaceAll("{port}", String(port));
      let child: ChildLike;
      const t0 = now();
      try {
        child = (deps.spawn ?? defaultSpawn)(command, { cwd: wt, env: checkoutEnv({ PORT: String(port), ...dbEnv }) });
      } catch (e) {
        return { estado: "fallo", detalle: w.noSpawn(short(e)), tail: null };
      }
      if (!child.pid) return { estado: "fallo", detalle: w.noSpawn(w.noProcess), tail: null };
      const pid = child.pid;
      let out = "";
      const keep = (d: unknown) => (out = (out + String(d)).slice(-20_000));
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      let exited: string | null = null;
      child.once("error", (e) => (exited = short(e)));
      child.once("exit", (code, signal) => (exited = signal ? w.signal(signal) : w.code(code)));
      const locator = `port:${port}`;
      if (fp) await registerFootprint(db, { project: p.slug, kind: "server", locator, purpose: w.serverPurpose(p.title), teardown: `kill -TERM -${pid}`, details: { pid, pgid: pid, server_pid: process.pid, worktree: wt, command } }, ctx()).catch(() => undefined);
      teardown.unshift(async () => {
        if (!exited) {
          try {
            (deps.kill ?? killTree)(pid, "SIGTERM");
          } catch {
            // already gone
          }
        }
        if (fp) await releaseFootprint(db, { project: p.slug, kind: "server", locator }, ctx()).catch(() => undefined);
      });
      const url = `http://localhost:${port}${s.ready_path ?? "/"}`;
      const limit = deps.startMs ?? START_MS;
      for (;;) {
        if (exited) return { estado: "fallo", detalle: w.closed(exited), tail: verifyTail(out) || null };
        if (await (deps.up ?? defaultUp)(url)) break;
        if (now() - t0 > limit) return { estado: "fallo", detalle: w.noAnswer(Math.round(limit / 1000)), tail: verifyTail(out) || null };
        await new Promise((r) => setTimeout(r, deps.pollMs ?? POLL_MS));
      }
      cold = Math.max(1, now() - t0);
      base = `http://localhost:${port}`;
      return { estado: "ok", detalle: w.started(Math.round(cold / 1000)), tail: null };
    });

    // 6. Sign in, one photo, its URL.
    await step("foto", async () => {
      if (self) return skip(w.self);
      if (start.estado !== "ok" || !base || !s) return skip(start.estado === "aviso" ? (start.detalle ?? w.noCapture) : w.afterStart);
      const r = await (deps.photo ?? ((i) => photoCheck(i)))({ base_url: base, checkout: wt, settings: s, env: dbEnv });
      if (!r.ok) return { estado: "fallo", detalle: r.error, tail: null };
      let at = r.url;
      try {
        const u = new URL(r.url);
        at = u.pathname + u.search;
      } catch {
        // keep it
      }
      return { estado: "ok", detalle: w.photoOk(at), tail: null };
    });
  } finally {
    // Nothing the check-up made outlives it.
    for (const t of teardown) await t().catch(() => undefined);
  }

  // 7. The last production deploy.
  await step("deploy", () => deployStep(p));
  // 8. The machine: gh, disk, the plan brake.
  await step("maquina", async () => {
    const parts: { estado: StepState; text: string }[] = [];
    const gh = await exec()("gh auth status", { cwd: existsSync(repo) ? repo : "/", timeoutMs: 20_000, env: checkoutEnv() }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
    parts.push(gh.code === 0 ? { estado: "ok", text: w.ghOk } : { estado: "fallo", text: w.ghBad });
    const root = worktreeRoot(env());
    const free = await (deps.disk ?? defaultDisk)(existsSync(root) ? root : path.dirname(root));
    if (free == null) parts.push({ estado: "aviso", text: w.diskUnknown });
    else {
      const gb = Math.floor(free / GB);
      parts.push(gb < DISK_FAIL_GB ? { estado: "fallo", text: w.diskLow(gb) } : gb < DISK_WARN_GB ? { estado: "aviso", text: w.diskLow(gb) } : { estado: "ok", text: w.diskOk(gb) });
    }
    const plan = await (deps.plan ?? defaultPlan)(db, new Date(now())).catch(() => null);
    const ps = plan?.state ?? "unknown";
    parts.push(ps === "ok" ? { estado: "ok", text: w.planOk } : ps === "warn" ? { estado: "aviso", text: w.planWarn(plan?.five_hour_pct ?? null) } : ps === "stopped" ? { estado: "fallo", text: w.planStopped } : { estado: "aviso", text: w.planUnknown });
    return { estado: worst(parts.map((x) => x.estado)), detalle: parts.map((x) => x.text).join(" · "), tail: null };
  });

  const out: RevisionPass = {
    trigger,
    started_at: new Date(started).toISOString(),
    finished_at: new Date(now()).toISOString(),
    ok: !steps.some((x) => x.estado === "fallo"),
    branch,
    commit,
    cold_start_ms: cold,
    steps,
  };
  await db.insert(events).values({ projectId: p.id, type: REVISION_EVENT, actor: ctx().actor, payload: out as unknown as Record<string, unknown> });
  console.log(`[revision] ${p.slug}: ${steps.map((x) => `${x.id} ${x.estado} ${Math.round(x.ms / 1000)}s`).join(", ")}`);
  return out;
}

type VercelDeployment = { uid: string; state?: string; readyState?: string; created: number; meta?: { githubCommitSha?: string } };

async function deployStep(p: Project): Promise<Omit<RevisionStep, "id" | "ms">> {
  const w = say(REVISION_WORDS);
  const cfg = p.settings.vercel;
  if (!cfg?.project_id) return { estado: "aviso", detalle: w.noHost, tail: null };
  const name = cfg.token_env ?? "VERCEL_TOKEN";
  const token = env()[name];
  if (!token) return { estado: "fallo", detalle: w.noToken(name), tail: null };
  // The poller (src/jobs/vercel.ts) only keeps READY deployments; one small call reads the newest production one.
  const q = new URLSearchParams({ projectId: cfg.project_id, target: "production", limit: "1" });
  if (cfg.team_id) q.set("teamId", cfg.team_id);
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    return { estado: "fallo", detalle: w.hostDown(short(e)), tail: null };
  }
  if (res.status === 401 || res.status === 403) return { estado: "fallo", detalle: w.tokenRefused(res.status), tail: null };
  if (res.status >= 400) return { estado: "fallo", detalle: w.hostError(res.status), tail: null };
  const body = (await res.json().catch(() => ({}))) as { deployments?: VercelDeployment[] };
  const d = body.deployments?.[0];
  if (!d) return { estado: "aviso", detalle: w.noDeploy, tail: null };
  const sha = (d.meta?.githubCommitSha ?? d.uid).slice(0, 7);
  const st = d.state ?? d.readyState ?? "";
  if (st === "ERROR" || st === "CANCELED") return { estado: "fallo", detalle: w.deployFailed(sha), tail: null };
  if (st !== "READY") return { estado: "aviso", detalle: w.deployBuilding(sha), tail: null };
  return { estado: "ok", detalle: w.deployOk(sha, Math.floor((now() - d.created) / 3_600_000)), tail: null };
}

// ---- The read

export async function lastRevision(db: Db, projectId: string): Promise<RevisionPass | null> {
  const [row] = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.projectId, projectId), eq(events.type, REVISION_EVENT)))
    .orderBy(desc(events.id))
    .limit(1);
  return (row?.payload as RevisionPass | undefined) ?? null;
}

export async function revisionRead(db: Db, slug: string): Promise<RevisionRead> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  const last = await lastRevision(db, p.id);
  return { last, running: running.get(slug) ?? null, waits: await measuredWaits(db, slug), available: supported("test_copy") };
}

export const revisando = (slug: string): boolean => running.has(slug);
