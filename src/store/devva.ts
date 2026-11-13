// The devva adapter of the store port. Plania owns the transaction; devva stores it in one atomic statement.
//
//   lock     an in-process mutex serializes writes
//   build    the handler runs against in-memory state; its changes collect in a draft
//   commit   ONE insert into <prefix>_log, anchored on a unique commit id: all or nothing, and a second
//            writer racing for the same id is refused
//   apply    the changes are written to <prefix>_ent, one record per row, bucketed by project
//
// The log is the source of truth. Devva loses recent updates of an existing record across a restart
// (inserts survive), so nothing is kept only in an updated record: <prefix>_ent is a projection, compared
// with the log and rewritten on boot.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Q } from "../mcp/tx.js";
import { withDefaults } from "./defaults.js";
import { keyOf, metaOf, tableNames } from "./meta.js";
import { Cond, RequestIdReused, type Change, type Committed, type FindOptions, type Idempotency, type NewRow, type Reader, type Row, type Store, type TableName, type UnitOfWork, type Where } from "./types.js";

type AnyRow = Record<string, unknown>;
const REQUEST_TTL_MS = 30 * 24 * 3_600_000;

// The part of the devva TypeScript client this adapter uses. The client is loaded at run time (see loadClient).
type DevvaRecord = { getString(key: string): string | undefined; getNumber(key: string): number | undefined };
type DevvaPage = Iterable<DevvaRecord> & { hasMore: boolean; cursor: string | undefined };
type DevvaQuery = { limit(n: number): DevvaQuery; cursor(token: string): DevvaQuery; records(): Promise<DevvaPage>; one(): Promise<DevvaRecord | null> };
type DevvaClient = {
  readonly isAlive: boolean;
  close(): void;
  execute(statement: string, params?: unknown): Promise<unknown>;
  find(lobe: string, where: Record<string, unknown>): DevvaQuery;
  scan(lobe: string, where?: Record<string, unknown>): DevvaQuery;
  listLobes(): Promise<{ name: string }[]>;
  createLobe(name: string): Promise<unknown>;
  gravityBy(spec: string, lobe: string): Promise<unknown>;
  createAnchor(field: string, lobe: string): Promise<unknown>;
};

export type DevvaOptions = {
  host?: string;
  port?: number;
  // Lobe prefix. Each store (the service, a dev server, a test run) needs its own.
  prefix: string;
  // File holding the engine token, and the built client's entry module.
  tokenFile?: string;
  clientModule?: string;
};

const codeOf = (e: unknown) => (e as { code?: string })?.code ?? "";
const isTransport = (e: unknown) => codeOf(e) === "CONNECTION_ERROR" || codeOf(e) === "TIMEOUT";
const cid = (seq: number) => `c${String(seq).padStart(12, "0")}`;

// Rows hold Dates and, in a few tables, bigints. JSON has neither, so both are tagged on the way in.
function encode(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === "object") {
    const o = value as AnyRow;
    if (typeof o.$date === "string" && Object.keys(o).length === 1) return new Date(o.$date);
    if (typeof o.$bigint === "string" && Object.keys(o).length === 1) return BigInt(o.$bigint);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}
const clone = <T>(row: T): T => structuredClone(row);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") return JSON.stringify(encode(a)) === JSON.stringify(encode(b));
  return false;
}
function matches(row: AnyRow, where: AnyRow | undefined): boolean {
  if (!where) return true;
  for (const [prop, want] of Object.entries(where)) {
    if (want === undefined) continue;
    const have = row[prop] ?? null;
    if (want instanceof Cond) {
      // As in SQL, a comparison with null is never true.
      if (have === null) return false;
      if (want.op === "notNull") continue;
      const c = compare(have, want.value);
      if (want.op === "ne" ? same(have, want.value) : !{ gt: c > 0, gte: c >= 0, lt: c < 0, lte: c <= 0 }[want.op]) return false;
    } else if (want === null) {
      if (have !== null) return false;
    } else if (Array.isArray(want)) {
      if (!want.some((w) => same(have, w))) return false;
    } else if (!same(have, want)) return false;
  }
  return true;
}
// Nulls sort last ascending, as Postgres does. Text compares by code unit, which is Postgres's "C" order.
function compare(a: unknown, b: unknown): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  const [x, y] = [String(a), String(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

class Duplicate extends Error {
  readonly code = "23505"; // the code handlers already look for
  constructor(
    table: string,
    readonly constraint: string,
  ) {
    super(`duplicate key in ${table} (${constraint})`);
  }
}

type Tables = Map<TableName, Map<string, AnyRow>>;
const keyText = (table: TableName, row: AnyRow) => JSON.stringify(metaOf(table).key.map((k) => encode(row[k])));

// Reads over committed state, optionally under a write's draft (a null in the draft is a pending delete).
class MemoryReader implements Reader {
  constructor(
    protected readonly base: Tables,
    protected readonly draft?: Map<TableName, Map<string, AnyRow | null>>,
  ) {}

  protected rows(table: TableName): AnyRow[] {
    const out = new Map(this.base.get(table) ?? []);
    for (const [k, row] of this.draft?.get(table) ?? []) {
      if (row === null) out.delete(k);
      else out.set(k, row);
    }
    return [...out.values()];
  }

  async get<T extends TableName>(table: T, key: Where<T>): Promise<Row<T> | undefined> {
    const [row] = await this.find(table, key, { limit: 1 });
    return row;
  }

  async find<T extends TableName>(table: T, where?: Where<T>, options: FindOptions<T> = {}): Promise<Row<T>[]> {
    for (const prop of Object.keys(where ?? {})) if (!metaOf(table).columns.includes(prop)) throw new Error(`store: ${table} has no column ${prop}`);
    let rows = this.rows(table).filter((r) => matches(r, where as AnyRow));
    if (options.orderBy?.length) {
      rows = rows.sort((a, b) => {
        for (const o of options.orderBy!) {
          const c = compare(a[o.column as string], b[o.column as string]);
          if (c !== 0) return o.desc ? -c : c;
        }
        return 0;
      });
    }
    if (options.limit !== undefined) rows = rows.slice(0, options.limit);
    return rows.map(clone) as Row<T>[];
  }

  async count<T extends TableName>(table: T, where?: Where<T>): Promise<number> {
    return this.rows(table).filter((r) => matches(r, where as AnyRow)).length;
  }
}

class DevvaUnitOfWork extends MemoryReader implements UnitOfWork {
  readonly changes: Change[] = [];
  readonly now = new Date();
  declare protected readonly draft: Map<TableName, Map<string, AnyRow | null>>;

  // Numbers this write has handed out for store-numbered columns, on top of the committed counter.
  private readonly handedOut = new Map<string, number>();

  constructor(
    base: Tables,
    private readonly lastNumber: (table: TableName, column: string) => number,
  ) {
    super(base, new Map());
  }

  private nextNumber(table: TableName, column: string): number {
    const n = (this.handedOut.get(`${table}.${column}`) ?? this.lastNumber(table, column)) + 1;
    this.handedOut.set(`${table}.${column}`, n);
    return n;
  }

  get sql(): Q {
    throw new Error("store: the devva adapter has no SQL handle; this code path still needs the Postgres adapter");
  }

  private stage(table: TableName, row: AnyRow | null, k: string): void {
    let t = this.draft.get(table);
    if (!t) this.draft.set(table, (t = new Map()));
    t.set(k, row);
  }

  private checkUnique(table: TableName, row: AnyRow, selfKey: string): void {
    for (const group of metaOf(table).unique) {
      if (group.some((p) => row[p] == null)) continue; // nulls never collide, as in SQL
      const clash = this.rows(table).find((r) => keyText(table, r) !== selfKey && group.every((p) => same(r[p], row[p])));
      if (clash) throw new Duplicate(table, group.join(","));
    }
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>> {
    const meta = metaOf(table);
    const full = withDefaults(table, clone(row as AnyRow), this.now);
    for (const col of meta.numbered) if (full[col] === undefined) full[col] = this.nextNumber(table, col);
    for (const col of meta.columns) if (full[col] === undefined) full[col] = null;
    const k = keyText(table, full);
    if (this.rows(table).some((r) => keyText(table, r) === k)) throw new Duplicate(table, meta.key.join(","));
    this.checkUnique(table, full, k);
    this.stage(table, full, k);
    this.changes.push({ table, op: "put", key: keyOf(table, full), row: clone(full) });
    return clone(full) as Row<T>;
  }

  async update<T extends TableName>(table: T, where: Where<T>, patch: Partial<NewRow<T>>): Promise<Row<T>[]> {
    const out: AnyRow[] = [];
    for (const row of this.rows(table).filter((r) => matches(r, where as AnyRow))) {
      const before = keyText(table, row);
      const next = { ...row };
      for (const [prop, value] of Object.entries(clone(patch as AnyRow))) if (value !== undefined) next[prop] = value;
      const after = keyText(table, next);
      if (after !== before) throw new Error(`store: an update may not change the key of ${table}`);
      this.checkUnique(table, next, after);
      this.stage(table, next, after);
      this.changes.push({ table, op: "put", key: keyOf(table, next), row: clone(next) });
      out.push(clone(next));
    }
    return out as Row<T>[];
  }

  async delete<T extends TableName>(table: T, where: Where<T>): Promise<Row<T>[]> {
    const out: AnyRow[] = [];
    for (const row of this.rows(table).filter((r) => matches(r, where as AnyRow))) {
      this.stage(table, null, keyText(table, row));
      this.changes.push({ table, op: "delete", key: keyOf(table, row) });
      out.push(clone(row));
    }
    return out as Row<T>[];
  }
}

type Commit = { seq: number; nonce: string; at: string; projectId: string; changes: Change[] };

export class DevvaStore implements Store {
  private readonly tables: Tables = new Map();
  private readonly counters = new Map<string, number>();
  private readonly listeners = new Set<(c: Committed) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private db!: DevvaClient;
  private connect!: () => Promise<DevvaClient>;
  private head = 0;
  readonly log: string;
  readonly ent: string;
  // What boot found: commits replayed, and projection records it had to rewrite.
  recovered = { replayed: 0, repaired: 0 };
  readonly stats = { commits: 0, conflicts: 0, indeterminate: 0 };

  private constructor(private readonly opts: DevvaOptions) {
    this.log = `${opts.prefix}_log`;
    this.ent = `${opts.prefix}_ent`;
  }

  static async open(opts: DevvaOptions): Promise<DevvaStore> {
    const store = new DevvaStore(opts);
    store.connect = await loadClient(opts);
    store.db = await store.connect();
    await store.declare();
    await store.recover();
    return store;
  }

  close(): void {
    this.db.close();
  }

  // The client never reconnects: a dead one is replaced.
  private async live(): Promise<DevvaClient> {
    if (!this.db.isAlive) this.db = await this.connect();
    return this.db;
  }

  // Anchors and gravity are declared on empty lobes, before the first write.
  private async declare(): Promise<void> {
    const have = new Set((await this.db.listLobes()).map((l) => l.name));
    const make = async (lobe: string, anchor: string, gravity?: string) => {
      if (have.has(lobe)) return;
      try {
        await this.db.createLobe(lobe);
        if (gravity) await this.db.gravityBy(gravity, lobe);
        await this.db.createAnchor(anchor, lobe);
      } catch (e) {
        if (!(await this.db.listLobes()).some((l) => l.name === lobe)) throw e;
      }
    };
    await make(this.log, "cid");
    await make(this.ent, "pk", "scope");
  }

  private table(name: TableName): Map<string, AnyRow> {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new Map()));
    return t;
  }

  private fold(c: Commit): void {
    for (const ch of c.changes) {
      const k = JSON.stringify(metaOf(ch.table).key.map((p) => encode(ch.key[p])));
      if (ch.op === "delete") this.table(ch.table).delete(k);
      else {
        this.table(ch.table).set(k, ch.row!);
        for (const col of metaOf(ch.table).numbered) {
          const n = Number(ch.row![col]);
          if (n > (this.counters.get(`${ch.table}.${col}`) ?? 0)) this.counters.set(`${ch.table}.${col}`, n);
        }
      }
    }
    this.head = c.seq;
  }

  private async scanAll(lobe: string): Promise<DevvaRecord[]> {
    const out: DevvaRecord[] = [];
    let cursor: string | undefined;
    do {
      const q = (await this.live()).scan(lobe).limit(1000);
      const page = await (cursor ? q.cursor(cursor) : q).records();
      for (const r of page) out.push(r);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  // Boot: replay the whole log into memory, then make the projection equal to it.
  private async recover(): Promise<void> {
    const commits = (await this.scanAll(this.log)).map((r) => decode(JSON.parse(r.getString("body") ?? "null")) as Commit).sort((a, b) => a.seq - b.seq);
    commits.forEach((c, i) => {
      if (c.seq !== i + 1) throw new Error(`store: commit log gap, expected ${i + 1} and found ${c.seq}`);
      this.fold(c);
    });
    this.recovered = { replayed: commits.length, repaired: await this.repair() };
  }

  private entPk = (table: TableName, key: AnyRow) => `${table}:${JSON.stringify(metaOf(table).key.map((p) => encode(key[p])))}`;
  // The bucket a row lives in: its project's, a project's own for the project row, else the company's.
  private scopeOf = (table: TableName, row: AnyRow) => {
    const project = table === "projects" ? row.id : row.projectId;
    return typeof project === "string" ? project : "company";
  };

  private async repair(): Promise<number> {
    const got = new Map((await this.scanAll(this.ent)).map((r) => [r.getString("pk") ?? "", r.getString("data") ?? ""]));
    const fix: Change[] = [];
    const want = new Set<string>();
    for (const name of tableNames()) {
      for (const row of this.tables.get(name)?.values() ?? []) {
        const pk = this.entPk(name, row);
        want.add(pk);
        if (got.get(pk) !== JSON.stringify(encode(row))) fix.push({ table: name, op: "put", key: keyOf(name, row), row });
      }
    }
    const db = await this.live();
    for (const pk of got.keys()) if (!want.has(pk)) await db.execute(`DELETE "${this.ent}" WHERE pk = $pk`, { pk });
    await this.apply(fix);
    return fix.length + [...got.keys()].filter((pk) => !want.has(pk)).length;
  }

  // Every statement here can be repeated.
  private async apply(changes: readonly Change[]): Promise<void> {
    const db = await this.live();
    for (const ch of changes) {
      const pk = this.entPk(ch.table, ch.key);
      if (ch.op === "delete") await db.execute(`DELETE "${this.ent}" WHERE pk = $pk`, { pk });
      else await db.execute(`PUT {pk: $pk, scope: $scope, tbl: $tbl, data: $data} IN "${this.ent}" ON CONFLICT UPDATE`, { pk, scope: this.scopeOf(ch.table, ch.row!), tbl: ch.table, data: JSON.stringify(encode(ch.row)) });
    }
  }

  private async readBack(seq: number): Promise<string | undefined> {
    for (let i = 0; i < 20; i++) {
      try {
        return (await (await this.live()).find(this.log, { cid: cid(seq) }).one())?.getString("nonce");
      } catch (e) {
        if (!isTransport(e)) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error("store: the devva engine is unreachable");
  }

  // One statement, all or nothing. False means another writer owns this commit id.
  private async commit(c: Commit): Promise<boolean> {
    const params = { cid: cid(c.seq), seq: c.seq, nonce: c.nonce, body: JSON.stringify(encode(c)) };
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await (await this.live()).execute(`PUT {cid: $cid, seq: $seq, nonce: $nonce, body: $body} IN "${this.log}"`, params);
        return true;
      } catch (e) {
        if (codeOf(e) === "DUPLICATE_ANCHOR") return (await this.readBack(c.seq)) === c.nonce;
        if (!isTransport(e)) throw e;
        // The statement may have run. Read it back before deciding anything.
        this.stats.indeterminate += 1;
        const nonce = await this.readBack(c.seq);
        if (nonce) return nonce === c.nonce;
      }
    }
    throw new Error("store: the commit could not be written");
  }

  private async catchUp(): Promise<void> {
    for (;;) {
      const row = await (await this.live()).find(this.log, { cid: cid(this.head + 1) }).one();
      if (!row) return;
      this.fold(decode(JSON.parse(row.getString("body") ?? "null")) as Commit);
    }
  }

  read<T>(fn: (r: Reader) => Promise<T>): Promise<T> {
    return fn(new MemoryReader(this.tables));
  }

  write<T>(projectId: string, idem: Idempotency, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const uow = new DevvaUnitOfWork(this.tables, (table, col) => this.counters.get(`${table}.${col}`) ?? 0);
        if (idem.requestId) {
          const seen = await uow.get("writeRequests", { projectId, requestId: idem.requestId });
          if (seen && seen.tool !== idem.tool) throw new RequestIdReused(seen.tool);
          if (seen) return ((seen.response as { __void?: boolean })?.__void ? undefined : seen.response) as T;
        }
        const value = await fn(uow);
        if (idem.requestId) {
          for (const old of await uow.find("writeRequests", { projectId })) if (old.createdAt.getTime() < uow.now.getTime() - REQUEST_TTL_MS) await uow.delete("writeRequests", { projectId, requestId: old.requestId });
          await uow.insert("writeRequests", { projectId, requestId: idem.requestId, tool: idem.tool ?? "", response: value === undefined ? { __void: true } : JSON.parse(JSON.stringify(value)) });
        }
        if (uow.changes.length === 0) return value;
        const c: Commit = { seq: this.head + 1, nonce: crypto.randomUUID(), at: uow.now.toISOString(), projectId, changes: uow.changes };
        if (!(await this.commit(c))) {
          this.stats.conflicts += 1;
          await this.catchUp();
          continue;
        }
        this.fold(c);
        this.stats.commits += 1;
        await this.apply(c.changes);
        for (const listener of this.listeners) listener({ projectId, changes: c.changes });
        return value;
      }
      throw new Error("store: too many commit conflicts");
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  // Applies a write set produced by another store (the Postgres adapter, while devva runs as its shadow).
  replicate(c: Committed): Promise<void> {
    const run = async (): Promise<void> => {
      if (c.changes.length === 0) return;
      for (;;) {
        const commit: Commit = { seq: this.head + 1, nonce: crypto.randomUUID(), at: new Date().toISOString(), projectId: c.projectId, changes: clone([...c.changes]) };
        if (await this.commit(commit)) {
          this.fold(commit);
          this.stats.commits += 1;
          await this.apply(commit.changes);
          return;
        }
        this.stats.conflicts += 1;
        await this.catchUp();
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  // How many commits the log holds.
  get commits(): number {
    return this.head;
  }

  onCommit(listener: (c: Committed) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // The rows the projection holds for one project (or "company"), as stored in devva.
  async bucket(scope: string): Promise<{ table: string; row: AnyRow }[]> {
    const out: { table: string; row: AnyRow }[] = [];
    let cursor: string | undefined;
    do {
      const q = (await this.live()).scan(this.ent, { scope }).limit(1000);
      const page = await (cursor ? q.cursor(cursor) : q).records();
      for (const r of page) out.push({ table: r.getString("tbl") ?? "", row: decode(JSON.parse(r.getString("data") ?? "null")) as AnyRow });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  // Empties this store's lobes. For tests.
  async purge(): Promise<void> {
    const db = await this.live();
    for (const lobe of [this.log, this.ent]) await db.execute(`PURGE "${lobe}"`);
    this.tables.clear();
    this.counters.clear();
    this.head = 0;
  }
}

// The devva client is not a dependency yet: it is loaded from a built copy named by DEVVA_CLIENT (or the option),
// by default the one the spike's setup script copies.
async function loadClient(opts: DevvaOptions): Promise<() => Promise<DevvaClient>> {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const entry = opts.clientModule ?? process.env.DEVVA_CLIENT ?? path.join(root, "spike", "devva-commit-log", "vendor", "xyzdb", "dist", "src", "index.js");
  const tokenFile = opts.tokenFile ?? process.env.DEVVA_TOKEN_FILE ?? path.join(root, "spike", "devva-commit-log", ".token");
  const token = readFileSync(tokenFile, "utf8").trim();
  process.env.DEVVA_TOKEN = process.env.XYZDB_TOKEN = token;
  const mod = (await import(pathToFileURL(entry).href)) as { connect(host: string, port: number, timeoutMs: number): Promise<DevvaClient> };
  const host = opts.host ?? process.env.DEVVA_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.DEVVA_PORT ?? 2511);
  return () => mod.connect(host, port, 15_000);
}
