// PLA-I72-2: the numbers of each machine, for Máquinas. One read (GET /:slug/maquinas/numeros) with, per copy, its
// server (CPU % and memory of the process tree Plania started, uptime, the last 28 samples, response time from its
// recent log lines, disk of its folder split into code, dependencies, build cache and log) and its base (size,
// tables, rows, open connections, migrations applied and pending, where it came from); the Mac (free disk and
// memory); and the base engine (version, uptime, connections out of max_connections, this project's bases).
// Sampling runs only while a screen has the door open: each read keeps it open for OPEN_MS, a 5 s tick samples the
// running servers, and once nobody reads the tick stops. Nothing here runs a command otherwise. Every outside call
// (ps, du, SQL, disk, memory, the clock) is injected in tests (setNumerosDeps).
import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync, statfsSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import path from "node:path";
import pg from "pg";
import type { Db } from "../db/client.js";
import { maquinaCopias } from "../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { appBaseUrl, copyRuntime, idOf, pruebaLog } from "../captures/prueba.js";
import { secretValues } from "./env.js";
import { worktreeRoot } from "../runner/worktree.js";
import { copiasRead, START_ID, type CopiaRead } from "./copias.js";
import { MaquinaError } from "./errors.js";
import { appEnvOf, menv, projectOf, type ProjectRow } from "./machines.js";
import { migrationsOf, type Queryable } from "./reader.js";
import { defineWords, say } from "../words.js";

export const NUMEROS_WORDS = defineWords({
  es: { off: "La copia no está encendida", noFolder: "La copia todavía no tiene carpeta en esta Mac" },
  en: { off: "The copy is not on", noFolder: "The copy has no folder on this Mac yet" },
});

export const SAMPLES = 28;
export const TICK_MS = 5_000;
export const OPEN_MS = 15_000; // a read keeps the door counted as open this long
const DU_TTL_MS = 60_000;
// The build cache of a copy: what «Borrar la caché de compilación» removes, and what the disk split counts as cache.
export const CACHE_DIRS = [".next/cache", ".turbo", "node_modules/.cache", "node_modules/.vite"];
const DEPS_DIR = "node_modules";
const LOG_DIRS = ["logs", ".next/trace"];

export type NumerosDeps = {
  ps?: () => Promise<string>; // lines "pid ppid pcpu rss_kb"
  du?: (dir: string) => Promise<number | null>; // bytes
  query?: (url: string, sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  disk?: (dir: string) => { free: number; total: number } | null;
  memory?: () => Promise<{ free: number; total: number } | null>;
  rm?: (dir: string) => void;
  now?: () => number;
  timers?: boolean; // false: no interval (tests call sampleTick)
};
let deps: NumerosDeps = {};
export function setNumerosDeps(d: NumerosDeps): void {
  deps = d;
  resetNumeros();
}
const now = () => (deps.now ?? Date.now)();
/** PLA-I72-3: the same outside reads for Sobrantes (injected in tests through setNumerosDeps). */
export const numerosDeps = () => ({ query: deps.query ?? defaultQuery, ps: deps.ps ?? defaultPs, du: deps.du ?? defaultDu });

// ---- outside reads (defaults)

const run = (file: string, args: string[], timeout = 10_000) =>
  new Promise<string>((resolve) => execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out))));
const defaultPs = () => run("ps", ["-A", "-o", "pid=,ppid=,pcpu=,rss="]);
const defaultDu = async (dir: string) => {
  const out = await run("du", ["-sk", dir], 30_000);
  const kb = Number(out.trim().split(/\s+/)[0]);
  return Number.isFinite(kb) && out ? kb * 1024 : null;
};
const defaultDisk = (dir: string) => {
  try {
    const s = statfsSync(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
};
const defaultQuery = async (url: string, sql: string, params: unknown[] = []) => {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000, statement_timeout: 5_000, application_name: "plania-maquinas-numeros", options: "-c default_transaction_read_only=on" });
  c.on("error", () => undefined);
  try {
    await c.connect();
    return (await c.query(sql, params)).rows as Record<string, unknown>[];
  } finally {
    await c.end().catch(() => undefined);
  }
};

/** macOS: vm_stat's free + inactive + speculative + purgeable pages are what a new process can have. */
export function parseVmStat(text: string): number | null {
  const size = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!size) return null;
  const pages = (name: string) => Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(text)?.[1] ?? 0);
  const free = pages("free") + pages("inactive") + pages("speculative") + pages("purgeable");
  return free ? free * size : null;
}
/** Linux: MemAvailable and MemTotal from /proc/meminfo, in bytes. */
export function parseMeminfo(text: string): { free: number; total: number } | null {
  const kb = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1]);
  const free = kb("MemAvailable");
  const total = kb("MemTotal");
  return free && total ? { free: free * 1024, total: total * 1024 } : null;
}
const defaultMemory = async (): Promise<{ free: number; total: number } | null> => {
  if (process.platform === "darwin") {
    const free = parseVmStat(await run("vm_stat", []));
    return { free: free ?? freemem(), total: totalmem() };
  }
  if (process.platform === "linux") {
    try {
      const { readFileSync } = await import("node:fs");
      return parseMeminfo(readFileSync("/proc/meminfo", "utf8")) ?? { free: freemem(), total: totalmem() };
    } catch {
      return { free: freemem(), total: totalmem() };
    }
  }
  return { free: freemem(), total: totalmem() };
};

// ---- the process tree

type Proc = { pid: number; ppid: number; cpu: number; rss: number };
export function parsePs(text: string): Proc[] {
  const out: Proc[] = [];
  for (const line of text.split("\n")) {
    const [pid, ppid, cpu, rss] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) out.push({ pid: pid!, ppid: ppid!, cpu: Number.isFinite(cpu) ? cpu! : 0, rss: Number.isFinite(rss) ? rss! * 1024 : 0 });
  }
  return out;
}
/** CPU % and memory (bytes) of a process and every descendant. */
export function treeUsage(procs: Proc[], root: number): { cpu: number; rss: number } | null {
  const kids = new Map<number, Proc[]>();
  for (const p of procs) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)!).push(p);
  const top = procs.find((p) => p.pid === root);
  if (!top) return null;
  let cpu = 0;
  let rss = 0;
  const seen = new Set<number>();
  const walk = (p: Proc) => {
    if (seen.has(p.pid)) return;
    seen.add(p.pid);
    cpu += p.cpu;
    rss += p.rss;
    for (const k of kids.get(p.pid) ?? []) walk(k);
  };
  walk(top);
  return { cpu: Math.round(cpu * 10) / 10, rss };
}

/** The average response time (ms) of the request lines in a copy's output (Next.js: «GET / 200 in 123ms»). */
export function responseMs(lines: string[]): number | null {
  const ms: number[] = [];
  for (const l of lines.slice(-60)) {
    const m = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD)\b.*?\b[1-5]\d\d\b.*?\bin\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/.exec(l);
    if (m) ms.push(m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]));
  }
  return ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
}

// ---- sampling while the door is open

const open = new Map<string, number>(); // slug → open until
const samples = new Map<string, { cpu: number[]; mem: number[]; at: number }>(); // copy id → last SAMPLES
const duCache = new Map<string, { at: number; bytes: number | null }>();
let timer: NodeJS.Timeout | null = null;
let ticking = false;

export function resetNumeros(): void {
  open.clear();
  samples.clear();
  duCache.clear();
  if (timer) clearInterval(timer);
  timer = null;
}
export const sampling = (): boolean => [...open.values()].some((u) => u > now());

function markOpen(slug: string): void {
  open.set(slug, now() + OPEN_MS);
  if (!timer && deps.timers !== false) {
    timer = setInterval(() => void sampleTick(), TICK_MS);
    timer.unref?.();
  }
}

// The copies in memory of the open projects that have a process.
async function liveCopyIds(): Promise<{ id: string; pid: number }[]> {
  const out: { id: string; pid: number }[] = [];
  const db = await import("../db/client.js");
  for (const [slug, until] of open) {
    if (until <= now()) continue;
    const ids = await db.withDb(async (d) => {
      const r = await copiasRead(d, slug, false);
      return r.copias.map((c) => copyIdOf(slug, c));
    });
    for (const id of ids) {
      const rt = copyRuntime(id);
      if (rt?.pid) out.push({ id, pid: rt.pid });
    }
  }
  return out;
}

function push(id: string, cpu: number, rss: number): void {
  const s = samples.get(id) ?? { cpu: [], mem: [], at: 0 };
  s.cpu = [...s.cpu, cpu].slice(-SAMPLES);
  s.mem = [...s.mem, rss].slice(-SAMPLES);
  s.at = now();
  samples.set(id, s);
}

/** One sample of every running server of the open projects. Runs nothing when no door is open. */
export async function sampleTick(ids?: { id: string; pid: number }[]): Promise<number> {
  for (const [slug, until] of open) if (until <= now()) open.delete(slug);
  if (!open.size) {
    if (timer) clearInterval(timer);
    timer = null;
    return 0;
  }
  if (ticking) return 0;
  ticking = true;
  try {
    const list = ids ?? (await liveCopyIds());
    if (!list.length) return 0;
    const procs = parsePs(await (deps.ps ?? defaultPs)());
    let n = 0;
    for (const { id, pid } of list) {
      const u = treeUsage(procs, pid);
      if (!u) continue;
      push(id, u.cpu, u.rss);
      n += 1;
    }
    return n;
  } finally {
    ticking = false;
  }
}

async function du(dir: string): Promise<number | null> {
  if (!existsSync(dir)) return 0;
  const had = duCache.get(dir);
  if (had && now() - had.at < DU_TTL_MS) return had.bytes;
  const bytes = await (deps.du ?? defaultDu)(dir);
  duCache.set(dir, { at: now(), bytes });
  return bytes;
}

export type DiskSplit = { total: number | null; code: number | null; deps: number | null; cache: number | null; log: number | null };
async function diskOf(wt: string): Promise<DiskSplit> {
  const total = await du(wt);
  const depsB = await du(path.join(wt, DEPS_DIR));
  let cache = 0;
  for (const d of CACHE_DIRS) cache += (await du(path.join(wt, d))) ?? 0;
  let log = 0;
  for (const d of LOG_DIRS) log += (await du(path.join(wt, d))) ?? 0;
  try {
    for (const f of readdirSync(wt)) if (f.endsWith(".log")) log += statSync(path.join(wt, f)).size;
  } catch {
    // no folder
  }
  // The caches inside node_modules count as cache, not dependencies.
  const inDeps = ((await du(path.join(wt, "node_modules/.cache"))) ?? 0) + ((await du(path.join(wt, "node_modules/.vite"))) ?? 0);
  const depsOnly = depsB === null ? null : Math.max(0, depsB - inDeps);
  const code = total === null ? null : Math.max(0, total - (depsB ?? 0) - (cache - inDeps) - log);
  return { total, code, deps: depsOnly, cache, log };
}

// ---- the read

export type ServerNumbers = {
  on: boolean;
  cpu: number | null; // % of one core
  mem_bytes: number | null;
  uptime_s: number | null;
  response_ms: number | null;
  cpu_samples: number[];
  mem_samples: number[];
  disk: DiskSplit | null;
  // The last request line, or for a copy that did not start its first error line; scrubbed like the log.
  line: string | null;
};
export type BaseNumbers = {
  name: string;
  reachable: boolean;
  size_bytes: number | null;
  tables: number | null;
  rows: number | null;
  connections: number | null;
  migrations: { applied: number; pending: number } | null;
  origin: { from: "app" | "inicio"; at: string | null };
};
export type NumerosRead = {
  at: string;
  sampling: boolean;
  servers: Record<string, ServerNumbers>;
  bases: Record<string, BaseNumbers>;
  mac: { disk_free: number | null; disk_total: number | null; mem_free: number | null; mem_total: number | null };
  engine: { on: boolean; version: string | null; uptime_s: number | null; connections: number | null; max_connections: number | null; project_bases: number | null };
};

export const copyIdOf = (slug: string, c: Pick<CopiaRead, "kind" | "key">) => (c.kind === "inicio" ? idOf(slug, "sandbox") : idOf(slug, "iniciativa", c.key));
const LIVE = new Set(["starting", "capturing", "live"]);

function urlFor(base: string, name: string): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const REQ_LINE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+.*?\b[1-5]\d\d\b/;
const ERR_LINE = /\b(error|missing|exited|fatal|cannot|failed)\b/i;
function lineOf(slug: string, id: string, failed: boolean, secrets: string[]): string | null {
  const lines = pruebaLog(id, secrets);
  if (failed) return lines.find((l) => ERR_LINE.test(l))?.trim().slice(0, 200) ?? null;
  return [...lines].reverse().find((l) => REQ_LINE.test(l))?.trim().slice(0, 200) ?? null;
}

async function serverNumbers(slug: string, c: CopiaRead, secrets: string[]): Promise<ServerNumbers> {
  const id = copyIdOf(slug, c);
  const rt = copyRuntime(id);
  const line = rt ? lineOf(slug, id, c.phase === "failed", secrets) : null;
  const on = !!rt?.pid && LIVE.has(c.phase);
  const wt = c.worktree ?? rt?.worktree ?? null;
  const disk = wt && existsSync(wt) ? await diskOf(wt) : null;
  if (!on) return { on: false, cpu: null, mem_bytes: null, uptime_s: null, response_ms: null, cpu_samples: [], mem_samples: [], disk, line };
  if (!samples.get(id)) await sampleTick([{ id, pid: rt!.pid! }]);
  const s = samples.get(id);
  return {
    on: true,
    cpu: s?.cpu.at(-1) ?? null,
    mem_bytes: s?.mem.at(-1) ?? null,
    uptime_s: Math.max(0, Math.round((now() - rt!.started_at) / 1000)),
    response_ms: responseMs(rt!.tail),
    cpu_samples: s?.cpu ?? [],
    mem_samples: s?.mem ?? [],
    disk,
    line,
  };
}

const BASE_SQL = `select pg_database_size(current_database()) as size,
  (select count(*) from pg_stat_user_tables) as tables,
  (select coalesce(sum(n_live_tup), 0) from pg_stat_user_tables) as rows,
  (select count(*) from pg_stat_activity where datname = current_database()) as connections`;

async function baseNumbers(p: ProjectRow, c: CopiaRead, base: string, createdAt: Date | null): Promise<BaseNumbers> {
  const name = c.database!;
  const q = deps.query ?? defaultQuery;
  const url = urlFor(base, name);
  const origin = { from: (c.kind === "inicio" ? "app" : "inicio") as "app" | "inicio", at: createdAt?.toISOString() ?? null };
  try {
    const [r] = await q(url, BASE_SQL);
    const client: Queryable = { query: async (sql: string, params?: unknown[]) => ({ rows: (await q(url, sql, params)) as any[] }) };
    const m = await migrationsOf(client, p, c.worktree && existsSync(c.worktree) ? c.worktree : null).catch(() => null);
    return { name, reachable: true, size_bytes: num(r?.size), tables: num(r?.tables), rows: num(r?.rows), connections: num(r?.connections), migrations: m && m.table && m.files.length ? { applied: m.applied, pending: m.pending } : null, origin };
  } catch {
    return { name, reachable: false, size_bytes: null, tables: null, rows: null, connections: null, migrations: null, origin };
  }
}

const ENGINE_SQL = `select current_setting('server_version') as version,
  extract(epoch from now() - pg_postmaster_start_time())::bigint as uptime,
  (select count(*) from pg_stat_activity) as connections,
  current_setting('max_connections') as max_connections,
  (select count(*) from pg_database where datname = $1 or datname like $2) as project_bases`;

export async function numerosRead(db: Db, slug: string): Promise<NumerosRead> {
  const p = await projectOf(db, slug);
  markOpen(slug);
  const { copias } = await copiasRead(db, slug, false);
  const rows = await db.select().from(maquinaCopias).where(and(eq(maquinaCopias.projectId, p.id), isNull(maquinaCopias.deletedAt)));
  const created = new Map(rows.map((r) => [r.initiativeKey, r.createdAt]));
  const servers: Record<string, ServerNumbers> = {};
  const bases: Record<string, BaseNumbers> = {};
  const base = appBaseUrl(p);
  const secrets = secretValues(appEnvOf(p).env.values);
  for (const c of copias) {
    if (c.kind === "iniciativa" && !c.worktree) continue; // never made: nothing to count
    servers[c.id] = await serverNumbers(slug, c, secrets);
    if (c.database && base) bases[c.id] = await baseNumbers(p, c, base, c.key ? (created.get(c.key) ?? null) : null);
  }
  const disk = (deps.disk ?? defaultDisk)(existsSync(worktreeRoot(menv())) ? worktreeRoot(menv()) : "/");
  const mem = await (deps.memory ?? defaultMemory)().catch(() => null);
  let engine: NumerosRead["engine"] = { on: false, version: null, uptime_s: null, connections: null, max_connections: null, project_bases: null };
  if (base) {
    const app = decodeURIComponent(new URL(base).pathname.slice(1));
    try {
      const [r] = await (deps.query ?? defaultQuery)(base, ENGINE_SQL, [app, `${app}\\_%`]);
      engine = { on: true, version: r?.version ? String(r.version) : null, uptime_s: num(r?.uptime), connections: num(r?.connections), max_connections: num(r?.max_connections), project_bases: num(r?.project_bases) };
    } catch {
      // off or unreachable
    }
  }
  return {
    at: new Date(now()).toISOString(),
    sampling: sampling(),
    servers,
    bases,
    mac: { disk_free: disk?.free ?? null, disk_total: disk?.total ?? null, mem_free: mem?.free ?? null, mem_total: mem?.total ?? null },
    engine,
  };
}

/** Borrar la caché de compilación: removes the build cache folders of one copy (CACHE_DIRS), nothing else. */
export async function borrarCache(db: Db, slug: string, id: string): Promise<{ removed: string[]; freed_bytes: number }> {
  const { copias } = await copiasRead(db, slug, false);
  const c = copias.find((x) => x.id === id);
  if (!c) throw new MaquinaError("COPY_NOT_FOUND", "No encuentro esa copia");
  const wt = c.worktree ?? (c.id === START_ID ? (copyRuntime(idOf(slug, "sandbox"))?.worktree ?? null) : null);
  if (!wt || !existsSync(wt)) throw new MaquinaError("NO_TEST_COPY", say(NUMEROS_WORDS).noFolder);
  const removed: string[] = [];
  let freed = 0;
  for (const d of CACHE_DIRS) {
    const full = path.join(wt, d);
    if (!full.startsWith(wt + path.sep) || !existsSync(full)) continue;
    freed += (await (deps.du ?? defaultDu)(full)) ?? 0;
    (deps.rm ?? ((x: string) => rmSync(x, { recursive: true, force: true })))(full);
    removed.push(d);
  }
  for (const k of [...duCache.keys()]) if (k.startsWith(wt)) duCache.delete(k);
  return { removed, freed_bytes: freed };
}
