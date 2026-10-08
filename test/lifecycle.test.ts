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
    "In review → Backlog", "In review → Blocked", "In review → Merged", "In review → Ready",
    "Merged → In review", "Merged → Released",
    "Ready → Backlog", "Ready → Blocked",
  ]);
});

test("the pollers (via system) make only the merge and release moves", () => {
  assert.deepEqual(allowed("ticket", TICKET_STATUSES, { via: "system" }), [
    "In review → Merged", "In review → Ready", "Merged → Released", "Released → Merged",
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

test("Jorge on screen may make any move; an approval only opens the one move it is for", () => {
  assert.equal(allowed("ticket", TICKET_STATUSES, { human: true }).length, TICKET_STATUSES.length * (TICKET_STATUSES.length - 1));
  const done = allowed("ticket", TICKET_STATUSES, { approval: { action: "done" } });
  assert.ok(done.includes("In review → Done"));
  assert.ok(!done.includes("In review → Won't do"));
  assert.ok(!done.includes("Done → Ready"));
  const reopen = allowed("ticket", TICKET_STATUSES, { approval: { action: "reopen" } });
  assert.ok(reopen.includes("Done → Ready"));
  assert.ok(!reopen.includes("Backlog → In review"));
});
