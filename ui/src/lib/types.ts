// Shapes returned by the server's /api routes (src/api/routes.ts). Timestamps are ISO-8601 UTC.

export type Actor = { agent: string; session_id: string; machine?: string; model?: string };
export type Workspace = { machine?: string; worktree_path?: string; branch?: string };

/** One environment in a line for Inicio: what runs there and how many integration branches it trails. */
export type EnvSummary = { env: string; commit: string | null; branch: string | null; deployed_at: string | null; flags: Record<string, unknown>; behind: number };

export type ProjectSummary = {
  slug: string;
  title: string;
  line: string;
  open_questions: number;
  tasks: TaskRow[];
  next_claimable: NextClaimable | null;
  envs: EnvSummary[];
  /** Events per day, the last 7 days, oldest first. */
  activity: number[];
  /** Each open initiative's notes: what it is doing and what it needs next. */
  initiatives: InitiativeNote[];
};

export type InitiativeNote = { key: string; in_progress: string; next_action: string };

/** The next ticket an agent can take (get_next's shape without the claim). */
export type NextClaimable = {
  key: string;
  kind: "initiative" | "ticket";
  title: string;
  summary: string;
  status: string;
  priority: string | null;
  parent_key: string | null;
  blocked_by: Blocker[];
  workspace: Workspace | null;
};

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
  /** One line about what the project's agents have running on the Mac, or null. */
  machine?: string | null;
};

// Everything waiting on Jorge (GET /api/inbox).
export type InboxItem = {
  id: string;
  kind: "approval" | "question" | "human_action" | "footprint";
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
  /** Set with the live lease: when it started and when its holder last wrote. */
  claimed_at: string | null;
  last_seen_at: string | null;
  updated_at: string;
  /** Keys of tasks it still waits on. */
  waits_on: string[];
  /** Held by a blocker other than a task (env, flag, metric, time, human action). */
  held: boolean;
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
  /** Set by a status change: strings, or FOOTPRINT_LIVE for something still running on the Mac. */
  warnings?: (string | { code: string; kind?: string; locator?: string; teardown?: string })[];
  aliases: string[];
  scope: string;
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

export type LiveEvent = { type: "task" | "project" | "decision" | "footprint"; project: string; key?: string };

// Same sets the server validates against (src/db/schema.ts).
export const TICKET_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Merged", "Released", "Blocked", "Needs Jorge", "Done", "Won't do"] as const;
export const INITIATIVE_STATUSES = ["Planning", "Active", "Shipping", "Done", "On hold", "Won't do"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const CLOSED_STATUSES = new Set(["Done", "Won't do"]);

// GET /api/machine: what runs and is stored on this Mac for agent work (src/jobs/machine).
export type FootprintKind = "worktree" | "server" | "db_server" | "database" | "container" | "browser" | "service" | "tunnel" | "cache";
export type FootprintState = "live" | "orphan" | "stale" | "ghost" | "gone" | "released" | "self" | "system";

export type FootprintItem = {
  id: string;
  machine: string;
  kind: FootprintKind;
  locator: string;
  project: string | null;
  /** The repo directory ("plania"), set even when it is not a project. */
  repo: string | null;
  task_key: string | null;
  task_title: string | null;
  initiative_key: string | null;
  initiative_title: string | null;
  session_id: string | null;
  holder: Actor | null;
  source: "observed" | "declared" | "both";
  purpose: string;
  teardown: string;
  details: Record<string, unknown>;
  state: FootprintState;
  /** A live lease_resource on this server's port: who holds it and why. */
  lease: { name: string; project: string; holder: Actor; purpose: string; lease_until: string } | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  declared_at: string | null;
  released_at: string | null;
};

export type MachineTotals = { servers: number; databases: number; worktree_kb: number; orphan: number; stale: number };
/** An audit finding about the Mac that no project audit holds (rows without a project). */
export type MachineFinding = { code: string; key: string | null; detail: string; fix_hint: string };
export type MachineBackup = { at: string | null; path: string | null; bytes: number | null; error: string | null; attempted_at: string | null };
export type Machine = { machine: string; totals: MachineTotals; backup?: MachineBackup; findings: MachineFinding[]; items: FootprintItem[] };
