-- PLA-I25: tokens an agent reports for one task run.
-- Totals are informational. A second run adds nothing.
CREATE TABLE IF NOT EXISTS "token_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "agent" text NOT NULL,
  "task_key" text NOT NULL,
  "run_id" text NOT NULL,
  "model" text NOT NULL,
  "input" integer NOT NULL,
  "output" integer NOT NULL,
  "at" timestamp with time zone NOT NULL
);

ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "agent" text;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "task_key" text;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "run_id" text;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "input" integer;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "output" integer;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "at" timestamp with time zone;

DO $$ BEGIN
  ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_run_unique" UNIQUE ("project_id", "agent", "task_key", "run_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_counts_check" CHECK ("input" >= 0 AND "output" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_agent_check" CHECK (char_length("agent") BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_task_key_check" CHECK (char_length("task_key") BETWEEN 1 AND 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_run_id_check" CHECK (char_length("run_id") BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_model_check" CHECK (char_length("model") BETWEEN 1 AND 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "token_usage_at_idx" ON "token_usage" ("at");
