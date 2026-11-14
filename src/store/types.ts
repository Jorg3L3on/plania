// The store port. Plania's handlers talk to this; the devva adapter (devva.ts) implements it.
//
// A write is a unit of work: every change made through it commits or rolls back together, and the changes
// it made are kept as a write set of record images. The write set is what the commit log stores.
import type { PgTable } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema.js";
import type { Q } from "../mcp/tx.js";

type Schema = typeof schema;
export type TableName = { [K in keyof Schema]: Schema[K] extends PgTable ? K : never }[keyof Schema];
export type Row<T extends TableName> = Schema[T] extends { $inferSelect: infer R } ? R : never;
export type NewRow<T extends TableName> = Schema[T] extends { $inferInsert: infer R } ? R : never;

// A comparison other than equality, made with gt, gte, lt, lte, ne or notNull below.
export class Cond<V = unknown> {
  constructor(
    readonly op: "gt" | "gte" | "lt" | "lte" | "ne" | "notNull",
    readonly value?: V,
  ) {}
}
export const gt = <V>(value: V) => new Cond<V>("gt", value);
export const gte = <V>(value: V) => new Cond<V>("gte", value);
export const lt = <V>(value: V) => new Cond<V>("lt", value);
export const lte = <V>(value: V) => new Cond<V>("lte", value);
// ne(null) is not what you want: use notNull().
export const ne = <V>(value: V) => new Cond<V>("ne", value);
export const notNull = () => new Cond<never>("notNull");

// Equality on each named column; an array means "any of"; null means the column is null; a Cond is a comparison.
// An undefined value is skipped, so check a value you depend on before passing it.
export type Where<T extends TableName> = { [K in keyof Row<T>]?: Row<T>[K] | Row<T>[K][] | null | Cond<NonNullable<Row<T>[K]>> };
export type FindOptions<T extends TableName> = { orderBy?: { column: keyof Row<T>; desc?: boolean }[]; limit?: number };

export interface Reader {
  get<T extends TableName>(table: T, key: Where<T>): Promise<Row<T> | undefined>;
  find<T extends TableName>(table: T, where?: Where<T>, options?: FindOptions<T>): Promise<Row<T>[]>;
  count<T extends TableName>(table: T, where?: Where<T>): Promise<number>;
}

// One change in a write set. row is the record after the change; a delete has none.
export type Change = { table: TableName; op: "put" | "delete"; key: Record<string, unknown>; row?: Record<string, unknown> };

export interface UnitOfWork extends Reader {
  // Columns with a default that the row leaves out are filled by plania (ids, timestamps, empty lists), not by the store.
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>>;
  // Changes the rows matching `where` and returns them as they are afterwards.
  update<T extends TableName>(table: T, where: Where<T>, patch: Partial<NewRow<T>>): Promise<Row<T>[]>;
  delete<T extends TableName>(table: T, where: Where<T>): Promise<Row<T>[]>;
  // The write's one clock reading. Every timestamp a write stores comes from it.
  readonly now: Date;
  // The changes made through this unit of work so far, in order.
  readonly changes: readonly Change[];
  // The handle of this write, for code that takes a handle (Q) and finds the unit of work again with uowOf.
  readonly sql: Q;
}

export type Idempotency = { requestId?: string; tool?: string };

// Thrown when a request id is retried by a different tool.
export class RequestIdReused extends Error {
  constructor(readonly tool: string) {
    super("REQUEST_ID_REUSED");
  }
}

export type Committed = { projectId: string; changes: readonly Change[] };

export interface Store {
  read<T>(fn: (r: Reader) => Promise<T>): Promise<T>;
  // Runs fn as one serialized, atomic write. With a request id, a retry returns the first reply and runs nothing.
  // projectId is "" for a write that belongs to no project (the roster, machine state); such a write takes no request id.
  write<T>(projectId: string, idem: Idempotency, fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  // Called after each commit with what it changed. Returns an unsubscribe function.
  onCommit(listener: (c: Committed) => void): () => void;
}
