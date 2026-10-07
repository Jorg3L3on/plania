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
  resumeInProgress: text("resume_in_progress").notNull().default(""),
  resumeNextAction: text("resume_next_action").notNull().default(""),
  resumeBranchOrProd: text("resume_branch_or_prod").notNull().default(""),
  resumeMustKeepDecision: text("resume_must_keep_decision").notNull().default(""),
  // Optimistic concurrency: writers pass the version they read; a mismatch is STALE_VERSION.
  version: integer("version").notNull().default(1),
  // Bumped when rules_text changes, so agents can tell they hold an old copy.
  rulesVersion: integer("rules_version").notNull().default(1),
  ...timestamps,
});

export const designPages = pgTable("design_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  ...timestamps,
});

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
    // A decision that reverses another names it; the old one renders struck through.
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => decisions.id, { onDelete: "set null" }),
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
    uniqueIndex("decisions_supersedes_unique").on(t.supersedesId).where(sql`${t.supersedesId} is not null`),
  ],
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
    // v1 markdown blob. Frozen: v2 reads scope, checks and the event log instead; dropped after backfill.
    body: text("body").notNull().default(""),
    // What the task is: PRD and phased plan (initiative) or the phase's scope (ticket). Replaced whole,
    // with the version; old text stays in the task.updated event.
    scope: text("scope").notNull().default(""),
    phase: integer("phase"), // tickets under an initiative: Phase N
    status: text("status").notNull(),
    priority: text("priority"), // tickets only: P0|P1|P2|P3
    workType: text("work_type"), // tickets only: code|ops|research|decision-needed
    origin: text("origin"), // tickets only: chartered|discovered
    baseBranch: text("base_branch"), // initiatives only
    // Initiatives only: their part of the generated resume. Claims and next_claimable are derived.
    inProgressNote: text("in_progress_note").notNull().default(""),
    nextAction: text("next_action").notNull().default(""),
    branch: text("branch"),
    prUrl: text("pr_url"),
    blockedNote: text("blocked_note"),
    // Bumped by every field change; appends (notes, results, checks) leave it alone.
    version: integer("version").notNull().default(1),
    // Lease: who is working on it and until when. An expired lease is free to claim and is cleared
    // by the next write in the project. workspace says where the code is; it outlives the lease.
    owner: jsonb("owner").$type<Actor>(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    workspace: jsonb("workspace").$type<Workspace>(),
    ...timestamps,
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("tasks_project_key_unique").on(t.projectId, t.key),
    check("tasks_kind_check", sql`${t.kind} in ('initiative', 'ticket')`),
    check("tasks_initiative_no_parent", sql`${t.kind} <> 'initiative' or ${t.parentId} is null`),
    check("tasks_lease_pair", sql`(${t.owner} is null) = (${t.leaseUntil} is null)`),
    check(
      "tasks_work_type_check",
      sql`${t.workType} is null or ${t.workType} in ('code', 'ops', 'research', 'decision-needed')`,
    ),
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
  },
  (t) => [index("questions_project_open_idx").on(t.projectId).where(sql`${t.answeredAt} is null`)],
);

// v2: evidence. Several per task; In review requires one that fits the ticket's work_type.
export const results = pgTable(
  "results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // unit|integration|test|verify|live|grep|subagent|ci
    verdict: text("verdict").notNull(), // pass|warn|fail
    cite: text("cite").notNull(),
    url: text("url"), // CI run, screenshot, recording
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
    migrationsApplied: integer("migrations_applied"), // highest migration number applied
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
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

// A task blocked by an environment rather than a ticket: contains_commit <sha>,
// migration_gte <n>, deployed_after <ISO time>.
export const envBlockers = pgTable(
  "env_blockers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    env: text("env").notNull(),
    condition: text("condition").notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    index("env_blockers_task_idx").on(t.taskId),
    check("env_blockers_condition_check", sql`${t.condition} in ('contains_commit', 'migration_gte', 'deployed_after')`),
  ],
);

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
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_project_id_idx").on(t.projectId, t.id), index("events_task_id_idx").on(t.taskId, t.id)],
);

// Who made a change. session_id identifies one agent session (and owns its leases).
export type Actor = { agent: string; session_id: string; machine?: string; model?: string };

// Where a ticket's code is checked out.
export type Workspace = { machine?: string; worktree_path?: string; branch?: string };

export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;

export const INITIATIVE_STATUSES = ["Planning", "Active", "Shipping", "Done", "On hold", "Won't do"] as const;
export const TICKET_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Blocked", "Needs Jorge", "Done", "Won't do"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const ORIGINS = ["chartered", "discovered"] as const;
export const KINDS = ["initiative", "ticket"] as const;
