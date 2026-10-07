// Shapes returned by the server's /api routes (src/api/routes.ts). Timestamps are ISO-8601 UTC.

export type Actor = { agent: string; session_id: string; machine?: string; model?: string };
export type Workspace = { machine?: string; worktree_path?: string; branch?: string };

export type ProjectSummary = { slug: string; title: string; line: string; open_questions: number; tasks: TaskRow[] };

export type Headline = { text: string; version: number; at: string | null; stale: boolean };

export type Claim = { key: string; title: string; owner: Actor | null; lease_until: string | null; workspace: Workspace | null };

export type NextTicket = { key: string; title: string } | null;

export type Decision = {
  id: string;
  text: string;
  task_key: string | null;
  tags: string[];
  pinned: boolean;
  supersedes: string[];
  superseded_by: string | null;
  retired: { at: string; by: Actor | null; reason: string | null } | null;
  adr_url: string | null;
  adr_doc_id: string | null;
  decided_on: string | null;
  actor: Actor | null;
  created_at: string;
};

export type Question = {
  id: string;
  task_key: string;
  question: string;
  options: string[];
  asked_by: Actor;
  asked_at: string;
  answer: string | null;
  answered_by: Actor | null;
  answered_at: string | null;
  decision_id: string | null;
};

export type LegacyCard = { in_progress: string; next_action: string; branch_or_prod: string; must_keep_decision: string };

// get_resume: generated from the data, never hand-written.
export type Resume = {
  headline: Headline;
  claims: Claim[];
  next_claimable: NextTicket;
  initiatives: {
    key: string;
    title: string;
    status: string;
    summary: string;
    in_progress: { note: string; claims: Claim[] };
    next_action: { note: string; next_claimable: NextTicket };
    must_keep: Decision[];
    counts: Record<string, number>;
  }[];
  standalone: { open: number; claims: Claim[] };
  must_keep: Decision[];
  open_questions: Question[];
  legacy_card_present: boolean;
  legacy_card?: LegacyCard | null;
};

// Everything waiting on Jorge (GET /api/inbox).
export type InboxItem = {
  id: string;
  kind: "approval" | "question" | "human_action" | "released";
  project: string;
  key: string | null;
  task_kind: string | null;
  parent_key: string | null;
  title: string | null;
  why: string;
  options?: string[];
  action?: string;
  target?: Record<string, unknown>;
  waiting_since: string;
  wait_s: number;
  evidence: { last_pass: { kind: string; cite: string; at: string } | null; open_checks: number } | null;
  pr_url: string | null;
  action_hint: string;
};
export type Inbox = { items: InboxItem[]; count: number; by_project: Record<string, number> };

// Agent tokens (GET /api/tokens). The secret is only ever in the create response.
export type AgentToken = {
  id: string;
  name: string;
  agent: string;
  machine: string | null;
  scopes: string[];
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

export type TaskRow = {
  key: string;
  kind: "initiative" | "ticket";
  title: string;
  summary: string;
  status: string;
  priority: string | null;
  work_type: string | null;
  parent_key: string | null;
  blocked_note: string | null;
  pr_url: string | null;
  branch: string | null;
  base_branch: string | null;
  version: number;
  claimed_by: Actor | null;
  lease_until: string | null;
  updated_at: string;
};

export type Blocker =
  | { type: "task"; task: string; status: string; satisfied: boolean }
  | { type: "env"; env: string; condition: string; value: string; current: unknown; satisfied: boolean }
  | { type: "human_action"; id: string; assignee: string; text: string; satisfied: boolean; satisfied_at: string | null }
  | { type: "env_flag"; env: string; flag: string; equals: unknown; current: unknown; satisfied: boolean }
  | { type: "time_after"; at: string; satisfied: boolean }
  | { type: "metric_gte"; name: string; value: number; current: number | null; satisfied: boolean };

export type Check = {
  n: number;
  text: string;
  done: boolean;
  done_at: string | null;
  done_by: Actor | null;
  evidence_id: string | null;
  waived: { at: string; by: Actor | null; reason: string | null; approval_id: string | null } | null;
};
export type Result = { id: string; kind: string; verdict: string; cite: string; url: string | null; actor: Actor; at: string };
export type LogEntry = { id: number; at: string; type: string; actor: Actor; payload: Record<string, unknown> };

// The get_task shape.
export type TaskDetail = Omit<TaskRow, "claimed_by" | "lease_until"> & {
  aliases: string[];
  scope: string;
  legacy_body?: string;
  phase: number | null;
  checks: Check[];
  results: Result[];
  docs: { id: string; title: string; version: number; updated_at: string }[];
  questions: Question[];
  origin: string | null;
  child_keys: string[];
  blocked_by: Blocker[];
  base_branch: string | null;
  next_action?: string;
  in_progress_note?: string;
  branch: string | null;
  claim: { owner: Actor; claimed_at: string; lease_until: string; last_seen_at: string | null; live: boolean } | null;
  workspace: Workspace | null;
  log: LogEntry[];
  log_total: number;
};

export type ProjectDetail = { slug: string; title: string; version: number; resume: Resume; tasks: TaskRow[]; decisions: Decision[] };

export type LiveEvent = { type: "task" | "project" | "decision"; project: string; key?: string };

// Same sets the server validates against (src/db/schema.ts).
export const TICKET_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Merged", "Released", "Blocked", "Needs Jorge", "Done", "Won't do"] as const;
export const INITIATIVE_STATUSES = ["Planning", "Active", "Shipping", "Done", "On hold", "Won't do"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const CLOSED_STATUSES = new Set(["Done", "Won't do"]);
