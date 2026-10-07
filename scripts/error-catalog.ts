// Usage: pnpm error-catalog  (rewrites the error table in README.md from src/mcp/errors.ts)
import { readFileSync, writeFileSync } from "node:fs";
import { ERRORS } from "../src/mcp/errors.js";

const START = "<!-- errors:start -->";
const END = "<!-- errors:end -->";

const rows = Object.entries(ERRORS)
  .sort(([a, [sa]], [b, [sb]]) => sa - sb || a.localeCompare(b))
  .map(([code, [status, when]]) => `| \`${code}\` | ${status} | ${when} |`);
const table = [START, "| Code | Status | When |", "|---|---|---|", ...rows, END].join("\n");

const path = new URL("../README.md", import.meta.url);
const readme = readFileSync(path, "utf8");
const a = readme.indexOf(START);
const b = readme.indexOf(END);
if (a < 0 || b < 0) throw new Error(`README.md needs ${START} and ${END} markers`);
writeFileSync(path, readme.slice(0, a) + table + readme.slice(b + END.length));
console.log(`README.md: ${rows.length} error codes`);
