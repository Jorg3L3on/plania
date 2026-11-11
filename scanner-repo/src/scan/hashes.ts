// Vendored from src/lib/scan for the private scanner repo. No plaintext patterns.
// PLA-I38-1: match names and other exact personal values by hash. The list is salt + sha256 hex
// digests of normalized strings. Plaintext never belongs in the repo.

import { createHash } from "node:crypto";
import { valueAllowed, type Allowlist } from "./patterns.ts";

export type HashList = { salt: string; hashes: Set<string> };

/** Lowercase, strip accents, collapse whitespace. Punctuation inside a token stays. */
export function normalizeToken(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** sha256(salt + normalized token), hex. No separator between salt and token. */
export function hashToken(salt: string, token: string): string {
  return createHash("sha256").update(salt, "utf8").update(token, "utf8").digest("hex");
}

/** Whitespace tokens, plus 2- and 3-word sequences, from one line. */
export function candidateTokens(line: string): string[] {
  const words = normalizeToken(line)
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length >= 2 && word.length <= 500)
    .slice(0, 80);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (token: string) => {
    if (token.length < 2 || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };
  for (const word of words) push(word);
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i + size <= words.length; i++) push(words.slice(i, i + size).join(" "));
  }
  return out;
}

export function parseHashList(text: string): HashList {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("hash list is not json");
  }
  if (!data || typeof data !== "object") throw new Error("hash list is not usable");
  const salt = (data as { salt?: unknown }).salt;
  const hashes = (data as { hashes?: unknown }).hashes;
  if (typeof salt !== "string" || salt.length === 0 || salt.length > 512) throw new Error("hash list is not usable");
  if (!Array.isArray(hashes)) throw new Error("hash list is not usable");
  const set = new Set<string>();
  for (const entry of hashes) {
    if (typeof entry !== "string" || !/^[a-f0-9]{64}$/i.test(entry)) throw new Error("hash list is not usable");
    set.add(entry.toLowerCase());
  }
  return { salt, hashes: set };
}

function tokenAllowed(token: string, allow: Allowlist): boolean {
  if (valueAllowed(token, allow)) return true;
  for (const exact of allow.exact) if (normalizeToken(exact) === token) return true;
  return false;
}

/** True when a token or n-gram on the line is in the hash list and not allowlisted. */
export function lineHasKnownString(line: string, list: HashList, allow: Allowlist): boolean {
  for (const token of candidateTokens(line)) {
    if (tokenAllowed(token, allow)) continue;
    if (list.hashes.has(hashToken(list.salt, token))) return true;
  }
  return false;
}
