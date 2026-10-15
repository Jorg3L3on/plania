// Usage: pnpm mcp-table  (rewrites the MCP tool tables in README.md from src/mcp/register.ts)
// test/readme.test.ts fails when the committed README differs from what this generates.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Db } from "../src/db/client.js";
import { createMcpServer } from "../src/mcp/register.js";

const START = "<!-- mcp-tools:start -->";
const END = "<!-- mcp-tools:end -->";
const README = new URL("../README.md", import.meta.url);

type Tool = { name: string; title?: string; description?: string; annotations?: { readOnlyHint?: boolean } };

// Every tool the full token sees, in registration order. Registering touches no database.
export async function listTools(): Promise<Tool[]> {
  const server = createMcpServer({} as Db);
  const client = new Client({ name: "mcp-table", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

// Up to the first full stop that ends a sentence ("e.g." and friends do not).
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const re = /[.!?](?=\s|$)/g;
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    if (/\b(e\.g|i\.e|etc|vs)\.$/i.test(flat.slice(0, m.index + 1))) continue;
    return flat.slice(0, m.index + 1);
  }
  return flat;
}

const cell = (s: string) => s.replaceAll("|", "\\|");

export function tables(tools: Tool[]): string {
  const row = (t: Tool) => `| \`${t.name}\` | ${cell([t.title, firstSentence(t.description ?? "")].filter(Boolean).join(": "))} |`;
  const read = tools.filter((t) => t.annotations?.readOnlyHint);
  const write = tools.filter((t) => !t.annotations?.readOnlyHint);
  return [
    START,
    "| Read | |",
    "|---|---|",
    ...read.map(row),
    "",
    "| Write | |",
    "|---|---|",
    ...write.map(row),
    END,
  ].join("\n");
}

// The README with its tool tables replaced.
export async function renderReadme(readme: string): Promise<string> {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`README.md needs ${START} and ${END} markers`);
  return readme.slice(0, a) + tables(await listTools()) + readme.slice(b + END.length);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const before = readFileSync(README, "utf8");
  const after = await renderReadme(before);
  writeFileSync(README, after);
  const n = (await listTools()).length;
  console.log(`README.md: ${n} tools${before === after ? " (unchanged)" : ""}`);
}
