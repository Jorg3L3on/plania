// PLA-I74-10: Artist's empty states become sample cases. An empty state drawn on the idea's canvas was never shown in
// the delivery's pictures: the muestra's datos filled every view with rows before the photo, so only a hand test found
// that the empty form had lost its default values. Now each frame Artist marked as an empty state (by its name, group
// or what it does) adds one view to El Probador's pass, photographed on the delivery's fresh copy before the muestra's
// rows are loaded: what the app's own migrations and defaults leave there. Only for a muestra with datos (without
// them every view is already the empty state). Pure pairing here; the pass and the read call emptyCases.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ideaFrames, tasks, type Task } from "../db/schema.js";
import type { Muestra, MuestraVista } from "./muestra.js";
import type { ViewPage } from "./run.js";
import { defineWords, say } from "../words.js";

export const VACIOS_WORDS = defineWords({
  es: { estado: "vacía, con lo que la app pone por defecto" },
  en: { estado: "empty, with what the app puts by default" },
});

export const MAX_CASES = 3;
// Words that mark a frame as an empty state, in Spanish or English.
const EMPTY = /(^|[^\p{L}])(vac[ií][oa]s?|vaciad[oa]|sin (datos|nada|registros|filas|resultados|elementos|citas|clientes|ventas|pedidos|productos|nada todav[ií]a)|todav[ií]a no hay|a[uú]n no hay|primera vez|empty|blank slate|no data|zero state)([^\p{L}]|$)/iu;

export type FrameLike = { frameId: string; name: string; grupo: string | null; hace: string | null; porque: string | null };
export type EmptyCase = MuestraVista & { from_frame: string };

export const isEmptyFrame = (f: FrameLike): boolean => EMPTY.test([f.name, f.grupo, f.hace].filter(Boolean).join(" · "));

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);

/** The view a frame belongs to: the one whose label, key or path shares the most words with the frame; else the first. */
export function pairOf(f: FrameLike, vistas: MuestraVista[]): MuestraVista | null {
  if (!vistas.length) return null;
  const text = new Set(words([f.name, f.grupo, f.hace, f.porque].filter(Boolean).join(" ")));
  let best = vistas[0]!;
  let score = 0;
  for (const v of vistas) {
    const n = words(`${v.label} ${v.key} ${v.path}`).filter((w) => text.has(w)).length;
    if (n > score) {
      best = v;
      score = n;
    }
  }
  return best;
}

/** One case per empty-state frame (at most MAX_CASES, one per view): the paired view's path, behind its login if it
 * is, with its clicks (to open a form) but none of its fills (so the defaults show) and no follow (there is no row to
 * follow in an empty state). Its key is vacia-<frame id>. */
export function casesOf(m: Muestra, frames: FrameLike[], language?: "es" | "en"): EmptyCase[] {
  if (!m.datos?.trim()) return [];
  const out: EmptyCase[] = [];
  const used = new Set<string>();
  const keys = new Set(m.vistas.map((v) => v.key));
  for (const f of frames.filter(isEmptyFrame)) {
    if (out.length >= MAX_CASES) break;
    const v = pairOf(f, m.vistas);
    if (!v || used.has(v.key)) continue;
    const key = `vacia-${f.frameId.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`.slice(0, 40).replace(/-+$/, "");
    if (keys.has(key)) continue;
    used.add(v.key);
    keys.add(key);
    const clicks = (v.acciones ?? []).filter((a) => "click" in a);
    out.push({
      key,
      label: f.name.trim().slice(0, 60),
      path: v.path,
      estado: say(VACIOS_WORDS, language).estado,
      ...(v.session ? { session: true } : {}),
      ...(clicks.length ? { acciones: clicks } : {}),
      ...(v.url ? { url: v.url } : {}),
      from_frame: f.frameId,
    });
  }
  return out;
}

export const caseViews = (cases: EmptyCase[]): ViewPage[] =>
  cases.map((c) => ({ key: c.key, label: c.label, path: c.path, ...(c.session ? { session: true } : {}), ...(c.acciones ? { acciones: c.acciones } : {}), ...(c.url ? { url: c.url } : {}) }));

/** The frames of the idea that became this ticket's initiative (or the ticket itself, when it is the initiative). */
export async function framesFor(db: Db, t: Pick<Task, "projectId" | "parentId" | "key" | "kind">): Promise<FrameLike[]> {
  let initiative: string | null = t.kind === "initiative" ? t.key : null;
  if (!initiative && t.parentId) {
    const [ini] = await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1);
    initiative = ini?.key ?? null;
  }
  if (!initiative) return [];
  const ideas = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, t.projectId), eq(tasks.kind, "idea"), eq(tasks.promotedTo, initiative)));
  if (!ideas.length) return [];
  return db
    .select({ frameId: ideaFrames.frameId, name: ideaFrames.name, grupo: ideaFrames.grupo, hace: ideaFrames.hace, porque: ideaFrames.porque })
    .from(ideaFrames)
    .where(inArray(ideaFrames.taskId, ideas.map((i) => i.id)))
    .orderBy(asc(ideaFrames.position));
}

/** The empty-state cases of a delivery's muestra. */
export async function emptyCases(db: Db, t: Pick<Task, "projectId" | "parentId" | "key" | "kind" | "muestra">): Promise<EmptyCase[]> {
  if (!t.muestra?.datos?.trim()) return [];
  return casesOf(t.muestra, await framesFor(db, t).catch(() => []));
}
