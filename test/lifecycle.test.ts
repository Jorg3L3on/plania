// The status machine as a table: every (from, to) pair an agent may make through set_task.
import assert from "node:assert/strict";
import { test } from "node:test";
import { IDEA_STATUSES, INITIATIVE_STATUSES, TICKET_STATUSES } from "../src/db/schema.js";
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
    "Merged → Done", "Merged → In review", "Merged → Released",
    "Ready → Backlog", "Ready → Blocked",
    "Released → Done",
  ]);
});

test("where an agent may set Done depends on the work type", () => {
  const doneFrom = (workType: string) =>
    allowed("ticket", TICKET_STATUSES, { workType }).filter((m) => m.endsWith("→ Done")).map((m) => m.split(" → ")[0]);
  assert.deepEqual(doneFrom("code"), ["Merged", "Released"]);
  assert.deepEqual(doneFrom("bug"), ["Merged", "Released"]);
  assert.deepEqual(doneFrom("debt"), ["Merged", "Released"]);
  assert.deepEqual(doneFrom("ops"), ["In review", "Merged", "Released"]);
  assert.deepEqual(doneFrom("research"), ["In review", "Merged", "Released"]);
  assert.deepEqual(doneFrom("decision-needed"), ["Backlog", "In progress", "Ready"]);
});

test("the pollers (via system) make only the merge and release moves", () => {
  assert.deepEqual(allowed("ticket", TICKET_STATUSES, { via: "system" }), [
    "In review → Merged", "In review → Ready", "Merged → Released", "Released → Merged",
  ]);
});

test("initiative moves an agent makes with set_task", () => {
  assert.deepEqual(allowed("initiative", INITIATIVE_STATUSES), [
    "Active → Done", "Active → On hold", "Active → Planning", "Active → Shipping",
    "On hold → Active", "On hold → Done", "On hold → Planning", "On hold → Shipping",
    "Planning → Active", "Planning → Done", "Planning → On hold",
    "Shipping → Active", "Shipping → Done", "Shipping → On hold",
  ]);
});

test("an idea is Open or Done; Won't do stays Jorge's", () => {
  assert.deepEqual(allowed("idea", IDEA_STATUSES), ["Open → Done"]);
});

test("Jorge on screen may make any move once Won't do and reopening carry a reason", () => {
  const human = allowed("ticket", TICKET_STATUSES, { human: true, reason: "en pantalla" });
  assert.equal(human.length, TICKET_STATUSES.length * (TICKET_STATUSES.length - 1));
  const bare = allowed("ticket", TICKET_STATUSES, { human: true });
  assert.ok(!bare.includes("In review → Won't do"));
  assert.ok(!bare.includes("Done → Ready"));
  const delegated = allowed("ticket", TICKET_STATUSES, { delegated: true, reason: "él lo pidió" });
  assert.ok(delegated.includes("In review → Won't do"));
  assert.ok(delegated.includes("Done → Ready"));
  assert.ok(!delegated.includes("Backlog → In review"), "evidence does not open an ordinary move");
  assert.ok(!delegated.includes("In review → Done"), "Done stays where the work stands");
});
