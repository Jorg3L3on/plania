import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 TOTP: HMAC-SHA1, 6 digits, 30 second step, verifier window ±1.
// PLA-I36-11: the owner's code. No new dependency. The secret never leaves this module except as base32 for the
// one-time enrol reply.

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

// Tests move this so two codes in the same second do not share a time step.
export const ownerClock = { now: (): number => Date.now() };

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomSecret(): Buffer {
  return randomBytes(20);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.trim().replace(/=+$/g, "").replace(/[\s-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// otpauth URI as text. No QR library. The label is the product, not a person.
export function otpauthUri(secretBase32: string): string {
  const label = encodeURIComponent("Plania:dueño");
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: "Plania",
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params}`;
}

export function hotp(secret: Buffer, counter: bigint, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

export function totp(secret: Buffer, nowMs = ownerClock.now()): string {
  const counter = BigInt(Math.floor(nowMs / 1000 / TOTP_STEP_SEC));
  return hotp(secret, counter);
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// The matched time step, or null. A code is only valid for one step; the window covers clock skew.
export function matchTotp(secret: Buffer, code: string, nowMs = ownerClock.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const counter = BigInt(Math.floor(nowMs / 1000 / TOTP_STEP_SEC));
  let found: number | null = null;
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const step = counter + BigInt(delta);
    if (step < 0n) continue;
    if (sameCode(hotp(secret, step), code)) found = Number(step);
  }
  return found;
}
