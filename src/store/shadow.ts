// Devva as a shadow of Postgres: every committed write set is replayed into a DevvaStore, and parity
// says how far the two are apart. Postgres stays the system of record; a failure here never fails a write.
import type { Db } from "../db/client.js";
import { DevvaStore, type DevvaOptions } from "./devva.js";
import { keyOf, metaOf, tableNames } from "./meta.js";
import { pgStore } from "./pg.js";
import type { Change, TableName } from "./types.js";

type AnyRow = Record<string, unknown>;
const CHUNK_BYTES = 2 * 1024 * 1024; // a commit is one statement, and a statement is capped at 16 MiB

// Dates and bigints compare by value; everything else by its JSON.
const text = (row: unknown): string => JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
const keyText = (table: TableName, row: AnyRow) => text(metaOf(table).key.map((k) => row[k]));

// columns: which columns differ, across the differing rows.
export type Drift = { table: TableName; missing: number; extra: number; differing: number; columns: string[] };
export type Parity = { tables: number; rows: number; drift: Drift[] };

export class Shadow {
  private stop: (() => void) | null = null;
  private pending: Promise<void> = Promise.resolve();
  readonly errors: string[] = [];

  private constructor(
    private readonly db: Db,
    readonly devva: DevvaStore,
    private readonly log: (line: string) => void,
  ) {}

  static async start(db: Db, opts: DevvaOptions, log: (line: string) => void = console.log): Promise<Shadow> {
    const shadow = new Shadow(db, await DevvaStore.open(opts), log);
    // Subscribe first, so a write that lands during the first copy is queued behind it, not lost.
    shadow.stop = pgStore(db).onCommit((c) => shadow.enqueue(() => shadow.devva.replicate(c)));
    if (shadow.devva.commits === 0) shadow.enqueue(() => shadow.copyAll());
    return shadow;
  }

  private enqueue(job: () => Promise<void>): void {
    this.pending = this.pending.then(job).catch((e) => {
      const line = `[shadow] ${e instanceof Error ? e.message : String(e)}`;
      this.errors.push(line);
      this.log(line);
    });
  }

  // Resolves when everything queued so far has been replayed.
  settled(): Promise<void> {
    return this.pending;
  }

  close(): void {
    this.stop?.();
    this.devva.close();
  }

  // The first copy: every row Postgres holds, as put changes, in commits small enough for one statement.
  private async copyAll(): Promise<void> {
    let rows = 0;
    let chunk: Change[] = [];
    let bytes = 0;
    const flush = async () => {
      if (chunk.length) await this.devva.replicate({ projectId: "", changes: chunk });
      chunk = [];
      bytes = 0;
    };
    for (const table of tableNames()) {
      for (const row of (await pgStore(this.db).read((r) => r.find(table))) as AnyRow[]) {
        chunk.push({ table, op: "put", key: keyOf(table, row), row });
        bytes += text(row).length;
        rows += 1;
        if (bytes > CHUNK_BYTES) await flush();
      }
    }
    await flush();
    this.log(`[shadow] first copy: ${rows} rows in ${this.devva.commits} commits`);
  }

  // Compares every table, row by row. Call settled() first for a meaningful answer.
  async parity(): Promise<Parity> {
    const out: Parity = { tables: 0, rows: 0, drift: [] };
    for (const table of tableNames()) {
      const pg = new Map(((await pgStore(this.db).read((r) => r.find(table))) as AnyRow[]).map((row) => [keyText(table, row), row]));
      const dv = new Map(((await this.devva.read((r) => r.find(table))) as AnyRow[]).map((row) => [keyText(table, row), row]));
      const d: Drift = { table, missing: 0, extra: 0, differing: 0, columns: [] };
      for (const [k, row] of pg) {
        const other = dv.get(k);
        if (!other) d.missing += 1;
        else if (text(other) !== text(row)) {
          d.differing += 1;
          for (const col of metaOf(table).columns) if (text(other[col]) !== text(row[col]) && !d.columns.includes(col)) d.columns.push(col);
        }
      }
      for (const k of dv.keys()) if (!pg.has(k)) d.extra += 1;
      out.tables += 1;
      out.rows += pg.size;
      if (d.missing + d.extra + d.differing > 0) out.drift.push(d);
    }
    return out;
  }
}
