// PLA-I2-18: «Ayuda sin tocar su máquina». The help report: one plain-text file the owner of an install makes and
// chooses to send to whoever helps them. Plania sends nothing by itself.
//
// What it holds, field by field (an allow-list: nothing reaches the file that is not named here):
//   Plania's version and commit; the system and Node; the machine check, as item, state and reason codes; whether the
//   database answered; readiness per project, as item ids, states and reason codes; the last failed runs, with the
//   project, role, ticket key, exit code and the one-line reason; the NAMES of the environment variables that are set;
//   the last lines of the server log.
// What it never holds: a value of an environment variable, a token, a password or its hash, repo content, a prompt, a
// ticket's scope, thread text, project settings, folder paths. Every free-text line that is allowed (a failure reason, a
// log line) goes through the redactor (./redact.ts) first.
//
// No network: the machine check runs with programs' --version only (no `gh auth status`, no short `claude -p`), the
// readiness folder check skips `git ls-remote`, and nothing calls fetch. The database named in DATABASE_URL is the
// only connection it opens, and when it does not answer the report says so and carries what it could still read.
// Two readers: GET /api/help-report (src/api/help-report.ts) and `pnpm help:report` (scripts/help-report.ts).
import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { defaultExec, type ExecFn } from "../brief/doctor.js";
import type { Db } from "../db/client.js";
import { agentRuns, projects } from "../db/schema.js";
import { machineCheck as defaultMachineCheck, type MachineCheckDeps, type MachineItem } from "../machine-check/index.js";
import { failureWords } from "../runner/failed.js";
import { projectReadiness, type Readiness, type ReadinessDeps } from "../runner/readiness.js";
import type { GitFn } from "../runner/worktree.js";
import { HIDDEN, makeRedactor, secretValues, type Redactor } from "./redact.js";
import { planiaVersion, type PlaniaVersion } from "./version.js";

export const FAILED_RUNS = 10;
export const LOG_LINES = 40;
const LOG_TAIL_BYTES = 256 * 1024;

export type HelpReport = {
  format: "plania-help-report";
  made_at: string;
  plania: PlaniaVersion;
  system: { platform: string; release: string; arch: string; node: string };
  machine: { id: string; state: string; reason: string; version: string | null }[];
  database: { state: "ok" | "no_url" | "unreachable" };
  projects: { slug: string; blocking: number; items: { id: string; state: string; blocks: boolean; why: string | null }[] }[] | null;
  failed_runs: { at: string | null; project: string; role: string; ticket: string | null; exit_code: number | null; reason: string }[] | null;
  env_names: string[];
  log: { found: boolean; lines: string[] };
};

export type HelpReportDeps = {
  /** Plania's folder: package.json, .env. */
  root?: string;
  env?: NodeJS.ProcessEnv;
  /** Local programs only. Every call the report makes goes through this. */
  exec?: ExecFn;
  now?: () => Date;
  /** An open database (the server's). */
  db?: Db | null;
  /** Or a way to open one (the command line). Throwing, or a first query that fails, is "unreachable". */
  openDb?: () => Promise<{ db: Db; close: () => Promise<void> }>;
  machineCheck?: (deps: MachineCheckDeps) => Promise<MachineItem[]>;
  readiness?: (db: Db, slug: string, deps: ReadinessDeps) => Promise<Readiness>;
  /** The server log file; null when there is none. Default: PLANIA_LOG_FILE, else the service's log for this system. */
  logFile?: string | null;
  system?: () => HelpReport["system"];
  home?: string;
};

// The variables Plania and its runs read. Names outside these (PATH, HOME…) say nothing useful and are left out.
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const RELEVANT = /^(?:PLANIA_|DATABASE_URL$|MCP_|SESSION_SECRET$|CLAUDE_|ANTHROPIC_|GH_|GITHUB_|VAPID_|PORT$|NODE_ENV$|TZ$)/;

/** The service's log: the launchd agent writes ~/Library/Logs/plania/server.log; on Linux, ~/.local/state/plania. */
export function serverLogPath(env: NodeJS.ProcessEnv, home: string, os: string = platform()): string {
  if (env.PLANIA_LOG_FILE?.trim()) return env.PLANIA_LOG_FILE.trim();
  return os === "darwin" ? path.join(home, "Library", "Logs", "plania", "server.log") : path.join(home, ".local", "state", "plania", "server.log");
}

/** NAME=value pairs of a .env file (comments, blanks and export prefixes skipped; quotes removed). */
export function parseDotEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out.set(m[1]!, v);
  }
  return out;
}

async function tailLines(file: string, n: number): Promise<string[] | null> {
  if (!existsSync(file)) return null;
  try {
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - LOG_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      const lines = buf.toString("utf8").split(/\r?\n/);
      if (start > 0) lines.shift(); // a cut first line
      return lines.filter((l) => l.trim()).slice(-n);
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/**
 * The exec the report hands on: --version, `git rev-parse`, `git remote get-url` run; anything else (a network call
 * such as `gh auth status`, `git ls-remote`, `claude -p`) is refused without starting a program.
 */
export function localOnly(exec: ExecFn): ExecFn {
  return async (cmd, args, opts) => {
    const ok = (args.length === 1 && args[0] === "--version") || (args[0] === "rev-parse") || (args[0] === "remote" && args[1] === "get-url");
    if (!ok) return { code: null, stdout: "", stderr: "not run: the help report runs local programs only" };
    return exec(cmd, args, opts);
  };
}

const REFUSED = -1;

/** Every string inside a JSON value. */
export function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

export async function buildHelpReport(deps: HelpReportDeps = {}): Promise<HelpReport> {
  const env = deps.env ?? process.env;
  const root = deps.root ?? process.cwd();
  const home = deps.home ?? env.HOME ?? homedir();
  const exec = localOnly(deps.exec ?? defaultExec);
  const now = deps.now ?? (() => new Date());

  // The secrets known by value: everything in the process environment and in .env.
  let dotenv = new Map<string, string>();
  try {
    dotenv = parseDotEnv(await readFile(path.join(root, ".env"), "utf8"));
  } catch {
    dotenv = new Map();
  }
  const known = secretValues(env as Record<string, string | undefined>, [...dotenv.values()]);
  let redact: Redactor = makeRedactor(known);

  const plania = await planiaVersion(root, exec, env);
  const system = deps.system?.() ?? { platform: platform(), release: release(), arch: arch(), node: process.versions.node };

  // The machine check without the two items that need the network: they are reported as not checked.
  const items = await (deps.machineCheck ?? defaultMachineCheck)({
    env,
    exec,
    claudeDryRun: async () => ({ state: "no_result" as const }),
  });
  const machine = items.map((i) => {
    const offline = i.id === "claude_session" || (i.id === "gh" && i.reason !== "absent");
    // The version is the only part of the sentence kept: the sentence itself is not.
    const version = /\d+\.\d+(?:\.\d+)?/.exec(i.sentence)?.[0] ?? null;
    return { id: i.id, state: offline ? "not_checked" : i.state, reason: offline ? "not_checked" : i.reason, version: version && /^[0-9.]{1,20}$/.test(version) ? version : null };
  });

  // The database: the server's, or one opened here. Nothing else below runs without it.
  let database: HelpReport["database"] = { state: "ok" };
  let db: Db | null = deps.db ?? null;
  let close: (() => Promise<void>) | null = null;
  if (!db) {
    if (!env.DATABASE_URL?.trim() || !deps.openDb) database = { state: env.DATABASE_URL?.trim() ? "unreachable" : "no_url" };
    else {
      try {
        const opened = await deps.openDb();
        db = opened.db;
        close = opened.close;
      } catch {
        database = { state: "unreachable" };
      }
    }
  }
  let projectRows: HelpReport["projects"] = null;
  let failedRuns: HelpReport["failed_runs"] = null;
  try {
    if (db) {
      try {
        await db.execute(sql`select 1`);
      } catch {
        database = { state: "unreachable" };
        db = null;
      }
    }
    if (db) {
      // Every text in the projects' settings is taken as a secret too (a test login, a folder): a failure line or a
      // log line that repeats one hides it.
      const settings = await db.select({ settings: projects.settings }).from(projects);
      redact = makeRedactor([...known, ...secretValues(settings.flatMap((p) => stringLeaves(p.settings)))].sort((a, b) => b.length - a.length));
      const git: GitFn = async (args, cwd) => {
        const r = await exec("git", args, { env, cwd, timeoutMs: 20_000 });
        return { code: r.code ?? REFUSED, stdout: r.stdout, stderr: r.stderr };
      };
      const slugs = await db.select({ slug: projects.slug }).from(projects).orderBy(projects.slug);
      projectRows = [];
      for (const { slug } of slugs) {
        try {
          const r = await (deps.readiness ?? projectReadiness)(db, slug, { env, repoCheck: { git, isDir: (p) => existsSync(p) } });
          projectRows.push({
            slug: r.slug,
            // The origin's branch needs the network: not checked here, so it does not count as missing.
            blocking: r.items.filter((x) => x.state === "missing" && x.blocks && x.why !== "REPO_ORIGIN_UNREACHABLE").length,
            items: r.items.map((x) =>
              x.why === "REPO_ORIGIN_UNREACHABLE" ? { id: x.id, state: "not_checked", blocks: false, why: "origin_not_checked" } : { id: x.id, state: x.state, blocks: x.blocks, why: x.why ?? null },
            ),
          });
        } catch {
          projectRows.push({ slug, blocking: 0, items: [] });
        }
      }
      const runs = await db
        .select({ endedAt: agentRuns.endedAt, queuedAt: agentRuns.queuedAt, slug: projects.slug, role: agentRuns.role, taskKey: agentRuns.taskKey, exitCode: agentRuns.exitCode, summary: agentRuns.summary })
        .from(agentRuns)
        .innerJoin(projects, eq(projects.id, agentRuns.projectId))
        .where(eq(agentRuns.status, "fail"))
        .orderBy(desc(sql`coalesce(${agentRuns.endedAt}, ${agentRuns.queuedAt})`))
        .limit(FAILED_RUNS);
      failedRuns = runs.map((r) => ({
        at: (r.endedAt ?? r.queuedAt)?.toISOString() ?? null,
        project: r.slug,
        role: redact(r.role),
        ticket: r.taskKey && /^[A-Z0-9-]{1,40}$/.test(r.taskKey) ? r.taskKey : null,
        exit_code: r.exitCode,
        reason: redact(failureWords(r.summary.split(/\r?\n/)[0] ?? "")).slice(0, 200),
      }));
    }
  } catch {
    database = { state: "unreachable" };
  } finally {
    await close?.().catch(() => undefined);
  }

  const names = new Set<string>();
  for (const [k, v] of Object.entries(env)) if (v?.trim() && RELEVANT.test(k) && ENV_NAME.test(k)) names.add(k);
  for (const [k, v] of dotenv) if (v.trim() && ENV_NAME.test(k)) names.add(k);

  const logFile = deps.logFile === undefined ? serverLogPath(env, home) : deps.logFile;
  const tail = logFile ? await tailLines(logFile, LOG_LINES) : null;

  return {
    format: "plania-help-report",
    made_at: now().toISOString(),
    plania,
    system: { platform: redact(system.platform), release: redact(system.release), arch: redact(system.arch), node: redact(system.node) },
    machine,
    database,
    projects: projectRows,
    failed_runs: failedRuns,
    env_names: [...names].sort(),
    log: { found: tail !== null, lines: (tail ?? []).map(redact) },
  };
}

/** The file the owner sends: plain text, one section per field, the words in Spanish. */
export function renderHelpReport(r: HelpReport): string {
  const out: string[] = [];
  const h = (title: string) => out.push("", `## ${title}`);
  out.push("# Informe de ayuda de Plania", `Hecho: ${r.made_at}`, "Este archivo no lleva contraseñas, claves, valores de variables, código ni textos de tus proyectos.", `Lo oculto aparece como ${HIDDEN}.`);
  h("Plania");
  out.push(`Versión: ${r.plania.version ?? "desconocida"}`, `Commit: ${r.plania.commit ?? "desconocido"}`);
  h("Sistema");
  out.push(`${r.system.platform} ${r.system.release} (${r.system.arch}) · Node ${r.system.node}`);
  h("La máquina");
  for (const m of r.machine) out.push(`${m.id}: ${m.state} (${m.reason})${m.version ? ` · ${m.version}` : ""}`);
  out.push("gh y la sesión de Claude no se revisan aquí: revisarlos usa la red.");
  h("Base de datos");
  out.push({ ok: "Responde.", no_url: "No hay DATABASE_URL.", unreachable: "No responde: lo que sigue sin proyectos ni corridas es lo que se pudo leer sin ella." }[r.database.state]);
  h("Proyectos");
  if (!r.projects) out.push("No se pudo leer (sin base de datos).");
  else if (!r.projects.length) out.push("Ninguno.");
  else
    for (const p of r.projects) {
      out.push(`${p.slug}: ${p.blocking ? `${p.blocking} cosa(s) impiden correr` : "nada impide correr"}`);
      for (const i of p.items) if (i.state !== "ready") out.push(`  ${i.id}: ${i.state}${i.why ? ` (${i.why})` : ""}${i.blocks ? " · impide" : ""}`);
    }
  h(`Últimas corridas que fallaron (hasta ${FAILED_RUNS})`);
  if (!r.failed_runs) out.push("No se pudo leer (sin base de datos).");
  else if (!r.failed_runs.length) out.push("Ninguna.");
  else for (const f of r.failed_runs) out.push(`${f.at ?? "?"} · ${f.project} · ${f.role}${f.ticket ? ` · ${f.ticket}` : ""}${f.exit_code !== null ? ` · salida ${f.exit_code}` : ""} · ${f.reason}`);
  h("Variables definidas (solo nombres)");
  out.push(r.env_names.length ? r.env_names.join(", ") : "Ninguna.");
  h(`Últimas líneas del registro del servidor (hasta ${LOG_LINES})`);
  if (!r.log.found) out.push("No se encontró el registro.");
  else out.push(...r.log.lines);
  return `${out.join("\n")}\n`;
}

export const helpReportFileName = (r: HelpReport): string => `plania-ayuda-${r.made_at.slice(0, 10)}.txt`;
