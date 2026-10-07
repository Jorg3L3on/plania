// Shapes returned by the server's /api routes (src/api/routes.ts).

export type Resume = {
  project: string;
  in_progress: string;
  next_action: string;
  branch_or_prod: string;
  must_keep_decision: string;
};

export type ProjectSummary = { slug: string; title: string; resume: Resume; tasks: TaskRow[] };

export type TaskRow = {
  key: string;
  kind: "initiative" | "ticket";
  title: string;
  summary: string;
  status: string;
  priority: string | null;
  parent_key: string | null;
  blocked_note: string | null;
  pr_url: string | null;
  branch: string | null;
  base_branch: string | null;
  updated_at: string;
};

// One task with its body: the get_task shape plus updated_at.
export type TaskDetail = TaskRow & {
  body: string;
  origin: string | null;
  child_keys: string[];
  blocked_by: string[];
};

export type ProjectDetail = { slug: string; title: string; resume: Resume; tasks: TaskRow[] };

export type LiveEvent = { type: "task" | "project" | "decision"; project: string; key?: string };

// Same sets the server validates against (src/db/schema.ts).
export const TICKET_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Blocked", "Done", "Won't do"] as const;
export const INITIATIVE_STATUSES = ["Planning", "Active", "Shipping", "Done", "On hold", "Won't do"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const CLOSED_STATUSES = new Set(["Done", "Won't do"]);
