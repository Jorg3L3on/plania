// PLA-I48 (decision 5 of the Plan): how Plania learns a project's local base address and which variables are set.
// The app's own env file (in the test copy, else in the repo checkout) is read here, inside the Plania process.
// What leaves this module is names, set/missing flags and a connection object kept in memory for one query. No
// value is ever stored, logged, put in an event or returned by a route. Product repos are never written, with one
// exception (PLA-116): the owner's own value for one variable, into the app's untracked env file (llaves.ts).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoPathOf, worktreeRoot } from "../runner/worktree.js";

// The files a Node app reads its env from, most specific first (Next.js, Vite, dotenv).
export const ENV_FILES = [".env.local", ".env.development.local", ".env.development", ".env"];
export const EXAMPLE_FILES = [".env.example", ".env.local.example", ".env.sample", ".env.template"];

export type MaquinasSettings = {
  env_file?: string; // default: the first of ENV_FILES that exists
  migrate?: string; // default: the package.json script named db:migrate / migrate
  seed?: string; // default: db:seed / seed
  migrations_dir?: string; // default: drizzle.config's out, else drizzle/ or drizzle/migrations/
};

// Where the app runs from: the test copy (Plania's worktree of sandbox) when it exists, else the repo checkout.
export function appDirs(slug: string, settings: { local?: { repo_path?: string } } | null, env: NodeJS.ProcessEnv = process.env) {
  const prueba = path.join(worktreeRoot(env), slug, "_prueba");
  const repo = repoPathOf(slug, settings, env);
  return { prueba: existsSync(prueba) ? prueba : null, repo: existsSync(repo) ? repo : null };
}

// dotenv-style parse: KEY=value, export KEY=value, quotes, # comments. Values stay in the returned map only.
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    const q = v[0];
    if ((q === '"' || q === "'" || q === "`") && v.lastIndexOf(q) > 0) v = v.slice(1, v.lastIndexOf(q));
    else v = v.replace(/\s+#.*$/, "").trim();
    out.set(m[1]!, v);
  }
  return out;
}

export type AppEnv = { file: string | null; where: "prueba" | "repo" | null; dir: string | null; values: Map<string, string> };

// The app's env, read now. dir is where the file was found (commands that need it run there).
export function readAppEnv(dirs: { prueba: string | null; repo: string | null }, s?: MaquinasSettings): AppEnv {
  const names = s?.env_file ? [s.env_file] : ENV_FILES;
  for (const where of ["prueba", "repo"] as const) {
    const dir = dirs[where];
    if (!dir) continue;
    for (const f of names) {
      const full = path.join(dir, f);
      if (!full.startsWith(dir + path.sep) || !existsSync(full)) continue;
      try {
        return { file: f, where, dir, values: parseEnv(readFileSync(full, "utf8")) };
      } catch {
        // unreadable: try the next
      }
    }
  }
  return { file: null, where: null, dir: dirs.prueba ?? dirs.repo, values: new Map() };
}

// Names declared in the repo's example file (no values: an example file holds none that matter).
export function exampleNames(dir: string | null): { file: string | null; names: string[] } {
  if (!dir) return { file: null, names: [] };
  for (const f of EXAMPLE_FILES) {
    const full = path.join(dir, f);
    if (!existsSync(full)) continue;
    try {
      return { file: f, names: [...parseEnv(readFileSync(full, "utf8")).keys()] };
    } catch {
      return { file: f, names: [] };
    }
  }
  return { file: null, names: [] };
}

export const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// The database the app points at, parsed in memory. `safe` is what may be shown: host, port and database name.
export type BaseAddress = {
  url: string; // never leaves the Plania process
  host: string;
  port: number;
  database: string;
  safe: { host: string; port: number; database: string };
};

const DB_VARS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "PG_URL", "DB_URL"];

export function baseAddress(env: AppEnv): BaseAddress | null {
  for (const k of DB_VARS) {
    const v = env.values.get(k);
    if (!v) continue;
    try {
      const u = new URL(v);
      if (!/^postgres(ql)?:$/.test(u.protocol)) continue;
      const host = u.hostname.replace(/^\[|\]$/g, "") || "localhost";
      const port = Number(u.port) || 5432;
      const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
      return { url: v, host, port, database, safe: { host, port, database } };
    } catch {
      continue;
    }
  }
  return null;
}

// Every value of Plania's own environment and of the app's env that looks secret, for scrubbing text that leaves
// the process (a log tail, a command's output).
const SECRETISH = /SECRET|TOKEN|PASSWORD|PASS|KEY|DATABASE_URL|_URL$|PRIVATE|CREDENTIAL|AUTH/i;
export function secretValues(...envs: (NodeJS.ProcessEnv | Map<string, string>)[]): string[] {
  const out = new Set<string>();
  for (const e of envs) {
    const entries = e instanceof Map ? [...e.entries()] : Object.entries(e);
    for (const [k, v] of entries) {
      if (!v || v.length < 6 || !SECRETISH.test(k)) continue;
      out.add(v);
      // A URL's password alone, too.
      try {
        const u = new URL(v);
        if (u.password && u.password.length >= 4) out.add(decodeURIComponent(u.password));
      } catch {
        // not a URL
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function scrub(text: string, secrets: string[]): string {
  let t = text;
  for (const s of secrets) if (s) t = t.split(s).join("(oculto)");
  // Any postgres URL with a password left in it.
  return t.replace(/(postgres(?:ql)?:\/\/[^:\s/@]+):[^@\s]+@/g, "$1:(oculto)@");
}
