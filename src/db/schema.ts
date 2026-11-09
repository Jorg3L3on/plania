import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Handoff §1. Enum-like columns are plain text; tools validate values.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  rulesText: text("rules_text").notNull().default(""),
  // Optimistic concurrency: writers pass the version they read; a mismatch is STALE_VERSION.
  version: integer("version").notNull().default(1),
  // Bumped when rules_text changes, so agents can tell they hold an old copy.
  rulesVersion: integer("rules_version").notNull().default(1),
  // v2.1: the project's key prefix (FIL for filmia). Keys are PREFIX-I<n> (initiatives),
  // PREFIX-<n> (standalone tickets) and <initiative key>-<n> (phases); see src/mcp/keys.ts.
  keyPrefix: text("key_prefix").notNull().default(""),
  // v2.1: one human-readable line about where the project stands (set_project headline, ≤ 280 chars).
  // 2.11: the headline is generated (src/mcp/headline.ts); this is the note beside it, for what the
  // data cannot say. The server flags it stale when an env, an initiative's status or a Done moves after it.
  headlineNote: text("headline_note").notNull().default(""),
  headlineNoteVersion: integer("headline_note_version").notNull().default(0),
  headlineNoteAt: timestamp("headline_note_at", { withTimezone: true }),
  headlineNoteStale: boolean("headline_note_stale").notNull().default(false),
  // v2.2: per-project settings as data: release_target (env), branch_pattern (regex), claim_from
  // (backlog|ready), resources and quotas policies, github and vercel integration config.
  settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
  // PLA-I29: the project kill switch. A new project starts paused; only Jorge resumes it, on screen.
  runsPaused: boolean("runs_paused").notNull().default(true),
  runsPausedAt: timestamp("runs_paused_at", { withTimezone: true }),
  ...timestamps,
});

// v2.1: per-agent tokens issued on screen. The server fills actor.agent/machine from the token and
// records token_id on every event. Static env tokens keep working as unbound fallbacks.
export const agentTokens = pgTable("agent_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  agent: text("agent").notNull(),
  machine: text("machine"),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`), // read | write | ops
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(), // the first characters, to tell tokens apart on screen
  createdBy: jsonb("created_by").$type<Actor>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
});

// v2.1: one counter per key scope ("initiative", "standalone", "idea", or a parent initiative's id).
// Counters only move up, so a number is never reissued after a rename, move or delete.
export const keyCounters = pgTable(
  "key_counters",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    next: integer("next").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.scope] })],
);

// v2.1: former keys of a task (after a move between initiatives, or the rekey migration).
// Every tool accepts an alias; responses and events carry the canonical key.
export const taskAliases = pgTable(
  "task_aliases",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.alias] }), index("task_aliases_task_idx").on(t.taskId)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    line: text("line").notNull(),
    adrUrl: text("adr_url"),
    // The task it is about. Pinned decisions are the "must keep" of the generated resume:
    // under their initiative, or project-wide when there is no task.
    taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
    pinned: boolean("pinned").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // v2.1: retired without a replacement (retire_decision). Hidden by default, like superseded ones.
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredBy: jsonb("retired_by").$type<Actor>(),
    retiredReason: text("retired_reason"),
    // The full ADR, stored as a project doc.
    docId: uuid("doc_id").references((): AnyPgColumn => docs.id, { onDelete: "set null" }),
    // v1 decisions carried a typed date in the line; the backfill moves it here.
    decidedOn: date("decided_on"),
    actor: jsonb("actor").$type<Actor>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("decisions_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("decisions_task_idx").on(t.taskId),
  ],
);

// v2.1: a decision may reverse several earlier ones (add_decision supersedes: [...]); each old one is
// reversed at most once, so the unique index keeps ALREADY_SUPERSEDED meaningful.
export const decisionSupersessions = pgTable(
  "decision_supersessions",
  {
    decisionId: uuid("decision_id")
      .notNull()
      .references((): AnyPgColumn => decisions.id, { onDelete: "cascade" }),
    supersedesId: uuid("supersedes_id")
      .notNull()
      .references((): AnyPgColumn => decisions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.decisionId, t.supersedesId] }), uniqueIndex("decision_supersessions_old_unique").on(t.supersedesId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // NULL = initiative or standalone spec.
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    // What the task is: PRD and phased plan (initiative) or the phase's scope (ticket). Replaced whole,
    // with the version; old text stays in the task.updated event.
    scope: text("scope").notNull().default(""),
    phase: integer("phase"), // tickets under an initiative: Phase N
    status: text("status").notNull(),
    priority: text("priority"), // tickets only: P0|P1|P2|P3
    workType: text("work_type"), // tickets only: code|ops|research|decision-needed
    origin: text("origin"), // tickets only: chartered|discovered|jorge (2.12: Jorge asked for it on screen)
    baseBranch: text("base_branch"), // initiatives only
    // Initiatives only: their part of the generated resume. Claims and next_claimable are derived.
    inProgressNote: text("in_progress_note").notNull().default(""),
    nextAction: text("next_action").notNull().default(""),
    branch: text("branch"),
    prUrl: text("pr_url"),
    blockedNote: text("blocked_note"),
    // v2.2: code areas (path globs) a ticket or initiative touches; claim warns on overlap (R-11).
    areas: text("areas").array().notNull().default(sql`'{}'::text[]`),
    // v2.2 bug and debt tickets (R-19).
    severity: text("severity"), // bugs: S1 | S2 | S3 | S4
    foundIn: text("found_in"), // bugs: the environment it was found in
    introducedBy: text("introduced_by"), // bugs: a key or a sha
    regression: boolean("regression"),
    costNote: text("cost_note"), // debt: what it costs while it stays
    // Bumped by every field change; appends (notes, results, checks) leave it alone.
    version: integer("version").notNull().default(1),
    // Lease: who is working on it and until when. An expired lease is free to claim and is cleared
    // by the next write in the project. workspace says where the code is; it outlives the lease.
    owner: jsonb("owner").$type<Actor>(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    workspace: jsonb("workspace").$type<Workspace>(),
    // v2.1: when the status last moved (the inbox shows how long something has waited).
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    // v2.1: the claim.expiring warning was sent for the current lease (cleared by a heartbeat).
    expiringWarnedAt: timestamp("expiring_warned_at", { withTimezone: true }),
    // v2.3 (R-16): where the initiative stands, apart from its spec (scope); stale when older than the last move.
    stateNote: text("state_note").notNull().default(""),
    stateNoteAt: timestamp("state_note_at", { withTimezone: true }),
    // v2.3 (R-06): a claim handed to a session (or "open") with a note; the hold lasts ten minutes.
    handoff: jsonb("handoff").$type<Handoff>(),
    ...timestamps,
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // 2.8: when it should be done (a calendar date, no time); audit OVERDUE once it is past and the task is open.
    dueOn: date("due_on"),
    // PLA-I8-1: ideas only. Null on tickets, initiatives, and every row that existed before ideas.
    stage: text("stage"),
    // Key of the initiative or standalone ticket an idea became. Null until it is promoted.
    promotedTo: text("promoted_to"),
    // PLA-I21: informational owner. It does not hold the lease (owner / lease_until do).
    ownerAgent: uuid("owner_agent").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    // PLA-I22: initiatives only. The goal this initiative serves; tickets inherit it through the parent.
    goalId: uuid("goal_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
    // PLA-I23: how many times assign moved owner_agent. Above 3 the next assign is refused.
    assignHops: integer("assign_hops").notNull().default(0),
  },
  (t) => [
    unique("tasks_project_key_unique").on(t.projectId, t.key),
    check("tasks_kind_check", sql`${t.kind} in ('initiative', 'ticket', 'idea')`),
    check("tasks_initiative_no_parent", sql`${t.kind} <> 'initiative' or ${t.parentId} is null`),
    check("tasks_idea_no_parent", sql`${t.kind} <> 'idea' or ${t.parentId} is null`),
    check(
      "tasks_stage_check",
      sql`(${t.kind} = 'idea' and ${t.stage} in ('idea', 'research', 'design', 'planning', 'ready')) or (${t.kind} <> 'idea' and ${t.stage} is null)`,
    ),
    check("tasks_promoted_to_idea", sql`${t.promotedTo} is null or ${t.kind} = 'idea'`),
    check("tasks_idea_status_check", sql`${t.kind} <> 'idea' or ${t.status} in ('Open', 'Done', 'Won''t do')`),
    check("tasks_lease_pair", sql`(${t.owner} is null) = (${t.leaseUntil} is null)`),
    check(
      "tasks_work_type_check",
      sql`${t.workType} is null or ${t.workType} in ('code', 'ops', 'research', 'decision-needed', 'bug', 'debt')`,
    ),
    check("tasks_goal_initiative", sql`${t.goalId} is null or ${t.kind} = 'initiative'`),
  ],
);

export const taskBlockers = pgTable(
  "task_blockers",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.blockerId] }),
    check("task_blockers_not_self", sql`${t.taskId} <> ${t.blockerId}`),
  ],
);

// v2: documents that live in Plania so every machine sees them: specs and plans on a task,
// design pages and ADRs on the project (task_id null). Replaced whole, with a version.
export const docs = pgTable(
  "docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    version: integer("version").notNull().default(1),
    actor: jsonb("actor").$type<Actor>().notNull(),
    ...timestamps,
  },
  (t) => [
    // Postgres 14 has no NULLS NOT DISTINCT: one index per scope.
    uniqueIndex("docs_task_title_unique").on(t.taskId, t.title).where(sql`${t.taskId} is not null`),
    uniqueIndex("docs_project_title_unique").on(t.projectId, t.title).where(sql`${t.taskId} is null`),
  ],
);

// v2: questions for Jorge. ask moves a ticket to Needs Jorge; the answer comes back as a decision
// tied to the task, so another machine's session finds it instead of asking again.
export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    options: text("options").array().notNull().default(sql`'{}'::text[]`),
    statusBefore: text("status_before"), // the ticket's status when the first open question was asked
    askedBy: jsonb("asked_by").$type<Actor>().notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    answer: text("answer"),
    answeredBy: jsonb("answered_by").$type<Actor>(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }),
    // 2.8: other task keys this question holds up, and how soon Jorge is needed (now | soon | whenever).
    blocks: text("blocks").array().notNull().default(sql`'{}'::text[]`),
    urgency: text("urgency"),
    humanOnly: boolean("human_only").notNull().default(false),
  },
  (t) => [index("questions_project_open_idx").on(t.projectId).where(sql`${t.answeredAt} is null`)],
);

// PLA-I15-2: one delegated answer. The owner told plania-bot in his own chat; the bot records
// that single option or approval decision with the message id and a short quote. answered_by on
// the question stays the screen actor (the owner). This row is the evidence, and it is what the
// Bandeja badge and DELEGATED_ANSWER read. The server cannot prove the message exists.
export const delegatedAnswers = pgTable(
  "delegated_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "cascade" }),
    // Historical id. Migration 0032 dropped the table it pointed at; the uuid stays on old rows.
    approvalId: uuid("approval_id"),
    messageId: text("message_id").notNull(),
    quote: text("quote").notNull(),
    actor: jsonb("actor").$type<Actor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // PLA-06: Jorge saw it on the Bandeja. The row stays; it leaves the list and the audit.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("delegated_answers_question_unique").on(t.questionId).where(sql`${t.questionId} is not null`),
    uniqueIndex("delegated_answers_approval_unique").on(t.approvalId).where(sql`${t.approvalId} is not null`),
    index("delegated_answers_created_idx").on(t.createdAt),
    check(
      "delegated_answers_one_target",
      sql`(${t.questionId} is not null and ${t.approvalId} is null) or (${t.questionId} is null and ${t.approvalId} is not null)`,
    ),
  ],
);

// v2: evidence. Several per task; In review requires one that fits the ticket's work_type.
export const results = pgTable(
  "results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // unit|integration|test|verify|live|grep|subagent|ci|e2e|visual|a11y|perf|security|migration
    verdict: text("verdict").notNull(), // pass|warn|fail
    cite: text("cite").notNull(),
    url: text("url"), // CI run, screenshot, recording
    // v2.2 structured fields (R-17): what ran, where, against which commit.
    commit: text("commit"),
    branch: text("branch"),
    env: text("env"),
    command: text("command"),
    exitCode: integer("exit_code"),
    counts: jsonb("counts").$type<{ pass?: number; fail?: number; skip?: number }>(),
    durationS: integer("duration_s"),
    attachments: text("attachments").array().notNull().default(sql`'{}'::text[]`), // links only
    viewport: text("viewport"),
    device: text("device"),
    metrics: jsonb("metrics").$type<Record<string, number>>(), // reported values, for metric_gte blockers
    actor: jsonb("actor").$type<Actor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("results_task_idx").on(t.taskId, t.createdAt)],
);

// v2: "Done when" as data. n is stable per task (set_check addresses it); position orders the list.
export const checks = pgTable(
  "checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: jsonb("done_by").$type<Actor>(),
    evidenceId: uuid("evidence_id").references(() => results.id, { onDelete: "set null" }),
    // v2.3 (R-14): an initiative check that ticks itself when this child reaches Done.
    derivedFrom: text("derived_from"),
    // v2.1: a check that will not be done, with why and (once In review or later) who approved it.
    waivedAt: timestamp("waived_at", { withTimezone: true }),
    waivedBy: jsonb("waived_by").$type<Actor>(),
    waiveReason: text("waive_reason"),
    approvalId: uuid("approval_id"),
  },
  (t) => [unique("checks_task_n_unique").on(t.taskId, t.n)],
);

// v2: numbers that must not collide across initiatives (e.g. migration 0009), reserved per project
// and bound to the ticket that will use them.
export const sequences = pgTable(
  "sequences",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nextValue: integer("next_value").notNull(),
    width: integer("width").notNull().default(4),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.name] })],
);

export const sequenceReservations = pgTable(
  "sequence_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: integer("value").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    actor: jsonb("actor").$type<Actor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("sequence_reservations_value_unique").on(t.projectId, t.name, t.value)],
);

// v2: what each environment runs, as data agents can check ("may I apply 0010?").
export const envStates = pgTable(
  "env_states",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    env: text("env").notNull(), // prod, staging, sandbox...
    commit: text("commit"),
    branch: text("branch"),
    migrationsApplied: integer("migrations_applied"), // highest migration number applied (derived from migrations when given)
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    // v2.2 (R-20): the migration tags applied, configuration flags (never secrets), and where
    // deployed_at came from ({provider, deployment_id, url}).
    migrations: text("migrations").array().notNull().default(sql`'{}'::text[]`),
    flags: jsonb("flags").$type<Record<string, string | number | boolean>>().notNull().default({}),
    deploySource: jsonb("deploy_source").$type<DeploySource>(),
    by: jsonb("by").$type<Actor>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.env] })],
);

// Commits known to be in an environment. Plania does not read git: CI or agents report them.
export const envCommits = pgTable(
  "env_commits",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    env: text("env").notNull(),
    sha: text("sha").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.env, t.sha] })],
);

// v2.0 env blockers, replaced by the typed `blockers` table in 2.2. Kept until the cleanup migration.

// v2.2 (R-15): typed blockers the server can evaluate. env: {env, condition, value} as before
// (contains_commit, migration_gte, deployed_after); human_action: {assignee, text}, cleared from the
// inbox; env_flag: {env, flag, equals}; time_after: {at}; metric_gte: {name, value}.
export const blockers = pgTable(
  "blockers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    satisfiedAt: timestamp("satisfied_at", { withTimezone: true }),
    satisfiedBy: jsonb("satisfied_by").$type<Actor>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("blockers_task_idx").on(t.taskId),
    check("blockers_type_check", sql`${t.type} in ('env', 'human_action', 'env_flag', 'time_after', 'metric_gte')`),
  ],
);

// v2.2: metric values agents report (set_metric, or metrics on a result), for metric_gte blockers.
export const projectMetrics = pgTable(
  "project_metrics",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: integer("value").notNull(),
    by: jsonb("by").$type<Actor>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.name] })],
);

// v2.2 (R-09): branches the project knows, who owns each (an initiative's integration branch or a
// ticket), and what the poller learned about them.
export const branches = pgTable(
  "branches",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ownerTaskId: uuid("owner_task_id").references(() => tasks.id, { onDelete: "set null" }),
    shared: boolean("shared").notNull().default(false),
    shareReason: text("share_reason"),
    headSha: text("head_sha"),
    headAt: timestamp("head_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    prNumber: integer("pr_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.name] }), index("branches_owner_idx").on(t.ownerTaskId)],
);

// v2.2 (R-10): shared things only one session may hold at a time (a port on a machine, the
// production migrate step), and daily quotas (an API's call budget).
export const resources = pgTable(
  "resources",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    holder: jsonb("holder").$type<Actor>().notNull(),
    purpose: text("purpose").notNull().default(""),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
    approvalId: uuid("approval_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.name] })],
);

export const quotaUsage = pgTable(
  "quota_usage",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    day: date("day").notNull(), // UTC day
    used: integer("used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.name, t.day] })],
);

// Machine footprint (PLA-I1-2): what runs or is stored on a Mac for agent work: dev servers, database
// servers and their databases, worktrees, services, headless browsers, tunnels, containers. Rows come
// from the machine job (source observed), from agents that declare what they create (declared) or
// both. Apart from `resources`, which stays the short-lived lock table. project_id is null for what
// no project owns (a Postgres server, a repo that is not a project yet: details.repo names it).
// locator is unique per machine and kind while the row is not released; kind-specific facts live in
// details. misses counts consecutive runs of the item's collector that did not see it (2 = gone).
export const footprints = pgTable(
  "footprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    machine: text("machine").notNull(),
    kind: text("kind").notNull(), // worktree | server | db_server | database | container | browser | service | tunnel | cache
    locator: text("locator").notNull(), // port:3069, db@127.0.0.1:5433, a path, pid:123, brew:postgresql@17
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
    sessionId: text("session_id"),
    holder: jsonb("holder").$type<Actor>(), // who declared it (declared and both)
    source: text("source").notNull().default("observed"), // observed | declared | both
    purpose: text("purpose").notNull().default(""),
    // A command that removes it. For observed rows the job fills in a suggestion; nothing runs it.
    teardown: text("teardown").notNull().default(""),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    state: text("state").notNull().default("orphan"), // live | orphan | stale | ghost | gone | released | self | system
    misses: integer("misses").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    declaredAt: timestamp("declared_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("footprints_live_locator_idx").on(t.machine, t.kind, t.locator).where(sql`${t.releasedAt} is null`),
    index("footprints_project_idx").on(t.projectId),
    index("footprints_task_idx").on(t.taskId),
    check(
      "footprints_kind_check",
      sql`${t.kind} in ('worktree', 'server', 'db_server', 'database', 'container', 'browser', 'service', 'tunnel', 'cache')`,
    ),
    check("footprints_source_check", sql`${t.source} in ('observed', 'declared', 'both')`),
    check(
      "footprints_state_check",
      sql`${t.state} in ('live', 'orphan', 'stale', 'ghost', 'gone', 'released', 'self', 'system')`,
    ),
  ],
);

// v2.2 (R-21): pull requests the GitHub poller has seen, linked to the ticket they belong to.
export const pullRequests = pgTable(
  "pull_requests",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    state: text("state").notNull(), // open | merged | closed
    headSha: text("head_sha"),
    headBranch: text("head_branch"),
    baseBranch: text("base_branch"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    mergeSha: text("merge_sha"),
    ciState: text("ci_state"), // pending | success | failure
    ciUrl: text("ci_url"),
    ghUpdatedAt: timestamp("gh_updated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.repo, t.number] }), index("pull_requests_task_idx").on(t.taskId)],
);

// v2.3 (R-31): the last audit run per project, so the status block can show the count.
export const auditRuns = pgTable("audit_runs", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
  findings: jsonb("findings").$type<{ code: string; key: string | null; detail: string; fix_hint: string; id?: string; command?: string; level?: "info" | "warn" }[]>().notNull().default([]),
});

// v2.3 (R-22): what a deploy shipped, computed when tickets reach Released.
export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    env: text("env").notNull(),
    commit: text("commit").notNull(),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    source: jsonb("source").$type<DeploySource>(),
    taskKeys: text("task_keys").array().notNull().default(sql`'{}'::text[]`),
    prs: text("prs").array().notNull().default(sql`'{}'::text[]`),
    migrations: text("migrations").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("releases_env_commit_unique").on(t.projectId, t.env, t.commit)],
);

// v2.2: where each poller got to (cursors, etags, caches) and its last error.
export const pollState = pgTable(
  "poll_state",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // github | vercel
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default({}),
    polledAt: timestamp("polled_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.source] })],
);

// 2.9: state of jobs that belong to the Mac, not to a project (the nightly backup), one row per key.
export const machineState = pgTable("machine_state", {
  key: text("key").primaryKey(), // backup
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 2.12: one row per device that turned on "Avisarme cuando me toque". endpoint is the push service's
// URL for that browser; keys are its {p256dh, auth}. The push job sends to every row; a 404/410 from
// the push service deletes the row, any other failure stamps failed_at.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
});

// v2: idempotent retries. A write that carries request_id stores its response here; the same
// request_id for the same tool replays it instead of writing twice. Rows older than 30 days are purged.
export const writeRequests = pgTable(
  "write_requests",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    tool: text("tool").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.requestId] })],
);

// v2: append-only audit trail. Every mutation writes one or more rows in the same transaction.
// Events of a task are also its log (get_task.log). Ids are a cursor for list_events.
export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    taskKey: text("task_key"), // kept when the task row is gone
    type: text("type").notNull(),
    actor: jsonb("actor").$type<Actor>().notNull(),
    tokenId: uuid("token_id"), // v2.1: the agent token behind the write, when one was used
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_project_id_idx").on(t.projectId, t.id), index("events_task_id_idx").on(t.taskId, t.id)],
);

// 2.7: where each digest reader left off. reader is the agent token id, or static:<scope> for the
// unbound env tokens. get_digest without since resumes from here, so an assistant stays stateless.
export const digestReads = pgTable("digest_reads", {
  reader: text("reader").primaryKey(),
  cursor: bigint("cursor", { mode: "number" }).notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Who made a change. session_id identifies one agent session (and owns its leases).
export type Actor = { agent: string; session_id: string; machine?: string; model?: string };

// Where a ticket's code is checked out.
export type Workspace = { machine?: string; worktree_path?: string; branch?: string };

// A claim handed to another session (or anyone) with what is done and what is next.
// footprint: what the ticket still has running on the Mac (register_footprint / the machine job), so the receiver knows.
export type Handoff = { to: string; note: string; head_sha?: string; from: Actor; at: string; until: string; footprint?: Record<string, unknown>[] };

// Where an environment's deployed_at came from.
export type DeploySource = { provider: string; deployment_id: string; url?: string };

// projects.settings (set_project settings, merged). Secrets never: integrations name env vars.
export type ProjectSettings = {
  release_target?: string; // the env a Released ticket must reach (default prod)
  branch_pattern?: string; // regex every branch name must match
  claim_from?: "backlog" | "ready"; // what get_next offers (default backlog)
  resources?: Record<string, { needs_approval?: boolean; ttl_max?: number }>; // by name glob
  quotas?: Record<string, { daily: number }>;
  github?: { repo: string; token_env?: string };
  vercel?: { project_id: string; team_id?: string; token_env?: string; targets?: Record<string, string> };
  // Where the project's repo lives on the Mac the machine job runs on (default <PLANIA_PROJECTS_ROOT>/<slug>).
  local?: { repo_path?: string };
  // 2.10: the release step only Jorge takes, e.g. {from: "sandbox", into: "main", env: "prod"}. Absent: none.
  release?: ReleaseSettings;
  // PLA-I21: how long since a check-in counts as idle. A live claim past this is stuck. Default 120.
  team?: { idle_minutes?: number };
};

// 2.13: mode "command" (default) shows the command Jorge runs; "merge" lets him ship from the screen
// (a PR from → into merged with gh pr merge --merge, POST /api/projects/:slug/release/ship).
export type ReleaseSettings = { from: string; into: string; env: string; mode?: "command" | "merge" };

export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;

// PLA-I21: company roster. Roles and bot labels only. reports_to is the org chart.
// A row may match agent_tokens.agent by name or slug (list_agents); there is no token foreign key.
export const AGENT_KINDS = ["bot", "coder", "human"] as const;
// PLA-I32: retired agents leave the roster but keep their runs and history.
export const AGENT_STATUSES = ["alive", "idle", "stuck", "retired"] as const;
export const ADAPTERS = ["http", "claude_code", "grok_webhook", "none"] as const;
export type AdapterName = (typeof ADAPTERS)[number];
// Env var names only. The values stay in the process environment.
export type AdapterConfig = {
  command_env?: string;
  args_env?: string;
  url_env?: string;
};

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    title: text("title").notNull().default(""),
    reportsTo: uuid("reports_to").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    capabilities: text("capabilities").array().notNull().default(sql`'{}'::text[]`),
    kind: text("kind").notNull(),
    wakeUrl: text("wake_url"),
    lastCheckInAt: timestamp("last_check_in_at", { withTimezone: true }),
    // Sweep wake throttle: at most one POST to wake_url per agent per hour.
    lastWakeAt: timestamp("last_wake_at", { withTimezone: true }),
    status: text("status").notNull().default("idle"),
    note: text("note").notNull().default(""),
    // PLA-I26: which adapter a heartbeat uses, and how often. Null minutes means the job skips the row.
    adapter: text("adapter").notNull().default("none"),
    adapterConfig: jsonb("adapter_config").$type<AdapterConfig>().notNull().default({}),
    heartbeatMinutes: integer("heartbeat_minutes"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    // PLA-I32: the project whose team this agent is on (null: the company, i.e. ceo and asistente),
    // and the role template it was made from (product-owner, research, artist, taller, ...). Migration 0041.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    roleTemplate: text("role_template"),
    ...timestamps,
  },
  (t) => [
    index("agents_project_idx").on(t.projectId),
    check("agents_kind_check", sql`${t.kind} in ('bot', 'coder', 'human')`),
    check("agents_status_check", sql`${t.status} in ('alive', 'idle', 'stuck', 'retired')`),
    check("agents_role_template_check", sql`${t.roleTemplate} is null or ${t.roleTemplate} ~ '^[a-z][a-z0-9-]{0,39}$'`),
    check("agents_not_self", sql`${t.reportsTo} is null or ${t.reportsTo} <> ${t.id}`),
    check("agents_adapter_check", sql`${t.adapter} in ('http', 'claude_code', 'grok_webhook', 'none')`),
    check("agents_heartbeat_minutes_check", sql`${t.heartbeatMinutes} is null or (${t.heartbeatMinutes} between 1 and 1440)`),
  ],
);

export type Agent = typeof agents.$inferSelect;
// PLA-I22: company goals (project_id null) and the project goals under them.
// An initiative points here with tasks.goal_id. Progress is Done/total tickets of linked initiatives,
// rolled up from project goals to their company goal. No scoring and no deadline enforcement.
export const GOAL_STATUSES = ["active", "done", "dropped"] as const;

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    why: text("why").notNull().default(""),
    status: text("status").notNull().default("active"),
    targetOn: date("target_on"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("goals_project_idx").on(t.projectId),
    index("goals_parent_idx").on(t.parentId),
    check("goals_status_check", sql`${t.status} in ('active', 'done', 'dropped')`),
    check("goals_company_root", sql`${t.projectId} is not null or ${t.parentId} is null`),
    check("goals_not_self", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

export type Goal = typeof goals.$inferSelect;

export const INITIATIVE_STATUSES = ["Planning", "Active", "Shipping", "Done", "On hold", "Won't do"] as const;
export const TICKET_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Merged", "Released", "Blocked", "Needs Jorge", "Done", "Won't do"] as const;
export const IDEA_STATUSES = ["Open", "Done", "Won't do"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const ORIGINS = ["chartered", "discovered", "jorge"] as const;
// What an agent may pass to create_task; "jorge" is the screen's alone (POST /api/projects/:slug/tasks).
export const AGENT_ORIGINS = ["chartered", "discovered"] as const;
export const KINDS = ["initiative", "ticket", "idea"] as const;

// PLA-I23: agents comment on a task and assign it to each other. assign_hops on tasks caps the chain.
// routine_runs is the history of a roster agent's routine (recorded, newest first when listed).
export const ROUTINE_STATUSES = ["ok", "fail", "skipped"] as const;

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorAgent: text("author_agent").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_comments_task_idx").on(t.taskId, t.createdAt),
    check("task_comments_author_check", sql`char_length(${t.authorAgent}) between 1 and 60`),
    check("task_comments_body_check", sql`char_length(${t.body}) between 1 and 2000`),
  ],
);

export type TaskComment = typeof taskComments.$inferSelect;

export const routineRuns = pgTable(
  "routine_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent: text("agent").notNull(),
    routine: text("routine").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    status: text("status").notNull(),
    summary: text("summary").notNull().default(""),
    taskKey: text("task_key"),
  },
  (t) => [
    index("routine_runs_agent_started_idx").on(t.agent, t.startedAt),
    check("routine_runs_status_check", sql`${t.status} in ('ok', 'fail', 'skipped')`),
    check("routine_runs_agent_check", sql`char_length(${t.agent}) between 1 and 60`),
    check("routine_runs_routine_check", sql`char_length(${t.routine}) between 1 and 80`),
  ],
);

export type RoutineRun = typeof routineRuns.$inferSelect;

// PLA-I25: tokens an agent reports for a task run. Totals per agent, project and week are informational.
export const tokenUsage = pgTable(
  "token_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    taskKey: text("task_key").notNull(),
    runId: text("run_id").notNull(),
    model: text("model").notNull(),
    input: integer("input").notNull(),
    output: integer("output").notNull(),
    // PLA-I29: cache tokens from the runner's modelUsage (0 when an agent reports by hand).
    cacheRead: integer("cache_read").notNull().default(0),
    cacheCreate: integer("cache_create").notNull().default(0),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("token_usage_run_unique").on(t.projectId, t.agent, t.taskKey, t.runId),
    index("token_usage_at_idx").on(t.at),
    check("token_usage_counts_check", sql`${t.input} >= 0 and ${t.output} >= 0`),
    check("token_usage_agent_check", sql`char_length(${t.agent}) between 1 and 60`),
    check("token_usage_task_key_check", sql`char_length(${t.taskKey}) between 1 and 80`),
    check("token_usage_run_id_check", sql`char_length(${t.runId}) between 1 and 120`),
    check("token_usage_model_check", sql`char_length(${t.model}) between 1 and 80`),
  ],
);

export type TokenUsage = typeof tokenUsage.$inferSelect;

// PLA-I26: one row each time a heartbeat or a manual wake runs an adapter.
export const HEARTBEAT_STATUSES = ["ok", "fail", "skipped"] as const;

export const heartbeatRuns = pgTable(
  "heartbeat_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    status: text("status").notNull(),
    adapter: text("adapter").notNull(),
    summary: text("summary").notNull().default(""),
    taskKey: text("task_key"),
  },
  (t) => [
    index("heartbeat_runs_agent_started_idx").on(t.agentId, t.startedAt),
    check("heartbeat_runs_status_check", sql`${t.status} in ('ok', 'fail', 'skipped')`),
    check("heartbeat_runs_adapter_check", sql`${t.adapter} in ('http', 'claude_code', 'grok_webhook', 'none')`),
    check("heartbeat_runs_summary_check", sql`char_length(${t.summary}) <= 500`),
    check("heartbeat_runs_task_key_check", sql`${t.taskKey} is null or char_length(${t.taskKey}) between 1 and 80`),
  ],
);

export type HeartbeatRun = typeof heartbeatRuns.$inferSelect;

// PLA-I29: the autonomous runner. One settings row (company switch and the knobs only Jorge moves),
// weekly token budgets, the run queue and live runs, the claude session per agent and project,
// and plan-window readings. Migration 0039.
export const runnerSettings = pgTable(
  "runner_settings",
  {
    id: integer("id").primaryKey().default(1),
    companyPaused: boolean("company_paused").notNull().default(false),
    companyPausedAt: timestamp("company_paused_at", { withTimezone: true }),
    maxConcurrent: integer("max_concurrent").notNull().default(1),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(30),
    planGuardPct: integer("plan_guard_pct").notNull().default(70),
    reserveTokens: integer("reserve_tokens").notNull().default(60000),
    maxTurns: integer("max_turns").notNull().default(40),
    timeoutMinutes: integer("timeout_minutes").notNull().default(45),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // PLA-I32-1: Asistente's weekly token budget (its runs are role asistente). Null stops them.
    asistenteWeeklyLimit: bigint("asistente_weekly_limit", { mode: "number" }).default(500_000),
  },
  (t) => [
    check("runner_settings_singleton", sql`${t.id} = 1`),
    check(
      "runner_settings_asistente_limit_check",
      sql`${t.asistenteWeeklyLimit} is null or (${t.asistenteWeeklyLimit} > 0 and ${t.asistenteWeeklyLimit} <= 10000000000)`,
    ),
  ],
);

export type RunnerSettings = typeof runnerSettings.$inferSelect;

// PLA-I32-1: scope 'role' is retired. The rows stay for history; no run is checked against them.
export const BUDGET_SCOPES = ["role", "project"] as const;

export const tokenBudgets = pgTable(
  "token_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    role: text("role"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    weeklyLimit: bigint("weekly_limit", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("token_budgets_role_unique").on(t.role).where(sql`${t.scope} = 'role'`),
    uniqueIndex("token_budgets_project_unique").on(t.projectId).where(sql`${t.scope} = 'project'`),
  ],
);

export const RUN_STATUSES = ["queued", "running", "ok", "fail", "skipped", "stopped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskKey: text("task_key"),
    role: text("role").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull().default(""),
    pid: integer("pid"),
    claudeSessionId: text("claude_session_id"),
    resumed: boolean("resumed").notNull().default(false),
    cwd: text("cwd"),
    worktreePath: text("worktree_path"),
    branch: text("branch"),
    logPath: text("log_path"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    turns: integer("turns").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    cacheCreateTokens: bigint("cache_create_tokens", { mode: "number" }).notNull().default(0),
    tokensTotal: bigint("tokens_total", { mode: "number" }).notNull().default(0),
    reserveTokens: integer("reserve_tokens").notNull().default(0),
    usageKnown: boolean("usage_known").notNull().default(true),
    usageAckAt: timestamp("usage_ack_at", { withTimezone: true }),
    exitCode: integer("exit_code"),
    stopReason: text("stop_reason"),
  },
  (t) => [
    index("agent_runs_status_idx").on(t.status, t.queuedAt),
    index("agent_runs_agent_idx").on(t.agentId, t.queuedAt),
    index("agent_runs_project_idx").on(t.projectId, t.startedAt),
    check("agent_runs_status_check", sql`${t.status} in ('queued', 'running', 'ok', 'fail', 'skipped', 'stopped')`),
    check("agent_runs_summary_check", sql`char_length(${t.summary}) <= 500`),
  ],
);

export type AgentRun = typeof agentRuns.$inferSelect;

export const agentSessions = pgTable(
  "agent_sessions",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    claudeSessionId: text("claude_session_id").notNull(),
    cwd: text("cwd").notNull(),
    runs: integer("runs").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.projectId] })],
);

export const PLAN_SOURCES = ["stream", "usage_probe"] as const;

export const planReadings = pgTable(
  "plan_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    status: text("status"),
    fiveHourPct: real("five_hour_pct"),
    sevenDayPct: real("seven_day_pct"),
    fiveHourResetsAt: timestamp("five_hour_resets_at", { withTimezone: true }),
    sevenDayResetsAt: timestamp("seven_day_resets_at", { withTimezone: true }),
    overageStatus: text("overage_status"),
    runId: uuid("run_id"),
  },
  (t) => [index("plan_readings_at_idx").on(t.at), check("plan_readings_source_check", sql`${t.source} in ('stream', 'usage_probe')`)],
);

export type PlanReading = typeof planReadings.$inferSelect;

// PLA-I32: conversations. One company thread (Jorge and Asistente) and one per project (Jorge and its PO;
// the team answers there too). Messages link what they talk about and keep the action Jorge took.
export const THREAD_KINDS = ["company", "project"] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];
export const LINK_KINDS = ["ticket", "doc", "pr", "idea", "question"] as const;
export type ThreadLink = { kind: (typeof LINK_KINDS)[number]; ref: string; title: string };
export const THREAD_ACTIONS = ["aceptar", "cambios", "responder"] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];
export type ActionState = { action: ThreadAction; at: string; result: Record<string, unknown> };

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    // When Jorge last read it on screen; later messages that are not his are unread.
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("threads_company_unique").on(t.kind).where(sql`${t.kind} = 'company'`),
    uniqueIndex("threads_project_unique").on(t.projectId).where(sql`${t.kind} = 'project'`),
    check("threads_kind_check", sql`(${t.kind} = 'company' and ${t.projectId} is null) or (${t.kind} = 'project' and ${t.projectId} is not null)`),
  ],
);

export type Thread = typeof threads.$inferSelect;

export const threadMessages = pgTable(
  "thread_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    authorAgent: text("author_agent").notNull(),
    authorRole: text("author_role").notNull(),
    body: text("body").notNull(),
    links: jsonb("links").$type<ThreadLink[]>().notNull().default([]),
    actionState: jsonb("action_state").$type<ActionState | null>(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "set null" }),
  },
  (t) => [
    index("thread_messages_thread_idx").on(t.threadId, t.at),
    check("thread_messages_body_check", sql`char_length(${t.body}) between 1 and 4000`),
    check("thread_messages_author_check", sql`char_length(${t.authorAgent}) between 1 and 60 and char_length(${t.authorRole}) between 1 and 40`),
    check("thread_messages_links_check", sql`jsonb_typeof(${t.links}) = 'array' and jsonb_array_length(${t.links}) <= 10`),
    check("thread_messages_action_state_check", sql`${t.actionState} is null or jsonb_typeof(${t.actionState}) = 'object'`),
  ],
);

export type ThreadMessage = typeof threadMessages.$inferSelect;
