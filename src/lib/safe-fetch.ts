// PLA-I67-4: the server's own fetch of an address the owner pasted (a reference link now; PLA-I67-6 imports skill
// folders through it). An address is a request the server makes from inside the owner's network, so:
//   - http and https only; no user name or password in the address; 2048 characters at most
//   - the host is resolved first and every address it resolves to is checked: loopback, private, link-local, the
//     cloud metadata addresses, carrier-grade NAT, multicast and the other reserved ranges are refused before any
//     byte is sent (IPv4-mapped and NAT64 IPv6 forms are checked as the IPv4 inside them)
//   - the connection goes to the address that was checked (the name is never resolved again, so a second answer
//     cannot point it elsewhere); TLS still checks the certificate against the host name
//   - a redirect is never followed: it is refused with its location, and the caller decides
//   - the body stops at maxBytes and the whole fetch at timeoutMs
// Every refusal is a SafeFetchError whose code is in src/mcp/errors.ts. Tests inject resolve and connect: nothing here
// touches the network unless the defaults run.
//
//   safeFetch(url, { resolve?, connect?, maxBytes?, timeoutMs?, accept?, headers? })
//     → { url, address, status, contentType, bytes, fetchedAt }
//   addressRefusal(ip) → "loopback" | "private" | "link_local" | "metadata" | "reserved" | null
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { ErrorCode } from "../mcp/errors.js";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;
export type ConnectRequest = { url: URL; address: string; family: 4 | 6; headers: Record<string, string>; signal: AbortSignal };
export type ConnectResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array> };
export type Connector = (req: ConnectRequest) => Promise<ConnectResponse>;

export type SafeFetchOptions = {
  resolve?: Resolver;
  connect?: Connector;
  maxBytes?: number;
  timeoutMs?: number;
  // Content types this use takes, as prefixes ("text/", "image/png"); absent: any.
  accept?: readonly string[];
  headers?: Record<string, string>;
  now?: () => Date;
};

export type SafeFetchResult = {
  url: string;
  address: string;
  status: number;
  contentType: string | null;
  bytes: Buffer;
  fetchedAt: Date;
};

export type FetchErrorCode = Extract<ErrorCode, `FETCH_${string}`>;

export class SafeFetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const SAFE_FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const SAFE_FETCH_TIMEOUT_MS = 10_000;
export const SAFE_FETCH_MAX_URL = 2048;

// ---- Addresses

export type AddressRefusal = "loopback" | "private" | "link_local" | "metadata" | "reserved";

function v4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

function v4Refusal(ip: string): AddressRefusal | null {
  const p = v4Parts(ip);
  if (!p) return "reserved";
  const [a, b, c, d] = p as [number, number, number, number];
  if (a === 169 && b === 254 && c === 169 && d === 254) return "metadata"; // AWS, GCP, Azure, OpenStack
  if (a === 100 && b === 100 && c === 100 && d === 200) return "metadata"; // Alibaba
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if (a === 169 && b === 254) return "link_local";
  if (a === 0) return "reserved"; // this network, 0.0.0.0 reaches the local host on most systems
  if (a === 100 && b >= 64 && b <= 127) return "private"; // carrier-grade NAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved"; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return "reserved"; // benchmarking
  if (a === 198 && b === 51 && c === 100) return "reserved"; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return "reserved"; // TEST-NET-3
  if (a >= 224) return "reserved"; // multicast, reserved, broadcast
  return null;
}

// Expands an IPv6 address to its eight 16-bit groups (an embedded IPv4 tail becomes the last two).
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const p = v4Parts(tail[1]!);
    if (!p) return null;
    s = `${s.slice(0, -tail[1]!.length)}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function v6Refusal(ip: string): AddressRefusal | null {
  const g = v6Groups(ip);
  if (!g) return "reserved";
  const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8)) return "reserved"; // ::
  if (zeros(7) && g[7] === 1) return "loopback"; // ::1
  if (zeros(5) && g[5] === 0xffff) return v4Refusal(v4Of(g[6]!, g[7]!)); // ::ffff:a.b.c.d
  if (zeros(6)) return v4Refusal(v4Of(g[6]!, g[7]!)) ?? "reserved"; // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Refusal(v4Of(g[6]!, g[7]!)); // NAT64
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g.slice(2, 7).every((x) => x === 0) && g[7] === 0x254) return "metadata"; // AWS
  if ((g[0]! & 0xfe00) === 0xfc00) return "private"; // unique local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return "link_local"; // fe80::/10
  if ((g[0]! & 0xffc0) === 0xfec0) return "private"; // site-local, deprecated
  if ((g[0]! & 0xff00) === 0xff00) return "reserved"; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return "reserved"; // documentation
  if (g[0] === 0x2002) {
    // 6to4 carries an IPv4 address in groups 1-2
    const inner = v4Refusal(v4Of(g[1]!, g[2]!));
    if (inner) return inner;
  }
  if (g[0] === 0x2001 && g[1] === 0) return "reserved"; // Teredo
  return null;
}

/** Why an address may not be fetched, or null when it is a public one. Anything that does not parse is refused. */
export function addressRefusal(ip: string): AddressRefusal | null {
  const kind = isIP(ip.replace(/%.*$/, ""));
  if (kind === 4) return v4Refusal(ip);
  if (kind === 6) return v6Refusal(ip);
  return "reserved";
}

// ---- The URL

/** Checks the address itself (no network): absolute, http(s), no credentials, not too long. */
export function parseFetchUrl(raw: string): URL {
  const text = raw.trim();
  if (!text || text.length > SAFE_FETCH_MAX_URL) throw new SafeFetchError("FETCH_URL_INVALID");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SafeFetchError("FETCH_URL_INVALID");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("FETCH_SCHEME_REFUSED", { scheme: url.protocol.replace(/:$/, "") });
  if (url.username || url.password) throw new SafeFetchError("FETCH_URL_INVALID");
  if (!url.hostname) throw new SafeFetchError("FETCH_URL_INVALID");
  url.hash = "";
  return url;
}

const bareHost = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

// ---- Defaults (the only code here that reaches the network)

export const defaultResolver: Resolver = async (host) => {
  const all = await lookup(host, { all: true, verbatim: true });
  return all.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

export const defaultConnector: Connector = (req) =>
  new Promise((resolve, reject) => {
    const mod = req.url.protocol === "https:" ? https : http;
    const r = mod.request(
      {
        protocol: req.url.protocol,
        hostname: bareHost(req.url),
        port: req.url.port || undefined,
        path: `${req.url.pathname}${req.url.search}`,
        method: "GET",
        headers: { Host: req.url.host, ...req.headers },
        signal: req.signal,
        autoSelectFamily: false,
        // The address checked above, never a second lookup.
        lookup: (_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: req.address, family: req.family }]) : cb(null, req.address, req.family),
        ...(req.url.protocol === "https:" && !isIP(bareHost(req.url)) ? { servername: bareHost(req.url) } : {}),
      } as http.RequestOptions,
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    r.on("error", reject);
    r.end();
  });

// ---- The fetch

const header = (h: ConnectResponse["headers"], name: string): string | null => {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
};

function withTimeout<T>(p: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) return Promise.reject(new SafeFetchError("FETCH_TIMEOUT", { timeout_ms: timeoutMs }));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new SafeFetchError("FETCH_TIMEOUT", { timeout_ms: timeoutMs }));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const url = parseFetchUrl(raw);
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS;
  const resolve = opts.resolve ?? defaultResolver;
  const connect = opts.connect ?? defaultConnector;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const host = bareHost(url);
    let addresses: ResolvedAddress[];
    if (isIP(host)) addresses = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
    else {
      try {
        addresses = await withTimeout(resolve(host), ctl.signal, timeoutMs);
      } catch (e) {
        if (e instanceof SafeFetchError) throw e;
        throw new SafeFetchError("FETCH_NOT_RESOLVED", { host });
      }
      if (addresses.length === 0) throw new SafeFetchError("FETCH_NOT_RESOLVED", { host });
    }
    // Every address the name gives must be public: one private answer among public ones is still refused.
    for (const a of addresses) {
      const reason = addressRefusal(a.address);
      if (reason) throw new SafeFetchError("FETCH_ADDRESS_REFUSED", { address: a.address, reason });
    }
    const target = addresses[0]!;
    let res: ConnectResponse;
    try {
      res = await withTimeout(
        connect({ url, address: target.address, family: target.family, headers: { Accept: "*/*", "User-Agent": "Plania/1 (reference snapshot)", ...opts.headers }, signal: ctl.signal }),
        ctl.signal,
        timeoutMs,
      );
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError(ctl.signal.aborted ? "FETCH_TIMEOUT" : "FETCH_FAILED", ctl.signal.aborted ? { timeout_ms: timeoutMs } : { reason: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
    if (res.status >= 300 && res.status < 400) {
      throw new SafeFetchError("FETCH_REDIRECT_REFUSED", { status: res.status, location: (header(res.headers, "location") ?? "").slice(0, SAFE_FETCH_MAX_URL) || null });
    }
    if (res.status < 200 || res.status >= 300) throw new SafeFetchError("FETCH_HTTP_STATUS", { status: res.status });
    const contentType = header(res.headers, "content-type")?.toLowerCase().trim() ?? null;
    if (opts.accept && !opts.accept.some((p) => (contentType ?? "").startsWith(p))) throw new SafeFetchError("FETCH_TYPE_REFUSED", { content_type: contentType });
    const declared = Number(header(res.headers, "content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new SafeFetchError("FETCH_TOO_LARGE", { max_bytes: maxBytes });
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of withTimeoutIter(res.body, ctl.signal, timeoutMs)) {
        size += chunk.length;
        if (size > maxBytes) throw new SafeFetchError("FETCH_TOO_LARGE", { max_bytes: maxBytes });
        chunks.push(Buffer.from(chunk));
      }
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError(ctl.signal.aborted ? "FETCH_TIMEOUT" : "FETCH_FAILED", ctl.signal.aborted ? { timeout_ms: timeoutMs } : { reason: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
    return { url: url.toString(), address: target.address, status: res.status, contentType, bytes: Buffer.concat(chunks), fetchedAt: (opts.now ?? (() => new Date()))() };
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}

async function* withTimeoutIter(body: AsyncIterable<Uint8Array>, signal: AbortSignal, timeoutMs: number): AsyncGenerator<Uint8Array> {
  const it = body[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await withTimeout(it.next(), signal, timeoutMs);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await it.return?.().catch(() => undefined);
  }
}
