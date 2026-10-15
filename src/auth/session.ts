import { createHmac, timingSafeEqual } from "node:crypto";

// Handoff §7: cookie plania_session = v1.<exp>.<sig>, HMAC-SHA256 with SESSION_SECRET.
// No sessions table. exp is unix seconds.
export const SESSION_COOKIE = "plania_session";
export const SESSION_MAX_AGE = 2592000; // 30 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || Buffer.byteLength(s) < 32) throw new Error("SESSION_SECRET must be at least 32 bytes");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSession(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const [, expStr, sig] = parts as [string, string, string];
  if (!/^\d+$/.test(expStr)) return false;
  const expected = Buffer.from(sign(`v1.${expStr}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(expStr) > Math.floor(now / 1000);
}

// 2.12: the cookie is Secure whenever the browser is on a secure origin: HTTPS directly, HTTPS that a
// reverse proxy on this Mac terminated (tailscale serve sends X-Forwarded-Proto: https), or a loopback
// host (localhost, 127.0.0.1, [::1]), which browsers treat as secure and accept Secure cookies from.
// The forwarded header is trusted because the server binds 127.0.0.1: only this Mac can reach it.
// Anything else (plain http to another name, which only a misconfigured proxy could send) gets a
// non-Secure cookie, so the login still works there instead of failing silently.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  const url = new URL(req.url);
  if (url.protocol === "https:") return true;
  const host = (req.headers.get("Host") ?? url.host).toLowerCase().replace(/:\d+$/, "");
  return LOOPBACK.has(host) || host.endsWith(".localhost");
}

export const sessionCookieOptions = (req: Request) =>
  ({
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  }) as const;
