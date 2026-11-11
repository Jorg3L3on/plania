// Usage: pnpm scan:hashes --in <plaintext.txt> --out <hashes.json> [--salt <salt>]
// PLA-I38-1: build a local hash list from one exact value per line. The plaintext file stays on
// this machine. Output is mode 0600 and contains only the salt and sha256 hex digests.
import { writeFileSync, readFileSync } from "node:fs";
import { hashToken, normalizeToken } from "../src/lib/scan/hashes.js";

const usage = "usage: pnpm scan:hashes --in <plaintext.txt> --out <hashes.json> [--salt <salt>]\n";

function parse(argv: string[]): { inPath: string; outPath: string; salt: string } | { error: string } {
  let inPath = "";
  let outPath = "";
  let salt = process.env.PLANIA_SCAN_HASH_SALT ?? "";
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

const parsed = parse(process.argv.slice(2));
if ("error" in parsed) {
  process.stderr.write(`${parsed.error}\n`);
  process.exitCode = 2;
} else {
  const hashes: string[] = [];
  for (const raw of readFileSync(parsed.inPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const token = normalizeToken(line);
    if (token.length < 2) continue;
    hashes.push(hashToken(parsed.salt, token));
  }
  const body = `${JSON.stringify({ v: 1, algorithm: "sha256", salt: parsed.salt, hashes }, null, 2)}\n`;
  writeFileSync(parsed.outPath, body, { mode: 0o600 });
  process.stderr.write(`wrote ${hashes.length} ${hashes.length === 1 ? "hash" : "hashes"}\n`);
}
