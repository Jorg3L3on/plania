// Usage: pnpm exec tsx scripts/settings-table.ts  (PLA-I2-6: rewrites README.md's table of advanced project settings
// from src/mcp/settings-registry.ts). test/settings-registry.test.ts fails when the README differs from it.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { advancedTable } from "../src/mcp/settings-registry.js";

export const START = "<!-- settings-advanced:start -->";
export const END = "<!-- settings-advanced:end -->";
const README = new URL("../README.md", import.meta.url);

/** The README with the table between the markers replaced; the line endings it had are kept. */
export function withTable(readme: string): string {
  const eol = readme.includes("\r\n") ? "\r\n" : "\n";
  const text = readme.replace(/\r\n/g, "\n");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error(`README.md has no ${START} … ${END} block`);
  return (text.slice(0, a + START.length) + "\n" + advancedTable() + "\n" + text.slice(b)).replace(/\n/g, eol);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeFileSync(README, withTable(readFileSync(README, "utf8")));
  console.log("README.md: advanced settings table rewritten");
}
