-- PLA-I32-1: the company as an organization. Each agent belongs to a project's team (project_id; null is
-- the company: ceo and asistente) and comes from a role template (role_template, a slug such as
-- product-owner, research, artist, taller). A retired agent keeps its runs and history (status retired).
-- Conversations: one company thread (Asistente) and one thread per project (its PO), with messages that
-- link the ticket, doc or PR they talk about and remember the action Jorge took on them.
-- Asistente gets its own weekly token budget (runner_settings.asistente_weekly_limit). Role budgets
-- (token_budgets scope 'role') are retired: the rows stay, the runner no longer reads them.
-- Additive and idempotent: a second run adds nothing.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "role_template" text;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_role_template_check" CHECK ("role_template" is null or "role_template" ~ '^[a-z][a-z0-9-]{0,39}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "agents_project_idx" ON "agents" ("project_id");

ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_status_check";
ALTER TABLE "agents" ADD CONSTRAINT "agents_status_check" CHECK ("status" in ('alive', 'idle', 'stuck', 'retired'));

-- Threads: kind company (no project, exactly one) or project (one per project).
-- read_at: when Jorge last read it on screen; later messages not his are unread.
CREATE TABLE IF NOT EXISTS "threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "project_id" uuid,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "threads" ADD CONSTRAINT "threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "threads" ADD CONSTRAINT "threads_kind_check" CHECK (
    ("kind" = 'company' and "project_id" is null) or ("kind" = 'project' and "project_id" is not null)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "threads_company_unique" ON "threads" ("kind") WHERE "kind" = 'company';
CREATE UNIQUE INDEX IF NOT EXISTS "threads_project_unique" ON "threads" ("project_id") WHERE "kind" = 'project';

CREATE TABLE IF NOT EXISTS "thread_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "author_agent" text NOT NULL,
  "author_role" text NOT NULL,
  "body" text NOT NULL,
  "links" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "action_state" jsonb,
  "question_id" uuid
);

DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_body_check" CHECK (char_length("body") between 1 and 4000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_author_check" CHECK (char_length("author_agent") between 1 and 60 and char_length("author_role") between 1 and 40);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_links_check" CHECK (jsonb_typeof("links") = 'array' and jsonb_array_length("links") <= 10);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_action_state_check" CHECK ("action_state" is null or jsonb_typeof("action_state") = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "thread_messages_thread_idx" ON "thread_messages" ("thread_id", "at");

-- The company thread and one thread per existing project. New projects get theirs on first use.
INSERT INTO "threads" ("kind") SELECT 'company' WHERE NOT EXISTS (SELECT 1 FROM "threads" WHERE "kind" = 'company');
INSERT INTO "threads" ("kind", "project_id")
  SELECT 'project', p."id" FROM "projects" p
  WHERE NOT EXISTS (SELECT 1 FROM "threads" t WHERE t."kind" = 'project' AND t."project_id" = p."id");

-- Asistente's weekly token budget. Null is no limit set, which stops its runs (unknown = stop).
ALTER TABLE "runner_settings" ADD COLUMN IF NOT EXISTS "asistente_weekly_limit" bigint DEFAULT 500000;

DO $$ BEGIN
  ALTER TABLE "runner_settings" ADD CONSTRAINT "runner_settings_asistente_limit_check" CHECK ("asistente_weekly_limit" is null or ("asistente_weekly_limit" > 0 and "asistente_weekly_limit" <= 10000000000));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
