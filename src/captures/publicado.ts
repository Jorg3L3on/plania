// PLA-82 (F-32): after Publicar ships a release that adds database migrations, the app's own local database
// (settings.capture.database: the one the app's env file names, which the test copies are made from) is migrated
// to the released branch, after a backup. In PLA-64 nothing did it: tienda_dev stayed behind main and was migrated
// by hand. Only a local Postgres is ever touched; the migrate command runs in Plania's own checkout of the released
// branch (<worktrees>/<slug>/_publicado), never in a checkout the owner works in. The outcome is an event, and a
// failure is said in the project's thread with the backup's path.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import type { Db } from "../db/client.js";
import type { Project } from "../db/schema.js";
import { writeTx, type Ctx } from "../mcp/tx.js";
import { defaultGit, isInside, repoPathOf, worktreeRoot, type GitFn } from "../runner/worktree.js";
import { postMessage, projectThread } from "../runner/threads.js";
import { entregaUrl, envValue, installCommand, pgPathOf, syncEnvFile } from "./prueba.js";
import { checkoutEnv, shellExec, type Exec } from "./run.js";

export type MigrarDeps = { git?: GitFn; exec?: Exec; env?: NodeJS.ProcessEnv; now?: () => Date; backups?: string };
export type Migrado = { ok: true; db: string; backup: string; migrations: string[] } | { ok: false; error: string; backup: string | null };

const SYSTEM: Ctx = { actor: { agent: "plania", session_id: "plania-publicado", machine: hostname() }, system: true, tool: "release.migrate" };
const tail = (s: string) => s.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? "";

export async function migrarBaseDeLaApp(db: Db, p: Project, into: string, migrations: string[], deps: MigrarDeps = {}): Promise<Migrado> {
  const out = await run(p, into, deps);
  await writeTx(db, p, SYSTEM, async (_tx, emit) => {
    await emit("release.migrated", null, { into, migrations, ...out });
  }).catch(() => undefined);
  if (!out.ok) {
    const cmd = p.settings.capture?.database?.migrate_command ?? "las migraciones";
    const body = `Publiqué ${p.title}, pero no pude migrar la base de la app (${out.error}).${out.backup ? ` Respaldo antes de intentarlo: ${out.backup}.` : ""} Corre ${cmd} en el repo de ${p.title} antes de usar la copia de prueba.`;
    await postMessage(db, { thread: await projectThread(db, p.id), project: p }, { author: { agent: "plania", role: "plania" }, body: body.slice(0, 4000), links: [] }, SYSTEM).catch(() => undefined);
  }
  return out;
}

async function run(p: Project, into: string, deps: MigrarDeps): Promise<Migrado> {
  const cfg = p.settings.capture?.database;
  if (!cfg) return { ok: false, error: "el proyecto no dice cómo migrar su base (settings.capture.database)", backup: null };
  const env = deps.env ?? process.env;
  const g = deps.git ?? defaultGit;
  const exec = deps.exec ?? shellExec;
  const repo = repoPathOf(p.slug, p.settings, env);
  if (!existsSync(repo)) return { ok: false, error: `no encuentro el repo en ${repo}`, backup: null };
  const wt = path.join(worktreeRoot(env), p.slug, "_publicado");
  if (isInside(wt, repo)) return { ok: false, error: "la copia quedaría dentro del repo", backup: null };

  if ((await g(["fetch", "origin", into], repo)).code !== 0) return { ok: false, error: `no se pudo traer ${into} de origin`, backup: null };
  if (existsSync(wt)) {
    const dirty = await g(["status", "--porcelain", "--untracked-files=no"], wt);
    if (dirty.code !== 0 || dirty.stdout.trim()) return { ok: false, error: "la copia de lo publicado tiene cambios; no la toco", backup: null };
    if ((await g(["checkout", "--detach", `origin/${into}`], wt)).code !== 0) return { ok: false, error: `no se pudo poner la copia en ${into}`, backup: null };
  } else {
    mkdirSync(path.dirname(wt), { recursive: true });
    if ((await g(["worktree", "add", "--detach", wt, `origin/${into}`], repo)).code !== 0) return { ok: false, error: "no se pudo crear la copia de lo publicado", backup: null };
  }

  // The app's own database URL, from its env file (copied in, untracked, mode 0600). A local Postgres only.
  const envFile = syncEnvFile(repo, wt, p.settings.maquinas);
  const file = envFile ? path.join(wt, envFile) : null;
  const url = file && existsSync(file) ? envValue(readFileSync(file, "utf8"), cfg.env_var) : null;
  if (!url) return { ok: false, error: `no encuentro ${cfg.env_var} en el archivo de entorno de la app`, backup: null };
  const local = entregaUrl(url);
  if (!local) return { ok: false, error: `${cfg.env_var} no es una base local de Postgres; no la toco`, backup: null };
  const name = local.name.replace(/_entrega$/, "");

  const install = installCommand(wt, p.settings.capture!);
  if (install) {
    const mark = path.join(wt, "node_modules", ".plania-publicado");
    if (!existsSync(mark) || readFileSync(mark, "utf8").trim() !== install.hash) {
      const r = await exec(install.command, { cwd: wt, timeoutMs: 600_000, env: checkoutEnv() });
      if (r.code !== 0) return { ok: false, error: `no se instalaron las dependencias (${install.command}): ${tail(r.stderr || r.stdout)}`, backup: null };
      mkdirSync(path.dirname(mark), { recursive: true });
      writeFileSync(mark, install.hash);
    }
  }

  // Backup first, like the owner's own migrations (~/plania-backups).
  const dir = deps.backups ?? path.join(homedir(), "plania-backups");
  mkdirSync(dir, { recursive: true });
  const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const backup = path.join(dir, `${name}-pre-release-${stamp}.sql.gz`);
  const pgPath = pgPathOf();
  const dumped = await exec(`set -o pipefail; pg_dump --no-owner --no-privileges "$PLANIA_APP_URL" | gzip > "$PLANIA_BACKUP"`, {
    cwd: wt,
    timeoutMs: 300_000,
    env: checkoutEnv({ PATH: pgPath, PLANIA_APP_URL: url, PLANIA_BACKUP: backup }),
  });
  if (dumped.code !== 0) return { ok: false, error: `no se pudo respaldar ${name}: ${tail(dumped.stderr || dumped.stdout)}`, backup: null };

  const migrated = await exec(cfg.migrate_command, { cwd: wt, timeoutMs: 300_000, env: checkoutEnv({ [cfg.env_var]: url }) });
  if (migrated.code !== 0) return { ok: false, error: `${cfg.migrate_command} falló: ${tail(migrated.stderr || migrated.stdout)}`, backup };
  return { ok: true, db: name, backup, migrations: [] };
}
