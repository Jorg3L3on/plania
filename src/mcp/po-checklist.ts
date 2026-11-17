// PLA-I46-11: the PO's check list on a ticket (tasks.po_checklist). The PO writes 3 things to verify when it plans a
// leg, the owner edits them before Aprobar el plan, and every step of the plan gets a copy. QA reads and ticks them:
//   [{ n: 1, text: "Sale el nombre de la novia", done: false, done_at: null, done_by: null }, ...]
// get_task (full) shows it as po_checklist when the ticket has one.
import type { Db } from "../db/client.js";
import type { PoCheck } from "../db/schema.js";
import { writeVia } from "../runner/limits.js";
import { readerOf } from "../store/port.js";
import type { Reader } from "../store/types.js";

async function ticketOf(r: Reader, project: string, key: string) {
  const p = project == null ? undefined : await r.get("projects", { slug: project });
  const t = p && key != null ? await r.get("tasks", { projectId: p.id, key }) : undefined;
  return t ? { id: t.id, projectId: t.projectId, list: t.poChecklist } : null;
}

export async function poChecklistOf(db: Db, project: string, key: string): Promise<PoCheck[] | null> {
  return (await ticketOf(readerOf(db), project, key))?.list ?? null;
}

// Tick (or untick) line n. Returns the list, or null when the ticket or the line is not there.
export async function tickPoCheck(db: Db, input: { project: string; key: string; n: number; done: boolean; by: string }, now = new Date()): Promise<PoCheck[] | null> {
  const found = await ticketOf(readerOf(db), input.project, input.key);
  if (!found || !found.list.some((c) => c.n === input.n)) return null;
  // Read again inside the write, so a tick never undoes another one made meanwhile.
  return writeVia(
    db,
    async (uow) => {
      const t = await ticketOf(uow, input.project, input.key);
      if (!t || !t.list.some((c) => c.n === input.n)) return null;
      const list = t.list.map((c) => (c.n === input.n ? { ...c, done: input.done, done_at: input.done ? now.toISOString() : null, done_by: input.done ? input.by : null } : c));
      await uow.update("tasks", { id: t.id }, { poChecklist: list });
      return list;
    },
    found.projectId,
  );
}
