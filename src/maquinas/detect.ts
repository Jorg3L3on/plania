// PLA-I48-1: what a floor can learn from the repo itself when settings are missing: the scripts in package.json,
// the package manager from the lockfile, and where the migrations live. Read-only; a non-Node repo finds nothing
// (the floor then says «Sin configurar» with what is missing, never a guess).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { MaquinasSettings } from "./env.js";

export type Found = {
  manager: "npm" | "pnpm" | "yarn" | null;
  scripts: { name: string; command: string }[];
  dev: string | null; // the command Usar estos comandos would set (with {port})
  port: number | null; // a port the dev script names (-p 3001, --port 3001), else null
  migrate: string | null;
  seed: string | null;
  test: string | null;
  missing: string[]; // what is not there, in Spanish, for Sin configurar
};

function managerOf(dir: string): Found["manager"] {
  if (existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(dir, "package-lock.json")) || existsSync(path.join(dir, "package.json"))) return "npm";
  return null;
}

const run = (m: NonNullable<Found["manager"]>, script: string) => (m === "npm" ? `npm run ${script}` : `${m} ${script}`);

export function findScripts(dir: string | null): Found {
  const none: Found = { manager: null, scripts: [], dev: null, port: null, migrate: null, seed: null, test: null, missing: ["package.json"] };
  if (!dir || !existsSync(path.join(dir, "package.json"))) return none;
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return { ...none, missing: ["un package.json legible"] };
  }
  const m = managerOf(dir) ?? "npm";
  const list = Object.entries(scripts)
    .filter(([, v]) => typeof v === "string")
    .map(([name, command]) => ({ name, command: String(command).slice(0, 300) }));
  const has = (n: string) => list.find((s) => s.name === n);
  const pick = (...names: string[]) => names.map(has).find(Boolean) ?? null;
  const dev = pick("dev", "start:dev", "develop", "start");
  const portM = dev ? /(?:-p|--port)[ =](\d{4,5})\b/.exec(dev.command) : null;
  // npm needs `--` before the script's own flags; pnpm and yarn pass them through.
  const devCmd = dev ? `${run(m, dev.name)}${m === "npm" ? " --" : ""} --port {port}` : null;
  const migrate = pick("db:migrate", "migrate", "db:push");
  const seed = pick("db:seed", "seed");
  const test = pick("test");
  const missing: string[] = [];
  if (!dev) missing.push("un script dev");
  return {
    manager: m,
    scripts: list,
    dev: devCmd,
    port: portM ? Number(portM[1]) : null,
    migrate: migrate ? run(m, migrate.name) : null,
    seed: seed ? run(m, seed.name) : null,
    test: test ? run(m, test.name) : null,
    missing,
  };
}

// The migrations folder: the setting, drizzle.config's `out`, else drizzle/migrations or drizzle with .sql files.
export function migrationsDir(dir: string | null, s?: MaquinasSettings): string | null {
  if (!dir) return null;
  const inside = (p: string) => {
    const full = path.resolve(dir, p);
    return full.startsWith(dir + path.sep) && existsSync(full) ? full : null;
  };
  if (s?.migrations_dir) return inside(s.migrations_dir);
  for (const f of ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"]) {
    const cfg = path.join(dir, f);
    if (!existsSync(cfg)) continue;
    const out = /\bout\s*:\s*["'`]([^"'`]+)["'`]/.exec(readFileSync(cfg, "utf8"))?.[1];
    if (out && inside(out)) return inside(out);
  }
  for (const p of ["drizzle/migrations", "drizzle", "migrations", "db/migrations"]) {
    const full = inside(p);
    if (full && sqlFiles(full).length) return full;
  }
  return null;
}

export function sqlFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
}
