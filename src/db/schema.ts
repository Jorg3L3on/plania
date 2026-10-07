import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("decisions_project_created_idx").on(t.projectId, t.createdAt.desc())],
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
    body: text("body").notNull().default(""),
    status: text("status").notNull(),
    priority: text("priority"), // tickets only: P0|P1|P2|P3
    origin: text("origin"), // tickets only: chartered|discovered
    baseBranch: text("base_branch"), // initiatives only
    branch: text("branch"),
    prUrl: text("pr_url"),
    blockedNote: text("blocked_note"),
    ...timestamps,
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("tasks_project_key_unique").on(t.projectId, t.key),
    check("tasks_kind_check", sql`${t.kind} in ('initiative', 'ticket')`),
    check("tasks_initiative_no_parent", sql`${t.kind} <> 'initiative' or ${t.parentId} is null`),
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

export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;

export const INITIATIVE_STATUSES = ["Planning", "Active", "Shipping", "Done", "On hold", "Won't do"] as const;
export const TICKET_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Blocked", "Done", "Won't do"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const ORIGINS = ["chartered", "discovered"] as const;
export const KINDS = ["initiative", "ticket"] as const;
