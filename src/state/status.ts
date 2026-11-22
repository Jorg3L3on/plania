// PLA-I74-4: the one home of a task's status names. Every other server file reads a status through these
// constants (test/status-guard.test.ts fails on a status string written anywhere else under src/).
import { sql, type SQL } from "drizzle-orm";

export const ST = {
  // Tickets
  backlog: "Backlog",
  ready: "Ready",
  inProgress: "In progress",
  blocked: "Blocked",
  needsOwner: "Needs owner",
  inReview: "In review",
  merged: "Merged",
  released: "Released",
  // Tickets, initiatives and ideas
  done: "Done",
  wontDo: "Won't do",
  // Ideas
  open: "Open",
  // Initiatives
  planning: "Planning",
  active: "Active",
  shipping: "Shipping",
  onHold: "On hold",
} as const;

export type Status = (typeof ST)[keyof typeof ST];

export const TICKET_STATUSES = [ST.backlog, ST.ready, ST.inProgress, ST.blocked, ST.needsOwner, ST.inReview, ST.merged, ST.released, ST.done, ST.wontDo] as const;
export const INITIATIVE_STATUSES = [ST.planning, ST.active, ST.shipping, ST.onHold, ST.done, ST.wontDo] as const;
export const IDEA_STATUSES = [ST.open, ST.done, ST.wontDo] as const;

// Closed for good: nothing more happens on the item.
export const TERMINAL = [ST.done, ST.wontDo] as const;
// PLA-15: the ticket's work is in the integration branch (or needed no merge).
export const LANDED = [ST.merged, ST.released, ST.done] as const;
// A ticket's work that counts as finished on the plan (closed without Won't do).
export const DONE_LIKE = [ST.done, ST.merged, ST.released] as const;
// Nothing left to do on it, Won't do included.
export const CLOSED = [ST.done, ST.merged, ST.released, ST.wontDo] as const;
// A blocker that is a ticket holds once it reached one of these (R-15).
export const SETTLED = [ST.inReview, ST.merged, ST.released, ST.done] as const;
// An initiative that is still open.
export const OPEN_INITIATIVE = [ST.planning, ST.active, ST.shipping, ST.onHold] as const;

export const isIn = (list: readonly string[], status: string | null | undefined): boolean => !!status && list.includes(status);

// SQL: `<col> in (...)` with the names as bound values, for raw SQL that names a column by alias (e.g. b.status).
export const sqlIn = (col: SQL | unknown, list: readonly string[]): SQL => sql`${col} in (${sql.join(list.map((s) => sql`${s}`), sql`, `)})`;
export const sqlNotIn = (col: SQL | unknown, list: readonly string[]): SQL => sql`${col} not in (${sql.join(list.map((s) => sql`${s}`), sql`, `)})`;
