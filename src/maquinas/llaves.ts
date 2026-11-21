// PLA-I48-3: Llaves. The names a project's app needs (its env example file and the code's process.env reads) and,
// for each, whether the app's env file sets it. Never a value: an empty value counts as missing, and the read
// returns names and flags only (decision 5 of the Plan).
import { chmodSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "../db/client.js";
import { checkoutEnv, shellExec } from "../captures/run.js";
import { defineWords, say } from "../words.js";
import { EXAMPLE_FILES, exampleNames, parseEnv } from "./env.js";
import { MaquinaError } from "./errors.js";
import { appEnvOf, maquinasSettingsOf, mdeps, projectOf } from "./machines.js";

// PLA-I72-4: iniciativas: the initiatives whose branch asks for a key the start copy's does not.
export type Llave = { name: string; set: boolean; from: ("ejemplo" | "código")[]; public: boolean; iniciativas?: string[] };
export type LlavesRead = {
  env_file: string | null;
  where: "prueba" | "repo" | null;
  example_file: string | null;
  llaves: Llave[];
  set: number;
  missing: number;
  // PLA-I72-4: after a save, the running copies that read their keys at start (the screen offers to restart them).
  reiniciar?: { id: string; title: string }[];
};

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
  // PLA-I72-4: each initiative copy's own env example; a name only its branch asks for is marked with it.
  const only = new Map<string, string[]>();
  const { copiasRead } = await import("./copias.js");
  for (const c of (await copiasRead(db, slug, false)).copias) {
    if (c.kind !== "iniciativa" || !c.worktree || !c.made) continue;
    for (const n of exampleNames(c.worktree).names) {
      if (names.has(n)) continue;
      (only.get(n) ?? only.set(n, []).get(n)!).push(c.key!);
    }
  }
  for (const n of only.keys()) names.set(n, new Set(["ejemplo"]));
  const list: Llave[] = [...names.entries()]
    .map(([name, from]) => ({ name, set: (env.values.get(name) ?? "").trim() !== "", from: [...from].sort(), public: /^(NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(name), ...(only.has(name) ? { iniciativas: only.get(name)! } : {}) }))
    .sort((a, b) => Number(a.set) - Number(b.set) || a.name.localeCompare(b.name));
  return { env_file: env.file, where: env.where, example_file: example.file, llaves: list, set: list.filter((l) => l.set).length, missing: list.filter((l) => !l.set).length };
}

// PLA-116: Poner una llave. The owner types one value on the screen; it goes into the env file Llaves reads (test
// copy first, then the repo), or into a new .env.local there. Only a name Llaves lists, one line, never a file git
// tracks. The other lines and comments stay as they were; the file is replaced atomically with mode 0600. The value
// is never returned, logged, put in an event or in an error: the answer is the names-only read again.
export const VALUE_MAX = 8000;
const SAFE_FILE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const BARE = /^[A-Za-z0-9_\-.:/@+=,~%]*$/;

// The value as an env-file line value that parseEnv reads back exactly, or null when no quoting can hold it.
export function quoteEnvValue(value: string): string | null {
  if (BARE.test(value)) return value;
  for (const q of ['"', "'", "`"]) if (!value.includes(q)) return `${q}${value}${q}`;
  return null;
}

// The new text of an env file with name set to value: the first line that sets it is replaced (keeping an export
// prefix), later ones are dropped, else it is appended. Every other line stays byte for byte.
export function withEnvValue(text: string, name: string, value: string): string {
  const quoted = quoteEnvValue(value);
  if (quoted === null) throw new MaquinaError("VALUE_NOT_WRITABLE", "Lleva comillas de los tres tipos; ponla a mano en el archivo.");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const re = new RegExp(`^(\\s*(?:export\\s+)?)${name}\\s*=`);
  let done = false;
  const out: string[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) out.push(line);
    else if (!done) {
      out.push(`${m[1]}${name}=${quoted}`);
      done = true;
    }
  }
  if (!done) {
    while (out.length && out[out.length - 1] === "") out.pop();
    out.push(`${name}=${quoted}`, "");
  } else if (out[out.length - 1] !== "") out.push("");
  return out.join(eol);
}

export async function ponerLlave(db: Db, slug: string, name: unknown, value: unknown): Promise<LlavesRead> {
  const W = say(LLAVE_WORDS);
  const p = await projectOf(db, slug);
  const before = await llaves(db, slug);
  if (typeof name !== "string" || !before.llaves.some((l) => l.name === name)) throw new MaquinaError("KEY_NOT_LISTED", W.notListed);
  if (typeof value !== "string" || !value.trim()) throw new MaquinaError("VALUE_NOT_WRITABLE", W.empty);
  if (/[\r\n\0]/.test(value)) throw new MaquinaError("VALUE_NOT_WRITABLE", W.oneLine);
  if (value.length > VALUE_MAX) throw new MaquinaError("VALUE_NOT_WRITABLE", W.tooLong);
  const { dirs, env } = appEnvOf(p);
  const dir = env.file && env.dir ? env.dir : (dirs.prueba ?? dirs.repo);
  if (!dir) throw new MaquinaError("NO_APP_DIR", W.noDir);
  const file = env.file ?? maquinasSettingsOf(p)?.env_file ?? ".env.local";
  // PLA-I72-4: every copy copies its env file from the repo's at start, so a value saved in the start copy's file
  // also goes into the repo's own (when it is a different folder), or the other copies would never see it.
  const targets = [...new Set([dir, dirs.prueba, dirs.repo].filter((d): d is string => !!d))];
  const plans: { full: string; next: string }[] = [];
  for (const d of targets) {
    const full = path.resolve(d, file);
    if (!SAFE_FILE.test(file) || !full.startsWith(d + path.sep) || EXAMPLE_FILES.includes(path.basename(file))) throw new MaquinaError("ENV_FILE_TRACKED", W.badFile);
    // A tracked env file would put the value in the next commit. Outside a git checkout (no repo), nothing is tracked.
    const git = await (mdeps().exec ?? shellExec)(`git ls-files -- '${file}'`, { cwd: d, timeoutMs: 15_000, env: checkoutEnv() });
    if (git.code === 0 && git.stdout.trim()) throw new MaquinaError("ENV_FILE_TRACKED", W.tracked(file));
    const text = existsSync(full) ? readFileSync(full, "utf8") : "";
    const next = withEnvValue(text, name, value);
    if (parseEnv(next).get(name) !== value) throw new MaquinaError("VALUE_NOT_WRITABLE", W.unreadable);
    plans.push({ full, next });
  }
  for (const { full, next } of plans) {
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.plania-${process.pid}-${Date.now()}`);
    try {
      writeFileSync(tmp, next, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, full);
    } catch {
      rmSync(tmp, { force: true });
      throw new MaquinaError("COMMAND_FAILED", W.writeFailed(file));
    }
  }
  // PLA-I72-4: a copy reads its env file at start (copied from the app's): the ones on now need a restart.
  const { copiasRead } = await import("./copias.js");
  const on = (await copiasRead(db, slug, false)).copias.filter((c) => c.managed && ["live", "capturing", "starting"].includes(c.phase)).map((c) => ({ id: c.id, title: c.title }));
  return { ...(await llaves(db, slug)), reiniciar: on };
}

const LLAVE_WORDS = defineWords({
  es: {
    notListed: "Esa llave no está en la lista de la app.",
    empty: "Escribe un valor.",
    oneLine: "El valor va en una sola línea.",
    tooLong: `El valor pasa de ${VALUE_MAX} caracteres.`,
    noDir: "No encuentro la copia de prueba ni el repositorio en esta máquina.",
    badFile: "Ese archivo no es de valores locales.",
    tracked: (f: string) => `${f} está en git: el valor se subiría con el próximo commit. Sácalo de git primero.`,
    unreadable: "Ese valor no se puede guardar tal cual; ponlo a mano en el archivo.",
    writeFailed: (f: string) => `No pude escribir ${f}.`,
  },
  en: {
    notListed: "That key is not on the app's list.",
    empty: "Type a value.",
    oneLine: "The value goes on one line.",
    tooLong: `The value is over ${VALUE_MAX} characters.`,
    noDir: "Neither the test copy nor the repository is on this machine.",
    badFile: "That file is not for local values.",
    tracked: (f: string) => `${f} is in git: the value would go out with the next commit. Take it out of git first.`,
    unreadable: "That value cannot be saved as it is; put it in the file by hand.",
    writeFailed: (f: string) => `Could not write ${f}.`,
  },
});
