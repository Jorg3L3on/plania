// Commit-log store on devva: plania owns the transaction, devva stores it in one atomic statement.
//
//   1. lock      an in-process mutex (what pg_advisory_xact_lock does today)
//   2. build     run the handler against in-memory state, collect a write set of record images
//   3. commit    one PUT into <prefix>_log with a unique `cid` anchor: the commit point
//   4. apply     write the images to the entity and event lobes (repeatable)
//   5. publish   advance the applied watermark
//
// The log is the source of truth. The entity and event lobes are projections that can be rebuilt.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Client, connect } from "../vendor/xyzdb/dist/src/index.js";

export type Rec = { pk: string; project: string; kind: string; version: number; [field: string]: unknown };
export type Ev = { project: string; type: string; key: string | null; payload: unknown };
export type WriteSet = { puts: Rec[]; dels: { pk: string; project: string }[]; events: Ev[] };
export type Commit = {
  seq: number;
  nonce: string;
  writer: string;
  at: number;
  project: string;
  tool: string;
  rid: string | null;
  ws: WriteSet;
  response: unknown;
};

export class StoreError extends Error {
  constructor(
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

// What a handler sees: current state plus its own pending writes.
export class Tx {
  readonly ws: WriteSet = { puts: [], dels: [], events: [] };
  private readonly draft = new Map<string, Rec | null>();
  constructor(
    private readonly recs: ReadonlyMap<string, Rec>,
    readonly now: number,
  ) {}
  get(pk: string): Rec | undefined {
    if (this.draft.has(pk)) return this.draft.get(pk) ?? undefined;
    return this.recs.get(pk);
  }
  list(project: string, kind: string): Rec[] {
    const out = new Map<string, Rec>();
    for (const r of this.recs.values()) if (r.project === project && r.kind === kind) out.set(r.pk, r);
    for (const [pk, r] of this.draft) {
      if (r === null) out.delete(pk);
      else if (r.project === project && r.kind === kind) out.set(pk, r);
    }
    return [...out.values()];
  }
  put(rec: Rec): Rec {
    this.draft.set(rec.pk, rec);
    this.ws.puts = this.ws.puts.filter((p) => p.pk !== rec.pk).concat(rec);
    return rec;
  }
  del(pk: string): void {
    const cur = this.get(pk);
    if (!cur) return;
    this.draft.set(pk, null);
    this.ws.puts = this.ws.puts.filter((p) => p.pk !== pk);
    this.ws.dels.push({ pk, project: cur.project });
  }
  emit(project: string, type: string, key: string | null, payload: unknown = {}): void {
    this.ws.events.push({ project, type, key, payload });
  }
}

// reproject: re-apply every commit. inspectOnly: replay the log into memory and write nothing (for measuring drift).
export type StoreOptions = { host?: string; port?: number; prefix: string; writer?: string; reproject?: boolean; inspectOnly?: boolean };
export type Stats = { commits: number; conflicts: number; indeterminate: number; reconnects: number };

const cid = (seq: number) => `c${String(seq).padStart(12, "0")}`;
const isCode = (e: unknown, code: string) => (e as { code?: string })?.code === code;
const isTransport = (e: unknown) => ["CONNECTION_ERROR", "TIMEOUT"].includes((e as { code?: string })?.code ?? "");

export class Store {
  readonly recs = new Map<string, Rec>();
  readonly rids = new Map<string, { tool: string; response: unknown }>();
  readonly stats: Stats = { commits: 0, conflicts: 0, indeterminate: 0, reconnects: 0 };
  head = 0;
  recovered = { replayed: 0, reapplied: 0, watermark: 0, repaired: 0 };
  private db!: Client;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly host: string;
  private readonly port: number;
  private readonly writer: string;
  readonly log: string;
  readonly ent: string;
  readonly evt: string;
  readonly meta: string;

  private constructor(private readonly opts: StoreOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 2511;
    this.writer = opts.writer ?? `w-${process.pid}`;
    this.log = `${opts.prefix}_log`;
    this.ent = `${opts.prefix}_ent`;
    this.evt = `${opts.prefix}_evt`;
    this.meta = `${opts.prefix}_meta`;
  }

  static async open(opts: StoreOptions): Promise<Store> {
    const token = readFileSync(path.resolve(import.meta.dirname, "..", ".token"), "utf8").trim();
    process.env.DEVVA_TOKEN = process.env.XYZDB_TOKEN = token;
    const s = new Store(opts);
    await s.reconnect();
    await s.declare();
    await s.recover(opts.reproject ?? false);
    return s;
  }

  close(): void {
    this.db.close();
  }

  // The client never reconnects: a dead one is replaced.
  private async reconnect(): Promise<void> {
    if (this.db?.isAlive) return;
    this.db = await connect(this.host, this.port, 15_000);
  }
  private async live(): Promise<Client> {
    if (!this.db.isAlive) {
      this.stats.reconnects += 1;
      await this.reconnect();
    }
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
        // A second writer starting at the same moment may have declared it first.
        if (!(await this.db.listLobes()).some((l) => l.name === lobe)) throw e;
      }
    };
    await make(this.log, "cid");
    await make(this.ent, "pk", "project");
    await make(this.evt, "eid", "project");
    await make(this.meta, "id");
  }

  private fold(c: Commit): void {
    for (const r of c.ws.puts) this.recs.set(r.pk, r);
    for (const d of c.ws.dels) this.recs.delete(d.pk);
    if (c.rid) this.rids.set(`${c.project}:${c.rid}`, { tool: c.tool, response: c.response });
    this.head = c.seq;
  }

  // Boot: replay the whole log into memory, then re-apply whatever the projections may have missed.
  private async recover(reproject: boolean): Promise<void> {
    const commits: Commit[] = [];
    let cursor: string | undefined;
    do {
      const q = this.db.scan(this.log).limit(1000);
      const page = await (cursor ? q.cursor(cursor) : q).records();
      for (const r of page) commits.push(JSON.parse(r.getString("body") ?? "null") as Commit);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    commits.sort((a, b) => a.seq - b.seq);
    commits.forEach((c, i) => {
      if (c.seq !== i + 1) throw new StoreError("LOG_GAP", { expected: i + 1, found: c.seq });
      this.fold(c);
    });
    const mark = (await this.db.find(this.meta, { id: "applied" }).one())?.getNumber("seq") ?? 0;
    this.recovered = { replayed: commits.length, reapplied: 0, watermark: mark, repaired: 0 };
    if (this.opts.inspectOnly) return;
    // The watermark is only a lower bound: the engine loses recent updates of an existing record
    // across a restart, so it can read low, never high. Re-applying from it is safe.
    const from = reproject ? 0 : mark;
    for (const c of commits) if (c.seq > from) await this.apply(c);
    this.recovered.reapplied = commits.filter((c) => c.seq > from).length;
    // Entity records are updated in place, so the same loss can leave them stale. Compare and rewrite.
    this.recovered.repaired = await this.repair();
    if (this.head > mark || reproject) await this.setWatermark(this.head);
  }

  // Make the entity lobe equal to the state the log folds to. Cost is one scan plus one write per difference.
  private async repair(): Promise<number> {
    const got = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const q = this.db.scan(this.ent).limit(1000);
      const page = await (cursor ? q.cursor(cursor) : q).records();
      for (const r of page) got.set(r.getString("pk") ?? "", r.getString("data") ?? "");
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const ws: WriteSet = { puts: [], dels: [], events: [] };
    for (const r of this.recs.values()) if (got.get(r.pk) !== JSON.stringify(r)) ws.puts.push(r);
    for (const pk of got.keys()) if (!this.recs.has(pk)) ws.dels.push({ pk, project: "" });
    if (ws.puts.length + ws.dels.length > 0) await this.apply({ seq: 0, nonce: "", writer: this.writer, at: 0, project: "", tool: "repair", rid: null, ws, response: null });
    return ws.puts.length + ws.dels.length;
  }

  // Another writer committed: read forward from our head until the next cid is free.
  private async catchUp(): Promise<void> {
    for (;;) {
      const row = await (await this.live()).find(this.log, { cid: cid(this.head + 1) }).one();
      if (!row) return;
      this.fold(JSON.parse(row.getString("body") ?? "null") as Commit);
    }
  }

  private async setWatermark(seq: number): Promise<void> {
    await (await this.live()).execute(`PUT {id: $id, seq: $seq} IN "${this.meta}" ON CONFLICT UPDATE`, { id: "applied", seq });
  }

  // Step 4. Every statement can be repeated: anchored upserts, deletes by key, events ignored when present.
  private async apply(c: Commit): Promise<void> {
    const db = await this.live();
    let n = 0;
    const fault = () => {
      n += 1;
      if (process.env.SPIKE_CRASH === "mid-apply" && n === 1) process.exit(137);
    };
    for (const r of c.ws.puts) {
      await db.execute(`PUT {pk: $pk, project: $project, kind: $kind, version: $version, status: $status, data: $data} IN "${this.ent}" ON CONFLICT UPDATE`, {
        pk: r.pk,
        project: r.project,
        kind: r.kind,
        version: r.version,
        status: typeof r.status === "string" ? r.status : null,
        data: JSON.stringify(r),
      });
      fault();
    }
    for (const d of c.ws.dels) {
      await db.execute(`DELETE "${this.ent}" WHERE pk = $pk`, { pk: d.pk });
      fault();
    }
    for (const [i, e] of c.ws.events.entries()) {
      try {
        await db.execute(`PUT {eid: $eid, project: $project, seq: $seq, type: $type, key: $key, at: $at, payload: $payload} IN "${this.evt}"`, {
          eid: `${cid(c.seq)}.${i}`,
          project: e.project,
          seq: c.seq * 1000 + i,
          type: e.type,
          key: e.key,
          at: c.at,
          payload: JSON.stringify(e.payload),
        });
      } catch (err) {
        if (!isCode(err, "DUPLICATE_ANCHOR")) throw err;
      }
      fault();
    }
  }

  // Step 3. One statement, all or nothing. Returns false when another writer owns this seq.
  private async commit(c: Commit): Promise<boolean> {
    const params = { cid: cid(c.seq), seq: c.seq, writer: c.writer, nonce: c.nonce, body: JSON.stringify(c) };
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await (await this.live()).execute(`PUT {cid: $cid, seq: $seq, writer: $writer, nonce: $nonce, body: $body} IN "${this.log}"`, params);
        return true;
      } catch (e) {
        if (isCode(e, "DUPLICATE_ANCHOR")) return this.ownsSeq(c);
        if (!isTransport(e)) throw e;
        // The statement may have run. Read it back before deciding anything.
        this.stats.indeterminate += 1;
        const row = await this.readBack(c.seq);
        if (row) return row === c.nonce;
      }
    }
    throw new StoreError("COMMIT_UNAVAILABLE", { seq: c.seq });
  }
  private async ownsSeq(c: Commit): Promise<boolean> {
    return (await this.readBack(c.seq)) === c.nonce;
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
    throw new StoreError("ENGINE_UNREACHABLE", { seq });
  }

  // The whole write path. `fn` may throw: nothing has been written at that point.
  write<T>(project: string, ctx: { tool: string; rid?: string }, fn: (tx: Tx) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (ctx.rid) {
          const seen = this.rids.get(`${project}:${ctx.rid}`);
          if (seen && seen.tool !== ctx.tool) throw new StoreError("REQUEST_ID_REUSED", { tool: seen.tool });
          if (seen) return seen.response as T;
        }
        const tx = new Tx(this.recs, Date.now());
        const response = await fn(tx);
        const c: Commit = { seq: this.head + 1, nonce: randomUUID(), writer: this.writer, at: tx.now, project, tool: ctx.tool, rid: ctx.rid ?? null, ws: tx.ws, response: response ?? null };
        if (!(await this.commit(c))) {
          this.stats.conflicts += 1;
          await this.catchUp();
          continue;
        }
        if (process.env.SPIKE_CRASH === "after-commit") process.exit(137);
        this.fold(c);
        this.stats.commits += 1;
        await this.apply(c);
        await this.setWatermark(c.seq);
        return response;
      }
      throw new StoreError("TOO_MANY_CONFLICTS");
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  // A project's bucket, read from the projection (gravity = project).
  async bucket(project: string): Promise<Rec[]> {
    const out: Rec[] = [];
    let cursor: string | undefined;
    do {
      const q = (await this.live()).scan(this.ent, { project }).limit(1000);
      const page = await (cursor ? q.cursor(cursor) : q).records();
      for (const r of page) out.push(JSON.parse(r.getString("data") ?? "null") as Rec);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async eventCount(project: string): Promise<number> {
    return (await (await this.live()).scan(this.evt, { project }).aggregate("count()")).count ?? 0;
  }

  // How far the projection is from the log's state: records missing, extra, or holding an older image.
  async drift(projects: string[]): Promise<{ missing: number; extra: number; stale: number }> {
    const d = { missing: 0, extra: 0, stale: 0 };
    for (const p of projects) {
      const want = new Map([...this.recs.values()].filter((r) => r.project === p).map((r) => [r.pk, r]));
      const got = new Map((await this.bucket(p)).map((r) => [r.pk, r]));
      for (const [pk, r] of want) {
        const g = got.get(pk);
        if (!g) d.missing += 1;
        else if (JSON.stringify(g) !== JSON.stringify(r)) d.stale += 1;
      }
      for (const pk of got.keys()) if (!want.has(pk)) d.extra += 1;
    }
    return d;
  }

  async purge(): Promise<void> {
    for (const lobe of [this.log, this.ent, this.evt, this.meta]) await this.db.purge(lobe);
  }
}
