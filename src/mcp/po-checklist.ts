// PLA-I46-11: the PO's check list on a ticket (tasks.po_checklist). The PO writes 3 things to verify when it plans a
// leg, the owner edits them before Aceptar plan, and every step of the plan gets a copy. QA reads and ticks them:
//   [{ n: 1, text: "Sale el nombre de la novia", done: false, done_at: null, done_by: null }, ...]
// get_task (full) shows it as po_checklist when the ticket has one.
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projects, tasks, type PoCheck } from "../db/schema.js";

async function ticketOf(db: Db, project: string, key: string) {
  const [row] = await db
    .select({ id: tasks.id, list: tasks.poChecklist })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(projects.slug, project), eq(tasks.key, key)))
    .limit(1);
  return row ?? null;
}

export async function poChecklistOf(db: Db, project: string, key: string): Promise<PoCheck[] | null> {
  return (await ticketOf(db, project, key))?.list ?? null;
}

// Tick (or untick) line n. Returns the list, or null when the ticket or the line is not there.
export async function tickPoCheck(db: Db, input: { project: string; key: string; n: number; done: boolean; by: string }, now = new Date()): Promise<PoCheck[] | null> {
  const t = await ticketOf(db, input.project, input.key);
  if (!t || !t.list.some((c) => c.n === input.n)) return null;
  const list = t.list.map((c) => (c.n === input.n ? { ...c, done: input.done, done_at: input.done ? now.toISOString() : null, done_by: input.done ? input.by : null } : c));
  await db.update(tasks).set({ poChecklist: list }).where(eq(tasks.id, t.id));
  return list;
}
