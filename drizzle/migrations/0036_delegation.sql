-- PLA-I23: task comments, an assign hop counter, and routine run history.
-- Additive and idempotent: a second run adds nothing.
CREATE TABLE IF NOT EXISTS "task_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "author_agent" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "task_id" uuid;
ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "author_agent" text;
ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;

DO $$ BEGIN
  ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_check" CHECK (char_length("author_agent") between 1 and 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_body_check" CHECK (char_length("body") between 1 and 2000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "task_comments_task_idx" ON "task_comments" ("task_id", "created_at");

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assign_hops" integer DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "routine_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent" text NOT NULL,
  "routine" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "status" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "task_key" text
);

ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "agent" text;
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "routine" text;
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "summary" text DEFAULT '' NOT NULL;
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "task_key" text;

DO $$ BEGIN
  ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_status_check" CHECK ("status" in ('ok', 'fail', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_agent_check" CHECK (char_length("agent") between 1 and 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routine_check" CHECK (char_length("routine") between 1 and 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "routine_runs_agent_started_idx" ON "routine_runs" ("agent", "started_at");
