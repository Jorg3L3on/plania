-- PLA-I21: company roster and an informational task owner.
-- Additive and idempotent: a second run adds nothing. 0032 and 0033 are reserved for other work.
CREATE TABLE IF NOT EXISTS "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "reports_to" uuid,
  "capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
  "kind" text NOT NULL,
  "wake_url" text,
  "last_check_in_at" timestamp with time zone,
  "last_wake_at" timestamp with time zone,
  "status" text DEFAULT 'idle' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "role" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "title" text DEFAULT '' NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "reports_to" uuid;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "capabilities" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "wake_url" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "last_check_in_at" timestamp with time zone;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "last_wake_at" timestamp with time zone;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'idle' NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "note" text DEFAULT '' NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "agents_slug_unique" ON "agents" ("slug");

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_reports_to_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "agents"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_kind_check" CHECK ("kind" in ('bot', 'coder', 'human'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_status_check" CHECK ("status" in ('alive', 'idle', 'stuck'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_not_self" CHECK ("reports_to" is null or "reports_to" <> "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "owner_agent" uuid;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_agent_agents_id_fk" FOREIGN KEY ("owner_agent") REFERENCES "agents"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "tasks_owner_agent_idx" ON "tasks" ("owner_agent");
