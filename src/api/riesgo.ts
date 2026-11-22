// PLA-I73-3: one review per module. With settings.velocidad.revision por_modulo, a delivery whose photos and checks
// are green is accepted into the start branch by itself and the owner reviews the whole module once, at Publicar,
// with every step's before and after (the release reel). A step that carries a risk still stops for the owner:
// a migration that removes or rewrites data, login and session code, or payment code.
import type { GitFn } from "../runner/worktree.js";
import { defineWords, say } from "../words.js";

export const RIESGO_WORDS = defineWords({
  es: {
    destructive: (file: string) => `Cambia o borra datos (${file}): revísala tú.`,
    auth: (file: string) => `Toca el acceso o las sesiones (${file}): revísala tú.`,
    money: (file: string) => `Toca pagos o cobros (${file}): revísala tú.`,
    unknown: "No se pudo leer qué cambia: revísala tú.",
  },
  en: {
    destructive: (file: string) => `It changes or deletes data (${file}): review it yourself.`,
    auth: (file: string) => `It touches login or sessions (${file}): review it yourself.`,
    money: (file: string) => `It touches payments (${file}): review it yourself.`,
    unknown: "What it changes could not be read: review it yourself.",
  },
});

const AUTH = /(^|[\/._-])(auth|login|logout|session|sesion|password|contrase|token|oauth|signin|signup|middleware)([\/._-]|$)/i;
const MONEY = /(^|[\/._-])(pay|payment|pago|pagos|cobro|cobros|stripe|checkout|billing|factura|invoice|refund|reembolso)([\/._-]|$)/i;
const SQL_FILE = /\.sql$/i;
// Statements that lose or rewrite rows; adding tables, columns or indexes is not among them.
const DESTRUCTIVE = /\b(drop\s+(table|column|schema|type|view)|truncate\b|delete\s+from\b|update\s+\S+\s+set\b|alter\s+table\s+\S+\s+(drop|rename|alter\s+column\s+\S+\s+type))/i;

export type Riesgo = { reason: string } | null;

/** The first risk in a delivery's changed files, reading the SQL files' text through `read` (null when unreadable). */
export async function riesgoOf(files: string[], read: (file: string) => Promise<string | null>): Promise<Riesgo> {
  const w = say(RIESGO_WORDS);
  for (const f of files) {
    if (MONEY.test(f)) return { reason: w.money(f) };
    if (AUTH.test(f)) return { reason: w.auth(f) };
  }
  for (const f of files.filter((x) => SQL_FILE.test(x))) {
    const text = await read(f);
    if (text === null) return { reason: w.unknown };
    const body = text.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (DESTRUCTIVE.test(body)) return { reason: w.destructive(f) };
  }
  return null;
}

/** Reads a file at the tip of a branch in the project's repo (git show origin/<branch>:<file>). */
export const readAt = (git: GitFn, repo: string, branch: string) => async (file: string): Promise<string | null> => {
  const r = await git(["show", `origin/${branch}:${file}`], repo).catch(() => null);
  return r && r.code === 0 ? r.stdout : null;
};
