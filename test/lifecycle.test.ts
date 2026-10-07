// The status machine as a table: every (from, to) pair an agent may make through set_task.
import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIATIVE_STATUSES, TICKET_STATUSES } from "../src/db/schema.js";
import { assertTransition } from "../src/mcp/lifecycle.js";

function allowed(kind: string, statuses: readonly string[], ctx = {}) {
  const out: string[] = [];
  for (const from of statuses) {
    for (const to of statuses) {
      if (from === to) continue;
      try {
        assertTransition(kind, from, to, { via: "set_task", ...ctx });
        out.push(`${from} → ${to}`);
      } catch {}
    }
  }
  return out.sort();
}

test("ticket moves an agent makes with set_task", () => {
  assert.deepEqual(allowed("ticket", TICKET_STATUSES), [
    "Backlog → Blocked", "Backlog → Ready",
    "Blocked → Backlog", "Blocked → Ready",
    "In progress → Backlog", "In progress → Blocked", "In progress → In review", "In progress → Ready",
    "In review → Backlog", "In review → Blocked", "In review → Ready",
    "Ready → Backlog", "Ready → Blocked",
  ]);
});

test("initiative moves an agent makes with set_task", () => {
  assert.deepEqual(allowed("initiative", INITIATIVE_STATUSES), [
    "Active → On hold", "Active → Planning", "Active → Shipping",
    "On hold → Active", "On hold → Planning", "On hold → Shipping",
    "Planning → Active", "Planning → On hold",
    "Shipping → Active", "Shipping → On hold",
  ]);
});

test("Jorge on screen may make any move; an override only opens Done, Won't do and reopening", () => {
  assert.equal(allowed("ticket", TICKET_STATUSES, { human: true }).length, TICKET_STATUSES.length * (TICKET_STATUSES.length - 1));
  const asked = allowed("ticket", TICKET_STATUSES, { override: { confirm_by_jorge: true, reason: "asked" } });
  assert.ok(asked.includes("In review → Done"));
  assert.ok(asked.includes("Done → Ready"));
  assert.ok(!asked.includes("Backlog → In review"));
});
