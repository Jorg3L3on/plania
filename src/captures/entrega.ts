// PLA-I52-2: warm the delivery's copy when a delivery with a muestra lands, so El Probador's «Pruébala en vivo» is
// ready by the time the owner looks (a first Next.js compile can take a minute). Best effort: a failure shows on
// the copy's read, never on the finish that triggered it.
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks } from "../db/schema.js";
import { encenderEntrega, type EntregaRead } from "./prueba.js";
import { probar } from "./probador.js";

export async function warmEntrega(db: Db, slug: string, key: string): Promise<EntregaRead | null> {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p?.settings.capture) return null;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, key))).limit(1);
  const branch = t?.branch || t?.workspace?.branch;
  if (!t?.muestra || !branch) return null;
  return encenderEntrega(db, slug, { key: t.key, branch });
}

// PLA-I52-3: after finish, the whole pass: both copies, the pairs, and where the delivery's pictures stand. In the background.
export function afterFinish(db: Db, slug: string, key: string): void {
  void probar(db, slug, key).catch((e) => console.log(`[probador] ${slug}/${key} failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`));
}

// Off in tests and wherever background jobs are off (PLANIA_JOBS=0).
export const warmOn = (env: NodeJS.ProcessEnv = process.env): boolean => env.PLANIA_JOBS !== "0" && env.PLANIA_WARM_ENTREGA !== "0";
