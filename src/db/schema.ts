import { sql } from "drizzle-orm";
import type { CustomSpec, McpTally, ToolsSnapshot } from "../runner/conexiones.js";
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
  time,
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
  // v2.1: the project's key prefix (TND for tienda). Keys are PREFIX-I<n> (initiatives),
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
  // PLA-I29: the project kill switch. A new project starts paused; only the owner resumes it, on screen.
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
    origin: text("origin"), // tickets only: chartered|discovered|owner (2.12: the owner asked for it on screen)
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
    // PLA-I2-10 (0066): the words the owner typed for an order or an idea, kept as written. Null on agents' tickets
    // and on orders made before 0066 (orderText falls back to their scope line).
    ownerWords: text("owner_words"),
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
    // PLA-I46-11: the PO's check list, copied onto each step of an accepted plan; QA ticks it.
    poChecklist: jsonb("po_checklist").$type<PoCheck[]>().notNull().default(sql`'[]'::jsonb`),
    // PLA-I52-1: what Taller hands over with a delivery so Plania can show it (src/captures/muestra.ts). Null until finish.
    muestra: jsonb("muestra").$type<import("../captures/muestra.js").Muestra>(),
    // PLA-I52-3: where the delivery's pictures stand (src/captures/probador.ts). Null until Plania starts them.
    probador: jsonb("probador").$type<import("../captures/probador.js").ProbadorState>(),
    // PLA-I52-6: what the owner asked about the delivery (answers live in the project thread).
    // PLA-I52-7: the kind of change finish read from the diff: se_ve | se_comporta | no_se_ve. Null when unknown.
    cambio: text("cambio"),
    preguntas: jsonb("preguntas").$type<{ id: string; text: string; at: string }[]>().notNull().default(sql`'[]'::jsonb`),
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

// v2: questions for the owner. ask moves a ticket to Needs owner; the answer comes back as a decision
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
    // 2.8: other task keys this question holds up, and how soon the owner is needed (now | soon | whenever).
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
    // PLA-06: the owner saw it on the Bandeja. The row stays; it leaves the list and the audit.
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
    kind: text("kind").notNull(), // unit|integration|test|verify|live|grep|subagent|ci|e2e|visual|a11y|perf|security|migration|scan
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
    ciState: text("ci_state"), // pending | success | failure | none (PLA-14: the head has no check run and no status)
    ciUrl: text("ci_url"),
    // PLA-I36-10: how many files the PR changes, when the poller read it.
    changedFiles: integer("changed_files"),
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

// 2.9: state of jobs that belong to the machine, not to a project (the nightly backup), one row per key.
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
// footprint: what the ticket still has running on the machine (register_footprint / the machine job), so the receiver knows.
export type Handoff = { to: string; note: string; head_sha?: string; from: Actor; at: string; until: string; footprint?: Record<string, unknown>[] };

// Where an environment's deployed_at came from.
export type DeploySource = { provider: string; deployment_id: string; url?: string };

// projects.settings (set_project settings, merged). Secrets never: integrations name env vars.
// PLA-I60: the project's run limits, set in Motores. Missing keys are the defaults (1, 1, 1, true).
// PLA-58: shared_areas, the paths no single ticket owns (default src/runner/touched.ts DEFAULT_SHARED_AREAS).
export type ProjectRunnerSettings = { max_concurrent?: number; consulta_slots?: number; max_per_agent?: number; serialize_areas?: boolean; shared_areas?: string[];
  // PLA-I2-13: names of server variables this project's runs also get (src/runner/run-env.ts). Never Plania's own.
  env?: string[] };

// PLA-I73: how building goes fast (src/runner/velocidad.ts reads it with its defaults).
export type VelocidadSettings = {
  /** the next chained step starts when the previous one is delivered, on top of its branch */
  apilar?: boolean;
  /** por_modulo: a green step without risk is accepted by itself and the owner reviews the module at Publicar */
  revision?: "por_paso" | "por_modulo";
  /** Taller steps of this project at once (areas never overlap) */
  carriles?: number;
  /** the skeleton step starts when the plan is delivered, before «Constrúyelo» */
  esqueleto_temprano?: boolean;
  /** Plania runs settings.qa.verify on each delivery even without a QA seat */
  verificar?: boolean;
};
export type ProjectSettings = {
  // PLA-I60: «Agentes a la vez», «Preguntas a la vez», «Por agente» (Motores) and same-files serialization.
  runner?: ProjectRunnerSettings;
  release_target?: string; // the env a Released ticket must reach (default prod)
  // PLA-I56-1: what "released" means. env: release_target runs the merge commit (a deploy). branch: the release
  // branch (release.into, default main) contains it. Unset: env with Vercel or a commit recorded for release_target, else branch.
  release_on?: "env" | "branch";
  // PLA-I56-1: a released code, bug or debt ticket with every check closed and no open question moves to Done by
  // the rule. On unless false.
  auto_done?: boolean;
  velocidad?: VelocidadSettings;
  branch_pattern?: string; // regex every branch name must match
  claim_from?: "backlog" | "ready"; // what get_next offers (default backlog)
  resources?: Record<string, { needs_approval?: boolean; ttl_max?: number }>; // by name glob
  quotas?: Record<string, { daily: number }>;
  github?: { repo: string; token_env?: string };
  // PLA-I74-8: production_url is the address that must answer before a deploy counts as in production (default: the
  // production environment's health or URL in Camino, else the deploy's own URL).
  vercel?: { project_id: string; team_id?: string; token_env?: string; targets?: Record<string, string>; production_url?: string };
  // Where the project's repo lives on the machine the machine job runs on (default <PLANIA_PROJECTS_ROOT>/<slug>).
  // NEWPROJ-3: no_code says on purpose that the project has no code yet (never together with repo_path).
  local?: { repo_path?: string; no_code?: boolean };
  // PLA-I2-5: the branch every worktree is cut from and the only one Aceptar merges into. Default "sandbox"; never
  // main, master, production or prod. Read it through startBranchOf (src/runner/start-branch.ts).
  start_branch?: string;
  // 2.10: the release step only the owner takes, e.g. {from: "sandbox", into: "main", env: "prod"}. Absent: none.
  release?: ReleaseSettings;
  // PLA-I2-3: where the project sits in lists; lower first, then by slug. Colour and mark come from the slug.
  identity?: { order?: number };
  // PLA-I21: how long since a check-in counts as idle. A live claim past this is stuck. Default 120.
  team?: { idle_minutes?: number };
  // PLA-I36-6: the Ready ticket the owner picked to go first (Cambiar lo siguiente); ignored once it leaves Ready.
  next_first?: string;
  // PLA-I36-8: a PO's plan waits for "Sí, empiecen" before any ticket is made. On for a new project.
  plan_approval?: boolean;
  // PLA-I36-10: where the project's running preview lives (Ver la vista previa).
  preview_url?: string;
  // PLA-I40-7: a delivery whose tests pass is accepted into the test copy without the owner. Off unless set.
  auto_accept?: boolean;
  // PLA-I52-7: «solo lo que no se ve». With auto_accept off, deliveries whose diff does not change the screen
  // (tasks.cambio no_se_ve) are accepted alone into the test copy under the same rules. Off unless set.
  auto_accept_invisible?: boolean;
  // PLA-I46-6: how Plania starts and captures the project's test copy (src/captures/settings.ts).
  capture?: import("../captures/settings.js").CaptureSettings;
  // PLA-I46-9: the QA lane's verify list and review model (src/runner/qa-settings.ts).
  qa?: import("../runner/qa-settings.js").QaSettings;
  // PLA-I48-2: the floor's Máquinas: env file, migrate and seed commands, migrations folder (src/maquinas/settings.ts).
  maquinas?: import("../maquinas/env.js").MaquinasSettings;
  // PLA-I66-6: the Marca door also counts the native app icons and the iPhone launch screens. Off unless set.
  // PLA-I69-3: the extra surfaces the owner switched on (avisos, atajos, capturas, prueba).
  marca?: { native?: boolean; extras?: Partial<Record<"avisos" | "atajos" | "capturas" | "prueba", boolean>> };
};

// 2.13: mode "command" (default) shows the command the owner runs; "merge" lets him ship from the screen
// (a PR from → into merged with gh pr merge --merge, POST /api/projects/:slug/release/ship).
// PLA-I68-1: who migrates the production database when a release carries migrations: the deploy (its own step),
// the owner by hand, or nobody (the project has no production database). Unset blocks a release with migrations.
export const PROD_MIGRATIONS = ["deploy", "owner", "none"] as const;
export type ProdMigrations = (typeof PROD_MIGRATIONS)[number];
export type ReleaseSettings = { from: string; into: string; env: string; mode?: "command" | "merge"; prod_migrations?: ProdMigrations };

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
    // PLA-I46-12: the skill packs this role carries, by slug (a `Pack: <name>` doc in Plania). Migration 0046.
    skillPacks: text("skill_packs").array().notNull().default(sql`'{}'::text[]`),
    // PLA-I59-1 (Motores): the model and effort this seat runs on (null: the company default), and for a PO the
    // ones its Preguntar runs use (null: the seat's). src/runner/motor.ts resolves them. Migration 0058.
    motorModel: text("motor_model"),
    motorEffort: text("motor_effort"),
    consultaModel: text("consulta_model"),
    consultaEffort: text("consulta_effort"),
    // PLA-I60 (0060): this seat's own «a la vez» (null: the project's «por agente»).
    maxParallel: integer("max_parallel"),
    // PLA-I67-2 (0068): «tu manera», the owner's instruction for this agent, appended after the role prompt.
    manner: text("manner"),
    mannerUpdatedAt: timestamp("manner_updated_at", { withTimezone: true }),
    // PLA-I71-3 (0075): the owner paused this seat (it starts no run), its order on the chart, and the team template it
    // was adopted from (PLA-I71-6).
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    position: integer("position"),
    fromTeam: text("from_team"),
    ...timestamps,
  },
  (t) => [
    index("agents_project_idx").on(t.projectId),
    check("agents_skill_packs_check", sql`cardinality(${t.skillPacks}) <= 10`),
    check("agents_kind_check", sql`${t.kind} in ('bot', 'coder', 'human')`),
    check("agents_status_check", sql`${t.status} in ('alive', 'idle', 'stuck', 'retired')`),
    check("agents_role_template_check", sql`${t.roleTemplate} is null or ${t.roleTemplate} ~ '^[a-z][a-z0-9-]{0,39}$'`),
    check("agents_not_self", sql`${t.reportsTo} is null or ${t.reportsTo} <> ${t.id}`),
    check("agents_adapter_check", sql`${t.adapter} in ('http', 'claude_code', 'grok_webhook', 'none')`),
    check("agents_heartbeat_minutes_check", sql`${t.heartbeatMinutes} is null or (${t.heartbeatMinutes} between 1 and 1440)`),
    check("agents_motor_model_check", sql`${t.motorModel} is null or ${t.motorModel} ~ '^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]{3,60}(\\[1m\\])?)$'`),
    check("agents_consulta_model_check", sql`${t.consultaModel} is null or ${t.consultaModel} ~ '^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]{3,60}(\\[1m\\])?)$'`),
    check("agents_motor_effort_check", sql`${t.motorEffort} is null or ${t.motorEffort} in ('low', 'medium', 'high', 'xhigh', 'max')`),
    check("agents_consulta_effort_check", sql`${t.consultaEffort} is null or ${t.consultaEffort} in ('low', 'medium', 'high', 'xhigh', 'max')`),
    check("agents_max_parallel_check", sql`${t.maxParallel} is null or ${t.maxParallel} between 1 and 50`),
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
export const TICKET_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Merged", "Released", "Blocked", "Needs owner", "Done", "Won't do"] as const;
export const IDEA_STATUSES = ["Open", "Done", "Won't do"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const ORIGINS = ["chartered", "discovered", "owner"] as const;
// What an agent may pass to create_task; "owner" is the screen's alone (POST /api/projects/:slug/tasks).
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

// PLA-I29: the autonomous runner. One settings row (company switch and the knobs only the owner moves),
// the run queue and live runs (PLA-21: no token budgets), the claude session per agent and project,
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
    guardOverride: boolean("guard_override").notNull().default(false),
    reserveTokens: integer("reserve_tokens").notNull().default(60000),
    maxTurns: integer("max_turns").notNull().default(40),
    timeoutMinutes: integer("timeout_minutes").notNull().default(45),
    // PLA-I59-1: the company's default motor (null: the CLI's own default). Migration 0058.
    defaultModel: text("default_model"),
    defaultEffort: text("default_effort"),
    // PLA-I60 (0060): max_concurrent is the company ceiling; these pace and protect the machine.
    maxStartsPerMinute: integer("max_starts_per_minute").notNull().default(6),
    estPctPerRun: integer("est_pct_per_run").notNull().default(3),
    minFreeMb: integer("min_free_mb").notNull().default(1500),
    minFreeDiskGb: integer("min_free_disk_gb").notNull().default(10),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // runner_settings_ranges (0039, widened in 0060: max_concurrent up to 500) lives in the migrations only.
  (t) => [check("runner_settings_singleton", sql`${t.id} = 1`)],
);

export type RunnerSettings = typeof runnerSettings.$inferSelect;

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
    // PLA-I59-1: the --model and --effort this run was started with (null: the flag was not passed).
    requestedModel: text("requested_model"),
    requestedEffort: text("requested_effort"),
    // PLA-I60 (migration 0060): what the run is about and why, as columns (summary is display text only).
    workKey: text("work_key").notNull().default("general"),
    trigger: text("trigger").$type<RunTrigger>().notNull().default("owner"),
    lane: text("lane").$type<RunLane>().notNull().default("work"),
    reason: text("reason"),
    absorbed: text("absorbed"),
    heldCode: text("held_code"),
    heldDetail: jsonb("held_detail").$type<Record<string, unknown>>(),
    workerId: text("worker_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    stopRequested: text("stop_requested"),
    notBefore: timestamp("not_before", { withTimezone: true }),
    planWeight: real("plan_weight"),
    // AUDIT-2 (migration 0061): what the run was given. prompt_version is "<doc version>:<first 12 of the sha256 of
    // the role prompt>" (null on a resumed session or a run with no role prompt); skills are "<slug>@<first 8 of its
    // sha256>" for every skill in the run's kit; skills_used are the slugs the stream showed the run invoking.
    promptVersion: text("prompt_version"),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    skillsUsed: text("skills_used").array().notNull().default(sql`'{}'::text[]`),
    // AUDIT-7: the context the last turn carried (input + cache read + cache create of that turn), null when unknown.
    contextTokens: bigint("context_tokens", { mode: "number" }),
    // PLA-I67-2 (0068): the first 8 of the sha256 of the «tu manera» the run carried (null: none).
    mannerVersion: text("manner_version"),
    // PLA-I75 (0079): what the stream showed of each mcp__ call, {server: {tool: {ok, failed, blocked}}}; null: none.
    mcpCalls: jsonb("mcp_calls").$type<McpTally>(),
  },
  (t) => [
    index("agent_runs_status_idx").on(t.status, t.queuedAt),
    uniqueIndex("agent_runs_active_work_unique").on(t.agentId, t.projectId, t.workKey).where(sql`${t.status} in ('queued', 'starting', 'running')`),
    index("agent_runs_live_project_idx").on(t.projectId, t.lane).where(sql`${t.status} in ('starting', 'running')`),
    index("agent_runs_live_worker_idx").on(t.workerId).where(sql`${t.status} in ('starting', 'running')`),
    check("agent_runs_trigger_check", sql`${t.trigger} in ('event', 'owner', 'cadence', 'consulta', 'retry', 'qa', 'brief', 'trial')`),
    check("agent_runs_lane_check", sql`${t.lane} in ('work', 'consulta')`),
    check("agent_runs_work_key_check", sql`char_length(${t.workKey}) between 1 and 200`),
    index("agent_runs_agent_idx").on(t.agentId, t.queuedAt),
    index("agent_runs_project_idx").on(t.projectId, t.startedAt),
    check("agent_runs_status_check", sql`${t.status} in ('queued', 'starting', 'running', 'ok', 'fail', 'skipped', 'stopped')`),
    check("agent_runs_summary_check", sql`char_length(${t.summary}) <= 500`),
  ],
);

export type AgentRun = typeof agentRuns.$inferSelect;
// PLA-I67-6: trial is the owner's «Probar» of a skill on a past delivery (src/runner/trial.ts).
export const RUN_TRIGGERS = ["event", "owner", "cadence", "consulta", "retry", "qa", "brief", "trial"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type RunLane = "work" | "consulta";

// PLA-I60-2: one live run per lock key (a folder, a branch, a ticket).
export const runLocks = pgTable(
  "run_locks",
  {
    lockKey: text("lock_key").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("run_locks_run_idx").on(t.runId)],
);

// PLA-I60-3: a process that spawns and supervises runs.
export const runnerWorkers = pgTable("runner_workers", {
  id: text("id").primaryKey(),
  machine: text("machine").notNull(),
  capacity: integer("capacity").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  version: text("version"),
  draining: boolean("draining").notNull().default(false),
});

// PLA-I60-2: slots held for something that is not an agent run (the Morning brief).
export const runnerReservations = pgTable(
  "runner_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    slots: integer("slots").notNull().default(1),
    holder: text("holder"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [check("runner_reservations_slots_check", sql`${t.slots} between 1 and 50`)],
);

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
    // PLA-I60-1: one resumable session per work item.
    workKey: text("work_key").notNull().default("general"),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.projectId, t.workKey] })],
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

// PLA-I32: conversations. One company thread (the owner and Asistente) and one per project (the owner and its PO;
// the team answers there too). Messages link what they talk about and keep the action the owner took.
export const THREAD_KINDS = ["company", "project"] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];
export const LINK_KINDS = ["ticket", "doc", "pr", "idea", "question", "brief_plan"] as const;
export type ThreadLink = { kind: (typeof LINK_KINDS)[number]; ref: string; title: string };
// PLA-I36-7/8: what a PO proposes. choice: options to pick from. plan: what it understood of an order, the steps
// (each with what done means) and the cost; on approval the server makes one Ready ticket per step.
export type ProposalCost = { tickets?: number; days?: number; tokens?: number; delays?: string };
export type ProposalOption = { n: number; label: string; effect: string; cost: ProposalCost; recommended: boolean };
export type ProposalStep = { title: string; done_when: string; work_type: string };
// PLA-I46-11: a closed question in a leg's plan: two to four answers, the PO's suggestion marked (0-based).
export type PlanQuestion = { text: string; options: string[]; suggested: number };
// One line of the PO's check list on a ticket: what to verify, and whether QA ticked it.
export type PoCheck = { n: number; text: string; done: boolean; done_at: string | null; done_by: string | null };
export type ProposalData = {
  kind: "choice" | "plan";
  title: string;
  options: ProposalOption[];
  recommended_reason: string | null;
  combinable: number[][];
  order: string | null;
  understood: string | null;
  steps: ProposalStep[];
  cost: ProposalCost;
  links: ThreadLink[];
  // plan: whether it waited for approval (the project's switch when it was posted), and the tickets made.
  needs_approval: boolean;
  created: string[];
  // PLA-I46-11, plan for a leg of the route: the initiative it fills, up to 3 closed questions, the PO's check list
  // (3 things to verify), when the owner said Después, and what he accepted (answers by index, the edited list).
  leg?: string | null;
  questions?: PlanQuestion[];
  checklist?: string[];
  later_at?: string | null;
  answers?: number[] | null;
};
export const THREAD_ACTIONS = ["aceptar", "cambios", "responder"] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];
export type ActionState = { action: ThreadAction; at: string; result: Record<string, unknown> };

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    // When the owner last read it on screen; later messages that are not his are unread.
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
    // PLA-I36-7: a PO's proposal as data (the `propose` tool). The body keeps a prose copy.
    proposal: jsonb("proposal").$type<ProposalData | null>(),
  },
  (t) => [
    index("thread_messages_thread_idx").on(t.threadId, t.at),
    check("thread_messages_body_check", sql`char_length(${t.body}) between 1 and 4000`),
    check("thread_messages_author_check", sql`char_length(${t.authorAgent}) between 1 and 60 and char_length(${t.authorRole}) between 1 and 40`),
    check("thread_messages_links_check", sql`jsonb_typeof(${t.links}) = 'array' and jsonb_array_length(${t.links}) <= 10`),
    check("thread_messages_action_state_check", sql`${t.actionState} is null or jsonb_typeof(${t.actionState}) = 'object'`),
    check("thread_messages_proposal_check", sql`${t.proposal} is null or jsonb_typeof(${t.proposal}) = 'object'`),
  ],
);

export type ThreadMessage = typeof threadMessages.$inferSelect;

// PLA-I46-6: stills of a project's running app (the floor's Ventana, QA evidence). One row per page and
// viewport per run. The PNG lives in the local capture store (src/captures/store.ts) under file, named by
// its sha256; Plania keeps only the row. A failed page is a row with status error, no file and the error
// text, so the last good still of that page stays readable beside it.
export const CAPTURE_STATUSES = ["ok", "error"] as const;
export const captureStills = pgTable(
  "capture_stills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The ticket or delivery the run was for; null for a plain look at the test copy.
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    runId: uuid("run_id").notNull(),
    pageKey: text("page_key").notNull(),
    pageLabel: text("page_label").notNull(),
    path: text("path").notNull(),
    viewport: text("viewport").notNull(), // desktop | phone
    width: integer("width").notNull(),
    height: integer("height"),
    status: text("status").notNull(),
    error: text("error"),
    file: text("file"), // <sha256>.png in the store, null on error
    bytes: integer("bytes"),
    url: text("url"), // where the page ended up (after a follow or a redirect)
    commit: text("commit"),
    branch: text("branch"),
    actor: jsonb("actor").$type<Actor>().notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    // PLA-I52-3: a delivery's pair. side antes (sandbox) | despues (the delivery's copy); null for the Ventana's.
    side: text("side"),
    missing: boolean("missing").notNull().default(false), // antes: the path did not exist (a new screen)
    diff: jsonb("diff").$type<import("../captures/diff.js").DiffBox | { nueva: true } | { unreadable: true }>(), // despues
  },
  (t) => [
    index("capture_stills_side_idx").on(t.taskId, t.side, t.pageKey, t.viewport, t.takenAt),
    check("capture_stills_side_check", sql`${t.side} is null or ${t.side} in ('antes', 'despues')`),
    index("capture_stills_latest_idx").on(t.projectId, t.pageKey, t.viewport, t.takenAt),
    index("capture_stills_task_idx").on(t.taskId, t.takenAt),
    check("capture_stills_status_check", sql`${t.status} in ('ok', 'error')`),
    check("capture_stills_viewport_check", sql`${t.viewport} in ('desktop', 'phone')`),
    check("capture_stills_file_check", sql`(${t.status} = 'ok') = (${t.file} is not null)`),
  ],
);
export type CaptureStill = typeof captureStills.$inferSelect;

// PLA-I54-2: pictures the owner attaches to a request (pasted, dropped or picked on Pedir). Migration 0056. The file lives
// in the local store under <captures dir>/pedidos/<project>/, named by its sha256 (src/pedidos/images.ts); Plania keeps
// the row. The same picture twice on one request is one row; at most 6 per request (checked on upload).
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];
export const taskImages = pgTable(
  "task_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    file: text("file").notNull(), // <sha256>.<png|jpg|webp> in the store
    mime: text("mime").$type<ImageMime>().notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    actor: jsonb("actor").$type<Actor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("task_images_task_file_unique").on(t.taskId, t.file),
    index("task_images_task_idx").on(t.taskId, t.createdAt),
    check("task_images_mime_check", sql`${t.mime} in ('image/png', 'image/jpeg', 'image/webp')`),
    check("task_images_bytes_check", sql`${t.bytes} > 0 and ${t.bytes} <= 5242880`),
  ],
);
export type TaskImage = typeof taskImages.$inferSelect;

// PLA-I61-2 (La idea abierta): Artist's frames on an idea, in order, with what each does and why. Migration 0059.
// Same local store as the request pictures (src/pedidos/frames.ts); attach_frames replaces the whole set.
export const ideaFrames = pgTable(
  "idea_frames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    frameId: text("frame_id").notNull(), // the designer's own label: T, A1, B3…
    name: text("name").notNull(),
    grupo: text("grupo"),
    hace: text("hace"),
    porque: text("porque"),
    position: integer("position").notNull(),
    file: text("file").notNull(),
    mime: text("mime").$type<ImageMime>().notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    actor: jsonb("actor").$type<Actor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idea_frames_task_frame_unique").on(t.taskId, t.frameId),
    index("idea_frames_task_idx").on(t.taskId, t.position),
    check("idea_frames_mime_check", sql`${t.mime} in ('image/png', 'image/jpeg', 'image/webp')`),
    check("idea_frames_bytes_check", sql`${t.bytes} > 0 and ${t.bytes} <= 5242880`),
  ],
);
export type IdeaFrame = typeof ideaFrames.$inferSelect;

// PLA-I46-9: the QA lane's passes on a delivery. Migration 0049. The PO's check list it reads is tasks.po_checklist
// (PoCheck, migration 0048); QA's marks live on the lane (per commit), not on the item.

export type QaVerifyItem = {
  name: string;
  command: string;
  exit_code: number | null;
  ok: boolean;
  pass: number | null;
  fail: number | null;
  duration_s: number;
  tail: string; // the last lines of output, for Taller's notes
};
export type QaCapture = { run_id: string | null; ok: number; failed: number; still_ids: string[]; error: string | null };
// AUDIT-6: verdict is the overall one (fail when either axis fails). spec is "does it meet the scope, the Done when
// and the check list"; code is "is the change sound". Reviews stored before AUDIT-6 have neither.
export type QaAxis = { verdict: "pass" | "fail"; notes: string };
export type QaReview = { verdict: "pass" | "fail"; notes: string; model: string | null; spec?: QaAxis; code?: QaAxis; walked?: boolean };
export type QaMark = { n: number; mark: "pass" | "fail"; note: string };
export const QA_STATUSES = ["queued", "checking", "reviewing", "pass", "fail", "error"] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

export const qaLanes = pgTable(
  "qa_lanes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    taskKey: text("task_key").notNull(),
    commit: text("commit"),
    branch: text("branch"),
    prUrl: text("pr_url"),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").$type<QaStatus>().notNull().default("queued"),
    hold: text("hold"),
    verify: jsonb("verify").$type<QaVerifyItem[]>().notNull().default([]),
    capture: jsonb("capture").$type<QaCapture | null>(),
    review: jsonb("review").$type<QaReview | null>(),
    marks: jsonb("marks").$type<QaMark[]>().notNull().default([]),
    notes: text("notes"),
    diffLines: integer("diff_lines"),
    model: text("model"),
    runId: uuid("run_id"),
    reviewTries: integer("review_tries").notNull().default(0),
    headAfter: text("head_after"),
    returned: boolean("returned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("qa_lanes_task_idx").on(t.taskId, t.createdAt),
    index("qa_lanes_status_idx").on(t.status),
    index("qa_lanes_run_idx").on(t.runId),
    check("qa_lanes_status_check", sql`${t.status} in ('queued', 'checking', 'reviewing', 'pass', 'fail', 'error')`),
    check("qa_lanes_attempt_check", sql`${t.attempt} >= 1`),
  ],
);
export type QaLane = typeof qaLanes.$inferSelect;

// PLA-I41-1: the Morning brief (spec "Spec: Morning brief" §7.2). A brief per run (several a day are fine; the page
// shows the newest), the runs that made them, Send to Plania requests, the owner's checks, and one settings row.
// Migration 0045. The BriefData shape lives with the brief engine; here data is plain JSON.
export const BRIEF_TRIGGERS = ["schedule", "manual", "cli"] as const;
export type BriefTrigger = (typeof BRIEF_TRIGGERS)[number];
export const BRIEF_MODES = ["full", "partial", "facts_only"] as const;
export type BriefMode = (typeof BRIEF_MODES)[number];

export const morningBriefs = pgTable(
  "morning_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The date in the brief's time zone.
    localDate: date("local_date").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    trigger: text("trigger").$type<BriefTrigger>().notNull(),
    mode: text("mode").$type<BriefMode>().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    // brief_runs.id (no foreign key: a run row may be pruned while the brief stays).
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("morning_briefs_date_idx").on(t.localDate.desc(), t.generatedAt.desc()),
    check("morning_briefs_trigger_check", sql`${t.trigger} in ('schedule', 'manual', 'cli')`),
    check("morning_briefs_mode_check", sql`${t.mode} in ('full', 'partial', 'facts_only')`),
  ],
);

export type MorningBrief = typeof morningBriefs.$inferSelect;

export const BRIEF_RUN_STATUSES = ["waiting", "running", "ok", "partial", "fail", "fallback"] as const;
export type BriefRunStatus = (typeof BRIEF_RUN_STATUSES)[number];
export type BriefPassRecord = { status: string; turns?: number; tokens?: number; log_file?: string };

export const briefRuns = pgTable(
  "brief_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: text("trigger").notNull(),
    status: text("status").$type<BriefRunStatus>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // {brief: {status, turns, tokens, log_file}, ideas: {...}}; log_file is a file name only.
    passes: jsonb("passes").$type<Record<string, BriefPassRecord>>().notNull().default({}),
    // One plain line; never home paths, env values or tokens.
    summary: text("summary").notNull().default(""),
  },
  (t) => [
    check("brief_runs_status_check", sql`${t.status} in ('waiting', 'running', 'ok', 'partial', 'fail', 'fallback')`),
  ],
);

export type BriefRun = typeof briefRuns.$inferSelect;

export const BRIEF_PLAN_STATUSES = ["open", "done", "partial", "failed"] as const;
export type BriefPlanStatus = (typeof BRIEF_PLAN_STATUSES)[number];
export type BriefPlanTarget = {
  slug: string;
  po_agent: string;
  codes: string[];
  wake_run_id?: string | null;
  state: "waiting_paused" | "queued" | "running" | "done" | "failed";
  // PLA-I43-1: the "Plan these ideas" message (posted in the same transaction as the wake), why the target waits
  // or failed (one plain line), and when it last changed.
  message_id?: string | null;
  note?: string | null;
  updated_at?: string;
  results: {
    code: string;
    status: "created" | "duplicate" | "proposed" | "failed";
    idea_key?: string;
    initiative_key?: string;
    ticket_keys?: string[];
    note?: string;
  }[];
};

// Send to Plania (D3): the ideas the owner picked from a brief, and how each target project's PO is doing.
export const briefPlanRequests = pgTable(
  "brief_plan_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => morningBriefs.id, { onDelete: "cascade" }),
    codes: text("codes").array().notNull(),
    // The chosen Idea objects (code, app, title, why, flags).
    ideas: jsonb("ideas").$type<Record<string, unknown>[]>().notNull(),
    targets: jsonb("targets").$type<BriefPlanTarget[]>().notNull().default([]),
    status: text("status").$type<BriefPlanStatus>().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("brief_plan_requests_status_check", sql`${t.status} in ('open', 'done', 'partial', 'failed')`)],
);

export type BriefPlanRequest = typeof briefPlanRequests.$inferSelect;

// Item.id or Idea.id, stable across days. Uncheck = delete; ids unseen for 30 days are pruned by the pipeline.
export const briefChecks = pgTable("brief_checks", {
  itemId: text("item_id").primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BriefCheck = typeof briefChecks.$inferSelect;

// PLA-I49-3: what the owner did from a brief row (migration 0050). request_id makes a retry write once.
export type BriefActionOutcome = { status: "running" | "done" | "failed"; line?: string; error?: string; hint?: string; result?: Record<string, unknown>; undo?: Record<string, unknown> };
export const briefActions = pgTable(
  "brief_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => morningBriefs.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    action: text("action").notNull(),
    target: jsonb("target").$type<Record<string, unknown> | null>(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    outcome: jsonb("outcome").$type<BriefActionOutcome>().notNull().default({ status: "running" }),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("brief_actions_request_idx").on(t.requestId), index("brief_actions_item_idx").on(t.itemId, t.createdAt.desc()), index("brief_actions_brief_idx").on(t.briefId)],
);
export type BriefAction = typeof briefActions.$inferSelect;

export const BRIEF_LANGUAGES = ["en", "es"] as const;
export type BriefLanguage = (typeof BRIEF_LANGUAGES)[number];
export const BRIEF_GITHUB_MODES = ["poller", "gh", "off"] as const;
export type BriefGithubMode = (typeof BRIEF_GITHUB_MODES)[number];
export type BriefPassTimeouts = { brief: number; ideas: number; plan: number };
export type BriefProjectSetting = { include?: boolean; include_ideas?: boolean; letter?: string; order?: number };

export const briefSettings = pgTable(
  "brief_settings",
  {
    id: integer("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(true),
    runAt: time("run_at").notNull().default("07:00"),
    // Null = PLANIA_TZ.
    timezone: text("timezone"),
    // Null = derived (small map, else the IANA city).
    timezoneLabel: text("timezone_label"),
    // D5: content and page labels.
    language: text("language").$type<BriefLanguage>().notNull().default("es"),
    // Null = PLANIA_CEO_NAME.
    ownerName: text("owner_name"),
    hiddenRefs: text("hidden_refs").array().notNull().default(sql`'{}'::text[]`),
    maxItemsPerApp: integer("max_items_per_app").notNull().default(5),
    ideasPerProject: integer("ideas_per_project").notNull().default(3),
    ideasEnabled: boolean("ideas_enabled").notNull().default(true),
    // D4: hard ceiling for the scheduled brief (local time).
    fallbackAt: time("fallback_at").notNull().default("11:00"),
    // Null = CLI default.
    model: text("model"),
    passTimeouts: jsonb("pass_timeouts").$type<BriefPassTimeouts>().notNull().default({ brief: 10, ideas: 20, plan: 30 }),
    projects: jsonb("projects").$type<Record<string, BriefProjectSetting>>().notNull().default({}),
    githubMode: text("github_mode").$type<BriefGithubMode>().notNull().default("poller"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("brief_settings_id_check", sql`${t.id} = 1`),
    check("brief_settings_language_check", sql`${t.language} in ('en', 'es')`),
    check("brief_settings_github_mode_check", sql`${t.githubMode} in ('poller', 'gh', 'off')`),
  ],
);

export type BriefSettings = typeof briefSettings.$inferSelect;

// PLA-I57-1: Preguntar en Pedir. The owner's question about a project and the PO's answer (answer_consulta).
// No task: a question creates no idea and no ticket. run_id is the PO's read-only run, null until one is queued.
export type ConsultaAnswer = {
  short: string;
  why: string[];
  sources: { path: string; line: number | null; missing: boolean }[];
  branch: string | null;
  commit: string | null;
  sure: "seen" | "guess";
  tried: boolean;
  fix: string | null;
  by: string;
};
export const consultas = pgTable(
  "consultas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    runId: uuid("run_id"),
    answer: jsonb("answer").$type<ConsultaAnswer>(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consultas_project_idx").on(t.projectId, t.askedAt), check("consultas_text_check", sql`char_length(${t.text}) between 3 and 2000`)],
);
export type Consulta = typeof consultas.$inferSelect;

// PLA-I2-14: the owner's display name, one row (id 1). Migration 0062. Null = the brief's owner_name, then
// PLANIA_CEO_NAME, then «el dueño». Written at first start through setOwnerName (src/owner.ts).
export const ownerProfile = pgTable(
  "owner_profile",
  {
    id: integer("id").primaryKey().default(1),
    displayName: text("display_name"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("owner_profile_singleton", sql`${t.id} = 1`), check("owner_profile_name_check", sql`${t.displayName} is null or char_length(${t.displayName}) between 1 and 80`)],
);

// PLA-I2-2: what the install command and the first-start screen made (migration 0063). One row, id 1.
export const installState = pgTable(
  "install_state",
  {
    id: integer("id").primaryKey().default(1),
    setupCodeHash: text("setup_code_hash"),
    setupCodeAt: timestamp("setup_code_at", { withTimezone: true }),
    passwordHash: text("password_hash"),
    runnerToken: text("runner_token"),
    briefToken: text("brief_token"),
    timeZone: text("time_zone"),
    firstStartAt: timestamp("first_start_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("install_state_singleton", sql`${t.id} = 1`)],
);

// PLA-I67-2: skills the owner writes on screen and their immutable versions (migration 0068, ADR 0006).
// src/runner/skills.ts resolves them with the factory kit; the newest version is what runs carry.
export const SKILL_SCOPES = ["company", "seat", "project", "agent"] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    origin: text("origin").$type<"owner" | "factory-copy" | "imported">().notNull().default("owner"),
    scope: text("scope").$type<SkillScope>().notNull().default("agent"),
    role: text("role"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    state: text("state").$type<"on" | "off" | "archived">().notNull().default("on"),
    factorySha: text("factory_sha"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by").notNull().default("owner"),
    // PLA-I67-6 (0073): an imported skill's link and the sha256 of the content the owner saw and saved.
    sourceUrl: text("source_url"),
    sourceHash: text("source_hash"),
    sourceCheckedAt: timestamp("source_checked_at", { withTimezone: true }),
    // PLA-I71-5 (0076): where a brought skill came from, the commit it was read at, its publisher, the files left out,
    // what the review showed, and the newer content upstream has (null: none, or declined).
    sourceKind: text("source_kind").$type<"link" | "github" | "skills.sh">(),
    sourceCommit: text("source_commit"),
    publisher: text("publisher"),
    droppedFiles: text("dropped_files").array().notNull().default(sql`'{}'::text[]`),
    review: jsonb("review").$type<SkillReview>(),
    upstreamHash: text("upstream_hash"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("skills_slug_live_unique").on(t.slug).where(sql`${t.state} <> 'archived'`),
    index("skills_agent_idx").on(t.agentId),
    index("skills_project_idx").on(t.projectId),
    check("skills_slug_check", sql`${t.slug} ~ '^[a-z][a-z0-9-]{0,39}$'`),
    check("skills_origin_check", sql`${t.origin} in ('owner', 'factory-copy', 'imported')`),
    check("skills_scope_check", sql`${t.scope} in ('company', 'seat', 'project', 'agent')`),
    check("skills_state_check", sql`${t.state} in ('on', 'off', 'archived')`),
  ],
);
export type OwnerSkillRow = typeof skills.$inferSelect;
// PLA-I71-5: what the review showed before a brought skill was installed (src/runner/skill-import.ts).
export type SkillMark = { file: string; line: number; kind: "secret" | "link"; text: string };
export type SkillReview = { words: number; dropped: string[]; marks: SkillMark[]; pinned: string; dismissed?: string | null };

export type SkillFile = { path: string; content: string };
export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    files: jsonb("files").$type<SkillFile[]>().notNull().default([]),
    hash: text("hash").notNull(),
    author: text("author").notNull().default("owner"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("skill_versions_skill_n_unique").on(t.skillId, t.n), check("skill_versions_n_check", sql`${t.n} >= 1`)],
);
export type SkillVersionRow = typeof skillVersions.$inferSelect;

// PLA-I67-6 (0073): one past delivery re-run with one version of a skill, in a throwaway copy (src/runner/trial.ts).
export type TrialStatus = "queued" | "running" | "done" | "failed" | "skipped" | "stopped";
export const skillTrials = pgTable(
  "skill_trials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionN: integer("version_n").notNull(),
    versionStamp: text("version_stamp").notNull(),
    taskKey: text("task_key").notNull(),
    taskTitle: text("task_title").notNull().default(""),
    beforeRunId: uuid("before_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    baseCommit: text("base_commit"),
    beforeStamp: text("before_stamp"),
    beforeSkills: text("before_skills").array().notNull().default(sql`'{}'::text[]`),
    beforeOutput: text("before_output"),
    beforeDiff: text("before_diff"),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    afterSkills: text("after_skills").array().notNull().default(sql`'{}'::text[]`),
    afterOutput: text("after_output"),
    afterDiff: text("after_diff"),
    status: text("status").$type<TrialStatus>().notNull().default("queued"),
    summary: text("summary").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("skill_trials_skill_idx").on(t.skillId, t.createdAt),
    index("skill_trials_run_idx").on(t.runId),
    check("skill_trials_status_check", sql`${t.status} in ('queued', 'running', 'done', 'failed', 'skipped', 'stopped')`),
  ],
);
export type SkillTrialRow = typeof skillTrials.$inferSelect;

// PLA-I67-3: the owner's corrections, the lessons they become, and what each run carried (migration 0069).
// src/runner/lessons.ts reads corrections, runs the reflector and injects active lessons; only the owner approves.
export type LessonState = "proposed" | "active" | "one-off" | "rejected" | "retired" | "expired";
export type FeedbackKind = "changes" | "idea" | "dile";
export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    taskKey: text("task_key"),
    kind: text("kind").$type<FeedbackKind>().notNull(),
    words: text("words").notNull(),
    sourceEventId: bigint("source_event_id", { mode: "number" }),
    runId: uuid("run_id"),
    status: text("status").$type<"queued" | "reflecting" | "done" | "failed" | "skipped">().notNull().default("queued"),
    verdict: jsonb("verdict").$type<Record<string, unknown>>(),
    lessonId: uuid("lesson_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("feedback_events_source_unique").on(t.sourceEventId).where(sql`${t.sourceEventId} is not null`), index("feedback_events_agent_idx").on(t.agentId, t.createdAt), index("feedback_events_status_idx").on(t.status, t.createdAt)],
);
export type FeedbackEvent = typeof feedbackEvents.$inferSelect;

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    scope: text("scope").$type<SkillScope>().notNull().default("agent"),
    role: text("role"),
    text: text("text").notNull(),
    appliesWhen: text("applies_when"),
    state: text("state").$type<LessonState>().notNull().default("proposed"),
    proposedBy: text("proposed_by").$type<"reflector" | "owner">().notNull().default("reflector"),
    feedbackId: uuid("feedback_id").references(() => feedbackEvents.id, { onDelete: "set null" }),
    ownerWords: text("owner_words"),
    taskKey: text("task_key"),
    runId: uuid("run_id"),
    conflictsWith: uuid("conflicts_with").references((): AnyPgColumn => lessons.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    // PLA-I67-5 (0072): «mantener» on a 90-day retirement proposal, and the skill a lesson was merged into.
    keptAt: timestamp("kept_at", { withTimezone: true }),
    mergedInto: text("merged_into"),
    ...timestamps,
  },
  (t) => [
    index("lessons_agent_idx").on(t.agentId, t.state),
    index("lessons_project_idx").on(t.projectId, t.state),
    check("lessons_state_check", sql`${t.state} in ('proposed', 'active', 'one-off', 'rejected', 'retired', 'expired')`),
    check("lessons_text_check", sql`char_length(${t.text}) between 3 and 600`),
  ],
);
export type Lesson = typeof lessons.$inferSelect;

export const lessonVersions = pgTable(
  "lesson_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    text: text("text").notNull(),
    appliesWhen: text("applies_when"),
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lesson_versions_lesson_n_unique").on(t.lessonId, t.n)],
);

export const runKnowledge = pgTable(
  "run_knowledge",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"skill" | "lesson" | "manner" | "reference">().notNull(),
    item: text("item").notNull(),
    version: text("version").notNull(),
    opened: boolean("opened").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.kind, t.item] }), index("run_knowledge_item_idx").on(t.kind, t.item)],
);

// PLA-I67-5: each time a lesson's correction came back (migration 0072). A reflector suggestion counts once confirmed.
export const lessonRepeats = pgTable(
  "lesson_repeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    feedbackId: uuid("feedback_id").references(() => feedbackEvents.id, { onDelete: "set null" }),
    taskKey: text("task_key"),
    words: text("words"),
    by: text("by").$type<"owner" | "reflector">().notNull().default("owner"),
    confirmed: boolean("confirmed").notNull().default(false),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lesson_repeats_lesson_idx").on(t.lessonId, t.createdAt), uniqueIndex("lesson_repeats_feedback_unique").on(t.feedbackId).where(sql`${t.feedbackId} is not null`)],
);

// PLA-I67-4: references, the links, images and files the owner gives one agent (migration 0070). A file lives in the
// local store under <captures dir>/references/<project>/ (src/references/store.ts); a link keeps the text snapshot the
// server fetched at save time (src/lib/safe-fetch.ts). agent_reference_uses says which runs carried one and opened it.
export const REFERENCE_KINDS = ["link", "image", "file"] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const REFERENCE_MIMES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export type ReferenceMime = (typeof REFERENCE_MIMES)[number];
export const agentReferences = pgTable(
  "agent_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ReferenceKind>().notNull(),
    title: text("title").notNull(),
    url: text("url"),
    snapshotText: text("snapshot_text"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
    fetchStatus: text("fetch_status").$type<"ok" | "failed">(),
    fetchError: text("fetch_error"),
    file: text("file"),
    mime: text("mime").$type<ReferenceMime>(),
    bytes: integer("bytes"),
    width: integer("width"),
    height: integer("height"),
    originalBytes: integer("original_bytes"),
    note: text("note").notNull().default(""),
    stance: text("stance").$type<"follow" | "avoid">().notNull().default("follow"),
    applies: text("applies").$type<"always" | "on_topic">().notNull().default("always"),
    scope: text("scope").$type<"agent" | "project">().notNull().default("agent"),
    state: text("state").$type<"on" | "off">().notNull().default("on"),
    actor: jsonb("actor").$type<Actor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_references_agent_idx").on(t.agentId, t.createdAt),
    index("agent_references_project_idx").on(t.projectId, t.scope),
    check("agent_references_kind_check", sql`${t.kind} in ('link', 'image', 'file')`),
    check("agent_references_stance_check", sql`${t.stance} in ('follow', 'avoid')`),
    check("agent_references_applies_check", sql`${t.applies} in ('always', 'on_topic')`),
    check("agent_references_scope_check", sql`${t.scope} in ('agent', 'project')`),
    check("agent_references_state_check", sql`${t.state} in ('on', 'off')`),
    check("agent_references_fetch_check", sql`${t.fetchStatus} is null or ${t.fetchStatus} in ('ok', 'failed')`),
    check("agent_references_mime_check", sql`${t.mime} is null or ${t.mime} in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')`),
    check("agent_references_bytes_check", sql`${t.bytes} is null or (${t.bytes} > 0 and ${t.bytes} <= 5242880)`),
    check("agent_references_note_check", sql`char_length(${t.note}) <= 600`),
    check("agent_references_title_check", sql`char_length(${t.title}) between 1 and 160`),
  ],
);
export type AgentReference = typeof agentReferences.$inferSelect;

export const agentReferenceUses = pgTable(
  "agent_reference_uses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => agentReferences.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    opened: boolean("opened").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_reference_uses_run_ref_unique").on(t.runId, t.referenceId), index("agent_reference_uses_ref_idx").on(t.referenceId)],
);

// PLA-I66-1 (0067): a project's logo, versioned. The active row is the original the screen shows and every icon will
// come from (src/brand/logos.ts). The file lives in the local capture store, never in a repo.
export type LogoMime = "image/svg+xml" | "image/png";
export type LogoVariant = "icon" | "mark"; // icon: drawn on its own background; mark: the bare drawing
export type LogoSource = "repo" | "upload" | "artist";
// keptOver: a repo logo the owner chose to keep this one over (the drift question, PLA-I66-4).
export type LogoAdjust = { raw?: string; name?: string; scale?: number; bg?: string | null; keptOver?: string };
export const projectLogos = pgTable(
  "project_logos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    file: text("file").notNull(), // <sha256>.<svg|png> in the store
    mime: text("mime").$type<LogoMime>().notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    variant: text("variant").$type<LogoVariant>().notNull(),
    source: text("source").$type<LogoSource>().notNull(),
    sourcePath: text("source_path"),
    sourceCommit: text("source_commit"),
    colors: text("colors").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    // PLA-I66-3 (0071): the owner chose it (upload, a repo candidate, an Artist mark): the detector never replaces it.
    chosen: boolean("chosen").notNull().default(false),
    // PLA-I66-3: how an upload was fitted: its raw file in the store, the size inside the tile, the background.
    adjust: jsonb("adjust").$type<LogoAdjust>(),
    actor: jsonb("actor").$type<Actor>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_logos_version_unique").on(t.projectId, t.version),
    uniqueIndex("project_logos_one_active").on(t.projectId).where(sql`${t.active}`),
    check("project_logos_mime_check", sql`${t.mime} in ('image/svg+xml', 'image/png')`),
    check("project_logos_variant_check", sql`${t.variant} in ('icon', 'mark')`),
    check("project_logos_source_check", sql`${t.source} in ('repo', 'upload', 'artist')`),
    check("project_logos_bytes_check", sql`${t.bytes} > 0 and ${t.bytes} <= 2097152`),
  ],
);
export type ProjectLogo = typeof projectLogos.$inferSelect;

// PLA-I68-2: Camino (drizzle/migrations/0074_camino.sql). config is CaminoConfig (src/camino/types.ts), never a secret;
// discovery is the last read of GitHub and this machine.
export const camino = pgTable("camino", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  config: jsonb("config").$type<import("../camino/types.js").CaminoConfig>().notNull().default(sql`'{}'::jsonb`),
  version: integer("version").notNull().default(1),
  discovery: jsonb("discovery").$type<import("../camino/types.js").Discovery>(),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CaminoDest = "plania" | "proveedor" | "github" | "pr" | "llavero";
export const caminoHistory = pgTable(
  "camino_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    who: text("who").notNull(),
    label: text("label").notNull(),
    dest: text("dest").$type<CaminoDest>().notNull(),
    undo: text("undo"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("camino_history_project_at").on(t.projectId, t.at), check("camino_history_dest_check", sql`${t.dest} in ('plania', 'proveedor', 'github', 'pr', 'llavero')`)],
);

// PLA-I71-3 (0075): the role catalog as data (factory roles seeded from src/runner/team.ts, and the owner's own), and a
// PO's proposal of a seat, which only the owner's screen decides.
export const puestos = pgTable("puestos", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  line: text("line").notNull().default(""),
  origin: text("origin").$type<"factory" | "owner">().notNull().default("owner"),
  defaultSkills: text("default_skills").array().notNull().default(sql`'{}'::text[]`),
  defaultMotor: jsonb("default_motor").$type<{ model: string | null; effort: string | null }>(),
  promptRef: text("prompt_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PuestoRow = typeof puestos.$inferSelect;
export const seatProposals = pgTable(
  "seat_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    reason: text("reason").notNull(),
    proposedBy: text("proposed_by").notNull(),
    state: text("state").$type<"proposed" | "accepted" | "declined">().notNull().default("proposed"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("seat_proposals_project_idx").on(t.projectId, t.state)],
);
export type SeatProposal = typeof seatProposals.$inferSelect;

// PLA-I75 (0079): Conexiones. A seat's tools beyond Plania (src/runner/conexiones.ts), and an agent's request for one.
export const agentConnections = pgTable(
  "agent_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    server: text("server").notNull(),
    version: text("version").notNull(),
    // The variable the server reads → the key's name (Llaves). Never a value.
    keys: jsonb("keys").$type<Record<string, string>>().notNull().default({}),
    writesOn: text("writes_on").array().notNull().default(sql`'{}'::text[]`),
    custom: jsonb("custom").$type<CustomSpec | null>(),
    reviewed: boolean("reviewed").notNull().default(true),
    toolsSeen: jsonb("tools_seen").$type<ToolsSnapshot | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_connections_agent_server_idx").on(t.agentId, t.server)],
);
export type AgentConnection = typeof agentConnections.$inferSelect;

export const connectionRequests = pgTable(
  "connection_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    server: text("server").notNull(),
    reason: text("reason").notNull(),
    state: text("state").$type<"proposed" | "accepted" | "declined">().notNull().default("proposed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("connection_requests_agent_idx").on(t.agentId, t.state)],
);
export type ConnectionRequest = typeof connectionRequests.$inferSelect;

// PLA-I71-6 (0077): the team catalog (saved and brought teams; factory teams are kit/teams/*.json), adoptions, and
// whole-company transfers (src/runner/teams.ts, src/runner/company-package.ts).
export type TeamSeatSpec = { role: string; title?: string | null; line?: string | null; base?: string | null; reports_to: string | null; skills: string[]; motor?: { model: string | null; effort: string | null } | null; manner?: string | null };
export type TeamSpec = { seats: TeamSeatSpec[]; skills?: { slug: string; name: string; description: string; body: string }[]; lessons?: { role: string; text: string }[]; references?: { role: string; title: string; url: string }[] };
export const teamTemplates = pgTable("team_templates", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  line: text("line").notNull().default(""),
  origin: text("origin").$type<"owner" | "imported">().notNull(),
  spec: jsonb("spec").$type<TeamSpec>().notNull(),
  source: text("source"),
  sourceCommit: text("source_commit"),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const teamAdoptions = pgTable("team_adoptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  template: text("template").notNull(),
  hash: text("hash").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
export const companyTransfers = pgTable("company_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  direction: text("direction").$type<"export" | "import">().notNull(),
  state: text("state").$type<"previewed" | "done" | "failed">().notNull().default("done"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  counts: jsonb("counts").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// PLA-I72-1 (0078): one row per initiative copy made on this machine (src/maquinas/copias.ts). The processes are
// in memory; the row keeps the names (worktree, database), «No apagarla sola» and what the owner last asked.
export const maquinaCopias = pgTable(
  "maquina_copias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    initiativeId: uuid("initiative_id").references(() => tasks.id, { onDelete: "set null" }),
    initiativeKey: text("initiative_key").notNull(),
    branch: text("branch").notNull(),
    worktree: text("worktree"),
    database: text("database"),
    keep: boolean("keep").notNull().default(false),
    state: text("state").$type<"on" | "off">().notNull().default("off"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("maquina_copias_project_idx").on(t.projectId, t.deletedAt)],
);
export type MaquinaCopia = typeof maquinaCopias.$inferSelect;
