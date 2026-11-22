// PLA-I73-3/5/6: the idea's plan step behind a ticket. The PO turns the plan into tickets after «Constrúyelo»; the
// step keeps what the plan said about it (its «Pruébalo» views, the steps it needs, the files it touches, its effort)
// and Plania reads it from the idea's planning delivery by the ticket's phase.
import { and, desc, eq } from "drizzle-orm";
import { tasks } from "../db/schema.js";
import { deliveredFor, type PlanStep } from "./stage-docs.js";
import type { Q } from "./tx.js";

/** The plan steps of the idea promoted to this initiative, in order; null when there is none. */
export async function planOfInitiative(db: Q, projectId: string, initiativeKey: string): Promise<PlanStep[] | null> {
  const [idea] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "idea"), eq(tasks.promotedTo, initiativeKey)))
    .orderBy(desc(tasks.updatedAt))
    .limit(1);
  if (!idea) return null;
  const { stages } = await deliveredFor(db, idea.id);
  return stages.planning?.steps ?? null;
}

/** The plan step a ticket is: its initiative's plan, step number = phase. */
export async function planStepFor(db: Q, t: { projectId: string; parentId: string | null; phase: number | null }): Promise<PlanStep | null> {
  if (!t.parentId || !t.phase) return null;
  const [init] = await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, t.parentId)).limit(1);
  if (!init) return null;
  const steps = await planOfInitiative(db, t.projectId, init.key);
  return steps?.[t.phase - 1] ?? null;
}

/** The blocked_by keys and areas a new step gets from its plan when the PO gave none: the tickets of the steps it
 * depends on (already filed, by phase) and the files it touches. */
export async function planDefaults(db: Q, projectId: string, parent: { id: string; key: string }, phase: number): Promise<{ blockers: string[]; areas: string[] } | null> {
  const steps = await planOfInitiative(db, projectId, parent.key);
  const step = steps?.[phase - 1];
  if (!step || !steps!.some((s) => s.depends_on || s.files || s.esqueleto)) return null;
  const siblings = await db.select({ key: tasks.key, phase: tasks.phase }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.parentId, parent.id)));
  const blockers = (step.depends_on ?? []).flatMap((i) => siblings.filter((s) => s.phase === i + 1).map((s) => s.key));
  return { blockers, areas: step.files ?? [] };
}
