// The Postgres adapter of the store port: Drizzle over pg, one transaction per write under one advisory lock.
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { Q } from "../mcp/tx.js";
import { withDefaults } from "./defaults.js";
import { RequestIdReused, type Change, type Committed, type FindOptions, type Idempotency, type NewRow, type Reader, type Row, type Store, type TableName, type UnitOfWork, type Where } from "./types.js";

const REQUEST_TTL = "30 days";
const WRITE_LOCK = 7_264_201; // arbitrary constant: the one advisory lock every write takes

type AnyRow = Record<string, unknown>;
const tableOf = (name: TableName): PgTable => schema[name] as unknown as PgTable;
const columnsOf = (name: TableName) => getTableColumns(tableOf(name)) as Record<string, PgColumn>;

// The property names of a table's primary key, single or composite.
const keyCache = new Map<TableName, string[]>();
function keyColumns(name: TableName): string[] {
  const hit = keyCache.get(name);
  if (hit) return hit;
  const cols = columnsOf(name);
  const cfg = getTableConfig(tableOf(name));
  const dbNames = new Set<string>([...cfg.columns.filter((c) => c.primary).map((c) => c.name), ...cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name))]);
  const keys = Object.entries(cols)
    .filter(([, c]) => dbNames.has(c.name))
    .map(([prop]) => prop);
  keyCache.set(name, keys);
  return keys;
}
const keyOf = (name: TableName, row: AnyRow): AnyRow => Object.fromEntries(keyColumns(name).map((k) => [k, row[k]]));

function condition(name: TableName, where: AnyRow | undefined): SQL | undefined {
  if (!where) return undefined;
  const cols = columnsOf(name);
  const parts: SQL[] = [];
  for (const [prop, value] of Object.entries(where)) {
    if (value === undefined) continue;
    const col = cols[prop];
    if (!col) throw new Error(`store: ${name} has no column ${prop}`);
    if (value === null) parts.push(isNull(col));
    else if (Array.isArray(value)) parts.push(value.length ? inArray(col, value) : sql`false`);
    else parts.push(eq(col, value));
  }
  return parts.length ? and(...parts) : undefined;
}

class PgReader implements Reader {
  constructor(readonly sql: Q) {}

  async get<T extends TableName>(table: T, key: Where<T>): Promise<Row<T> | undefined> {
    const [row] = await this.find(table, key, { limit: 1 });
    return row;
  }

  async find<T extends TableName>(table: T, where?: Where<T>, options: FindOptions<T> = {}): Promise<Row<T>[]> {
    const cols = columnsOf(table);
    let q = this.sql.select().from(tableOf(table)).where(condition(table, where as AnyRow)).$dynamic();
    if (options.orderBy?.length) q = q.orderBy(...options.orderBy.map((o) => (o.desc ? desc : asc)(cols[o.column as string]!)));
    if (options.limit !== undefined) q = q.limit(options.limit);
    return (await q) as Row<T>[];
  }

  async count<T extends TableName>(table: T, where?: Where<T>): Promise<number> {
    const [row] = await this.sql
      .select({ n: sql<number>`count(*)::int` })
      .from(tableOf(table))
      .where(condition(table, where as AnyRow));
    return row?.n ?? 0;
  }
}

class PgUnitOfWork extends PgReader implements UnitOfWork {
  readonly changes: Change[] = [];
  readonly now = new Date();

  async insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>> {
    const [made] = (await this.sql
      .insert(tableOf(table))
      .values(withDefaults(table, row as AnyRow, this.now))
      .returning()) as AnyRow[];
    if (!made) throw new Error(`store: insert into ${table} returned nothing`);
    this.changes.push({ table, op: "put", key: keyOf(table, made), row: made });
    return made as Row<T>;
  }

  async update<T extends TableName>(table: T, where: Where<T>, patch: Partial<NewRow<T>>): Promise<Row<T>[]> {
    const rows = (await this.sql
      .update(tableOf(table))
      .set(patch as AnyRow)
      .where(condition(table, where as AnyRow))
      .returning()) as AnyRow[];
    for (const row of rows) this.changes.push({ table, op: "put", key: keyOf(table, row), row });
    return rows as Row<T>[];
  }

  async delete<T extends TableName>(table: T, where: Where<T>): Promise<Row<T>[]> {
    const rows = (await this.sql.delete(tableOf(table)).where(condition(table, where as AnyRow)).returning()) as AnyRow[];
    for (const row of rows) this.changes.push({ table, op: "delete", key: keyOf(table, row) });
    return rows as Row<T>[];
  }
}

export class PgStore implements Store {
  private readonly listeners = new Set<(c: Committed) => void>();
  constructor(private readonly db: Db) {}

  read<T>(fn: (r: Reader) => Promise<T>): Promise<T> {
    return fn(new PgReader(this.db));
  }

  async write<T>(projectId: string, idem: Idempotency, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    let committed: Committed | null = null;
    const result = await this.db.transaction(async (tx) => {
      // One global lock serializes every writer, so event ids commit in order across projects and a
      // single cursor over "all" never skips one. Plania is one machine with a handful of agents; the
      // concurrency given up is nil. (Until 2.7 the lock was per project.)
      await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`);
      const { writeRequests } = schema;
      if (idem.requestId) {
        const [seen] = await tx
          .select()
          .from(writeRequests)
          .where(and(eq(writeRequests.projectId, projectId), eq(writeRequests.requestId, idem.requestId)));
        if (seen && seen.tool !== idem.tool) throw new RequestIdReused(seen.tool);
        if (seen) return ((seen.response as { __void?: boolean })?.__void ? undefined : seen.response) as T;
      }
      const uow = new PgUnitOfWork(tx);
      const value = await fn(uow);
      if (idem.requestId) {
        await tx.delete(writeRequests).where(and(eq(writeRequests.projectId, projectId), sql`${writeRequests.createdAt} < now() - ${REQUEST_TTL}::interval`));
        await tx.insert(writeRequests).values({
          projectId,
          requestId: idem.requestId,
          tool: idem.tool ?? "",
          // A write with nothing to return (a poller's event) still replays as "done".
          response: value === undefined ? { __void: true } : JSON.parse(JSON.stringify(value)),
        });
      }
      committed = { projectId, changes: uow.changes };
      return value;
    });
    if (committed) for (const listener of this.listeners) listener(committed);
    return result;
  }

  onCommit(listener: (c: Committed) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// One store per Db, so a test that rebuilds its pool gets a fresh one.
const stores = new WeakMap<object, PgStore>();
export function pgStore(db: Db): PgStore {
  let store = stores.get(db);
  if (!store) stores.set(db, (store = new PgStore(db)));
  return store;
}
