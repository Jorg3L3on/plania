// The ticket list keeps ideas out. Initiatives still group their own tickets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupTasks } from "../ui/src/lib/groups.js";
import type { TaskRow } from "../ui/src/lib/types.js";

const row = (key: string, kind: TaskRow["kind"], extra: Partial<TaskRow> = {}): TaskRow => ({
  key,
  kind,
  title: key,
  summary: "",
  status: kind === "idea" ? "Open" : "Ready",
  priority: kind === "ticket" ? "P2" : null,
  work_type: null,
  parent_key: null,
  blocked_note: null,
  pr_url: null,
  branch: null,
  base_branch: null,
  version: 1,
  claimed_by: null,
  lease_until: null,
  claimed_at: null,
  last_seen_at: null,
  updated_at: "2026-10-11T00:00:00Z",
  waits_on: [],
  held: false,
  due_on: null,
  ...extra,
});

test("the ticket list and its groups leave ideas out", () => {
  const tasks = [
    row("WRK-I1", "initiative", { status: "Active" }),
    row("WRK-I1-1", "ticket", { parent_key: "WRK-I1" }),
    row("WRK-01", "ticket"),
    row("WRK-IDEA1", "idea", { summary: "Una linea", stage: "research" }),
    row("WRK-IDEA2", "idea", { status: "Done", promoted_to: "WRK-I1" }),
  ];
  const { groups, loose } = groupTasks(tasks, { status: "all", priority: "all", showClosed: true });
  const keys = [...groups.flatMap((g) => [g.initiative.key, ...g.children.map((t) => t.key)]), ...loose.map((t) => t.key)];
  assert.deepEqual(keys, ["WRK-I1", "WRK-I1-1", "WRK-01"]);
});
