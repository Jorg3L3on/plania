-- PLA-I29: the autonomous runner. Company and project kill switches, weekly token budgets,
-- the run queue and live runs, claude sessions per agent and project, plan-window readings,
-- and cache counts on token_usage.
-- Additive and idempotent: a second run adds nothing.

-- Company switch and the knobs only Jorge moves. One row (id 1).
CREATE TABLE IF NOT EXISTS "runner_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "company_paused" boolean DEFAULT false NOT NULL,
  "company_paused_at" timestamp with time zone,
  "max_concurrent" integer DEFAULT 1 NOT NULL,
  "cooldown_minutes" integer DEFAULT 30 NOT NULL,
  "plan_guard_pct" integer DEFAULT 70 NOT NULL,
  "reserve_tokens" integer DEFAULT 60000 NOT NULL,
  "max_turns" integer DEFAULT 40 NOT NULL,
  "timeout_minutes" integer DEFAULT 45 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "runner_settings" ADD CONSTRAINT "runner_settings_singleton" CHECK ("id" = 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "runner_settings" ADD CONSTRAINT "runner_settings_ranges" CHECK (
    "max_concurrent" between 0 and 8
    and "cooldown_minutes" between 0 and 1440
    and "plan_guard_pct" between 0 and 100
    and "reserve_tokens" between 0 and 5000000
    and "max_turns" between 1 and 500
    and "timeout_minutes" between 1 and 600
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "runner_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- Project switch. Every project starts paused, existing ones included: nothing runs until Jorge resumes it.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "runs_paused" boolean DEFAULT true NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "runs_paused_at" timestamp with time zone;

-- Weekly token limits per role or per project. No row means no limit set, which blocks runs.
CREATE TABLE IF NOT EXISTS "token_budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "role" text,
  "project_id" uuid,
  "weekly_limit" bigint NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "token_budgets" ADD CONSTRAINT "token_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_budgets" ADD CONSTRAINT "token_budgets_scope_check" CHECK (
    ("scope" = 'role' and "role" is not null and "project_id" is null)
    or ("scope" = 'project' and "project_id" is not null and "role" is null)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "token_budgets" ADD CONSTRAINT "token_budgets_limit_check" CHECK ("weekly_limit" > 0 and "weekly_limit" <= 10000000000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "token_budgets_role_unique" ON "token_budgets" ("role") WHERE "scope" = 'role';
CREATE UNIQUE INDEX IF NOT EXISTS "token_budgets_project_unique" ON "token_budgets" ("project_id") WHERE "scope" = 'project';

-- One row per runner run: queued, then running, then ended. tokens_total counts input, output and cache.
CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "task_key" text,
  "role" text NOT NULL,
  "status" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "pid" integer,
  "claude_session_id" text,
  "resumed" boolean DEFAULT false NOT NULL,
  "cwd" text,
  "worktree_path" text,
  "branch" text,
  "log_path" text,
  "queued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "turns" integer DEFAULT 0 NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_create_tokens" bigint DEFAULT 0 NOT NULL,
  "tokens_total" bigint DEFAULT 0 NOT NULL,
  "reserve_tokens" integer DEFAULT 0 NOT NULL,
  "usage_known" boolean DEFAULT true NOT NULL,
  "usage_ack_at" timestamp with time zone,
  "exit_code" integer,
  "stop_reason" text
);

DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_check" CHECK ("status" in ('queued', 'running', 'ok', 'fail', 'skipped', 'stopped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_summary_check" CHECK (char_length("summary") <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "agent_runs_status_idx" ON "agent_runs" ("status", "queued_at");
CREATE INDEX IF NOT EXISTS "agent_runs_agent_idx" ON "agent_runs" ("agent_id", "queued_at");
CREATE INDEX IF NOT EXISTS "agent_runs_project_idx" ON "agent_runs" ("project_id", "started_at");

-- The claude session an agent resumes in a project, and the folder it ran in (a session resumes only there).
CREATE TABLE IF NOT EXISTS "agent_sessions" (
  "agent_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "claude_session_id" text NOT NULL,
  "cwd" text NOT NULL,
  "runs" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_sessions_agent_id_project_id_pk" PRIMARY KEY ("agent_id", "project_id")
);

DO $$ BEGIN
  ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Plan-window readings: rate_limit_event from a run (source stream) or the free /usage probe.
CREATE TABLE IF NOT EXISTS "plan_readings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" text NOT NULL,
  "status" text,
  "five_hour_pct" real,
  "seven_day_pct" real,
  "five_hour_resets_at" timestamp with time zone,
  "seven_day_resets_at" timestamp with time zone,
  "overage_status" text,
  "run_id" uuid
);

DO $$ BEGIN
  ALTER TABLE "plan_readings" ADD CONSTRAINT "plan_readings_source_check" CHECK ("source" in ('stream', 'usage_probe'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "plan_readings_at_idx" ON "plan_readings" ("at");

-- Cache tokens the runner reads from modelUsage.
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "cache_read" integer DEFAULT 0 NOT NULL;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "cache_create" integer DEFAULT 0 NOT NULL;
