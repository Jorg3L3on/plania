-- PLA-I41-1: Morning brief (spec "Spec: Morning brief" §7.2). Five new tables: the briefs, the runs that made them,
-- Send to Plania requests (D3), the owner's checks, and one settings row (fallback_at is the D4 ceiling).
-- Additive and idempotent: a second run adds nothing. The owner applies it by hand:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/migrations/0045_morning_brief.sql

CREATE TABLE IF NOT EXISTS "morning_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "local_date" date NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "trigger" text NOT NULL CONSTRAINT "morning_briefs_trigger_check" CHECK ("trigger" in ('schedule', 'manual', 'cli')),
  "mode" text NOT NULL CONSTRAINT "morning_briefs_mode_check" CHECK ("mode" in ('full', 'partial', 'facts_only')),
  "data" jsonb NOT NULL,
  "run_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "morning_briefs_date_idx" ON "morning_briefs" ("local_date" DESC, "generated_at" DESC);

CREATE TABLE IF NOT EXISTS "brief_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trigger" text NOT NULL,
  "status" text NOT NULL CONSTRAINT "brief_runs_status_check" CHECK ("status" in ('waiting', 'running', 'ok', 'partial', 'fail', 'fallback')),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  "passes" jsonb NOT NULL DEFAULT '{}',
  "summary" text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS "brief_plan_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "brief_id" uuid NOT NULL REFERENCES "morning_briefs"("id") ON DELETE CASCADE,
  "codes" text[] NOT NULL,
  "ideas" jsonb NOT NULL,
  "targets" jsonb NOT NULL DEFAULT '[]',
  "status" text NOT NULL DEFAULT 'open' CONSTRAINT "brief_plan_requests_status_check" CHECK ("status" in ('open', 'done', 'partial', 'failed')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "brief_checks" (
  "item_id" text PRIMARY KEY,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "brief_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 CONSTRAINT "brief_settings_id_check" CHECK ("id" = 1),
  "enabled" boolean NOT NULL DEFAULT true,
  "run_at" time NOT NULL DEFAULT '07:00',
  "timezone" text,
  "timezone_label" text,
  "language" text NOT NULL DEFAULT 'en' CONSTRAINT "brief_settings_language_check" CHECK ("language" in ('en', 'es')),
  "owner_name" text,
  "hidden_refs" text[] NOT NULL DEFAULT '{}',
  "max_items_per_app" integer NOT NULL DEFAULT 5,
  "ideas_per_project" integer NOT NULL DEFAULT 3,
  "ideas_enabled" boolean NOT NULL DEFAULT true,
  "fallback_at" time NOT NULL DEFAULT '11:00',
  "model" text,
  "pass_timeouts" jsonb NOT NULL DEFAULT '{"brief": 10, "ideas": 20, "plan": 30}',
  "projects" jsonb NOT NULL DEFAULT '{}',
  "github_mode" text NOT NULL DEFAULT 'poller' CONSTRAINT "brief_settings_github_mode_check" CHECK ("github_mode" in ('poller', 'gh', 'off')),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
