// PLA-I48-3: Cómo probarla. The test walkthrough of a floor: the project doc «Recorrido de prueba» (a checklist the
// PO writes from the checks of accepted steps) as steps, or, until it exists, one step per capture page. Plus the
// test user's name, and a fresh password for it on demand (session.password_command), returned once, never kept.
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { docs } from "../db/schema.js";
import { checkoutEnv, shellExec } from "../captures/run.js";
import { isTestUser } from "../captures/settings.js";
import { appDirs } from "./env.js";
import { MaquinaError } from "./errors.js";
import { mdeps, menv, projectOf } from "./machines.js";
import { defineWords, say } from "../words.js";

// PLA-I2-10: the walkthrough's lines and refusals in the install's language; the Spanish is unchanged.
export const RECORRIDO_WORDS = defineWords({
  es: {
    open: (label: string, session: boolean) => `Abre ${label}${session ? " (con la sesión de prueba)" : ""}`,
    noUser: "Este piso no tiene usuario de prueba",
    notTestUser: "Solo cambio la contraseña de un usuario de prueba (example.com, .test)",
    noCopy: "No encuentro la copia de la app",
    passwordFailed: "No se pudo poner la contraseña",
  },
  en: {
    open: (label: string, session: boolean) => `Open ${label}${session ? " (with the test session)" : ""}`,
    noUser: "This floor has no test user",
    notTestUser: "I only change the password of a test user (example.com, .test)",
    noCopy: "I can't find the app's copy",
    passwordFailed: "Could not set the password",
  },
});

export const RECORRIDO_TITLE = "Recorrido de prueba";

export type Paso = { n: number; text: string; page: string | null; path: string | null };
export type RecorridoRead = { from: "doc" | "pages" | "none"; doc_id: string | null; steps: Paso[]; user: string | null; can_password: boolean };

// A checklist line (- [ ] / - [x] / - / 1.), with a page named as `/path` in backticks or as [label](/path).
export function stepsOf(markdown: string, pages: { key: string; path: string }[]): Paso[] {
  const out: Paso[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (!m) continue;
    const raw = m[1]!.trim();
    const p = /`(\/[^`\s]*)`/.exec(raw)?.[1] ?? /\]\((\/[^)\s]*)\)/.exec(raw)?.[1] ?? null;
    const page = p ? (pages.find((x) => x.path === p)?.key ?? null) : null;
    const text = raw
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim()
      .slice(0, 240);
    if (text) out.push({ n: out.length + 1, text, page, path: p });
  }
  return out.slice(0, 40);
}

export async function recorrido(db: Db, slug: string): Promise<RecorridoRead> {
  const p = await projectOf(db, slug);
  const s = p.settings.capture;
  const pages = s?.pages ?? [];
  const [d] = await db
    .select({ id: docs.id, markdown: docs.markdown })
    .from(docs)
    .where(and(eq(docs.projectId, p.id), isNull(docs.taskId), eq(docs.title, RECORRIDO_TITLE)));
  const user = s?.session?.user ?? null;
  const can_password = !!(s?.session && isTestUser(s.session.user));
  if (d) {
    const steps = stepsOf(d.markdown, pages);
    if (steps.length) return { from: "doc", doc_id: d.id, steps, user, can_password };
  }
  if (pages.length) {
    return { from: "pages", doc_id: null, steps: pages.map((pg, i) => ({ n: i + 1, text: say(RECORRIDO_WORDS).open(pg.label, !!pg.session), page: pg.key, path: pg.path })), user, can_password };
  }
  return { from: "none", doc_id: null, steps: [], user, can_password };
}

// Copiar una nueva (PLA-I48-3) is now Cambiarla (PLA-I72-4): the same fresh password, set in the app and in every
// running copy, and kept for the eye.
export async function nuevaContrasena(db: Db, slug: string): Promise<{ user: string; password: string }> {
  const r = await cambiarContrasena(db, slug);
  return { user: r.user, password: r.password };
}

// ---- PLA-I72-4: the test user's password, kept for the eye

// One JSON file only the user can read, outside every repo, next to Plania's other local secrets:
// $XDG_CONFIG_HOME/plania/test-passwords.json (default ~/.config/plania/…; PLANIA_TEST_PASSWORDS_FILE names
// another). Only a test user's password is kept (isTestUser: example.com, .test). It never goes to the database, an
// event, a log line or an error: the eye's read and Cambiarla's answer are the only places it leaves.
type Kept = { user: string; password: string; at: string; stale: string[] };
type KeptFile = Record<string, Kept>;

export function passwordsFile(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.PLANIA_TEST_PASSWORDS_FILE?.trim();
  if (named) return named;
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(env.HOME || homedir(), ".config");
  return path.join(base, "plania", "test-passwords.json");
}

function readKept(env: NodeJS.ProcessEnv): KeptFile {
  const file = passwordsFile(env);
  try {
    // A file the group or others can read is not trusted (and never written that way).
    if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) return {};
    const v = JSON.parse(readFileSync(file, "utf8")) as KeptFile;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writeKept(env: NodeJS.ProcessEnv, all: KeptFile): void {
  const file = passwordsFile(env);
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(all, null, 2));
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export type EntrarRead = {
  user: string | null;
  password: string | null; // the kept one, for the eye; null until Cambiarla set one
  can_password: boolean;
  at: string | null;
  stale: string[]; // copies (ids) that were off when it last changed: their sign-in is still the old one
};

/** What the «Entrar a tu app» strip shows. Reading twice gives the same password: nothing is set here. */
export async function entrarRead(db: Db, slug: string): Promise<EntrarRead> {
  const p = await projectOf(db, slug);
  const sess = p.settings.capture?.session;
  const user = sess?.user ?? null;
  const can = !!(sess && isTestUser(sess.user));
  const kept = can ? readKept(menv())[slug] : undefined;
  const ok = kept && kept.user === user ? kept : undefined;
  return { user, password: ok?.password ?? null, can_password: can, at: ok?.at ?? null, stale: ok?.stale ?? [] };
}

export type CambioRead = EntrarRead & { password: string; user: string; set_in: string[] };

/** Cambiarla: a fresh password for the test user, set in the app's own base (as before) and in every running copy's
 * base (each with its own database variable), then kept. Copies that are off are listed as stale. */
export async function cambiarContrasena(db: Db, slug: string): Promise<CambioRead> {
  const p = await projectOf(db, slug);
  const sess = p.settings.capture?.session;
  if (!sess) throw new MaquinaError("NOT_CONFIGURED", say(RECORRIDO_WORDS).noUser);
  if (!isTestUser(sess.user)) throw new MaquinaError("NOT_A_TEST_USER", say(RECORRIDO_WORDS).notTestUser);
  const dirs = appDirs(slug, p.settings, menv());
  const dir = dirs.prueba ?? dirs.repo;
  if (!dir) throw new MaquinaError("NO_TEST_COPY", say(RECORRIDO_WORDS).noCopy);
  const password = randomBytes(12).toString("base64url");
  const cmd = sess.password_command.replaceAll("{user}", sess.user);
  const exec = mdeps().exec ?? shellExec;
  const stdin = `${password}\n${password}\n`;
  const r = await exec(cmd, { cwd: dir, stdin, timeoutMs: 120_000, env: checkoutEnv() });
  if (r.code !== 0) throw new MaquinaError("COMMAND_FAILED", say(RECORRIDO_WORDS).passwordFailed);
  const { copiasRead } = await import("./copias.js");
  const { copyEnvOf } = await import("../captures/prueba.js");
  const set_in: string[] = [];
  const stale: string[] = [];
  for (const c of (await copiasRead(db, slug, false)).copias) {
    const env = copyEnvOf(slug, c.kind === "inicio" ? null : c.key);
    if (env && c.worktree && ["live", "capturing", "starting"].includes(c.phase)) {
      const x = await exec(cmd, { cwd: c.worktree, stdin, timeoutMs: 120_000, env: checkoutEnv(env) });
      (x.code === 0 ? set_in : stale).push(c.id);
    } else if (c.database && c.made) stale.push(c.id);
  }
  const all = readKept(menv());
  const at = new Date().toISOString();
  all[slug] = { user: sess.user, password, at, stale };
  writeKept(menv(), all);
  return { user: sess.user, password, can_password: true, at, stale, set_in };
}
