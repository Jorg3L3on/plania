/**
 * Low-level framed TCP transport for the devva engine binary wire protocol.
 *
 * A request is `[version: u8][format: u8][len: u32 BE][payload]`, plus a
 * trailing `[len: u32 BE][params-json]` block when parameters are bound (which
 * switches the version byte to V4). Responses are `[status: u8][len: u32 BE]
 * [body]`. Most callers use {@link Client} instead.
 */
import net from "node:net";
import { ConnectionError, TimeoutError, DevvaError } from "./errors.js";
const PROTOCOL_V2 = 0x02;
const PROTOCOL_V4 = 0x04; // query + bound params (anti-injection)
const FORMAT_JSON = 0x02;
const FORMAT_TEXT = 0x00;
const STATUS_OK = 0x00;
const STATUS_ERROR = 0x01;
/** Bearer-token preamble magic byte (sent when `DEVVA_TOKEN` is set). */
const AUTH_MAGIC = 0x41;
const MAX_AUTH_TOKEN_LEN = 4096;
/** The server rejects frames larger than this (16 MiB); checked client-side. */
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
/**
 * A framed connection to an devva engine server. Requests are serialised internally,
 * so one connection carries a single request/response stream at a time.
 */
/**
 * Encode a bearer-token auth frame: `[0x41][len: u16 BE][token: UTF-8]`.
 *
 * @throws {DevvaError} If the token exceeds the wire limit.
 */
export function encodeAuth(token) {
    const tokenBytes = Buffer.from(token, "utf8");
    if (tokenBytes.length > MAX_AUTH_TOKEN_LEN) {
        throw new DevvaError(`DEVVA_TOKEN exceeds ${MAX_AUTH_TOKEN_LEN} bytes`);
    }
    const frame = Buffer.alloc(3 + tokenBytes.length);
    frame.writeUInt8(AUTH_MAGIC, 0);
    frame.writeUInt16BE(tokenBytes.length, 1);
    tokenBytes.copy(frame, 3);
    return frame;
}
/**
 * Encode a request frame: `[version][format][len: u32 BE][payload]` for V2, plus
 * a trailing `[len: u32 BE][params-json]` block for V4 (when `params` is given).
 * The params block is canonical JSON (compact, UTF-8, non-ASCII not escaped) —
 * identical across all clients so the wire is byte-for-byte the same.
 *
 * @throws {DevvaError} If the statement or params block exceeds the frame limit.
 */
export function encodeRequest(query, fmt, params) {
    const payload = Buffer.from(query, "utf8");
    if (payload.length > MAX_FRAME_SIZE) {
        throw new DevvaError(`statement is ${payload.length} bytes, over the server's ${MAX_FRAME_SIZE}-byte ` +
            `(16 MiB) frame limit; send fewer records per PUT BATCH or split the statement`, "FRAME_TOO_LARGE");
    }
    if (params !== undefined) {
        const paramsBytes = Buffer.from(JSON.stringify(params), "utf8");
        if (paramsBytes.length > MAX_FRAME_SIZE) {
            throw new DevvaError(`params block is ${paramsBytes.length} bytes, over the server's ${MAX_FRAME_SIZE}-byte ` +
                `(16 MiB) frame limit`, "FRAME_TOO_LARGE");
        }
        const header = Buffer.alloc(6);
        header.writeUInt8(PROTOCOL_V4, 0);
        header.writeUInt8(fmt, 1);
        header.writeUInt32BE(payload.length, 2);
        const paramsLen = Buffer.alloc(4);
        paramsLen.writeUInt32BE(paramsBytes.length, 0);
        return Buffer.concat([header, payload, paramsLen, paramsBytes]);
    }
    const header = Buffer.alloc(6);
    header.writeUInt8(PROTOCOL_V2, 0);
    header.writeUInt8(fmt, 1);
    header.writeUInt32BE(payload.length, 2);
    return Buffer.concat([header, payload]);
}
/**
 * Decode a full JSON response frame `[status: u8][len: u32 BE][body]`.
 *
 * @returns The decoded JSON body on an OK status.
 * @throws {DevvaError} On an error status (with the server code/message) or a
 *   malformed / undecodable frame.
 */
export function decodeResponse(frame) {
    if (frame.length < 5) {
        throw new DevvaError("truncated response frame", "PROTOCOL_ERROR");
    }
    const status = frame.readUInt8(0);
    const length = frame.readUInt32BE(1);
    const body = frame.subarray(5, 5 + length);
    if (status === STATUS_ERROR) {
        const text = body.toString("utf8");
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw classifyPlainTextError(text);
        }
        if (parsed !== null && typeof parsed === "object") {
            const { error, code } = parsed;
            if (typeof code === "string")
                throw new DevvaError(error ?? text, code);
            if (typeof error === "string")
                throw new DevvaError(error, "UNKNOWN");
        }
        throw classifyPlainTextError(text);
    }
    try {
        return JSON.parse(body.toString("utf8"));
    }
    catch (err) {
        throw new DevvaError(`invalid JSON response: ${err.message}`, "PROTOCOL_ERROR");
    }
}
/**
 * Classify a `STATUS_ERROR` body that is not the documented JSON error object.
 *
 * PROTOCOL.md §8: a failure raised before a format is negotiated — a rejected
 * token, an unsupported version — arrives as a plain `ERROR: …` string carrying
 * no code. Reporting all of them as `UNKNOWN` made a rejected token
 * indistinguishable from an unclassifiable failure, which is the one case the
 * caller must act on differently.
 */
/**
 * What to check when a connection dies without explaining itself.
 *
 * A rejected bearer token is the common cause and the server cannot always tell
 * us: it writes its error frame and closes, and a client that has already sent
 * the next statement gets an RST that discards whatever had not been read yet.
 * So the hint has to come from the client's own knowledge — whether it sent a
 * token at all.
 */
function tokenHint() {
    return process.env.DEVVA_TOKEN
        ? "; a server that rejects the bearer token fails exactly this way — check DEVVA_TOKEN"
        : "; if the server requires a bearer token, set DEVVA_TOKEN";
}
function classifyPlainTextError(text) {
    const message = text.replace(/^ERROR:\s*/, "");
    if (/\bauth\b|\btoken\b/i.test(message)) {
        return new DevvaError(`${message} — the server requires a bearer token; set DEVVA_TOKEN before connecting`, "AUTH_FAILED");
    }
    return new DevvaError(message, "PROTOCOL_ERROR");
}
/**
 * The error for a statement arriving after another one closed the connection.
 *
 * Handing it the first statement's error would be a false report: a timeout
 * says "may have executed", and this statement never left the process.
 */
function notSent(reason) {
    return new ConnectionError(`the connection was closed because ${reason}; this statement was not sent — ` +
        `open a new connection`);
}
export class Connection {
    socket;
    timeoutMs;
    buf = Buffer.alloc(0);
    waiter = null;
    fatal = null;
    /** What later statements are told when `fatal` describes one statement only. */
    refusal = null;
    chain = Promise.resolve();
    constructor(socket, timeoutMs) {
        this.socket = socket;
        this.timeoutMs = timeoutMs;
        this.socket.on("data", (chunk) => {
            this.buf = Buffer.concat([this.buf, chunk]);
            this.drain();
        });
        this.socket.on("error", (err) => this.fail(new ConnectionError(`socket error: ${err.message}`)));
        this.socket.on("close", () => this.fail(new ConnectionError("Connection closed by server")));
    }
    /**
     * Open the socket and, if `DEVVA_TOKEN` is set, send the auth frame.
     *
     * @throws {ConnectionError} If the socket cannot be opened or times out.
     * @throws {DevvaError} If `DEVVA_TOKEN` exceeds the wire limit.
     */
    static connect(host, port, timeoutMs = 30_000) {
        return new Promise((resolve, reject) => {
            const socket = net.connect({ host, port });
            socket.setNoDelay(true);
            const onConnectError = (err) => {
                reject(new ConnectionError(`Failed to connect to ${host}:${port}: ${err.message}`));
            };
            socket.once("error", onConnectError);
            socket.setTimeout(timeoutMs, () => {
                socket.destroy();
                reject(new ConnectionError(`Connect to ${host}:${port} timed out`));
            });
            socket.once("connect", () => {
                socket.removeListener("error", onConnectError);
                socket.setTimeout(0);
                const conn = new Connection(socket, timeoutMs);
                const token = process.env.DEVVA_TOKEN;
                if (token) {
                    try {
                        conn.sendAuthFrame(token);
                    }
                    catch (err) {
                        reject(err);
                        return;
                    }
                }
                resolve(conn);
            });
        });
    }
    sendAuthFrame(token) {
        this.socket.write(encodeAuth(token));
    }
    /**
     * Whether this connection can still carry a statement.
     *
     * `false` once the socket is closed or a transport error has been recorded —
     * this client never reconnects, so a dead connection stays dead. Cheap and
     * local: it costs no round trip, which is what makes it usable as a pool's
     * borrow-time check.
     */
    get isAlive() {
        return this.fatal === null && !this.socket.destroyed;
    }
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
    executeJson(query, params, timeoutMs) {
        const deadline = timeoutMs ?? this.timeoutMs;
        return this.enqueue(async () => {
            if (this.fatal)
                throw this.refusal ?? this.fatal;
            const frame = encodeRequest(query, FORMAT_JSON, params);
            const timer = setTimeout(() => this.fail(new TimeoutError(`statement timed out after ${deadline}ms; the connection is closed and the ` +
                `statement's effect is indeterminate — it may have executed on the server. ` +
                `Read the record back, or make the write idempotent with an anchored PUT ` +
                `and ON CONFLICT UPDATE, rather than retrying blindly`), notSent("an earlier statement timed out")), deadline);
            try {
                this.socket.write(frame);
                const head = await this.readExact(5);
                const status = head.readUInt8(0);
                const length = head.readUInt32BE(1);
                // Checked before the length so a peer that is not speaking this protocol
                // (a TLS alert, an HTTP banner) is named as that, not as a huge frame.
                if (status !== STATUS_OK && status !== STATUS_ERROR) {
                    throw this.desync(new DevvaError(`unknown response status 0x${status.toString(16).padStart(2, "0")}; ` +
                        `the peer is not speaking this protocol, or the stream is out of step`, "PROTOCOL_ERROR"));
                }
                // Bound the announced length BEFORE reading it: the value came over the
                // socket, the server never emits a frame past MAX_FRAME_SIZE, and reading
                // a larger one anyway turns one malformed length into unbounded memory.
                // PROTOCOL.md §10: this number is where a client rejects.
                if (length > MAX_FRAME_SIZE) {
                    throw this.desync(new DevvaError(`server announced a ${length}-byte frame, over the ${MAX_FRAME_SIZE}-byte ` +
                        `(16 MiB) limit; refusing to read it, and the connection is closed`, "FRAME_TOO_LARGE"));
                }
                let body;
                try {
                    body = await this.readExact(length);
                }
                catch (err) {
                    // The header said "error" and the body never came: the server wrote its
                    // reason and closed, and the statement we had already sent drew an RST
                    // that discarded the rest. Reporting the close alone would throw away
                    // the one fact we do hold — that the server answered with an error.
                    if (status === STATUS_ERROR && !(err instanceof TimeoutError)) {
                        throw new DevvaError(`the server answered with an error and closed before its message ` +
                            `arrived${tokenHint()}`, "PROTOCOL_ERROR");
                    }
                    throw err;
                }
                // A frame read whole leaves the stream in step whatever its body holds:
                // the engine answers some statements with an empty or non-JSON body on
                // purpose, so a decode failure here rejects this call and nothing else.
                return decodeResponse(Buffer.concat([head, body]));
            }
            finally {
                clearTimeout(timer);
            }
        });
    }
    /** Close the underlying socket. Idempotent. */
    close() {
        try {
            this.socket.destroy();
        }
        catch {
            // already closed
        }
    }
    enqueue(task) {
        const result = this.chain.then(task, task);
        this.chain = result.then(() => undefined, () => undefined);
        return result;
    }
    readExact(n) {
        if (this.fatal)
            return Promise.reject(this.fatal);
        if (this.buf.length >= n) {
            const out = Buffer.from(this.buf.subarray(0, n));
            this.buf = this.buf.subarray(n);
            return Promise.resolve(out);
        }
        return new Promise((resolve, reject) => {
            this.waiter = { need: n, resolve, reject };
        });
    }
    drain() {
        const w = this.waiter;
        if (w && this.buf.length >= w.need) {
            this.waiter = null;
            const out = Buffer.from(this.buf.subarray(0, w.need));
            this.buf = this.buf.subarray(w.need);
            w.resolve(out);
        }
    }
    /**
     * A complete `STATUS_ERROR` frame already sitting in the buffer, decoded.
     *
     * The server answers a rejected token with an error frame and then closes the
     * connection. When the close is observed first the frame is still unread, and
     * reporting the close turns "your token is wrong" into "connection closed by
     * server" — which is what made a rejected token arrive as an unclassified
     * failure whose cause was on the socket all along.
     */
    bufferedServerError() {
        if (this.buf.length < 5 || this.buf.readUInt8(0) !== STATUS_ERROR)
            return null;
        const length = this.buf.readUInt32BE(1);
        if (length > MAX_FRAME_SIZE || this.buf.length < 5 + length)
            return null;
        try {
            decodeResponse(this.buf.subarray(0, 5 + length));
            return null; // unreachable: an error status always throws
        }
        catch (err) {
            return err instanceof Error ? err : null;
        }
    }
    /**
     * Close after a response that could not be framed, and return `err` to throw.
     *
     * The refused frame's bytes stay on the socket; left open, the next statement
     * would read them as its own header — and could decode someone else's answer.
     */
    desync(err) {
        // Dropped first: these bytes are the tail of the refused frame, and `fail`
        // would otherwise try to read a server error out of them.
        this.buf = Buffer.alloc(0);
        this.fail(err, notSent("an earlier response could not be framed"));
        return err;
    }
    fail(err, refusal) {
        if (!this.fatal) {
            const serverError = this.bufferedServerError();
            this.fatal = serverError ?? err;
            if (!serverError && refusal)
                this.refusal = refusal;
        }
        const w = this.waiter;
        this.waiter = null;
        // The waiter gets the recorded cause, not the raw transport event: a caller
        // awaiting a statement must see the server's reason when there was one.
        if (w)
            w.reject(this.fatal);
        try {
            this.socket.destroy();
        }
        catch {
            // already closed
        }
    }
}
//# sourceMappingURL=protocol.js.map