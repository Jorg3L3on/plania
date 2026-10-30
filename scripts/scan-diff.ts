// Usage: pnpm scan:diff <repo-path> [base]   (base defaults to main)
// PLA-04: scans the lines a branch adds (git diff <base>...HEAD, read-only) for personal data and
// secrets, and prints file, line and a masked finding. Exit 1 on a high-confidence finding, 2 on a
// usage or git error, 0 otherwise. Nothing is written to the scanned repo. The allowlist is
// ~/.config/plania/scan-allowlist (PLANIA_SCAN_ALLOWLIST overrides the path): one literal value or
// /regex/ per line.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { addedLines } from "../src/lib/scan/diff.js";
import { EMPTY_ALLOWLIST, envFile, parseAllowlist, scanLine, type Allowlist } from "../src/lib/scan/patterns.js";

function allowlist(): Allowlist {
  const path = process.env.PLANIA_SCAN_ALLOWLIST || join(homedir(), ".config", "plania", "scan-allowlist");
  return existsSync(path) ? parseAllowlist(readFileSync(path, "utf8")) : EMPTY_ALLOWLIST;
}

function main(argv: string[]): number {
  const [repoArg, base = "main"] = argv;
  if (!repoArg) {
    process.stderr.write("usage: pnpm scan:diff <repo-path> [base]\n");
    return 2;
  }
  const repo = resolve(repoArg);
  let diff: string;
  try {
    diff = execFileSync("git", ["-C", repo, "diff", "--unified=0", "--no-color", "--no-ext-diff", `${base}...HEAD`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    process.stderr.write(`git diff ${base}...HEAD failed in ${repo}: ${(e as Error).message.split("\n")[0]}\n`);
    return 2;
  }
  const allow = allowlist();
  const { lines, files } = addedLines(diff);
  let high = 0;
  let hints = 0;
  for (const file of files) {
    if (envFile(file)) {
      high++;
      process.stdout.write(`${file}: HIGH archivo .env en el diff\n`);
    }
  }
  for (const l of lines) {
    for (const f of scanLine(l.text, allow)) {
      if (f.confidence === "high") high++;
      else hints++;
      process.stdout.write(`${l.file}:${l.line}: ${f.confidence === "high" ? "HIGH" : "hint"} ${f.label} ${f.masked}\n`);
    }
  }
  process.stdout.write(`PII scan: ${high} high, ${hints} ${hints === 1 ? "hint" : "hints"}\n`);
  return high > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
