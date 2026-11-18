// PLA-I52-2: warm the delivery's copy when a delivery with a muestra lands, so El Probador's «Pruébala en vivo» is
// ready by the time the owner looks (a first Next.js compile can take a minute). Best effort: a failure shows on
// the copy's read, never on the finish that triggered it.
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { apagarEntrega, cargarDatos, datosDe, encenderEntrega, entregaRead, hashDatos, type EntregaRead } from "./prueba.js";
import { probar } from "./probador.js";

export async function warmEntrega(db: Db, slug: string, key: string): Promise<EntregaRead | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p?.settings.capture) return null;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  const branch = t?.branch || t?.workspace?.branch;
  if (!t?.muestra || !branch) return null;
  // PLA-100 (guided test PLA-86, F-25): «Pruébala en vivo» started the copy without the muestra's fake rows (only El
  // Probador's pass loaded them), so the owner's own try showed «Te llamaremos» where the photos showed the calendar.
  // A copy holding another muestra's rows starts again, and once live this one's rows are loaded, as the pass does.
  const want = hashDatos(t.muestra.datos);
  const have = datosDe(slug, "entrega");
  if (have && have !== want) await apagarEntrega(db, slug).catch(() => null);
  const r = await encenderEntrega(db, slug, { key: t.key, branch });
  if (t.muestra.datos) void loadWhenLive(slug, t.muestra.datos);
  return r;
}

// Waits for the delivery's copy to be live (up to two minutes) and loads the muestra's rows into it; a failure stays on
// the server log (the card's photos already say whether the rows load).
export async function loadWhenLive(slug: string, datos: string, deps: { load?: typeof cargarDatos; read?: typeof entregaRead; sleep?: (ms: number) => Promise<void>; waitMs?: number } = {}): Promise<boolean> {
  const read = deps.read ?? entregaRead;
  const load = deps.load ?? cargarDatos;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = Date.now() + (deps.waitMs ?? 120_000);
  for (;;) {
    const e = read(slug);
    if (e?.phase === "live") break;
    if (!e || e.phase === "failed" || Date.now() > until) return false;
    await sleep(1000);
  }
  const r = await load(slug, "entrega", datos);
  if (!r.ok) console.log(`[entrega] ${slug}: the muestra's rows did not load: ${r.error}`);
  return r.ok;
}

// PLA-I52-3: after finish, the whole pass: both copies, the pairs, and where the delivery's pictures stand. In the background.
export function afterFinish(db: Db, slug: string, key: string): void {
  void probar(db, slug, key).catch((e) => console.log(`[probador] ${slug}/${key} failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`));
}

// Off in tests and wherever background jobs are off (PLANIA_JOBS=0).
export const warmOn = (env: NodeJS.ProcessEnv = process.env): boolean => env.PLANIA_JOBS !== "0" && env.PLANIA_WARM_ENTREGA !== "0";
