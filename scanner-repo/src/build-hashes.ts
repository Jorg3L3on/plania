// PLA-I38-3: build a hash list on the operator's machine. Plaintext stays off the repo and off the log.
// Same construction as pnpm scan:hashes: sha256(salt + normalized line), no separator.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hashToken, normalizeToken } from "./scan/hashes.ts";

const usage = "usage: node --experimental-strip-types src/build-hashes.ts --in <plaintext.txt> --out <hashes.json> [--salt <salt>]\n";

export function parseHashArgs(argv: string[], envSalt = ""): { inPath: string; outPath: string; salt: string } | { error: string } {
  let inPath = "";
  let outPath = "";
  let salt = envSalt;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--in" || arg === "--out" || arg === "--salt") {
      if (!next || next.startsWith("-")) return { error: usage.trim() };
      i++;
      if (arg === "--in") inPath = next;
      else if (arg === "--out") outPath = next;
      else salt = next;
    } else return { error: usage.trim() };
  }
  if (!inPath || !outPath || !salt) return { error: usage.trim() };
  return { inPath, outPath, salt };
}

export function hashesFromLines(lines: string, salt: string): string[] {
  const hashes: string[] = [];
  for (const raw of lines.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const token = normalizeToken(line);
    if (token.length < 2) continue;
    hashes.push(hashToken(salt, token));
  }
  return hashes;
}

function invokedDirectly(): boolean {
  const file = process.argv[1];
  if (!file) return false;
  return import.meta.url === pathToFileURL(file).href;
}

if (invokedDirectly()) {
  const parsed = parseHashArgs(process.argv.slice(2), process.env.PLANIA_SCAN_HASH_SALT ?? "");
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = 2;
  } else {
    const hashes = hashesFromLines(readFileSync(parsed.inPath, "utf8"), parsed.salt);
    const body = `${JSON.stringify({ v: 1, algorithm: "sha256", salt: parsed.salt, hashes }, null, 2)}\n`;
    writeFileSync(parsed.outPath, body, { mode: 0o600 });
    process.stderr.write(`wrote ${hashes.length} ${hashes.length === 1 ? "hash" : "hashes"}\n`);
  }
}
