// PLA-I30-1: the seed roster has no Cursor adapter; every bot runs claude_code with no cadence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ORG } from "../scripts/seed-org.js";

test("no seed row uses the Cursor adapter and every bot runs claude_code with no cadence", () => {
  assert.equal(ORG.some((r) => (r.adapter as string) === "cursor_agent"), false);
  for (const r of ORG.filter((r) => r.kind !== "human")) {
    assert.equal(r.adapter, "claude_code", r.slug);
    assert.equal(r.heartbeatMinutes, null, r.slug);
  }
});
