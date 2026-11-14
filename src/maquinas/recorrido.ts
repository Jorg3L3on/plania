// PLA-I48-3: Cómo probarla. The test walkthrough of a floor: the project doc «Recorrido de prueba» (a checklist the
// PO writes from the checks of accepted steps) as steps, or, until it exists, one step per capture page. Plus the
// test user's name, and a fresh password for it on demand (session.password_command), returned once, never kept.
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { docs } from "../db/schema.js";
import { checkoutEnv, shellExec } from "../captures/run.js";
import { isTestUser } from "../captures/settings.js";
import { appDirs } from "./env.js";
import { MaquinaError } from "./errors.js";
import { mdeps, menv, projectOf } from "./machines.js";

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
    return { from: "pages", doc_id: null, steps: pages.map((pg, i) => ({ n: i + 1, text: `Abre ${pg.label}${pg.session ? " (con la sesión de prueba)" : ""}`, page: pg.key, path: pg.path })), user, can_password };
  }
  return { from: "none", doc_id: null, steps: [], user, can_password };
}

// Copiar una nueva: sets a fresh random password on the seed's test user and returns it once. Refused for a user
// outside the reserved test domains, even if the stored settings were written around the schema.
export async function nuevaContrasena(db: Db, slug: string): Promise<{ user: string; password: string }> {
  const p = await projectOf(db, slug);
  const sess = p.settings.capture?.session;
  if (!sess) throw new MaquinaError("NOT_CONFIGURED", "Este piso no tiene usuario de prueba");
  if (!isTestUser(sess.user)) throw new MaquinaError("NOT_A_TEST_USER", "Solo cambio la contraseña de un usuario de prueba (example.com, .test)");
  const dirs = appDirs(slug, p.settings, menv());
  const dir = dirs.prueba ?? dirs.repo;
  if (!dir) throw new MaquinaError("NO_TEST_COPY", "No encuentro la copia de la app");
  const password = randomBytes(12).toString("base64url");
  const cmd = sess.password_command.replaceAll("{user}", sess.user);
  const r = await (mdeps().exec ?? shellExec)(cmd, { cwd: dir, stdin: `${password}\n${password}\n`, timeoutMs: 120_000, env: checkoutEnv() });
  if (r.code !== 0) throw new MaquinaError("COMMAND_FAILED", "No se pudo poner la contraseña");
  return { user: sess.user, password };
}
