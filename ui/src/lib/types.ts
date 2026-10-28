// Shapes returned by the server's /api routes (src/api/routes.ts). Timestamps are ISO-8601 UTC.
import type { Upcoming } from "./due.js";

export type Actor = { agent: string; session_id: string; machine?: string; model?: string };
export type Workspace = { machine?: string; worktree_path?: string; branch?: string };

/** One environment in a line for Inicio: what runs there and how many integration branches it trails. */
export type EnvSummary = { env: string; commit: string | null; branch: string | null; deployed_at: string | null; flags: Record<string, unknown>; behind: number };

/** 2.16: whether it is safe to open a read-only summary. The server decides; the screen does not recompute it. */
export type ReadinessState = "ready" | "caution" | "blocked" | "no_context";
export type ReadinessReason = {
  code: string;
  severity: "blocked" | "caution" | "no_context";
  text: string;
  task_key: string | null;
};
export type Readiness = {
  state: ReadinessState;
  reasons: ReadinessReason[];
  line: string;
};

export type ProjectSummary = {
  slug: string;
  title: string;
  /** 2.11: the generated headline. */
  line: string;
  /** The next step, for the tiles. */
  next_line: string;
  /** 2.16: read-only. Same object as get_resume. */
  readiness: Readiness;
  /** Orden: the last audit run's count. */
  audit_count: number;
  open_questions: number;
  tasks: TaskRow[];
  next_claimable: NextClaimable | null;
  envs: EnvSummary[];
  /** Events per day, the last 7 days, oldest first. */
  activity: number[];
  /** Each open initiative's notes: what it is doing and what it needs next. */
  initiatives: InitiativeNote[];
  /** 2.10: dates in the next 14 days, and the keys past their due day. */
  upcoming?: Upcoming[];
  overdue?: string[];
};

export type InitiativeNote = {
  key: string;
  in_progress: string;
  next_action: string;
  /** Derived waits (initiative state). Absent on older payloads; Ahora drops the ones that start with "Jorge". */
  waiting_on?: { key: string; on: string }[];
};

/** The next ticket an agent can take (get_next's shape without the claim). */
export type NextClaimable = {
  key: string;
  kind: "initiative" | "ticket" | "idea";
  title: string;
  summary: string;
  status: string;
  priority: string | null;
  parent_key: string | null;
  blocked_by: Blocker[];
  workspace: Workspace | null;
};

/** What set_project headline writes: since 2.11 the note beside the generated headline. */
export type HeadlineNote = { text: string; version: number; at: string | null; stale: boolean };
/** 2.11: get_resume.headline, generated from the data, plus the note. */
export type Headline = { generated: string; note: HeadlineNote };

/** 2.11: where an initiative stands, derived from its tickets, claims and blockers (src/mcp/initiative-state.ts). */
export type InitiativeState = {
  phase_now: number | null;
  done: number;
  total: number;
  in_progress: { key: string; agent: string | null }[];
  in_review: { key: string; pr: { number: number | null; url: string } | null }[];
  to_release: string[];
  waiting_on: { key: string; on: string }[];
  line: string;
};

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
  /** Ideas only: A, B or C when the question is a gate. Absent on an ordinary question. */
  gate?: string | null;
  /** True when only the screen may answer, by a click. */
  human_only?: boolean;
  /** Set when the Plania bot recorded the owner's instruction. Absent on a screen click. */
  delegated?: { message_id: string; quote: string; at: string; by: Actor } | null;
};


// get_resume: generated from the data, never hand-written.
/** 2.12: an open ticket Jorge asked for on screen (origin jorge), newest first. */
export type Request = {
  key: string;
  kind: string;
  parent_key: string | null;
  title: string;
  summary: string;
  status: string;
  priority: string | null;
  asked_at: string;
  claimed: boolean;
};

export type Resume = {
  headline: Headline;
  /** 2.16: read-only. The summary sheet shows it and does not recompute it. */
  readiness: Readiness;
  claims: Claim[];
  requests?: Request[];
  next_claimable: NextTicket;
  initiatives: {
    key: string;
    title: string;
    status: string;
    summary: string;
    state: InitiativeState;
    state_note: string | null;
    in_progress: { note: string; claims: Claim[] };
    next_action: { note: string; next_claimable: NextTicket };
    must_keep: Decision[];
    counts: Record<string, number>;
  }[];
  standalone: { open: number; claims: Claim[] };
  must_keep: Decision[];
  open_questions: Question[];
  /** Newest first. The summary sheet reads the first one when the headline is empty. */
  recent?: { at: string; type: string; task_key: string | null; agent: string }[];
  /** One line about what the project's agents have running on the Mac, or null. */
  machine?: string | null;
  /** The generated status block; the screen reads only the release step from it. */
  status?: { release?: ReleasePlan | null };
};

// 2.10: the release step (settings.release), computed by the server.
export type ReleasePlan = {
  from: { branch: string; head_sha: string | null };
  into: { branch: string; head_sha: string | null };
  env: string;
  ahead: number | null;
  shipped: boolean;
  commits: string[];
  tickets: { key: string; title: string; status: string; pr_url: string | null }[];
  migrations: string[];
  before: { blocker_id: string; key: string; text: string }[];
  open_checks: number;
  command: string;
  // 2.13: command mode shows the command; merge mode ships from the screen (Lanzar).
  mode: "command" | "merge";
  merged: { sha: string; pr_url: string; at: string } | null;
  ship: { ready: boolean; reason: ShipBlock | null };
};

export type ShipBlock = "mode_command" | "no_repo" | "nothing_to_ship" | "before_steps" | "open_checks" | "merged";

// POST /api/projects/:slug/release/ship: what was merged.
export type ShipResult = {
  merged: true;
  pr: { number: number; url: string };
  merge_sha: string;
  tickets: string[];
  migrations: string[];
};

// 2.11 Orden (GET /api/projects/:slug/audit): the last audit run, with what each finding offers.
export type OrdenFinding = {
  code: string;
  key: string | null;
  detail: string;
  fix_hint: string;
  id?: string;
  command?: string;
  can_fix: "retire_decision" | "copy" | "mark_deployed" | "open";
  owner: "jorge" | "agents";
};
export type Orden = { project: string; at: string | null; count: number; findings: OrdenFinding[] };

// Everything waiting on Jorge (GET /api/inbox).
export type InboxGroup = "decisiones" | "pasos" | "limpieza";
export type InboxItem = {
  id: string;
  kind: "approval" | "question" | "human_action" | "release" | "footprint";
  group: InboxGroup;
  project: string;
  key: string | null;
  task_kind: string | null;
  parent_key: string | null;
  title: string | null;
  why: string;
  options?: string[];
  /** Questions only: how soon Jorge is needed (now | soon | whenever). */
  urgency?: string | null;
  /** Questions only: A, B or C when this is a gate. */
  gate?: string | null;
  /** Questions only: the screen must answer it, by a click. */
  human_only?: boolean;
  action?: string;
  target?: Record<string, unknown>;
  waiting_since: string;
  wait_s: number;
  evidence: { last_pass: { kind: string; cite: string; at: string } | null; open_checks: number } | null;
  pr_url: string | null;
  action_hint: string;
};
// A closed answer the bot recorded. The Bandeja keeps it so the owner can review the quote.
export type DelegatedReview = {
  id: string;
  project: string;
  key: string | null;
  kind: "question" | "approval";
  gate: string | null;
  action: string | null;
  answer: string | null;
  quote: string;
  message_id: string;
  at: string;
};

// count and by_project: decisiones + pasos; chores: limpieza (2.10).
export type Inbox = { items: InboxItem[]; count: number; by_project: Record<string, number>; groups: Record<InboxGroup, number>; chores: number; delegated: DelegatedReview[] };

// 2.12 Hoy: get_digest as the screen reads it (GET /api/digest). Only the fields the strip shows.
export type DigestHighlights = { done: string[]; to_review: string[]; blocked: string[]; needs_jorge: string[]; prs_opened: number[]; prs_merged: number[]; claims: string[] };
export type Digest = {
  cursor: number;
  since: number;
  since_from: "since" | "memory" | "default";
  truncated: boolean;
  needs_jorge: { project: string; kind: InboxItem["kind"]; group: InboxGroup; key: string | null; title: string | null; why: string; wait_s: number }[];
  projects: { slug: string; title: string; line: string; changes_total: number; highlights: DigestHighlights }[];
  unchanged_projects: string[];
};

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
  kind: "initiative" | "ticket" | "idea";
  title: string;
  summary: string;
  status: string;
  /** Ideas only. One of idea, research, design, planning, ready. */
  stage?: string | null;
  /** Ideas only: the initiative or standalone ticket this idea became. */
  promoted_to?: string | null;
  /** Ideas only: the open gate, the missing doc, or that it can move. */
  waits?: string | null;
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
  /** When the task was created. Ideas use it to find the oldest one still waiting. */
  created_at?: string;
  /** Keys of tasks it still waits on. */
  waits_on: string[];
  /** Held by a blocker other than a task (env, flag, metric, time, human action). */
  held: boolean;
  /** 2.10: the due day (YYYY-MM-DD) and the earliest time_after still ahead. */
  due_on: string | null;
  time_after?: string | null;
};

export type Blocker =
  | { type: "task"; task: string; status: string; satisfied: boolean }
  | { type: "env"; env: string; condition: string; value: string; current: unknown; satisfied: boolean }
  | { type: "human_action"; id: string; assignee: string; text: string; satisfied: boolean; satisfied_at: string | null; source?: "parsed"; field?: string; gating?: boolean }
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
export type Result = {
  id: string;
  kind: string;
  verdict: string;
  cite: string;
  url: string | null;
  actor: Actor;
  at: string;
  // The structured fields (2.2) the 2.11 timeline shows.
  commit?: string | null;
  branch?: string | null;
  env?: string | null;
  command?: string | null;
  exit_code?: number | null;
  counts?: { pass?: number; fail?: number; skip?: number } | null;
  duration_s?: number | null;
  /** The branch moved past this result's commit (null: no commit, or the head is unknown). */
  stale_for_head?: boolean | null;
  /** The checks this result ticked (2.11). */
  ticked_checks?: number[];
};
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
  /** Initiatives only (2.11): the derived state, and the note as commentary. */
  state?: InitiativeState;
  state_note?: { text: string; at: string | null; stale: boolean };
  branch: string | null;
  pr?: { number: number | null; url: string } | null;
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
export const IDEA_STATUSES = ["Open", "Done", "Won't do"] as const;
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
