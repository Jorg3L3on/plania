// Semantic search over a project's tickets, docs and decisions, on devva.
//
// One lobe, <prefix>_vec, bucketed by project (gravity = scope): NEAREST scores exactly inside one bucket, so
// a search never leaves its project. The index is derived: it is rebuilt from the store at start and
// kept current from each commit's write set. Entries are replaced by delete then insert, never updated,
// because devva loses recent updates of an existing record across a restart.
import { createHash } from "node:crypto";
import { loadClient, type DevvaClient, type DevvaOptions } from "../store/devva.js";
import type { Change, Committed, Reader, Row } from "../store/types.js";
import type { Embedder } from "./embedder.js";

export type SearchKind = "task" | "doc" | "decision";
export const SEARCH_KINDS: readonly SearchKind[] = ["task", "doc", "decision"];
// What one indexed thing is: where it lives, how to name it in a result, and the text that is embedded.
type Entry = { pk: string; scope: string; kind: SearchKind; ref: string; title: string; text: string };
export type Hit = { kind: SearchKind; ref: string; title: string; snippet: string; rank: number };

const MAX_TEXT = 6_000; // characters embedded per entry; a long doc is found by its start
const SNIPPET = 240;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const ofTask = (t: Row<"tasks">): Entry => ({ pk: `task:${t.id}`, scope: t.projectId, kind: "task", ref: t.key, title: t.title, text: [t.title, t.summary, t.scope].filter(Boolean).join("\n") });
const ofDoc = (d: Row<"docs">): Entry => ({ pk: `doc:${d.id}`, scope: d.projectId, kind: "doc", ref: d.id, title: d.title, text: `${d.title}\n${d.markdown}` });
// A retired decision no longer holds, so it is not something to find.
const ofDecision = (d: Row<"decisions">): Entry | null => (d.retiredAt ? null : { pk: `decision:${d.id}`, scope: d.projectId, kind: "decision", ref: d.id, title: clip(oneLine(d.line), 80), text: d.line });

type Touched = { pk: string; entry: Entry | null };
function entryOf(change: Change): Touched | null {
  const id = String(change.key.id ?? "");
  const row = change.op === "put" ? change.row : undefined;
  if (change.table === "tasks") return { pk: `task:${id}`, entry: row ? ofTask(row as Row<"tasks">) : null };
  if (change.table === "docs") return { pk: `doc:${id}`, entry: row ? ofDoc(row as Row<"docs">) : null };
  if (change.table === "decisions") return { pk: `decision:${id}`, entry: row ? ofDecision(row as Row<"decisions">) : null };
  return null;
}

export class SearchIndex {
  private chain: Promise<unknown> = Promise.resolve();
  readonly errors: string[] = [];

  private constructor(
    private db: DevvaClient,
    private readonly connect: () => Promise<DevvaClient>,
    readonly lobe: string,
    private readonly embedder: Embedder,
    private readonly log: (line: string) => void,
  ) {}

  static async open(opts: DevvaOptions, embedder: Embedder, log: (line: string) => void = console.log): Promise<SearchIndex> {
    const connect = await loadClient(opts);
    const db = await connect();
    const lobe = `${opts.prefix}_vec`;
    if (!(await db.listLobes()).some((l) => l.name === lobe)) {
      // Gravity, the anchor and the vector field are declared on the empty lobe, before the first write.
      await db.createLobe(lobe);
      await db.gravityBy("scope", lobe);
      await db.createAnchor("pk", lobe);
      const { embedder: id, revision, runtime } = embedder.identity;
      await db.execute(`VECTOR emb IN "${lobe}" EMBEDDER ${JSON.stringify(id)} REVISION ${JSON.stringify(revision)} RUNTIME ${JSON.stringify(runtime)}`);
    }
    return new SearchIndex(db, connect, lobe, embedder, log);
  }

  close(): void {
    this.db.close();
  }

  private async live(): Promise<DevvaClient> {
    if (!this.db.isAlive) this.db = await this.connect();
    return this.db;
  }

  // A text's fingerprint includes who embedded it: a change of embedder re-embeds everything.
  private hash(e: Entry): string {
    return createHash("sha1")
      .update(JSON.stringify([this.embedder.identity, e.scope, e.kind, e.ref, e.title, clip(e.text, MAX_TEXT)]))
      .digest("hex");
  }

  private queue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async put(entries: Entry[]): Promise<void> {
    if (entries.length === 0) return;
    const vecs = await this.embedder.embed(entries.map((e) => clip(e.text, MAX_TEXT)));
    const db = await this.live();
    for (const [i, e] of entries.entries()) {
      await db.execute(`DELETE "${this.lobe}" WHERE pk = $pk`, { pk: e.pk });
      await db.execute(`PUT {pk: $pk, scope: $scope, kind: $kind, ref: $ref, title: $title, snippet: $snippet, hash: $hash, emb: $emb} IN "${this.lobe}"`, {
        pk: e.pk,
        scope: e.scope,
        kind: e.kind,
        ref: e.ref,
        title: e.title,
        snippet: clip(oneLine(e.text), SNIPPET),
        hash: this.hash(e),
        emb: vecs[i],
      });
    }
  }

  private async drop(pks: string[]): Promise<void> {
    const db = await this.live();
    for (const pk of pks) await db.execute(`DELETE "${this.lobe}" WHERE pk = $pk`, { pk });
  }

  // Makes the index equal to the store: embeds what is missing or changed, removes what is gone.
  sync(reader: Reader): Promise<{ indexed: number; added: number; removed: number }> {
    return this.queue(async () => {
      const want = new Map<string, Entry>();
      for (const t of await reader.find("tasks")) want.set(`task:${t.id}`, ofTask(t));
      for (const d of await reader.find("docs")) want.set(`doc:${d.id}`, ofDoc(d));
      for (const d of await reader.find("decisions")) {
        const e = ofDecision(d);
        if (e) want.set(e.pk, e);
      }
      const have = new Map<string, string>();
      let cursor: string | undefined;
      do {
        const q = (await this.live()).scan(this.lobe).limit(1000);
        const page = await (cursor ? q.cursor(cursor) : q).records();
        for (const r of page) have.set(r.getString("pk") ?? "", r.getString("hash") ?? "");
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      const stale = [...want.values()].filter((e) => have.get(e.pk) !== this.hash(e));
      const gone = [...have.keys()].filter((pk) => !want.has(pk));
      await this.drop(gone);
      await this.put(stale);
      return { indexed: want.size, added: stale.length, removed: gone.length };
    });
  }

  // Follows one commit. A failure is logged and kept; the next sync puts it right.
  follow(c: Committed): Promise<void> {
    const touched = c.changes.map(entryOf).filter((x): x is Touched => x !== null);
    if (touched.length === 0) return Promise.resolve();
    // The last change to a record in the commit is the one that stands.
    const last = new Map(touched.map((t) => [t.pk, t.entry]));
    return this.queue(async () => {
      await this.drop([...last].filter(([, e]) => e === null).map(([pk]) => pk));
      await this.put([...last.values()].filter((e): e is Entry => e !== null));
    }).catch((e) => {
      const line = `[search] ${e instanceof Error ? e.message : String(e)}`;
      this.errors.push(line);
      this.log(line);
    });
  }

  // Resolves when every commit followed so far is in the index.
  settled(): Promise<void> {
    return this.chain.then(
      () => undefined,
      () => undefined,
    );
  }

  // The closest entries of one project to the query, nearest first. Exact inside the project's bucket.
  search(projectId: string, query: string, options: { limit?: number; kinds?: readonly SearchKind[] } = {}): Promise<Hit[]> {
    const k = Math.min(Math.max(Math.trunc(options.limit ?? 8), 1), 50);
    const kinds = (options.kinds?.length ? options.kinds : SEARCH_KINDS).filter((x) => SEARCH_KINDS.includes(x));
    return this.queue(async () => {
      const [q] = await this.embedder.embed([clip(query, MAX_TEXT)]);
      const params: Record<string, unknown> = { scope: projectId, q };
      let where = "scope = $scope";
      if (kinds.length < SEARCH_KINDS.length) {
        kinds.forEach((kind, i) => (params[`k${i}`] = kind));
        where += ` AND (${kinds.map((_, i) => `kind = $k${i}`).join(" OR ")})`;
      }
      const res = (await (await this.live()).execute(`SCAN "${this.lobe}" WHERE ${where} LIMIT 10000 | NEAREST ${k} BY emb TO $q USING cosine`, params)) as { records?: Record<string, unknown>[] };
      return (res.records ?? []).map((r, i) => ({ kind: r.kind as SearchKind, ref: String(r.ref), title: String(r.title ?? ""), snippet: String(r.snippet ?? ""), rank: i + 1 }));
    });
  }

  // Empties the index. For tests.
  async purge(): Promise<void> {
    await (await this.live()).execute(`PURGE "${this.lobe}"`);
  }
}
