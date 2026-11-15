// PLA-I48-3: Llaves. The names a project's app needs (its env example file and the code's process.env reads) and,
// for each, whether the app's env file sets it. Never a value: an empty value counts as missing, and the read
// returns names and flags only (decision 5 of the Plan).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Db } from "../db/client.js";
import { exampleNames } from "./env.js";
import { appEnvOf, projectOf } from "./machines.js";

export type Llave = { name: string; set: boolean; from: ("ejemplo" | "código")[]; public: boolean };
export type LlavesRead = { env_file: string | null; where: "prueba" | "repo" | null; example_file: string | null; llaves: Llave[]; set: number; missing: number };

const CODE_DIRS = ["src", "app", "lib", "pages", "server", "scripts", "components", "utils"];
const CODE_FILE = /\.(c|m)?(t|j)sx?$/;
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage", ".turbo", ".vercel", "out"]);
const READS = [/process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[\s*["'`]([A-Z_][A-Z0-9_]*)["'`]\s*\]/g, /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g];
// Set by the runtime, not by the app's env file.
const RUNTIME = new Set(["NODE_ENV", "PORT", "CI", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "NEXT_RUNTIME", "HOSTNAME", "TZ", "PWD", "HOME", "PATH", "DEV", "PROD", "MODE", "SSR", "BASE_URL"]);

export function codeNames(root: string | null, maxFiles = 4000): Set<string> {
  const out = new Set<string>();
  if (!root) return out;
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 12 || seen > maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e) || e.startsWith(".")) continue;
      const full = path.join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (CODE_FILE.test(e) && st.size < 512_000 && seen++ < maxFiles) {
        const text = readFileSync(full, "utf8");
        for (const re of READS) for (const m of text.matchAll(re)) out.add(m[1]!);
      }
    }
  };
  for (const d of CODE_DIRS) walk(path.join(root, d), 0);
  // Config files at the root (next.config.ts, drizzle.config.ts…).
  try {
    for (const f of readdirSync(root).filter((f) => /\.config\.(c|m)?(t|j)s$/.test(f))) {
      const text = readFileSync(path.join(root, f), "utf8");
      for (const re of READS) for (const m of text.matchAll(re)) out.add(m[1]!);
    }
  } catch {
    // no root
  }
  for (const r of RUNTIME) out.delete(r);
  return out;
}

export async function llaves(db: Db, slug: string): Promise<LlavesRead> {
  const p = await projectOf(db, slug);
  const { dirs, env } = appEnvOf(p);
  const root = dirs.prueba ?? dirs.repo;
  const example = exampleNames(root);
  const code = codeNames(root);
  const names = new Map<string, Set<"ejemplo" | "código">>();
  for (const n of example.names) names.set(n, new Set(["ejemplo"]));
  for (const n of code) (names.get(n) ?? names.set(n, new Set()).get(n)!).add("código");
  const list: Llave[] = [...names.entries()]
    .map(([name, from]) => ({ name, set: (env.values.get(name) ?? "").trim() !== "", from: [...from].sort(), public: /^(NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(name) }))
    .sort((a, b) => Number(a.set) - Number(b.set) || a.name.localeCompare(b.name));
  return { env_file: env.file, where: env.where, example_file: example.file, llaves: list, set: list.filter((l) => l.set).length, missing: list.filter((l) => !l.set).length };
}
