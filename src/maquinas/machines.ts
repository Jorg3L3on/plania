// PLA-I48-1: the machines of a floor. One read with the test copy's server (src/captures/prueba.ts) and the
// project's local base (the machine job's db_server and database footprints, plus the database the app's env
// names), the scripts found in package.json when the floor has no capture settings yet, and the two writes
// that go with it: Usar estos comandos (settings.capture from the dev script) and the base lever (the brew
// service of that db_server, never Plania's own Postgres). Session cookie only (src/api/maquinas.ts).
import { hostname } from "node:os";
import { createConnection } from "node:net";
import type { Db } from "../db/client.js";
import type { Project } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { readerOf } from "../store/port.js";
import type { Row } from "../store/types.js";
import { MaquinaError } from "./errors.js";
import { setProject } from "../mcp/project.js";
import type { Ctx } from "../mcp/tx.js";
import { primaryPgPort } from "../jobs/machine/infer.js";
import { pruebaInfo, pruebaRead, type PruebaRead } from "../captures/prueba.js";
import { checkoutEnv, shellExec, type Exec } from "../captures/run.js";
import type { CaptureSettings } from "../captures/settings.js";
import { appDirs, baseAddress, LOOPBACK, readAppEnv, type BaseAddress, type MaquinasSettings } from "./env.js";
import { findScripts, type Found } from "./detect.js";

export type MaquinasDeps = {
  exec?: Exec;
  frame?: (url: string) => Promise<boolean>;
  portBusy?: (port: number) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
};
let deps: MaquinasDeps = {};
export function setMaquinasDeps(d: MaquinasDeps): void {
  deps = d;
  frames.clear();
}
export const mdeps = () => deps;
export const menv = () => deps.env ?? process.env;
export const ctx = (): Ctx => ({ actor: { agent: "plania", session_id: "plania-maquinas", machine: hostname() }, system: true, tool: "maquinas" });

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
// Decision 4 of the Plan: the window frames the live app only when the app allows it (no X-Frame-Options, no
// frame-ancestors that leaves Plania out); otherwise it shows the captures.
export function frameAllowed(headers: Headers): boolean {
  if (headers.get("x-frame-options")) return false;
  const fa = /frame-ancestors\s+([^;]+)/i.exec(headers.get("content-security-policy") ?? "")?.[1]?.trim();
  if (!fa) return true;
  return fa.split(/\s+/).some((s) => s === "*" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+|:\*)?$/.test(s));
}
const defaultFrame = async (url: string) => {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1500) });
    return r.status < 400 && frameAllowed(r.headers);
  } catch {
    return false;
  }
};
const frames = new Map<string, { at: number; ok: boolean }>();
async function frameable(url: string | null): Promise<boolean> {
  if (!url) return false;
  const had = frames.get(url);
  if (had && Date.now() - had.at < 60_000) return had.ok;
  const ok = await (deps.frame ?? defaultFrame)(url);
  frames.set(url, { at: Date.now(), ok });
  return ok;
}

const portBusy = (port: number) => (deps.portBusy ?? ((p: number) => knock("127.0.0.1", p)))(port);

export type ProjectRow = Project;
export const maquinasSettingsOf = (p: ProjectRow): MaquinasSettings | undefined => (p.settings as { maquinas?: MaquinasSettings }).maquinas;

export async function projectOf(db: Db, slug: string): Promise<ProjectRow> {
  // A missing slug names no project (the store reads a missing value as "any").
  const p = slug == null ? undefined : await readerOf(db).get("projects", { slug });
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: slug });
  return p;
}

// The app's env and where it runs from, read now (values stay in this process).
export function appEnvOf(p: ProjectRow) {
  const dirs = appDirs(p.slug, p.settings, menv());
  const env = readAppEnv(dirs, maquinasSettingsOf(p));
  return { dirs, env, address: baseAddress(env) };
}

// Plania's own Postgres: the primary port and the port of DATABASE_URL. Never offered a lever, never read.
export function planiaPorts(): Set<number> {
  const out = new Set([primaryPgPort()]);
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    out.add(Number(u.port) || 5432);
  } catch {
    // no URL
  }
  return out;
}

export type BaseRead = {
  state: "on" | "off" | "none"; // none: no database found for this project
  engine: string | null;
  version: string | null;
  host: string | null;
  port: number | null;
  databases: { name: string; size_bytes: number | null; app: boolean }[]; // app: the one the app's env names
  size_bytes: number | null;
  service: string | null; // the brew service that runs this server
  shared_with: string[]; // other floors with a database on this server
  lever: { can: boolean; reason: string | null };
  env_file: string | null; // which file the address came from (name only)
};

type Fp = Row<"footprints">;

export async function baseRead(db: Db, p: ProjectRow, address: BaseAddress | null, envFile: string | null): Promise<BaseRead> {
  const r = readerOf(db);
  const rows: Fp[] = await r.find("footprints", { kind: ["db_server", "database", "service"], releasedAt: null });
  const dbs = rows.filter((r) => r.kind === "database");
  const portOf = (r: Fp) => Number(r.details.port ?? /:(\d+)$/.exec(r.locator)?.[1]);
  const mine = dbs.filter((r) => r.projectId === p.id || (address && String(r.details.name) === address.database && portOf(r) === address.port));
  const port = address?.port ?? (mine[0] ? portOf(mine[0]) : null);
  const none: BaseRead = { state: "none", engine: null, version: null, host: null, port: null, databases: [], size_bytes: null, service: null, shared_with: [], lever: { can: false, reason: "No encuentro una base de datos de este piso" }, env_file: envFile };
  if (!port) return none;
  const host = address?.host ?? "127.0.0.1";
  const server = rows.find((r) => r.kind === "db_server" && r.locator === `postgres:${port}`);
  const onPort = mine.filter((r) => portOf(r) === port);
  const databases = onPort.map((r) => ({ name: String(r.details.name), size_bytes: Number.isFinite(Number(r.details.size_bytes)) ? Number(r.details.size_bytes) : null, app: String(r.details.name) === address?.database }));
  if (address && !databases.some((d) => d.app)) databases.unshift({ name: address.database, size_bytes: null, app: true });
  // The brew service whose data directory this server runs from (postgresql@17 → /opt/homebrew/var/postgresql@17).
  const dataDir = String(server?.details.data_dir ?? "");
  const services = rows.filter((r) => r.kind === "service" && r.locator.startsWith("brew:")).map((r) => r.locator.slice(5));
  const service = (dataDir && services.find((s) => dataDir.split("/").includes(s))) || null;
  const projectIds = [...new Set(dbs.filter((r) => portOf(r) === port && r.projectId && r.projectId !== p.id).map((r) => r.projectId!))];
  const others = projectIds.length ? await r.find("projects", { id: projectIds }) : [];
  const local = LOOPBACK.has(host);
  const on = local ? await portBusy(port) : false;
  const reason = !local
    ? "La base no está en esta Mac"
    : planiaPorts().has(port)
      ? "Es el Postgres de Plania; no se apaga desde un piso"
      : !service
        ? "No es un servicio de brew en esta Mac"
        : null;
  const version = String(onPort[0]?.details.version ?? server?.details.version ?? "") || null;
  const size = databases.reduce<number | null>((a, d) => (d.size_bytes === null ? a : (a ?? 0) + d.size_bytes), null);
  return { state: on ? "on" : "off", engine: "postgres", version, host, port, databases, size_bytes: size, service, shared_with: others.map((o) => o.slug).sort(), lever: { can: !reason, reason }, env_file: envFile };
}

export type MaquinasRead = {
  project: string;
  configured: boolean;
  server: PruebaRead & { command: string | null; commit: string | null; branch: string | null; worktree: string | null; started_by: string | null; frameable: boolean };
  base: BaseRead;
  found: Found | null;
  pages: CaptureSettings["pages"];
  test_user: string | null;
};

export async function maquinasRead(db: Db, slug: string): Promise<MaquinasRead> {
  const p = await projectOf(db, slug);
  const s = p.settings.capture;
  const { dirs, env, address } = appEnvOf(p);
  const prueba = await pruebaRead(slug, s);
  const info = pruebaInfo(slug);
  return {
    project: slug,
    configured: !!s,
    server: {
      ...prueba,
      command: info?.command ?? (s ? s.start_command.replaceAll("{port}", String(prueba.port ?? s.port)) : null),
      commit: info?.commit ?? null,
      branch: info?.branch ?? (s ? "sandbox" : null),
      worktree: info?.worktree ?? null,
      started_by: info?.started_by ?? (prueba.phase === "running" ? "fuera de Plania" : null),
      frameable: prueba.phase === "live" || prueba.phase === "running" ? await frameable(prueba.url) : false,
    },
    base: await baseRead(db, p, address, env.file),
    found: s ? null : findScripts(dirs.prueba ?? dirs.repo),
    pages: s?.pages ?? [],
    test_user: s?.session?.user ?? null,
  };
}

// Usar estos comandos: settings.capture from the dev script found in package.json, one page (/).
export async function configurar(db: Db, slug: string): Promise<MaquinasRead> {
  const p = await projectOf(db, slug);
  if (p.settings.capture) return maquinasRead(db, slug);
  const dirs = appDirs(p.slug, p.settings, menv());
  const found = findScripts(dirs.prueba ?? dirs.repo);
  if (!found.dev) throw new MaquinaError("NOT_CONFIGURED", `no encuentro ${found.missing.join(", ") || "un script dev"}`);
  const capture: CaptureSettings = { start_command: found.dev, port: found.port ?? 3000, pages: [{ key: "inicio", path: "/", label: "Inicio" }] };
  await setProject(db, { project: slug, version: p.version, settings: { capture } }, ctx());
  return maquinasRead(db, slug);
}

// The base lever: brew services start|stop of the server's own service. Refused for a remote base, Plania's own
// Postgres, and a server that is not a brew service on this Mac.
export async function baseLever(db: Db, slug: string, want: "encender" | "apagar"): Promise<BaseRead> {
  const p = await projectOf(db, slug);
  const { env, address } = appEnvOf(p);
  const b = await baseRead(db, p, address, env.file);
  if (b.state === "none" || !b.lever.can || !b.service || !b.port) throw new MaquinaError("BASE_LEVER_REFUSED", b.lever.reason ?? "no hay base");
  if (!/^[a-z0-9@._+-]+$/i.test(b.service)) throw new MaquinaError("BASE_LEVER_REFUSED", "nombre de servicio inválido");
  const r = await (deps.exec ?? shellExec)(`brew services ${want === "encender" ? "start" : "stop"} ${b.service}`, { cwd: "/", timeoutMs: 60_000, env: checkoutEnv() });
  if (r.code !== 0) throw new MaquinaError("COMMAND_FAILED", `brew no pudo ${want === "encender" ? "encenderla" : "apagarla"}`);
  // Wait a little for the port to follow.
  for (let i = 0; i < 20; i++) {
    if ((await portBusy(b.port)) === (want === "encender")) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return baseRead(db, p, address, env.file);
}
