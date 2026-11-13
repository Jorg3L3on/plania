// What an adapter needs to know about a table, read from the schema: its key, its unique rules, its
// timestamp columns, and the columns the store numbers itself.
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
import { defaultOf } from "./defaults.js";
import type { TableName } from "./types.js";

export type TableMeta = {
  name: TableName;
  // Property names of the primary key, single or composite.
  key: string[];
  // Property names of every column.
  columns: string[];
  // Columns that hold a Date.
  dates: string[];
  // Columns the store numbers on insert (an identity column).
  numbered: string[];
  // Groups of columns that must be unique together, beyond the key. Partial unique indexes are not here:
  // the handlers check those themselves.
  unique: string[][];
};

export const tableOf = (name: TableName): PgTable => schema[name] as unknown as PgTable;
export const columnsOf = (name: TableName) => getTableColumns(tableOf(name)) as Record<string, PgColumn>;

const cache = new Map<TableName, TableMeta>();
export function metaOf(name: TableName): TableMeta {
  const hit = cache.get(name);
  if (hit) return hit;
  const cols = columnsOf(name);
  const cfg = getTableConfig(tableOf(name));
  const prop = new Map(Object.entries(cols).map(([p, c]) => [c.name, p]));
  const props = (names: string[]) => names.map((n) => prop.get(n)!).filter(Boolean);
  const keyNames = new Set<string>([...cfg.columns.filter((c) => c.primary).map((c) => c.name), ...cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name))]);
  const unique: string[][] = [
    ...cfg.columns.filter((c) => c.isUnique).map((c) => props([c.name])),
    ...cfg.uniqueConstraints.map((u) => props(u.columns.map((c) => c.name))),
    ...cfg.indexes
      .filter((i) => i.config.unique && !i.config.where)
      .map((i) => props(i.config.columns.map((c) => (c as PgColumn).name).filter((n): n is string => typeof n === "string"))),
  ].filter((g) => g.length > 0);
  const meta: TableMeta = {
    name,
    key: Object.keys(cols).filter((p) => keyNames.has(cols[p]!.name)),
    columns: Object.keys(cols),
    dates: Object.keys(cols).filter((p) => cols[p]!.dataType === "date"),
    numbered: Object.keys(cols).filter((p) => defaultOf(cfg.columns.find((c) => c.name === cols[p]!.name) ?? cols[p]!) === "store"),
    unique,
  };
  cache.set(name, meta);
  return meta;
}

export const keyOf = (name: TableName, row: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(metaOf(name).key.map((k) => [k, row[k]]));

export const tableNames = (): TableName[] =>
  (Object.keys(schema) as (keyof typeof schema)[]).filter((k) => {
    try {
      getTableConfig(schema[k] as unknown as PgTable);
      return true;
    } catch {
      return false;
    }
  }) as TableName[];
