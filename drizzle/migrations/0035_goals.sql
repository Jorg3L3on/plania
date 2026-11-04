-- PLA-I22: company goals (project_id null) and project goals under them.
-- Initiatives point at a goal with tasks.goal_id. Additive and idempotent: a second run changes nothing.
CREATE TABLE IF NOT EXISTS "goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE cascade,
  "parent_id" uuid REFERENCES "goals"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "why" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "target_on" date,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goals_status_check" CHECK ("status" in ('active', 'done', 'dropped')),
  CONSTRAINT "goals_company_root" CHECK ("project_id" is not null OR "parent_id" is null),
  CONSTRAINT "goals_not_self" CHECK ("parent_id" is null OR "parent_id" <> "id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_project_idx" ON "goals" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_parent_idx" ON "goals" ("parent_id");
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "goal_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_initiative" CHECK ("goal_id" is null OR "kind" = 'initiative');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_goal_id_idx" ON "tasks" ("goal_id");
