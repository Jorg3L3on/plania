// The store port. Plania's handlers talk to this; an adapter (Postgres today, devva next) implements it.
//
// A write is a unit of work: every change made through it commits or rolls back together, and the changes
// it made are kept as a write set of record images. The write set is what a second store replays.
import type { PgTable } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema.js";
import type { Q } from "../mcp/tx.js";

type Schema = typeof schema;
export type TableName = { [K in keyof Schema]: Schema[K] extends PgTable ? K : never }[keyof Schema];
export type Row<T extends TableName> = Schema[T] extends { $inferSelect: infer R } ? R : never;
export type NewRow<T extends TableName> = Schema[T] extends { $inferInsert: infer R } ? R : never;

// Equality on each named column; an array means "any of"; null means the column is null.
export type Where<T extends TableName> = { [K in keyof Row<T>]?: Row<T>[K] | Row<T>[K][] | null };
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
  // The adapter's own handle, for code not yet moved onto the port. Changes made through it are not in
  // `changes`. It exists only on the Postgres adapter and goes away with it.
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
  write<T>(projectId: string, idem: Idempotency, fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  // Called after each commit with what it changed. Returns an unsubscribe function.
  onCommit(listener: (c: Committed) => void): () => void;
}
