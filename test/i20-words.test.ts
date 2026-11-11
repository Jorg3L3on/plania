// PLA-I20-1: no gate wording in the source agents and the screen read, and tools/list agrees.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LEGACY_EVENT_PREFIX } from "../src/db/legacy-names.js";
import { CLAIMABLE_BUT_GATED, CLAIMABLE_BUT_WAITING, canonicalAuditCode } from "../src/mcp/audit.js";
import { AGENT_CHORES } from "../src/mcp/orden.js";
import { summarize } from "../src/mcp/summary.js";

const WORD = /\bgates?\b|\bgated\b|compuerta/i;

test("src, ui, docs and the README have none of the removed words", () => {
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-i", "-n", "-E", "gates?|gated|compuerta", "--", "src", "ui/src", "docs", "README.md"], {
      encoding: "utf8",
    });
  } catch (err) {
    out = (err as { stdout?: string }).stdout ?? "";
  }
  // PLA-I38-2: the command merge-gate is the allowed token. The old approval word stays banned.
  const lines = out.split("\n").filter((line) => line && WORD.test(line.replaceAll(/merge-gate/gi, "")));
  assert.deepEqual(lines, []);
});

test("CLAIMABLE_BUT_GATED is an alias of CLAIMABLE_BUT_WAITING for one release", () => {
  assert.equal(canonicalAuditCode(CLAIMABLE_BUT_GATED), CLAIMABLE_BUT_WAITING);
  assert.equal(canonicalAuditCode(CLAIMABLE_BUT_WAITING), CLAIMABLE_BUT_WAITING);
  assert.equal(AGENT_CHORES.has(CLAIMABLE_BUT_WAITING), true);
  assert.equal(AGENT_CHORES.has(canonicalAuditCode(CLAIMABLE_BUT_GATED)), true);
});

test("old screen-step events read as a neutral line", () => {
  const actor = { agent: "plania", session_id: "system" };
  for (const suffix of ["challenge.created", "answered", "code.rejected", "enrolled"]) {
    const line = summarize({
      type: `${LEGACY_EVENT_PREFIX}${suffix}`,
      task_key: "FIL-01",
      actor,
      payload: { reason: "no", letter: "A" },
    });
    assert.equal(line, "FIL-01 evento antiguo");
    assert.equal(WORD.test(line), false);
  }
  assert.equal(summarize({ type: `${LEGACY_EVENT_PREFIX}enrolled`, task_key: null, actor, payload: {} }), "evento antiguo");
});

describe("tools/list", () => {
  test("descriptions and schemas name none of the removed words", async () => {
    const { createMcpServer } = await import("../src/mcp/register.js");
    const server = createMcpServer({} as never);
    const client = new Client({ name: "i20-words", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const tools = (await client.listTools()).tools;
      const blob = JSON.stringify(tools).replaceAll(/merge-gate/gi, "");
      assert.equal(WORD.test(blob), false, blob.match(WORD)?.[0] ?? "");
      const audit = tools.find((t) => t.name === "audit");
      assert.match(audit?.description ?? "", /CLAIMABLE_BUT_WAITING/);
      assert.match(audit?.description ?? "", /CLAIMABLE_BUT_GATED is the previous name of CLAIMABLE_BUT_WAITING/);
      const ask = tools.find((t) => t.name === "ask");
      const props = (ask?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
      assert.equal(LEGACY_EVENT_PREFIX.slice(0, -1) in props, false);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
