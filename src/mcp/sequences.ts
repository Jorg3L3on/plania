import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sequenceReservations, sequences, tasks } from "../db/schema.js";
import { ToolError, findProject, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// Per-project number registry: reserve_sequence("migration") hands out 0009 once, bound to a ticket.
// Writes are serialized per project by writeTx, so two sessions never get the same number.

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const DEFAULT_WIDTH = 4;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

type Reservation = typeof sequenceReservations.$inferSelect;

async function widthOf(db: Q, projectId: string, name: string): Promise<number> {
  const [row] = await db
    .select({ width: sequences.width })
    .from(sequences)
    .where(and(eq(sequences.projectId, projectId), eq(sequences.name, name)));
  return row?.width ?? DEFAULT_WIDTH;
}

function shape(r: Reservation, taskKey: string | null, width: number, existing: boolean) {
  return {
    name: r.name,
    value: pad(r.value, width),
    number: r.value,
    task_key: taskKey,
    reserved_at: iso(r.createdAt),
    actor: r.actor,
    existing,
  };
}

export async function reserveSequence(
  db: Db,
  input: {
    project: string;
    name: string;
    task_key: string;
    at_least?: number;
    value?: number;
    width?: number;
    additional?: boolean;
  },
  ctx: Ctx,
) {
  if (!NAME.test(input.name)) throw new ToolError("INVALID_SEQUENCE", { pattern: NAME.source });
  for (const [field, n] of [["at_least", input.at_least], ["value", input.value], ["width", input.width]] as const) {
    if (n !== undefined && (!Number.isInteger(n) || n < (field === "width" ? 1 : 0) || n > 999_999)) {
      throw new ToolError("INVALID_SEQUENCE", { field });
    }
  }
  const p = await findProject(db, input.project);
  return writeTx(db, p, ctx, async (tx, emit) => {
    const task = await requireTask(tx, p.id, input.task_key);
    // First use creates the counter. width is fixed by the first reservation.
    await tx
      .insert(sequences)
      .values({ projectId: p.id, name: input.name, nextValue: 1, width: input.width ?? DEFAULT_WIDTH })
      .onConflictDoNothing();
    const width = await widthOf(tx, p.id, input.name);
    const held = (value: number) =>
      tx
        .select({ r: sequenceReservations, key: tasks.key, status: tasks.status })
        .from(sequenceReservations)
        .leftJoin(tasks, eq(tasks.id, sequenceReservations.taskId))
        .where(
          and(
            eq(sequenceReservations.projectId, p.id),
            eq(sequenceReservations.name, input.name),
            eq(sequenceReservations.value, value),
          ),
        );

    let value: number;
    if (input.value !== undefined) {
      value = input.value;
      const [holder] = await held(value);
      if (holder && holder.r.taskId === task.id) return shape(holder.r, task.key, width, true);
      // A number held by a ticket that will never ship can be taken over.
      if (holder && holder.status !== "Won't do") {
        throw new ToolError("SEQUENCE_TAKEN", { value: pad(value, width), task_key: holder.key });
      }
      if (holder) await tx.delete(sequenceReservations).where(eq(sequenceReservations.id, holder.r.id));
    } else {
      // Retrying for the same ticket returns what it already holds, unless it asks for another.
      if (!input.additional) {
        const [mine] = await tx
          .select()
          .from(sequenceReservations)
          .where(
            and(
              eq(sequenceReservations.projectId, p.id),
              eq(sequenceReservations.name, input.name),
              eq(sequenceReservations.taskId, task.id),
            ),
          )
          .orderBy(asc(sequenceReservations.value))
          .limit(1);
        if (mine) return shape(mine, task.key, width, true);
      }
      const [counter] = await tx
        .select({ next: sequences.nextValue })
        .from(sequences)
        .where(and(eq(sequences.projectId, p.id), eq(sequences.name, input.name)));
      value = Math.max(counter!.next, input.at_least ?? 0);
      while ((await held(value)).length) value++;
    }

    const [r] = await tx
      .insert(sequenceReservations)
      .values({ projectId: p.id, name: input.name, value, taskId: task.id, actor: ctx.actor })
      .returning();
    await tx
      .update(sequences)
      .set({ nextValue: sql`greatest(${sequences.nextValue}, ${value + 1})` })
      .where(and(eq(sequences.projectId, p.id), eq(sequences.name, input.name)));
    await emit("sequence.reserved", task, { name: input.name, value: pad(value, width) });
    return shape(r!, task.key, width, false);
  });
}

// For get_project: every reservation with its ticket's status, and the next free value per name.
export async function projectSequences(db: Q, projectId: string) {
  const counters = await db.select().from(sequences).where(eq(sequences.projectId, projectId)).orderBy(asc(sequences.name));
  const widths = new Map(counters.map((c) => [c.name, c.width]));
  const rows = await db
    .select({ r: sequenceReservations, key: tasks.key, status: tasks.status })
    .from(sequenceReservations)
    .leftJoin(tasks, eq(tasks.id, sequenceReservations.taskId))
    .where(eq(sequenceReservations.projectId, projectId))
    .orderBy(asc(sequenceReservations.name), asc(sequenceReservations.value));
  return {
    sequences: Object.fromEntries(counters.map((c) => [c.name, { next: pad(c.nextValue, c.width) }])),
    reservations: rows.map(({ r, key, status }) => ({
      name: r.name,
      value: pad(r.value, widths.get(r.name) ?? DEFAULT_WIDTH),
      task_key: key,
      task_status: status,
      reserved_at: iso(r.createdAt),
    })),
  };
}
