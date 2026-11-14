/** High-level client: one method per xyTalk verb, plus a fluent query builder. */
import { DevvaError } from "./errors.js";
import { Connection } from "./protocol.js";
import { AggregateResult, RecordSet } from "./types.js";
/**
 * NEAREST scores only the scanned candidate set; without an explicit `LIMIT` the
 * server caps `SCAN` at 1000 rows, silently truncating recall. Since NEAREST
 * returns only `k`, its candidate window defaults to the SCAN hard maximum so
 * recall stays exact up to the ceiling.
 */
const NEAREST_DEFAULT_LIMIT = 10_000;
export class Client {
    conn;
    constructor(conn) {
        this.conn = conn;
    }
    /**
     * Connect to an devva engine server. Prefer `127.0.0.1` over `localhost` under high
     * concurrency to avoid the dual IPv4/IPv6 connection budget.
     *
     * @throws {ConnectionError} If the socket cannot be opened.
     */
    static async connect(host = "localhost", port = 2505, timeoutMs = 30_000) {
        return new Client(await Connection.connect(host, port, timeoutMs));
    }
    /** Close the underlying TCP connection. Idempotent. */
    close() {
        this.conn.close();
    }
    /**
     * Whether this client can still carry a statement.
     *
     * `false` once the connection is closed or has met a transport error — this
     * client never reconnects, so a dead one stays dead and must be replaced. The
     * check is local and costs no round trip.
     */
    get isAlive() {
        return this.conn.isAlive;
    }
    /**
     * Execute a raw xyTalk statement, optionally with bound `$name` params.
     *
     * The escape hatch for syntax the fluent API does not cover. Pass untrusted
     * values through `params` (protocol V4) rather than string interpolation.
     * `timeoutMs` overrides the client default for this statement only.
     */
    async execute(query, params, timeoutMs) {
        return this.conn.executeJson(query, params, timeoutMs);
    }
    // ── PUT ─────────────────────────────────────────────────────────────────
    /**
     * Insert a single record into a lobe. Prefix a field key with `*` to make it a
     * gravity field. Pass `{ onConflict: "update" }` to upsert on the anchor, or
     * `{ link }` for a relationship to a parent record.
     *
     * @throws {DevvaError} (rejects) If a field value is `undefined`.
     */
    async put(lobe, fields, options) {
        let query = buildPut(lobe, fields);
        if (options?.link)
            query += formatLink(options.link, lobe);
        if (options?.onConflict !== undefined) {
            if (options.onConflict !== "update") {
                throw new DevvaError(`onConflict ${show(options.onConflict)} is not supported; the only policy is "update"`, "INVALID_USAGE");
            }
            query += " ON CONFLICT UPDATE";
        }
        return this.conn.executeJson(query);
    }
    /**
     * Insert many records in one atomic batch (the engine caps a batch at 10,000
     * records; chunk larger loads into ≤10K slices). `link`, if given, is applied
     * to every record.
     *
     * @throws {DevvaError} (rejects) If a field value is `undefined`.
     */
    async putBatch(lobe, records, options) {
        let query = buildPutBatch(lobe, records);
        if (options?.link)
            query += formatLink(options.link, lobe);
        return this.conn.executeJson(query);
    }
    // ── Reads ─────────────────────────────────────────────────────────────
    /**
     * Start a `FIND` (indexed anchor/gravity lookup). Omit `where` to match the
     * whole lobe. `FIND` is AND-only — use {@link Client.scan} for `OR` / `NOT`.
     */
    find(lobe, where) {
        return new QueryBuilder(this.conn, () => select("FIND", lobe, where));
    }
    /** Start a `FIND` by local identifier (LID). */
    findLid(lid) {
        return new QueryBuilder(this.conn, () => `FIND LID("${token(lid, "LID")}")`);
    }
    /**
     * Start a `SCAN` (lobe iteration). Without a `.limit()` the server caps
     * results at 1,000 rows (hard ceiling 10,000); paginate with `.cursor()`.
     */
    scan(lobe, where) {
        return new QueryBuilder(this.conn, () => select("SCAN", lobe, where));
    }
    /** Scan a named ghost (materialised view) explicitly. */
    scanGhost(name, where) {
        return new QueryBuilder(this.conn, () => {
            let base = `SCAN GHOST ${quoted(name, "ghost")}`;
            const rendered = renderWhere(where);
            if (rendered)
                base += ` WHERE ${rendered}`;
            return base;
        });
    }
    /**
     * Read several co-located lobes in one call (`FETCH`, v1). Returns one envelope
     * whose fields are a named section per lobe. `where` is required (the
     * co-location key); `asNames`, if given, must supply one name per lobe.
     *
     * @throws {DevvaError} If `where` is empty or `asNames` length differs from `lobes`.
     */
    async fetch(lobes, where, asNames) {
        if (asNames && asNames.length !== lobes.length) {
            throw new DevvaError(`asNames must give one name per lobe: ${lobes.length} lobes, ${asNames.length} names`, "INVALID_USAGE");
        }
        const rendered = renderWhere(where);
        if (!rendered) {
            throw new DevvaError("FETCH requires a WHERE (the shared co-location key)", "INVALID_USAGE");
        }
        const lobeList = lobes.map((l) => quoted(l, "lobe")).join(", ");
        let query = `FETCH ${lobeList} WHERE ${rendered}`;
        if (asNames) {
            const names = asNames.map((n) => ident(n, "FETCH section name")).join(", ");
            query += ` AS {${names}}`;
        }
        return this.conn.executeJson(query);
    }
    /**
     * Empty a lobe — remove every record (`PURGE`, v1). Destructive; the
     * deliberate counterpart to a `WHERE`-guarded `DELETE`.
     */
    async purge(lobe) {
        return this.conn.executeJson(`PURGE ${quoted(lobe, "lobe")}`);
    }
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
    async deleteWhere(lobe, where) {
        const rendered = renderWhere(where);
        if (!rendered) {
            throw new DevvaError("DELETE requires a WHERE — add a predicate, or use client.purge() to empty a whole lobe", "INVALID_USAGE");
        }
        return this.conn.executeJson(`DELETE ${quoted(lobe, "lobe")} WHERE ${rendered}`);
    }
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
    async link(options) {
        let query = `LINK ${quoted(options.from, "lobe")}`;
        const from = renderWhere(options.where);
        if (from)
            query += ` WHERE ${from}`;
        query += ` TO ${quoted(options.to, "lobe")}`;
        const to = renderWhere(options.toWhere);
        if (to)
            query += ` WHERE ${to}`;
        query += ` AS ${quoted(options.as, "relation")}`;
        return this.conn.executeJson(query);
    }
    // ── Schema / introspection ───────────────────────────────────────────
    /** Declare a lobe, with an optional human-readable hint. */
    async createLobe(name, hint) {
        let query = `LOBE ${quoted(name, "lobe")}`;
        if (hint)
            query += ` HINT=${text(hint, "hint")}`;
        return this.conn.executeJson(query);
    }
    /** Declare a unique anchor (constraint + O(1) dictionary lookup). */
    async createAnchor(field, uniqueIn) {
        return this.conn.executeJson(`ANCHOR ${quoted(field, "anchor field")} UNIQUE IN ${quoted(uniqueIn, "lobe")}`);
    }
    /**
     * Declare a field as a searchable embedding (f32 vector column).
     *
     * The identity is required by the engine and passed as an object so the three
     * same-typed strings are named at the call site rather than ordered. The
     * engine stores them and never interprets them — it does not embed, so it
     * cannot check that an incoming vector came from what you declared. Keeping
     * the declaration true is the caller's half of the contract.
     */
    async createVector(field, lobe, identity) {
        const { embedder, revision, runtime } = identity ?? {};
        // The engine refuses VECTOR without all three; said here, by name, instead
        // of as a TypeError or a PARSE_ERROR from the other end.
        if (!embedder || !revision || !runtime) {
            throw new DevvaError("createVector needs the embedder identity as its third argument: " +
                "{ embedder, revision, runtime }, all three non-empty", "INVALID_USAGE");
        }
        return this.conn.executeJson(`VECTOR ${ident(field, "vector field")} IN ${quoted(lobe, "lobe")} ` +
            `EMBEDDER ${text(embedder, "embedder")} REVISION ${text(revision, "revision")} ` +
            `RUNTIME ${text(runtime, "runtime")}`);
    }
    /**
     * Declare the gravity (on-disk co-location) key for a lobe. `spec` is a field,
     * a fold of one (`lower(email)`, `trim(name)`), or a tuple (`(tenant, region)`).
     */
    async gravityBy(spec, lobe) {
        return this.conn.executeJson(`GRAVITY BY ${gravitySpec(spec)} IN ${quoted(lobe, "lobe")}`);
    }
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
    async satelliteBy(field, lobe) {
        return this.conn.executeJson(`SATELLITE BY ${ident(field, "satellite field")} IN ${quoted(lobe, "lobe")}`);
    }
    /**
     * Return the raw `SHOW LOBES` response — an `info` array of display lines.
     *
     * For the catalog as data, use {@link Client.listLobes}.
     */
    async showLobes() {
        return this.conn.executeJson("SHOW LOBES");
    }
    /**
     * Return the raw `SHOW ANCHORS` response — an `info` array of display lines.
     *
     * For the catalog as data, use {@link Client.listAnchors}.
     */
    async showAnchors(lobe) {
        return this.conn.executeJson(`SHOW ANCHORS IN ${quoted(lobe, "lobe")}`);
    }
    /**
     * The declared lobes as data: name, anchor count and hint.
     *
     * The engine answers the whole `SHOW` family with display lines, so this parses
     * them. Lines it does not recognise are skipped rather than guessed at; the
     * unparsed original stays available through {@link Client.showLobes}.
     */
    async listLobes() {
        const response = (await this.conn.executeJson("SHOW LOBES"));
        return infoLines(response).flatMap((line) => {
            const m = /^\s*\d+\.\s+(.+)\s+\((\d+)\s+anchors?\)(?:\s+—\s+(.*))?$/.exec(line);
            if (!m)
                return [];
            const hint = m[3];
            return [{ name: m[1], anchors: Number(m[2]), ...(hint ? { hint } : {}) }];
        });
    }
    /** The anchors declared on a lobe, as data. See {@link Client.listLobes}. */
    async listAnchors(lobe) {
        const response = (await this.showAnchors(lobe));
        return infoLines(response).flatMap((line) => {
            const m = /^\s*-\s+(.+?)(?:\s+\((UNIQUE)\))?$/.exec(line);
            if (!m)
                return [];
            return [{ field: m[1], unique: m[2] === "UNIQUE" }];
        });
    }
    /** Return the active write-throttle profile and state. */
    async showThrottle() {
        return this.conn.executeJson("SHOW THROTTLE");
    }
    /** Return the lobes held in the record cache and their entry counts. */
    async showCache() {
        return this.conn.executeJson("SHOW CACHE");
    }
    /** Return auto-anchor suggestions tracked for a lobe. */
    async showAutoanchor(lobe) {
        return this.conn.executeJson(`SHOW AUTOANCHOR IN ${quoted(lobe, "lobe")}`);
    }
    // ── Ghosts ────────────────────────────────────────────────────────────
    /**
     * Create a permanent ghost (materialised view) over a lobe. `orderBy`, if
     * given, is a field or a metric (`sum(amount)`), optionally followed by
     * `ASC` / `DESC`, for a metric-ordered rollup.
     */
    async createGhost(name, fromLobe, where, orderBy) {
        let query = `CREATE GHOST ${quoted(name, "ghost")} FROM ${quoted(fromLobe, "lobe")}`;
        const rendered = renderWhere(where);
        if (rendered)
            query += ` WHERE ${rendered}`;
        if (orderBy)
            query += ` ORDER BY ${orderTarget(orderBy, "ghost ORDER BY")}`;
        return this.conn.executeJson(query);
    }
    /** Return all ghosts, by type and status. */
    async showGhosts() {
        return this.conn.executeJson("SHOW GHOSTS");
    }
    /** Delete a ghost permanently. */
    async dropGhost(name) {
        return this.conn.executeJson(`DROP GHOST ${quoted(name, "ghost")}`);
    }
    /** Drop and rebuild a ghost (e.g. after a large write burst). */
    async refreshGhost(name) {
        return this.conn.executeJson(`REFRESH GHOST ${quoted(name, "ghost")}`);
    }
}
/** The `info` display lines of a `SHOW` response, or an empty list. */
function infoLines(response) {
    const info = response?.info;
    return Array.isArray(info) ? info.filter((l) => typeof l === "string") : [];
}
/** Open a connection to an devva engine server (convenience for {@link Client.connect}). */
export function connect(host = "localhost", port = 2505, timeoutMs = 30_000) {
    return Client.connect(host, port, timeoutMs);
}
/**
 * A fluent builder for a `FIND` / `SCAN` / `SCAN GHOST` statement.
 *
 * Trailing clauses (`orderBy` / `limit` / `cursor`) and pipeline steps (`pull` /
 * `groupBy` / `nearest` / `take` / `shape` / `follow` / `agg`) are assembled in
 * the order the engine requires regardless of call order; a terminal (`execute`
 * / `records` / `one` / `set` / `delete` / `aggregate`) sends the statement.
 */
export class QueryBuilder {
    conn;
    base;
    steps = [];
    selective;
    orderByClause;
    limitN;
    cursorTok;
    timeoutMs;
    /** The first refused argument, reported by the terminal call. */
    invalid = null;
    /** @internal Constructed by {@link Client} read methods. */
    constructor(conn, base) {
        this.conn = conn;
        let text = "";
        try {
            text = typeof base === "string" ? base : base();
        }
        catch (err) {
            this.invalid = err;
        }
        this.base = text;
        this.selective = text.includes(" WHERE ") || text.startsWith("FIND LID(");
    }
    // ── Trailing clauses ─────────────────────────────────────────────────
    /** Sort results by a field. `SCAN ORDER BY` requires a `.limit()`. */
    orderBy(field, descending = false) {
        return this.guard(() => {
            this.orderByClause = ` ORDER BY ${ident(field, "ORDER BY field")} ${descending ? "DESC" : "ASC"}`;
        });
    }
    /** Cap the result page at `n` rows (hard ceiling 10,000). */
    limit(n) {
        return this.guard(() => {
            this.limitN = int(n, "LIMIT");
        });
    }
    /** Resume pagination from an opaque cursor token. */
    cursor(tok) {
        return this.guard(() => {
            this.cursorTok = token(tok, "cursor");
        });
    }
    /**
     * Give this statement its own deadline, overriding the client default.
     *
     * A deadline that expires closes the connection and leaves the statement's
     * effect **indeterminate** — the client stops waiting, it does not cancel
     * anything. Use it to bound a read; for a write, pair it with an idempotent
     * shape (anchored `PUT` + `ON CONFLICT UPDATE`) instead of a retry.
     */
    timeout(ms) {
        this.timeoutMs = ms;
        return this;
    }
    // ── Pipeline steps ───────────────────────────────────────────────────
    /** Append `PULL` to fetch linked descendants up to `depth`. */
    pull(depth = 1, only) {
        return this.guard(() => {
            let clause = `PULL depth=${int(depth, "PULL depth")}`;
            if (only)
                clause += ` only=${ident(only, "PULL only")}`;
            this.steps.push(clause);
        });
    }
    /** Append `GROUP BY`. Pair with {@link QueryBuilder.aggregate} / {@link QueryBuilder.agg}. */
    groupBy(field) {
        return this.guard(() => {
            this.steps.push(`GROUP BY ${ident(field, "GROUP BY field")}`);
        });
    }
    /**
     * Append `NEAREST` (v1 phrase form). Pass a query vector (`number[]`) or a
     * `REF` id (`string`). Metrics: `"cosine"`, `"dot"`, `"l2"`.
     */
    nearest(field, query, k = 10, metric = "cosine") {
        return this.guard(() => {
            this.steps.push(`NEAREST ${int(k, "NEAREST k")} BY ${ident(field, "NEAREST field")} ` +
                `TO ${formatNearestQuery(query)} USING ${ident(metric, "NEAREST metric")}`);
        });
    }
    /**
     * Append `TAKE` — top-N over an aggregate (`by` set) or a plain stream
     * truncation (`by` omitted). `descending` is ignored without `by`.
     */
    take(n, by, descending = true) {
        return this.guard(() => {
            this.steps.push(by
                ? `TAKE ${int(n, "TAKE")} BY ${takeTarget(by)} ${descending ? "DESC" : "ASC"}`
                : `TAKE ${int(n, "TAKE")}`);
        });
    }
    /** Append `SHAPE` — project each record down to the named fields. */
    shape(...fields) {
        return this.guard(() => {
            this.steps.push(`SHAPE {${fields.map((f) => ident(f, "SHAPE field")).join(", ")}}`);
        });
    }
    /** Append `FOLLOW` — resolve `field`'s value as `on` in lobe `to` (cross-lobe). */
    follow(field, to, on) {
        return this.guard(() => {
            this.steps.push(`FOLLOW ${ident(field, "FOLLOW field")} TO ${quoted(to, "lobe")} ON ${ident(on, "FOLLOW ON field")}`);
        });
    }
    /**
     * Append `AGGREGATE` as a non-terminal step (so a `TAKE` can follow). For the
     * plain "give me the numbers" case use {@link QueryBuilder.aggregate}.
     */
    agg(...metrics) {
        return this.guard(() => {
            this.steps.push(`AGGREGATE ${metrics.map(metricExpr).join(", ")}`);
        });
    }
    /** Run a builder step, holding a refusal for the terminal call to reject with. */
    guard(step) {
        if (!this.invalid) {
            try {
                step();
            }
            catch (err) {
                this.invalid = err;
            }
        }
        return this;
    }
    // ── Terminals ────────────────────────────────────────────────────────
    /** Render the assembled xyTalk statement without sending it. */
    statement() {
        if (this.invalid)
            throw this.invalid;
        let query = this.base;
        if (this.orderByClause)
            query += this.orderByClause;
        // A NEAREST pipeline with no explicit LIMIT would inherit the server's
        // 1000-row SCAN default and silently truncate recall; widen the window to
        // the SCAN hard max (a no-op for the gravity-bucket fast path).
        let limit = this.limitN;
        if (limit === undefined && this.steps.some((s) => s.startsWith("NEAREST"))) {
            limit = NEAREST_DEFAULT_LIMIT;
        }
        if (limit !== undefined)
            query += ` LIMIT ${limit}`;
        if (this.cursorTok !== undefined)
            query += ` CURSOR "${token(this.cursorTok, "cursor")}"`;
        for (const step of this.steps)
            query += ` | ${step}`;
        return query;
    }
    /**
     * Append `SET` and execute, updating the matched record(s) in place.
     *
     * @throws {DevvaError} (rejects) If an assigned value is `undefined`.
     */
    async set(fields) {
        const assigns = Object.entries(fields)
            .map(([k, v]) => formatField(k, v, " = "))
            .join(", ");
        this.steps.push(`SET ${assigns}`);
        return this.conn.executeJson(this.statement(), undefined, this.timeoutMs);
    }
    /**
     * Append `DELETE` and execute. A selection is required (a `WHERE` or a
     * pipeline that produced records); there is no cascade. To empty a whole lobe
     * use {@link Client.purge}.
     *
     * @throws {DevvaError} (rejects) If the statement has no selection.
     */
    async delete() {
        if (!this.selective && this.steps.length === 0) {
            throw new DevvaError("DELETE requires a selection — add a where filter, or use client.purge() to empty a whole lobe", "INVALID_USAGE");
        }
        this.steps.push("DELETE");
        return this.conn.executeJson(this.statement(), undefined, this.timeoutMs);
    }
    /**
     * Append `AGGREGATE` and execute, returning the computed metrics.
     *
     * After a {@link QueryBuilder.groupBy} the engine answers with one row per
     * group: read {@link AggregateResult.groups}, not the flat accessors. To chain
     * a `TAKE`, use the non-terminal {@link QueryBuilder.agg} and end with `execute`.
     */
    async aggregate(...metrics) {
        this.steps.push(`AGGREGATE ${metrics.map(metricExpr).join(", ")}`);
        const response = await this.conn.executeJson(this.statement(), undefined, this.timeoutMs);
        return new AggregateResult(response);
    }
    /** Send the statement and return the raw JSON response. */
    async execute() {
        return this.conn.executeJson(this.statement(), undefined, this.timeoutMs);
    }
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
    async records() {
        const response = (await this.execute());
        const root = response?.["root"];
        if (root)
            return new RecordSet({ records: [root] });
        return new RecordSet(response ?? {});
    }
    /**
     * Send the statement and return the first matched record, or `null`.
     *
     * Warns (once) if the result was cut by the latency budget and `budgetStop`
     * was not read — the row returned may not be the true best match.
     */
    async one() {
        const set = await this.records();
        return set.at(0) ?? null;
    }
}
/**
 * Build one `AGGREGATE` metric expression, with optional alias and per-metric
 * filter (`func() [AS <alias>] [WHERE <predicate>]`, v1). `AS` precedes `WHERE`.
 */
export function metric(func, alias, where) {
    let expr = metricExpr(func);
    if (alias)
        expr += ` AS ${ident(alias, "metric alias")}`;
    if (where !== undefined) {
        const rendered = renderWhere(where);
        if (rendered)
            expr += ` WHERE ${rendered}`;
    }
    // Checked whole: a string `where` is raw, and must not end the AGGREGATE step.
    return metricExpr(expr);
}
// ── Guards ───────────────────────────────────────────────────────────────────
//
// A name is statement text: unlike a value it cannot be escaped into safety, so
// it is checked against the grammar and refused. Everything a caller supplies
// reaches a statement through one of these, a value formatter, or the two
// documented raw forms — `execute()` and a `WHERE` predicate string.
/** The engine's identifier: letters, digits, `_`, and `.` for nested access. */
const IDENT = String.raw `[\p{Alphabetic}\p{N}_.]+`;
/** The engine's whitespace: JavaScript's `\s` would also admit NBSP and U+2028. */
const WS = String.raw `[ \t\r\n]`;
/** `func()`, `func(*)` or `func(field)`. */
const CALL = String.raw `[\p{Alphabetic}\p{N}_]+\(${WS}*(?:${IDENT}|\*)?${WS}*\)`;
const IDENTIFIER = new RegExp(`^${IDENT}$`, "u");
const ORDER_TARGET = new RegExp(`^(?:${IDENT}|${CALL})(?:${WS}+(?:ASC|DESC))?$`, "iu");
/** No direction: `take()` appends its own. */
const TAKE_TARGET = new RegExp(`^(?:${IDENT}|${CALL})$`, "u");
/** Captures the predicate after `WHERE`, which {@link predicate} checks. */
const METRIC = new RegExp(`^${CALL}(?:${WS}+AS${WS}+${IDENT})?(?:${WS}+WHERE${WS}([\\s\\S]+))?$`, "iu");
const GRAVITY_SPEC = new RegExp(`^(?:${IDENT}|${CALL}|\\(${WS}*${IDENT}(?:${WS}*,${WS}*${IDENT})*${WS}*\\))$`, "u");
/** Cursor tokens (base64) and LIDs (hex groups joined by `:`). */
const TOKEN = /^[A-Za-z0-9+/=:_-]+$/;
/** A caller's input, quoted and cut, for an error message. */
function show(value) {
    const s = typeof value === "string" ? JSON.stringify(value) : String(value);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
}
function matching(pattern, value, what, expected) {
    if (typeof value !== "string" || !pattern.test(value)) {
        throw new DevvaError(`${what} ${show(value)} is not ${expected}. Names are statement text, not values: ` +
            `pass untrusted input as a value, or through execute() with bound $params`, "INVALID_IDENTIFIER");
    }
    return value;
}
/** Refuse anything outside the identifier grammar. */
function ident(value, what) {
    return matching(IDENTIFIER, value, what, "an identifier (letters, digits, '_' and '.')");
}
/** A validated name in its quoted position (lobes, ghosts, relations). */
function quoted(value, what) {
    return `"${ident(value, what)}"`;
}
/** A `PUT` / `SET` key: an identifier, optionally `*`-prefixed for gravity. */
function fieldKey(key) {
    return key.startsWith("*") ? "*" + ident(key.slice(1), "field") : ident(key, "field");
}
function orderTarget(value, what) {
    return matching(ORDER_TARGET, value, what, "a field or a metric such as sum(amount)");
}
function takeTarget(value) {
    return matching(TAKE_TARGET, value, "TAKE BY", "a metric or an alias, without ASC / DESC");
}
function metricExpr(value) {
    matching(METRIC, value, "metric", "of the form func(field) [AS alias] [WHERE predicate]");
    const tail = METRIC.exec(value)?.[1];
    if (tail !== undefined)
        predicate(tail, "metric WHERE");
    return value;
}
/**
 * A raw predicate that sits inside a statement the client builds.
 *
 * Its grammar is the engine's to check, but it must not end the statement or
 * the pipeline step it sits in: `;`, `|` and `--` are refused outside a text
 * literal, and so is a literal left open.
 */
function predicate(value, what) {
    let inText = false;
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (inText) {
            if (c === "\\")
                i++;
            else if (c === '"')
                inText = false;
        }
        else if (c === '"') {
            inText = true;
        }
        else if (c === ";" || c === "|" || (c === "-" && value[i + 1] === "-")) {
            throw new DevvaError(`${what} ${show(value)} contains '${c === "-" ? "--" : c}' outside a text literal, ` +
                `which would end the statement it is part of`, "INVALID_IDENTIFIER");
        }
    }
    if (inText) {
        throw new DevvaError(`${what} ${show(value)} leaves a text literal open`, "INVALID_IDENTIFIER");
    }
    return value;
}
function gravitySpec(value) {
    return matching(GRAVITY_SPEC, value, "gravity spec", "a field, lower(field) / trim(field), or (a, …)");
}
/**
 * Free text in a declaration (a hint, an embedder identity, a `REF` id), as an
 * escaped literal.
 *
 * `;` is refused on top of the escaping. Engines that split a request on every
 * `;`, quotes or not, exist; a value can be bound through `execute()` there,
 * and these positions cannot, so this refusal is their only defence.
 */
function text(value, what) {
    if (typeof value !== "string" || value.includes(";")) {
        throw new DevvaError(`${what} ${show(value)} must be text without ';'`, "INVALID_USAGE");
    }
    return formatValue(value);
}
function token(value, what) {
    if (typeof value !== "string" || !TOKEN.test(value)) {
        throw new DevvaError(`${show(value)} is not a valid ${what}`, "INVALID_USAGE");
    }
    return value;
}
/** A count that is interpolated bare: a `string` here would be statement text. */
function int(value, what) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DevvaError(`${what} ${show(value)} must be a non-negative integer`, "INVALID_USAGE");
    }
    return value;
}
function finite(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DevvaError(`${show(value)} is not a finite number; the language has no NaN or Infinity`, "INVALID_USAGE");
    }
    return String(value);
}
/** A typed array of numbers (`Float32Array` and the like), not a `DataView` or a `BigInt64Array`. */
function isNumberView(value) {
    return (ArrayBuffer.isView(value) &&
        !(value instanceof DataView) &&
        !(value instanceof BigInt64Array) &&
        !(value instanceof BigUint64Array));
}
/** The engine refuses a literal nested deeper than this. */
const MAX_LITERAL_DEPTH = 16;
// ── Helpers ──────────────────────────────────────────────────────────────────
function select(verb, lobe, where) {
    let base = `${verb} ${quoted(lobe, "lobe")}`;
    const rendered = renderWhere(where);
    if (rendered)
        base += ` WHERE ${rendered}`;
    return base;
}
function buildPut(lobe, fields) {
    const fieldStr = Object.entries(fields)
        .map(([k, v]) => formatField(k, v))
        .join(", ");
    return `PUT {${fieldStr}} IN ${quoted(lobe, "lobe")}`;
}
function buildPutBatch(lobe, records) {
    const items = records.map((rec) => {
        const fields = Object.entries(rec)
            .map(([k, v]) => formatField(k, v))
            .join(", ");
        return `{${fields}}`;
    });
    return `PUT BATCH IN ${quoted(lobe, "lobe")} [${items.join(", ")}]`;
}
function formatLink(link, defaultLobe) {
    const lobe = link.lobe ?? defaultLobe;
    const rendered = renderWhere(link.where) ?? "";
    return ` LINK TO ${quoted(lobe, "lobe")} WHERE ${rendered} AS ${quoted(link.as, "relation")}`;
}
function formatNearestQuery(query) {
    if (typeof query === "string")
        return `REF ${text(query, "NEAREST REF id")}`;
    if (!Array.isArray(query) && !isNumberView(query)) {
        throw new DevvaError("a NEAREST query is a vector (number[] or a typed array) or a REF id (string)", "INVALID_USAGE");
    }
    return `[${Array.from(query, (x) => finite(x)).join(", ")}]`;
}
/**
 * Render a `WHERE` predicate body (without the leading `WHERE`), or `null` when
 * there is no effective predicate.
 */
function renderWhere(where) {
    if (where === undefined)
        return null;
    if (typeof where === "string")
        return where.length > 0 ? where : null;
    const body = Object.entries(where)
        .map(([field, value]) => formatCondition(ident(field, "WHERE field"), value))
        .join(" AND ");
    return body.length > 0 ? body : null;
}
function formatCondition(field, value) {
    if (Array.isArray(value)) {
        return `${field} IN [${value.map((v) => formatValue(v)).join(", ")}]`;
    }
    if (value !== null && typeof value === "object") {
        const keys = Object.keys(value);
        if (keys.length !== 1) {
            throw new DevvaError(`operator object for '${field}' must have exactly one key`, "INVALID_USAGE");
        }
        const op = keys[0];
        return formatOperator(field, op, value[op]);
    }
    return `${field} = ${formatValue(value)}`;
}
function formatOperator(field, op, operand) {
    const o = op.toLowerCase();
    if (o === "in") {
        const items = operand.map((v) => formatValue(v)).join(", ");
        return `${field} IN [${items}]`;
    }
    if (o === "contains")
        return `${field} CONTAINS ${formatValue(operand)}`;
    if (o === "is_null")
        return `${field} IS NULL`;
    if (o === "is_not_null")
        return `${field} IS NOT NULL`;
    if (["=", "!=", ">", ">=", "<", "<="].includes(op)) {
        return `${field} ${op} ${formatValue(operand)}`;
    }
    throw new DevvaError(`unsupported WHERE operator '${op}' on field '${field}'`, "INVALID_USAGE");
}
/**
 * Format `field: value` for a `PUT`, refusing `undefined` by name.
 *
 * xyTalk has no `undefined`. An object built from optional properties carries
 * them anyway, and formatting one used to die inside `JSON.stringify` with a bare
 * `TypeError` that named neither the field nor the client.
 */
function formatField(key, value, separator = ": ", depth = 0, path = []) {
    if (value === undefined) {
        throw new DevvaError(`field '${key}' is undefined — omit the key, or pass null to store an explicit null`, "INVALID_USAGE");
    }
    return `${fieldKey(key)}${separator}${formatValue(value, depth, path)}`;
}
/** Escape the two characters a Text literal gives meaning to: `\` and `"`. */
function escapeText(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
/**
 * Format a JavaScript value as an xyTalk literal.
 *
 * `depth` counts containers as the engine does, and `path` holds the
 * containers being formatted, so a cycle is named instead of overflowing.
 */
function formatValue(value, depth = 0, path = []) {
    if (value === undefined) {
        throw new DevvaError("undefined is not an xyTalk value — omit it, or pass null for an explicit null", "INVALID_USAGE");
    }
    if (depth > MAX_LITERAL_DEPTH) {
        throw new DevvaError(`a value nests deeper than the engine's ${MAX_LITERAL_DEPTH} levels`, "INVALID_USAGE");
    }
    if (typeof value === "string") {
        return `"${escapeText(value)}"`;
    }
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number")
        return finite(value);
    if (value === null)
        return "null";
    if (typeof value !== "object") {
        throw new DevvaError(`a ${typeof value} is not an xyTalk value`, "INVALID_USAGE");
    }
    if (path.includes(value)) {
        throw new DevvaError("a value contains itself; a literal cannot be cyclic", "INVALID_USAGE");
    }
    const inner = [...path, value];
    if (Array.isArray(value)) {
        return `[${value.map((v) => formatValue(v, depth + 1, inner)).join(", ")}]`;
    }
    if (isNumberView(value))
        return `[${Array.from(value, (x) => finite(x)).join(", ")}]`;
    if (value instanceof Map || value instanceof Set) {
        // JSON.stringify writes both as "{}": the data would vanish without an error.
        const kind = value instanceof Map ? "Map" : "Set";
        throw new DevvaError(`a ${kind} is not an xyTalk value; convert it (Object.fromEntries, or an array) first`, "INVALID_USAGE");
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
        // A map literal, not JSON inside a text value: the engine stores a map, so
        // dot notation can filter it and no second layer of escapes exists to lose.
        const entries = Object.entries(value)
            .map(([k, v]) => formatField(ident(k, "map key"), v, ": ", depth + 1, inner))
            .join(", ");
        return `{${entries}}`;
    }
    // Not a map (a Date, a class instance): its JSON form, as one text value.
    const json = JSON.stringify(value);
    if (json === undefined) {
        throw new DevvaError(`a ${typeof value} is not an xyTalk value`, "INVALID_USAGE");
    }
    return `"${escapeText(json)}"`;
}
//# sourceMappingURL=client.js.map