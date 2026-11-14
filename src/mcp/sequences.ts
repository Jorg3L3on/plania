import type { Db } from "../db/client.js";
import type { sequenceReservations } from "../db/schema.js";
import { readerOf, uowOf } from "../store/port.js";
import type { Reader } from "../store/types.js";
import { ToolError, findProject, requireTask } from "./queries.js";
import { iso, writeTx, type Ctx, type Q } from "./tx.js";

// Per-project number registry: reserve_sequence("migration") hands out 0009 once, bound to a ticket.
// Writes are serialized by writeTx, so two sessions never get the same number.

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const DEFAULT_WIDTH = 4;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

type Reservation = typeof sequenceReservations.$inferSelect;

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

// A reservation with the key and status of the ticket holding it (none when the ticket is gone).
async function withTask(r: Reader, res: Reservation) {
  const task = res.taskId ? await r.get("tasks", { id: res.taskId }) : undefined;
  return { r: res, key: task?.key ?? null, status: task?.status ?? null };
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
    const uow = uowOf(tx);
    const task = await requireTask(tx, p.id, input.task_key);
    const at = { projectId: p.id, name: input.name };
    // First use creates the counter. width is fixed by the first reservation.
    const counter = (await uow.get("sequences", at)) ?? (await uow.insert("sequences", { ...at, nextValue: 1, width: input.width ?? DEFAULT_WIDTH }));
    const width = counter.width;
    const held = async (value: number) => {
      const res = await uow.get("sequenceReservations", { ...at, value });
      return res ? withTask(uow, res) : undefined;
    };

    let value: number;
    if (input.value !== undefined) {
      value = input.value;
      const holder = await held(value);
      if (holder && holder.r.taskId === task.id) return shape(holder.r, task.key, width, true);
      // A number held by a ticket that will never ship can be taken over.
      if (holder && holder.status !== "Won't do") {
        throw new ToolError("SEQUENCE_TAKEN", { value: pad(value, width), task_key: holder.key });
      }
      if (holder) await uow.delete("sequenceReservations", { id: holder.r.id });
    } else {
      // Retrying for the same ticket returns what it already holds, unless it asks for another.
      if (!input.additional) {
        const [mine] = await uow.find("sequenceReservations", { ...at, taskId: task.id }, { orderBy: [{ column: "value" }], limit: 1 });
        if (mine) return shape(mine, task.key, width, true);
      }
      value = Math.max(counter.nextValue, input.at_least ?? 0);
      while (await held(value)) value++;
    }

    const r = await uow.insert("sequenceReservations", { ...at, value, taskId: task.id, actor: ctx.actor });
    if (value + 1 > counter.nextValue) await uow.update("sequences", at, { nextValue: value + 1 });
    await emit("sequence.reserved", task, { name: input.name, value: pad(value, width) });
    return shape(r, task.key, width, false);
  });
}

// For get_project: every reservation with its ticket's status, and the next free value per name.
export async function projectSequences(db: Q, projectId: string) {
  const r = readerOf(db);
  const counters = await r.find("sequences", { projectId }, { orderBy: [{ column: "name" }] });
  const widths = new Map(counters.map((c) => [c.name, c.width]));
  const reservations = await r.find("sequenceReservations", { projectId }, { orderBy: [{ column: "name" }, { column: "value" }] });
  const rows = await Promise.all(reservations.map((res) => withTask(r, res)));
  return {
    sequences: Object.fromEntries(counters.map((c) => [c.name, { next: pad(c.nextValue, c.width) }])),
    reservations: rows.map(({ r: res, key, status }) => ({
      name: res.name,
      value: pad(res.value, widths.get(res.name) ?? DEFAULT_WIDTH),
      task_key: key,
      task_status: status,
      reserved_at: iso(res.createdAt),
    })),
  };
}
