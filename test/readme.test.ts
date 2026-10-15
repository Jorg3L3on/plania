// The README's MCP tool tables are generated from src/mcp/register.ts (scripts/mcp-table.ts); this fails when they drift.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { firstSentence, listTools, renderReadme } from "../scripts/mcp-table.js";

describe("README tool tables", () => {
  test("match what pnpm mcp-table generates", async () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    assert.equal(readme, await renderReadme(readme), "README.md is out of date: run pnpm mcp-table");
  });

  test("list every registered tool once", async () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const t of await listTools()) assert.equal(readme.split(`| \`${t.name}\` |`).length - 1, 1, t.name);
  });

  test("first sentence skips abbreviations", () => {
    assert.equal(firstSentence("Reserve a number (e.g. name 'migration'). Then more."), "Reserve a number (e.g. name 'migration').");
    assert.equal(firstSentence("No full stop"), "No full stop");
  });
});
