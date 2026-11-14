/**
 * Result types returned by the client.
 *
 * {@link Record} wraps a single row (with optional nested `PULL` children);
 * {@link RecordSet} wraps a set of rows together with the response envelope
 * (`budget_stop` / `has_more` / `cursor`); {@link AggregateResult} wraps the
 * output of an `AGGREGATE` pipeline.
 */
/** A raw JSON object of record fields. */
export type Fields = {
    [key: string]: unknown;
};
/**
 * A single record returned by `FIND` / `SCAN` / `PULL` / `FETCH`.
 *
 * Fields are read via {@link Record.get} (or the typed helpers); linked children
 * from a `PULL` are lifted out of `_related` and exposed via {@link Record.related}.
 */
export declare class Record {
    /** The record's top-level fields (without the lifted `_related`). */
    readonly data: Fields;
    /** Linked child records (populated by `PULL`). */
    readonly related: Record[];
    /** @param raw - The decoded record object from the server response. */
    constructor(raw: Fields);
    /** Return a field's raw value, or `undefined` if absent. */
    get(key: string): unknown;
    /** Return a field as a string, or `undefined` if absent or not a string. */
    getString(key: string): string | undefined;
    /** Return a field as a number, or `undefined` if absent or not a number. */
    getNumber(key: string): number | undefined;
    /** Return a field as a boolean, or `undefined` if absent or not a boolean. */
    getBoolean(key: string): boolean | undefined;
    /** Return the record's field names (top level only). */
    keys(): string[];
    /** Return a plain nested object copy (children under `_related`). */
    toObject(): Fields;
    /**
     * Render a compact, token-frugal text view of the record tree. Domain-agnostic:
     * uses `_type` as the header and the first visible field as the identifier.
     */
    toCompact(): string;
}
/**
 * Why a `NEAREST` came back short: the counts at the latency-airbag cut.
 *
 * Present only on a truncated result — an ordinary complete or cursor-paged
 * response has no `budgetStop`. The trio describes **the cut**, not the returned
 * set.
 */
export interface BudgetStop {
    /**
     * Candidates whose filter was checked before the cut. Counts passers and
     * non-passers alike — the numerator of the fraction checked.
     */
    readonly examined: number;
    /**
     * The whole scored set (the gravity bucket) before the filter. **Not** the
     * number of matches.
     */
    readonly candidates: number;
    /** Passers returned; equals the row count by construction. */
    readonly found: number;
    /**
     * Which traversal produced the partial, and therefore **what kind** of partial
     * it is. `"score_order"` means the rows are a true *prefix* — nothing
     * unexamined scores better. `"key_order"` means they are the best of a
     * contiguous *key region*, so the unwalked part may hold **better** rows, not
     * merely more. Do not extrapolate the observed pass rate to the tail under
     * `"key_order"`.
     */
    readonly strategy: string;
}
export declare class RecordSet implements Iterable<Record> {
    private readonly rows;
    private readonly envelope;
    private readonly stop?;
    private stopChecked;
    private warned;
    /** @param response - The decoded flat/paginated response object. */
    constructor(response: Fields);
    /**
     * The latency-airbag cut, or `undefined` when the result is complete.
     *
     * Reading this marks the truncation as checked, so consuming the rows
     * afterwards does not warn.
     */
    get budgetStop(): BudgetStop | undefined;
    /** Whether the server holds further rows beyond this page. */
    get hasMore(): boolean;
    /** The opaque token that resumes pagination, or `undefined` on the last page. */
    get cursor(): string | undefined;
    /** The rows as a plain array. Consuming these counts as consuming the set. */
    get records(): Record[];
    /** The number of rows in this set. Does not count as consuming it. */
    get length(): number;
    /** The row at `index`, or `undefined`. Negative indices count from the end. */
    at(index: number): Record | undefined;
    /** Map over the rows. */
    map<T>(fn: (record: Record, index: number) => T): T[];
    /** Filter the rows. */
    filter(fn: (record: Record, index: number) => boolean): Record[];
    /** Visit each row. */
    forEach(fn: (record: Record, index: number) => void): void;
    /** The undecorated server response, exactly as received. */
    raw(): Fields;
    /** Why this answer may be wrong, in words; empty when nothing was flagged. */
    staleReasons(): string[];
    [Symbol.iterator](): Iterator<Record>;
    /** Warn once if rows are consumed while a truncation sits unchecked. */
    private warnIfUnchecked;
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
export declare class AggregateResult {
    private readonly metrics;
    private readonly groupRows;
    private readonly envelope;
    private read;
    /** @param response - The full server response (`aggregation` or `groups`). */
    constructor(response: unknown);
    /** The undecorated server response, exactly as received. */
    raw(): Fields;
    /**
     * Why this answer may be wrong, in words; empty when nothing was flagged.
     *
     * A `GROUP BY | AGGREGATE` served by a ghost the engine has marked inexact is
     * the case this exists for, and the one shape where the numbers look complete
     * regardless. `raw()` carries `stale_ghost`, which names the ghost to `REFRESH`.
     */
    staleReasons(): string[];
    /**
     * One row per group for a `GROUP BY | AGGREGATE`, or `undefined` when the
     * pipeline was not grouped.
     *
     * Each row carries the grouping field beside its metrics, exactly as the engine
     * sent it. Reading this counts as reading the result as grouped, so the flat
     * accessors stop warning.
     */
    get groups(): Fields[] | undefined;
    /** Whether the server answered with groups rather than flat metrics. */
    get isGrouped(): boolean;
    /** The flat metrics of an ungrouped `AGGREGATE`; empty for a grouped one. */
    get data(): Fields;
    /** Return a metric by key, or by its normalised name (`sum(x)` → `sum_x`). */
    get(key: string): unknown;
    /** The total `count`, if present. */
    get count(): number | undefined;
    /** Warn once if a grouped result is read as though it were flat. */
    private warnIfGrouped;
}
//# sourceMappingURL=types.d.ts.map