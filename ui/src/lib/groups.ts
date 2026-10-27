// Groups tickets under their initiative. Ideas are neither, so the ticket list never shows them.
import { CLOSED_STATUSES, type TaskRow as Task } from "./types.js";

export type TaskListFilters = { status: string; priority: string; showClosed: boolean };

export function groupTasks(tasks: Task[], f: TaskListFilters) {
  const shown = (t: Task) => f.showClosed || !CLOSED_STATUSES.has(t.status);
  const filtering = f.status !== "all" || f.priority !== "all";
  const matches = (t: Task) =>
    shown(t) && (f.status === "all" || t.status === f.status) && (f.priority === "all" || t.priority === f.priority);

  const initiatives = tasks.filter((t) => t.kind === "initiative" && shown(t));
  const initiativeKeys = new Set(initiatives.map((i) => i.key));
  const tickets = tasks.filter((t) => t.kind === "ticket" && matches(t));

  const groups = initiatives
    .map((initiative) => ({ initiative, children: tickets.filter((t) => t.parent_key === initiative.key) }))
    .filter((g) => !filtering || g.children.length > 0);
  const loose = tickets.filter((t) => !t.parent_key || !initiativeKeys.has(t.parent_key));
  return { groups, loose };
}
