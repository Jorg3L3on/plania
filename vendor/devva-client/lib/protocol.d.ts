/**
 * Low-level framed TCP transport for the devva engine binary wire protocol.
 *
 * A request is `[version: u8][format: u8][len: u32 BE][payload]`, plus a
 * trailing `[len: u32 BE][params-json]` block when parameters are bound (which
 * switches the version byte to V4). Responses are `[status: u8][len: u32 BE]
 * [body]`. Most callers use {@link Client} instead.
 */
declare const FORMAT_JSON = 2;
declare const FORMAT_TEXT = 0;
/**
 * The response formats this client can read.
 *
 * The wire also defines `JSON_CHUNKED` (0x03) and `BINARY_CHUNKED` (0x04), and this
 * client implements no reader for either. `encodeRequest` is exported, so before
 * this type it accepted `fmt: number` and a caller could ask the server for a
 * chunked response the client then had no code to consume. Rust's equivalent is
 * `pub(crate)` and unreachable from outside; here the guarantee has to come from the
 * type, otherwise it is only a sentence in a README. Widening this union means
 * writing the reader first.
 */
export type ResponseFormat = typeof FORMAT_TEXT | typeof FORMAT_JSON;
/**
 * A framed connection to an devva engine server. Requests are serialised internally,
 * so one connection carries a single request/response stream at a time.
 */
/**
 * Encode a bearer-token auth frame: `[0x41][len: u16 BE][token: UTF-8]`.
 *
 * @throws {DevvaError} If the token exceeds the wire limit.
 */
export declare function encodeAuth(token: string): Buffer;
/**
 * Encode a request frame: `[version][format][len: u32 BE][payload]` for V2, plus
 * a trailing `[len: u32 BE][params-json]` block for V4 (when `params` is given).
 * The params block is canonical JSON (compact, UTF-8, non-ASCII not escaped) —
 * identical across all clients so the wire is byte-for-byte the same.
 *
 * @throws {DevvaError} If the statement or params block exceeds the frame limit.
 */
export declare function encodeRequest(query: string, fmt: ResponseFormat, params?: unknown): Buffer;
/**
 * Decode a full JSON response frame `[status: u8][len: u32 BE][body]`.
 *
 * @returns The decoded JSON body on an OK status.
 * @throws {DevvaError} On an error status (with the server code/message) or a
 *   malformed / undecodable frame.
 */
export declare function decodeResponse(frame: Buffer): unknown;
export declare class Connection {
    private readonly socket;
    private readonly timeoutMs;
    private buf;
    private waiter;
    private fatal;
    /** What later statements are told when `fatal` describes one statement only. */
    private refusal;
    private chain;
    private constructor();
    /**
     * Open the socket and, if `DEVVA_TOKEN` is set, send the auth frame.
     *
     * @throws {ConnectionError} If the socket cannot be opened or times out.
     * @throws {DevvaError} If `DEVVA_TOKEN` exceeds the wire limit.
     */
    static connect(host: string, port: number, timeoutMs?: number): Promise<Connection>;
    private sendAuthFrame;
    /**
     * Whether this connection can still carry a statement.
     *
     * `false` once the socket is closed or a transport error has been recorded —
     * this client never reconnects, so a dead connection stays dead. Cheap and
     * local: it costs no round trip, which is what makes it usable as a pool's
     * borrow-time check.
     */
    get isAlive(): boolean;
    /**
     * Send a statement and return the parsed JSON response; with `params`, as V4.
     *
     * A timeout, or a response that cannot be framed, closes the connection.
     *
     * @throws {DevvaError} On an error status frame or an undecodable response.
     * @throws {TimeoutError} If the deadline expires; the effect is indeterminate.
     * @throws {ConnectionError} On transport failure, or when an earlier
     *   statement already closed the connection.
     */
    executeJson(query: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
    /** Close the underlying socket. Idempotent. */
    close(): void;
    private enqueue;
    private readExact;
    private drain;
    /**
     * A complete `STATUS_ERROR` frame already sitting in the buffer, decoded.
     *
     * The server answers a rejected token with an error frame and then closes the
     * connection. When the close is observed first the frame is still unread, and
     * reporting the close turns "your token is wrong" into "connection closed by
     * server" — which is what made a rejected token arrive as an unclassified
     * failure whose cause was on the socket all along.
     */
    private bufferedServerError;
    /**
     * Close after a response that could not be framed, and return `err` to throw.
     *
     * The refused frame's bytes stay on the socket; left open, the next statement
     * would read them as its own header — and could decode someone else's answer.
     */
    private desync;
    private fail;
}
export {};
