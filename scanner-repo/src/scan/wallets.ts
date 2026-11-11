// Vendored from src/lib/scan for the private scanner repo. No plaintext patterns.
// PLA-I38-1: wallet address shapes. Checksums (BTC) and decoded length (Solana) live here because
// a gitleaks regex cannot verify them. Synthetic fixtures are derived from a label, never from a
// real key.

import { createHash } from "node:crypto";

export type LineHit = { rule: string; label: string; value: string };

const EVM = /\b0x[a-fA-F0-9]{40}\b/g;
const BECH32 = /\b(?:bc|tb)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{14,74}\b/gi;
const BASE58 = /\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g;
const SOLANA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const ZERO_EVM = "0x0000000000000000000000000000000000000000";

export function fixtureBytes(label: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let filled = 0;
  let counter = 0;
  while (filled < size) {
    const block = createHash("sha256").update(`plania-scan-fixture:${label}:${counter}`).digest();
    for (const byte of block) {
      if (filled >= size) break;
      out[filled++] = byte;
    }
    counter++;
  }
  return out;
}

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes++;
  const digits = [0];
  for (let i = zeroes; i < bytes.length; i++) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeroes);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i] ?? 0] ?? "";
  return out;
}

export function decodeBase58(text: string): Uint8Array | null {
  if (text.length === 0) return new Uint8Array();
  let zeroes = 0;
  while (zeroes < text.length && text[zeroes] === "1") zeroes++;
  const bytes = [0];
  for (let i = zeroes; i < text.length; i++) {
    const value = ALPHABET.indexOf(text[i] ?? "");
    if (value < 0) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeroes + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i] ?? 0;
  return out;
}

function sha256(data: Uint8Array): Uint8Array {
  return createHash("sha256").update(data).digest();
}

function checksum4(body: Uint8Array): Uint8Array {
  return sha256(sha256(body)).subarray(0, 4);
}

export function encodeBase58Check(version: number, payload: Uint8Array): string {
  const body = new Uint8Array(1 + payload.length);
  body[0] = version;
  body.set(payload, 1);
  const check = checksum4(body);
  const full = new Uint8Array(body.length + check.length);
  full.set(body, 0);
  full.set(check, body.length);
  return encodeBase58(full);
}

export function validBtcBase58(address: string): boolean {
  const raw = decodeBase58(address);
  if (!raw || raw.length !== 25) return false;
  const body = raw.subarray(0, 21);
  const check = raw.subarray(21);
  const expect = checksum4(body);
  for (let i = 0; i < 4; i++) if (check[i] !== expect[i]) return false;
  const version = body[0];
  return (version === 0x00 || version === 0x05) && body.length === 21;
}

function polymod(values: number[]): number {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((((chk & 0x1ffffff) << 5) ^ value) >>> 0);
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk = (chk ^ (generator[i] ?? 0)) >>> 0;
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const char of hrp) out.push(char.charCodeAt(0) >> 5);
  out.push(0);
  for (const char of hrp) out.push(char.charCodeAt(0) & 31);
  return out;
}

function convertBits(data: Uint8Array, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << to) - 1;
  const out: number[] = [];
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) return null;
  return out;
}

function bech32Checksum(hrp: string, data: number[], spec: "bech32" | "bech32m"): number[] {
  const constant = spec === "bech32" ? 1 : 0x2bc830a3;
  const poly = polymod(hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0])) ^ constant;
  const out: number[] = [];
  for (let i = 0; i < 6; i++) out.push((poly >>> (5 * (5 - i))) & 31);
  return out;
}

/** Witness version 0 uses bech32. Versions 1–16 use bech32m. */
export function encodeBech32(hrp: string, version: number, program: Uint8Array): string {
  const grouped = convertBits(program, 8, 5, true);
  if (!grouped) throw new Error("bech32 program did not convert");
  const spec = version === 0 ? "bech32" : "bech32m";
  const data = [version, ...grouped];
  const combined = data.concat(bech32Checksum(hrp, data, spec));
  return hrp + "1" + combined.map((part) => BECH32_CHARSET[part] ?? "").join("");
}

export function validBtcBech32(address: string): boolean {
  const lower = address.toLowerCase();
  const splitAt = lower.lastIndexOf("1");
  if (splitAt < 1 || splitAt + 7 > lower.length) return false;
  const hrp = lower.slice(0, splitAt);
  if (hrp !== "bc" && hrp !== "tb") return false;
  const data: number[] = [];
  for (const char of lower.slice(splitAt + 1)) {
    const value = BECH32_CHARSET.indexOf(char);
    if (value < 0) return false;
    data.push(value);
  }
  const spec = polymod(hrpExpand(hrp).concat(data));
  return spec === 1 || spec === 0x2bc830a3;
}

export function syntheticEvm(label: string): string {
  return `0x${Buffer.from(fixtureBytes(label, 20)).toString("hex")}`;
}

export function syntheticBtcBase58(label: string): string {
  return encodeBase58Check(0x00, fixtureBytes(label, 20));
}

export function syntheticBtcBech32(label: string): string {
  return encodeBech32("bc", 0, fixtureBytes(label, 20));
}

export function syntheticSolana(label: string): string {
  return encodeBase58(fixtureBytes(label, 32));
}

function pushUnique(hits: LineHit[], seen: Set<string>, rule: string, label: string, value: string) {
  if (seen.has(value)) return;
  seen.add(value);
  hits.push({ rule, label, value });
}

/** Wallet shapes in one line. Values stay in memory for the allowlist; callers must not print them. */
export function walletHits(line: string): LineHit[] {
  const hits: LineHit[] = [];
  const seen = new Set<string>();
  for (const match of line.matchAll(EVM)) {
    if (match[0].toLowerCase() === ZERO_EVM) continue;
    pushUnique(hits, seen, "plania-evm-address", "dirección EVM", match[0]);
  }
  for (const match of line.matchAll(BECH32)) {
    if (!validBtcBech32(match[0])) continue;
    pushUnique(hits, seen, "plania-btc-bech32", "dirección Bitcoin bech32", match[0]);
  }
  for (const match of line.matchAll(BASE58)) {
    if (!validBtcBase58(match[0])) continue;
    pushUnique(hits, seen, "plania-btc-base58", "dirección Bitcoin base58", match[0]);
  }
  for (const match of line.matchAll(SOLANA)) {
    const decoded = decodeBase58(match[0]);
    if (!decoded || decoded.length !== 32) continue;
    pushUnique(hits, seen, "plania-solana-address", "dirección Solana", match[0]);
  }
  return hits;
}
