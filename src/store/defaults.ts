// Column defaults, filled by the application so a stored record never depends on the database to complete it.
// A store that is not SQL has no defaults of its own: what plania writes is the whole record.
import { randomUUID } from "node:crypto";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { TableName } from "./types.js";

type Fill = (now: Date) => unknown;
const dialect = new PgDialect();

// The SQL defaults the schema uses, each with what it means outside SQL.
const SQL_DEFAULTS: Record<string, Fill> = {
  "now()": (now) => now,
  "gen_random_uuid()": () => randomUUID(),
  "'{}'::text[]": () => [],
  "'[]'::jsonb": () => [],
};

// How one column is completed: a value, "store" when the adapter numbers it (an identity column), or
// undefined when the column has no default.
export function defaultOf(column: PgColumn): Fill | "store" | undefined {
  const c = column as PgColumn & { generatedIdentity?: unknown; defaultFn?: () => unknown };
  if (c.generatedIdentity) return "store";
  if (!c.hasDefault) return undefined;
  if (c.defaultFn) return () => c.defaultFn!();
  if (is(c.default, SQL)) {
    const text = dialect.sqlToQuery(c.default).sql;
    const fill = SQL_DEFAULTS[text];
    if (!fill) throw new Error(`store: no application default for ${c.name} default ${text}`);
    return fill;
  }
  const literal = c.default;
  return () => (literal !== null && typeof literal === "object" ? structuredClone(literal) : literal);
}

const cache = new Map<TableName, [prop: string, fill: Fill][]>();
function fillsOf(table: TableName): [string, Fill][] {
  const hit = cache.get(table);
  if (hit) return hit;
  const t = schema[table] as unknown as PgTable;
  const byName = new Map(getTableConfig(t).columns.map((c) => [c.name, c]));
  const fills: [string, Fill][] = [];
  for (const [prop, col] of Object.entries(getTableColumns(t) as Record<string, PgColumn>)) {
    const fill = defaultOf(byName.get(col.name) ?? col);
    if (typeof fill === "function") fills.push([prop, fill]);
  }
  cache.set(table, fills);
  return fills;
}

// The row with every defaulted column the caller left out filled in. now is the write's one clock reading.
export function withDefaults(table: TableName, row: Record<string, unknown>, now: Date): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [prop, fill] of fillsOf(table)) if (out[prop] === undefined) out[prop] = fill(now);
  return out;
}
