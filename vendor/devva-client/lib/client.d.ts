/** High-level client: one method per xyTalk verb, plus a fluent query builder. */
import { Connection } from "./protocol.js";
import { AggregateResult, type Fields, Record, RecordSet } from "./types.js";
/** A scalar xyTalk value. */
export type Scalar = string | number | boolean | null;
/**
 * A single `WHERE` condition value in the object form:
 * - a scalar → equality (`field = value`);
 * - an array → membership (`field IN [...]`);
 * - a single-key operator object → `{ ">": 5000 }`, `{ "!=": "x" }`,
 *   `{ contains: "tech" }`, `{ in: [...] }`, `{ is_null: true }`, `{ is_not_null: true }`.
 */
export type WhereValue = Scalar | Scalar[] | {
    [op: string]: Scalar | Scalar[] | boolean;
};
/** The object form of a `WHERE` predicate — an AND-combined conjunction. */
export type WhereObject = {
    [field: string]: WhereValue;
};
/**
 * A `WHERE` predicate: an object (AND conjunction, value-escaped) or a raw
 * predicate string (the escape hatch for the full `OR` / `NOT` / parenthesised
 * tree). Build raw strings from trusted text; for untrusted values use
 * {@link Client.execute} with bound `$params`.
 */
export type WhereInput = string | WhereObject;
/** The query argument to {@link QueryBuilder.nearest}: a vector (an array or a typed array) or a `REF "id"`. */
export type NearestQuery = ArrayLike<number> | string;
/** A `LINK TO ... WHERE ... AS ...` relationship for a linked write. */
export interface LinkTo {
    /** Parent lobe; defaults to the record's own lobe. */
    lobe?: string;
    /** Predicate selecting the parent record. */
    where: WhereInput;
    /** Relation name. */
    as: string;
}
/** Options for {@link Client.put}. */
export interface PutOptions {
    /** Optional relationship to a parent record. */
    link?: LinkTo;
    /** Conflict policy; only `"update"` (upsert on the anchor) is supported. */
    onConflict?: "update";
}
/**
 * A connected devva engine session exposing one method per xyTalk verb.
 *
 * Construct with {@link Client.connect} (or the {@link connect} helper). A client
 * owns one TCP connection; requests are serialised. Authentication is
 * transparent: if `DEVVA_TOKEN` is set, the bearer token is sent on connect.
 */
/**
 * Who produced a lobe's embeddings, and under what conditions. Required by
 * `VECTOR`.
 *
 * Three fields and not one because a vector is a function of more than the model
 * name, and the guard cannot be the dimension: two runtimes give the same width
 * and different vectors, so a graph built on one and served from the other looks
 * identical and answers wrong.
 */
export interface EmbedderIdentity {
    /** Model that produces the embeddings. */
    embedder: string;
    /** Exact revision of it. A model name alone is not an identity. */
    revision: string;
    /** Execution profile — the part the dimension cannot catch. */
    runtime: string;
}
export declare class Client {
    private readonly conn;
    private constructor();
    /**
     * Connect to an devva engine server. Prefer `127.0.0.1` over `localhost` under high
     * concurrency to avoid the dual IPv4/IPv6 connection budget.
     *
     * @throws {ConnectionError} If the socket cannot be opened.
     */
    static connect(host?: string, port?: number, timeoutMs?: number): Promise<Client>;
    /** Close the underlying TCP connection. Idempotent. */
    close(): void;
    /**
     * Whether this client can still carry a statement.
     *
     * `false` once the connection is closed or has met a transport error — this
     * client never reconnects, so a dead one stays dead and must be replaced. The
     * check is local and costs no round trip.
     */
    get isAlive(): boolean;
    /**
     * Execute a raw xyTalk statement, optionally with bound `$name` params.
     *
     * The escape hatch for syntax the fluent API does not cover. Pass untrusted
     * values through `params` (protocol V4) rather than string interpolation.
     * `timeoutMs` overrides the client default for this statement only.
     */
    execute(query: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
    /**
     * Insert a single record into a lobe. Prefix a field key with `*` to make it a
     * gravity field. Pass `{ onConflict: "update" }` to upsert on the anchor, or
     * `{ link }` for a relationship to a parent record.
     *
     * @throws {DevvaError} (rejects) If a field value is `undefined`.
     */
    put(lobe: string, fields: Fields, options?: PutOptions): Promise<unknown>;
    /**
     * Insert many records in one atomic batch (the engine caps a batch at 10,000
     * records; chunk larger loads into ≤10K slices). `link`, if given, is applied
     * to every record.
     *
     * @throws {DevvaError} (rejects) If a field value is `undefined`.
     */
    putBatch(lobe: string, records: Fields[], options?: {
        link?: LinkTo;
    }): Promise<unknown>;
    /**
     * Start a `FIND` (indexed anchor/gravity lookup). Omit `where` to match the
     * whole lobe. `FIND` is AND-only — use {@link Client.scan} for `OR` / `NOT`.
     */
    find(lobe: string, where?: WhereInput): QueryBuilder;
    /** Start a `FIND` by local identifier (LID). */
    findLid(lid: string): QueryBuilder;
    /**
     * Start a `SCAN` (lobe iteration). Without a `.limit()` the server caps
     * results at 1,000 rows (hard ceiling 10,000); paginate with `.cursor()`.
     */
    scan(lobe: string, where?: WhereInput): QueryBuilder;
    /** Scan a named ghost (materialised view) explicitly. */
    scanGhost(name: string, where?: WhereInput): QueryBuilder;
    /**
     * Read several co-located lobes in one call (`FETCH`, v1). Returns one envelope
     * whose fields are a named section per lobe. `where` is required (the
     * co-location key); `asNames`, if given, must supply one name per lobe.
     *
     * @throws {DevvaError} If `where` is empty or `asNames` length differs from `lobes`.
     */
    fetch(lobes: string[], where: WhereInput, asNames?: string[]): Promise<unknown>;
    /**
     * Empty a lobe — remove every record (`PURGE`, v1). Destructive; the
     * deliberate counterpart to a `WHERE`-guarded `DELETE`.
     */
    purge(lobe: string): Promise<unknown>;
    /**
     * Delete the records of a lobe matching `where` (`DELETE "lobe" WHERE …`).
     *
     * The standalone counterpart to the pipeline form
     * ({@link QueryBuilder.delete}). There is **no cascade**: linked children are
     * not touched, whatever a relationship was declared. To empty a whole lobe use
     * {@link Client.purge}.
     *
     * @throws {DevvaError} (rejects) If `where` is empty.
     */
    deleteWhere(lobe: string, where: WhereInput): Promise<unknown>;
    /**
     * Create a relationship between two existing records
     * (`LINK "from" WHERE … TO "to" WHERE … AS "rel"`).
     *
     * **A link made this way is not visible to `PULL`.** `PULL` reads the gravity
     * bucket of the root record, and the standalone statement rewrites the child in
     * place without re-bucketing it, so the engine confirms a write the traversal
     * never visits. For parent/child reads, declare `GRAVITY BY <parent_field>` on
     * the child lobe — the co-location makes "the children of this record" a bucket
     * read — or create the link with `put(..., { link })` **within one lobe**, which
     * does co-locate. Tracked as E-3.
     */
    link(options: {
        /** Lobe holding the child record. */
        from: string;
        /** Predicate selecting the child. */
        where?: WhereInput;
        /** Lobe holding the parent record. */
        to: string;
        /** Predicate selecting the parent. */
        toWhere?: WhereInput;
        /** Relation name. */
        as: string;
    }): Promise<unknown>;
    /** Declare a lobe, with an optional human-readable hint. */
    createLobe(name: string, hint?: string): Promise<unknown>;
    /** Declare a unique anchor (constraint + O(1) dictionary lookup). */
    createAnchor(field: string, uniqueIn: string): Promise<unknown>;
    /**
     * Declare a field as a searchable embedding (f32 vector column).
     *
     * The identity is required by the engine and passed as an object so the three
     * same-typed strings are named at the call site rather than ordered. The
     * engine stores them and never interprets them — it does not embed, so it
     * cannot check that an incoming vector came from what you declared. Keeping
     * the declaration true is the caller's half of the contract.
     */
    createVector(field: string, lobe: string, identity: EmbedderIdentity): Promise<unknown>;
    /**
     * Declare the gravity (on-disk co-location) key for a lobe. `spec` is a field,
     * a fold of one (`lower(email)`, `trim(name)`), or a tuple (`(tenant, region)`).
     */
    gravityBy(spec: string, lobe: string): Promise<unknown>;
    /**
     * Declare the sub-gravity (satellite) axis for a lobe.
     *
     * Splits each gravity bucket into sub-buckets keyed by `field`, so a query
     * pinning both the gravity field and this one reads only the matching rows. A
     * pure optimisation: same rows, same order, never different results.
     *
     * The lobe must be **empty** — declaring the axis over existing data would
     * leave those rows in the default sub-bucket, unreachable by a bounded
     * per-satellite query. Declare it before the first write.
     *
     * @throws {DevvaError} If the lobe is not empty, or has no gravity declared.
     */
    satelliteBy(field: string, lobe: string): Promise<unknown>;
    /**
     * Return the raw `SHOW LOBES` response — an `info` array of display lines.
     *
     * For the catalog as data, use {@link Client.listLobes}.
     */
    showLobes(): Promise<unknown>;
    /**
     * Return the raw `SHOW ANCHORS` response — an `info` array of display lines.
     *
     * For the catalog as data, use {@link Client.listAnchors}.
     */
    showAnchors(lobe: string): Promise<unknown>;
    /**
     * The declared lobes as data: name, anchor count and hint.
     *
     * The engine answers the whole `SHOW` family with display lines, so this parses
     * them. Lines it does not recognise are skipped rather than guessed at; the
     * unparsed original stays available through {@link Client.showLobes}.
     */
    listLobes(): Promise<LobeInfo[]>;
    /** The anchors declared on a lobe, as data. See {@link Client.listLobes}. */
    listAnchors(lobe: string): Promise<AnchorInfo[]>;
    /** Return the active write-throttle profile and state. */
    showThrottle(): Promise<unknown>;
    /** Return the lobes held in the record cache and their entry counts. */
    showCache(): Promise<unknown>;
    /** Return auto-anchor suggestions tracked for a lobe. */
    showAutoanchor(lobe: string): Promise<unknown>;
    /**
     * Create a permanent ghost (materialised view) over a lobe. `orderBy`, if
     * given, is a field or a metric (`sum(amount)`), optionally followed by
     * `ASC` / `DESC`, for a metric-ordered rollup.
     */
    createGhost(name: string, fromLobe: string, where?: WhereInput, orderBy?: string): Promise<unknown>;
    /** Return all ghosts, by type and status. */
    showGhosts(): Promise<unknown>;
    /** Delete a ghost permanently. */
    dropGhost(name: string): Promise<unknown>;
    /** Drop and rebuild a ghost (e.g. after a large write burst). */
    refreshGhost(name: string): Promise<unknown>;
}
/** A lobe as reported by `SHOW LOBES`. */
export interface LobeInfo {
    /** Lobe name. */
    readonly name: string;
    /** How many anchors are declared on it. */
    readonly anchors: number;
    /** The declared hint, when the lobe has one. */
    readonly hint?: string;
}
/** An anchor as reported by `SHOW ANCHORS`. */
export interface AnchorInfo {
    /** Field the anchor is declared on. */
    readonly field: string;
    /** Whether the engine reported it `UNIQUE` (every anchor is, today). */
    readonly unique: boolean;
}
/** Open a connection to an devva engine server (convenience for {@link Client.connect}). */
export declare function connect(host?: string, port?: number, timeoutMs?: number): Promise<Client>;
/**
 * A fluent builder for a `FIND` / `SCAN` / `SCAN GHOST` statement.
 *
 * Trailing clauses (`orderBy` / `limit` / `cursor`) and pipeline steps (`pull` /
 * `groupBy` / `nearest` / `take` / `shape` / `follow` / `agg`) are assembled in
 * the order the engine requires regardless of call order; a terminal (`execute`
 * / `records` / `one` / `set` / `delete` / `aggregate`) sends the statement.
 */
export declare class QueryBuilder {
    private readonly conn;
    private readonly base;
    private readonly steps;
    private readonly selective;
    private orderByClause?;
    private limitN?;
    private cursorTok?;
    private timeoutMs?;
    /** The first refused argument, reported by the terminal call. */
    private invalid;
    /** @internal Constructed by {@link Client} read methods. */
    constructor(conn: Connection, base: string | (() => string));
    /** Sort results by a field. `SCAN ORDER BY` requires a `.limit()`. */
    orderBy(field: string, descending?: boolean): this;
    /** Cap the result page at `n` rows (hard ceiling 10,000). */
    limit(n: number): this;
    /** Resume pagination from an opaque cursor token. */
    cursor(tok: string): this;
    /**
     * Give this statement its own deadline, overriding the client default.
     *
     * A deadline that expires closes the connection and leaves the statement's
     * effect **indeterminate** — the client stops waiting, it does not cancel
     * anything. Use it to bound a read; for a write, pair it with an idempotent
     * shape (anchored `PUT` + `ON CONFLICT UPDATE`) instead of a retry.
     */
    timeout(ms: number): this;
    /** Append `PULL` to fetch linked descendants up to `depth`. */
    pull(depth?: number, only?: string): this;
    /** Append `GROUP BY`. Pair with {@link QueryBuilder.aggregate} / {@link QueryBuilder.agg}. */
    groupBy(field: string): this;
    /**
     * Append `NEAREST` (v1 phrase form). Pass a query vector (`number[]`) or a
     * `REF` id (`string`). Metrics: `"cosine"`, `"dot"`, `"l2"`.
     */
    nearest(field: string, query: NearestQuery, k?: number, metric?: string): this;
    /**
     * Append `TAKE` — top-N over an aggregate (`by` set) or a plain stream
     * truncation (`by` omitted). `descending` is ignored without `by`.
     */
    take(n: number, by?: string, descending?: boolean): this;
    /** Append `SHAPE` — project each record down to the named fields. */
    shape(...fields: string[]): this;
    /** Append `FOLLOW` — resolve `field`'s value as `on` in lobe `to` (cross-lobe). */
    follow(field: string, to: string, on: string): this;
    /**
     * Append `AGGREGATE` as a non-terminal step (so a `TAKE` can follow). For the
     * plain "give me the numbers" case use {@link QueryBuilder.aggregate}.
     */
    agg(...metrics: string[]): this;
    /** Run a builder step, holding a refusal for the terminal call to reject with. */
    private guard;
    /** Render the assembled xyTalk statement without sending it. */
    statement(): string;
    /**
     * Append `SET` and execute, updating the matched record(s) in place.
     *
     * @throws {DevvaError} (rejects) If an assigned value is `undefined`.
     */
    set(fields: Fields): Promise<unknown>;
    /**
     * Append `DELETE` and execute. A selection is required (a `WHERE` or a
     * pipeline that produced records); there is no cascade. To empty a whole lobe
     * use {@link Client.purge}.
     *
     * @throws {DevvaError} (rejects) If the statement has no selection.
     */
    delete(): Promise<unknown>;
    /**
     * Append `AGGREGATE` and execute, returning the computed metrics.
     *
     * After a {@link QueryBuilder.groupBy} the engine answers with one row per
     * group: read {@link AggregateResult.groups}, not the flat accessors. To chain
     * a `TAKE`, use the non-terminal {@link QueryBuilder.agg} and end with `execute`.
     */
    aggregate(...metrics: string[]): Promise<AggregateResult>;
    /** Send the statement and return the raw JSON response. */
    execute(): Promise<unknown>;
    /**
     * Send the statement and return the matched rows as a {@link RecordSet}.
     *
     * The set iterates like an array and also carries `budgetStop`, `hasMore` and
     * `cursor` — the envelope a bare `Record[]` could not hold, which is how a
     * `NEAREST` truncated by the latency budget used to arrive indistinguishable
     * from a complete answer. A `PULL` root comes back as a single-element set.
     *
     * There is no numeric index signature: use `.at(0)` (or `.records[0]`).
     */
    records(): Promise<RecordSet>;
    /**
     * Send the statement and return the first matched record, or `null`.
     *
     * Warns (once) if the result was cut by the latency budget and `budgetStop`
     * was not read — the row returned may not be the true best match.
     */
    one(): Promise<Record | null>;
}
/**
 * Build one `AGGREGATE` metric expression, with optional alias and per-metric
 * filter (`func() [AS <alias>] [WHERE <predicate>]`, v1). `AS` precedes `WHERE`.
 */
export declare function metric(func: string, alias?: string, where?: WhereInput): string;
