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

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
  maxAge: SESSION_MAX_AGE,
} as const;
