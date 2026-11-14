/** Error hierarchy raised by the devva engine client. */
/**
 * Error codes the server can send, and what a caller does with them.
 *
 * Preserved on {@link DevvaError.code} rather than flattened into one type, because
 * they are not interchangeable: `THROTTLED` means retry, `DUPLICATE_ANCHOR` is
 * business semantics a caller may build idempotency on, `PARSE_ERROR` is a bug in
 * the statement and retrying it is pointless.
 *
 * The set is the wire contract (`PROTOCOL.md` §8) and is pinned against
 * `protocol/vectors.json` by the golden test, so it cannot drift from the shared
 * vocabulary silently.
 */
export declare const SERVER_ERROR_CODES: readonly ["PARSE_ERROR", "LOBE_NOT_FOUND", "RECORD_NOT_FOUND", "DUPLICATE_ANCHOR", "TYPE_ERROR", "INVALID_QUERY", "STORAGE_ERROR", "THROTTLED", "INTERNAL_ERROR"];
/**
 * Codes this client raises on its own; never seen on the wire.
 *
 * The list is exhaustive by test: `repro.test.ts` sweeps the source for every
 * code passed to {@link DevvaError} and fails if one is missing from here or from
 * {@link SERVER_ERROR_CODES}. A caller can therefore switch on `code` knowing the
 * two lists are the whole vocabulary.
 */
export declare const CLIENT_ERROR_CODES: readonly ["CONNECTION_ERROR", "TIMEOUT", "AUTH_FAILED", "PROTOCOL_ERROR", "INVALID_USAGE", "INVALID_IDENTIFIER", "FRAME_TOO_LARGE", "UNKNOWN"];
/**
 * Base class for all devva engine errors.
 *
 * The message form is `[CODE] message`, mirroring the reference clients.
 */
export declare class DevvaError extends Error {
    /** Short machine-readable code (e.g. `"UNKNOWN"`, `"LOBE_NOT_FOUND"`). */
    readonly code: string;
    /**
     * @param message - Human-readable error text.
     * @param code - Short machine-readable code.
     */
    constructor(message: string, code?: string);
}
/**
 * A transport-level failure (connect, send, receive, or a closed socket).
 *
 * Carries `"CONNECTION_ERROR"`, except for {@link TimeoutError}, which narrows the
 * code without leaving the class.
 */
export declare class ConnectionError extends DevvaError {
    /**
     * @param message - Description of the transport failure.
     * @param code - Narrowed code; defaults to `"CONNECTION_ERROR"`.
     */
    constructor(message: string, code?: string);
}
/**
 * A statement that did not answer within its deadline; it **may have executed**.
 *
 * The client stopped waiting, it cancelled nothing: read a timed-out write back,
 * or make it idempotent (anchored `PUT` + `ON CONFLICT UPDATE`). A
 * {@link ConnectionError} because the connection is closed — a late answer would
 * desynchronise it. Raised only for the statement that was waiting; later ones
 * were never sent and get a plain {@link ConnectionError}.
 */
export declare class TimeoutError extends ConnectionError {
    /** @param message - Description of the deadline that expired. */
    constructor(message: string);
}
