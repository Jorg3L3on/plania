/**
 * Result types returned by the client.
 *
 * {@link Record} wraps a single row (with optional nested `PULL` children);
 * {@link RecordSet} wraps a set of rows together with the response envelope
 * (`budget_stop` / `has_more` / `cursor`); {@link AggregateResult} wraps the
 * output of an `AGGREGATE` pipeline.
 */
const HIDDEN_KEYS = new Set(["lid", "lobe", "created_at", "updated_at", "_type"]);
function isHidden(key) {
    return HIDDEN_KEYS.has(key) || key.startsWith("_");
}
/**
 * A single record returned by `FIND` / `SCAN` / `PULL` / `FETCH`.
 *
 * Fields are read via {@link Record.get} (or the typed helpers); linked children
 * from a `PULL` are lifted out of `_related` and exposed via {@link Record.related}.
 */
export class Record {
    /** The record's top-level fields (without the lifted `_related`). */
    data;
    /** Linked child records (populated by `PULL`). */
    related;
    /** @param raw - The decoded record object from the server response. */
    constructor(raw) {
        const { _related, ...rest } = raw;
        this.data = rest;
        this.related = Array.isArray(_related)
            ? _related.map((child) => new Record(child))
            : [];
    }
    /** Return a field's raw value, or `undefined` if absent. */
    get(key) {
        return this.data[key];
    }
    /** Return a field as a string, or `undefined` if absent or not a string. */
    getString(key) {
        const v = this.data[key];
        return typeof v === "string" ? v : undefined;
    }
    /** Return a field as a number, or `undefined` if absent or not a number. */
    getNumber(key) {
        const v = this.data[key];
        return typeof v === "number" ? v : undefined;
    }
    /** Return a field as a boolean, or `undefined` if absent or not a boolean. */
    getBoolean(key) {
        const v = this.data[key];
        return typeof v === "boolean" ? v : undefined;
    }
    /** Return the record's field names (top level only). */
    keys() {
        return Object.keys(this.data);
    }
    /** Return a plain nested object copy (children under `_related`). */
    toObject() {
        if (this.related.length === 0)
            return { ...this.data };
        return { ...this.data, _related: this.related.map((r) => r.toObject()) };
    }
    /**
     * Render a compact, token-frugal text view of the record tree. Domain-agnostic:
     * uses `_type` as the header and the first visible field as the identifier.
     */
    toCompact() {
        const lines = [];
        formatCompact(this, 0, lines);
        return lines.join("\n");
    }
}
function formatCompact(record, indent, lines) {
    const prefix = "  ".repeat(indent);
    const typeName = record.getString("_type") ?? "Record";
    const visible = Object.entries(record.data).filter(([k]) => !isHidden(k));
    const identifier = visible.length > 0 ? formatScalar(visible[0][1]) : "";
    const rest = visible.slice(1).map(([, v]) => formatScalar(v));
    let line = `${prefix}${typeName}`;
    if (identifier)
        line += ` ${identifier}`;
    if (rest.length > 0)
        line += `: ${rest.join(" | ")}`;
    lines.push(line);
    for (const child of record.related) {
        formatCompact(child, indent + 1, lines);
    }
}
function formatScalar(value) {
    if (typeof value === "string") {
        return value.length > 50 ? `${value.slice(0, 47)}...` : value;
    }
    return String(value);
}
/**
 * Rows plus the response envelope that says whether they are the whole answer.
 *
 * Iterable (`for..of`, spread, `Array.from`) with `length`, `at`, `map`, `filter`
 * and `forEach`, and carrying the three envelope fields a bare array could not:
 * {@link RecordSet.budgetStop}, {@link RecordSet.hasMore} and
 * {@link RecordSet.cursor}.
 *
 * **A truncated set warns when consumed unchecked.** If `budget_stop` is present
 * and nothing has read {@link RecordSet.budgetStop}, the first consumption emits
 * one `console.warn`. Reading `budgetStop` — even just testing it for
 * `undefined` — is what marks the cut as checked.
 *
 * Note there is **no numeric index signature**: `set[0]` is a compile error, on
 * purpose. TypeScript can refuse it outright, which is a louder signal than any
 * runtime warning, and `set[0]` could not have warned anyway — a plain property
 * read runs no code.
 */
/**
 * Pull the staleness words out of a response envelope.
 *
 * Shared by both result types because the envelope is the same object in both,
 * and because an extractor per type is how one of them ends up reading a key the
 * other does not.
 */
function staleReasonsOf(envelope) {
    const words = envelope["stale_reasons"];
    return Array.isArray(words) ? words.filter((w) => typeof w === "string") : [];
}
export class RecordSet {
    rows;
    envelope;
    stop;
    stopChecked;
    warned = false;
    /** @param response - The decoded flat/paginated response object. */
    constructor(response) {
        this.envelope = response;
        const raw = response["records"];
        this.rows = Array.isArray(raw) ? raw.map((r) => new Record(r)) : [];
        const stop = response["budget_stop"];
        this.stop = stop ?? undefined;
        // True when there is nothing to check: a complete result must never warn.
        this.stopChecked = this.stop === undefined;
    }
    /**
     * The latency-airbag cut, or `undefined` when the result is complete.
     *
     * Reading this marks the truncation as checked, so consuming the rows
     * afterwards does not warn.
     */
    get budgetStop() {
        this.stopChecked = true;
        return this.stop;
    }
    /** Whether the server holds further rows beyond this page. */
    get hasMore() {
        return this.envelope["has_more"] === true;
    }
    /** The opaque token that resumes pagination, or `undefined` on the last page. */
    get cursor() {
        const c = this.envelope["cursor"];
        return typeof c === "string" ? c : undefined;
    }
    /** The rows as a plain array. Consuming these counts as consuming the set. */
    get records() {
        this.warnIfUnchecked();
        return this.rows;
    }
    /** The number of rows in this set. Does not count as consuming it. */
    get length() {
        return this.rows.length;
    }
    /** The row at `index`, or `undefined`. Negative indices count from the end. */
    at(index) {
        this.warnIfUnchecked();
        return this.rows.at(index);
    }
    /** Map over the rows. */
    map(fn) {
        this.warnIfUnchecked();
        return this.rows.map(fn);
    }
    /** Filter the rows. */
    filter(fn) {
        this.warnIfUnchecked();
        return this.rows.filter(fn);
    }
    /** Visit each row. */
    forEach(fn) {
        this.warnIfUnchecked();
        this.rows.forEach(fn);
    }
    /** The undecorated server response, exactly as received. */
    raw() {
        return this.envelope;
    }
    /** Why this answer may be wrong, in words; empty when nothing was flagged. */
    staleReasons() {
        return staleReasonsOf(this.envelope);
    }
    [Symbol.iterator]() {
        this.warnIfUnchecked();
        return this.rows[Symbol.iterator]();
    }
    /** Warn once if rows are consumed while a truncation sits unchecked. */
    warnIfUnchecked() {
        if (this.stopChecked || this.warned || this.stop === undefined)
            return;
        this.warned = true;
        const s = this.stop;
        console.warn(`devva: reading a truncated result without checking .budgetStop: the ` +
            `server stopped at ${s.examined} of ${s.candidates} candidates ` +
            `(${s.strategy}) and returned ${s.found} row(s). These are not all the ` +
            `matches. Read .budgetStop to silence this.`);
    }
}
function isFields(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * The result of an `AGGREGATE` (or `GROUP BY | AGGREGATE`) pipeline.
 *
 * The two shapes are **not** interchangeable: an ungrouped pipeline answers with
 * flat metrics ({@link AggregateResult.data}, {@link AggregateResult.get}), a
 * grouped one with one row per group ({@link AggregateResult.groups}). Reading a
 * grouped result through the flat accessors used to return `{}` with no error —
 * the shape that put zeroes in front of users — so it now warns once.
 *
 * Metrics are reachable by their server key or by a normalised name:
 * `sum(hours)` is also matched by `sum_hours`.
 */
export class AggregateResult {
    metrics;
    groupRows;
    envelope;
    read = false;
    /** @param response - The full server response (`aggregation` or `groups`). */
    constructor(response) {
        const body = isFields(response) ? response : {};
        this.metrics = isFields(body["aggregation"]) ? body["aggregation"] : {};
        const groups = body["groups"];
        this.groupRows = Array.isArray(groups) ? groups : undefined;
        this.envelope = body;
    }
    /** The undecorated server response, exactly as received. */
    raw() {
        return this.envelope;
    }
    /**
     * Why this answer may be wrong, in words; empty when nothing was flagged.
     *
     * A `GROUP BY | AGGREGATE` served by a ghost the engine has marked inexact is
     * the case this exists for, and the one shape where the numbers look complete
     * regardless. `raw()` carries `stale_ghost`, which names the ghost to `REFRESH`.
     */
    staleReasons() {
        return staleReasonsOf(this.envelope);
    }
    /**
     * One row per group for a `GROUP BY | AGGREGATE`, or `undefined` when the
     * pipeline was not grouped.
     *
     * Each row carries the grouping field beside its metrics, exactly as the engine
     * sent it. Reading this counts as reading the result as grouped, so the flat
     * accessors stop warning.
     */
    get groups() {
        this.read = true;
        return this.groupRows;
    }
    /** Whether the server answered with groups rather than flat metrics. */
    get isGrouped() {
        return this.groupRows !== undefined;
    }
    /** The flat metrics of an ungrouped `AGGREGATE`; empty for a grouped one. */
    get data() {
        this.warnIfGrouped();
        return this.metrics;
    }
    /** Return a metric by key, or by its normalised name (`sum(x)` → `sum_x`). */
    get(key) {
        this.warnIfGrouped();
        if (key in this.metrics)
            return this.metrics[key];
        for (const k of Object.keys(this.metrics)) {
            const clean = k.replace(/\(/g, "_").replace(/\)/g, "").replace(/ /g, "_");
            if (clean === key)
                return this.metrics[k];
        }
        return undefined;
    }
    /** The total `count`, if present. */
    get count() {
        const v = this.get("count");
        return typeof v === "number" ? v : undefined;
    }
    /** Warn once if a grouped result is read as though it were flat. */
    warnIfGrouped() {
        if (this.read || this.groupRows === undefined)
            return;
        this.read = true;
        console.warn(`devva: reading a grouped AGGREGATE through the flat accessors. The engine ` +
            `returned ${this.groupRows.length} group(s) in .groups; .data and .get() are ` +
            `empty for a grouped pipeline and always will be. Read .groups instead.`);
    }
}
//# sourceMappingURL=types.js.map