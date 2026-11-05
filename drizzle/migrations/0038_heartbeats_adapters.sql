-- PLA-I26: how an agent is woken, and a row for each heartbeat.
-- Additive and idempotent: a second run adds nothing.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "adapter" text DEFAULT 'none' NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "heartbeat_minutes" integer;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp with time zone;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_adapter_check" CHECK ("adapter" in ('http', 'cursor_agent', 'claude_code', 'grok_webhook', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_heartbeat_minutes_check" CHECK ("heartbeat_minutes" is null or ("heartbeat_minutes" between 1 and 1440));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "heartbeat_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "status" text NOT NULL,
  "adapter" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "task_key" text
);

ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "agent_id" uuid;
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "adapter" text;
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "summary" text DEFAULT '' NOT NULL;
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "task_key" text;

DO $$ BEGIN
  ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_status_check" CHECK ("status" in ('ok', 'fail', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_adapter_check" CHECK ("adapter" in ('http', 'cursor_agent', 'claude_code', 'grok_webhook', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_summary_check" CHECK (char_length("summary") <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_task_key_check" CHECK ("task_key" is null or char_length("task_key") between 1 and 80);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "heartbeat_runs_agent_started_idx" ON "heartbeat_runs" ("agent_id", "started_at");
