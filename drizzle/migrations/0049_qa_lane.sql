-- PLA-I46-9: the QA lane. Idempotent. Nothing here touches any app repo.
--   po_checks  the PO's check list for a ticket: up to three things to verify, written when planning (a later
--              ticket has the PO write them; Jorge may edit them). QA marks them per delivery in qa_lanes.marks.
--   qa_lanes   one QA pass on one delivery (a ticket at a commit): the verify list, the captures, a fresh review
--              and the check-list marks. attempt 1 that fails goes back to Taller once; a later failure goes to Jorge.

CREATE TABLE IF NOT EXISTS "po_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE cascade,
  "n" integer NOT NULL,
  "text" text NOT NULL,
  "written_by" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "po_checks_n_check" CHECK ("n" between 1 and 3),
  CONSTRAINT "po_checks_text_check" CHECK (length(trim("text")) between 1 and 300)
);
CREATE UNIQUE INDEX IF NOT EXISTS "po_checks_task_n_idx" ON "po_checks" USING btree ("task_id","n");

CREATE TABLE IF NOT EXISTS "qa_lanes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE cascade,
  "task_key" text NOT NULL,
  "commit" text,
  "branch" text,
  "pr_url" text,
  "attempt" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "hold" text,
  "verify" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "capture" jsonb,
  "review" jsonb,
  "marks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "diff_lines" integer,
  "model" text,
  "run_id" uuid,
  "review_tries" integer DEFAULT 0 NOT NULL,
  "head_after" text,
  "returned" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  CONSTRAINT "qa_lanes_status_check" CHECK ("status" in ('queued', 'checking', 'reviewing', 'pass', 'fail', 'error')),
  CONSTRAINT "qa_lanes_attempt_check" CHECK ("attempt" >= 1)
);
CREATE INDEX IF NOT EXISTS "qa_lanes_task_idx" ON "qa_lanes" USING btree ("task_id","created_at");
CREATE INDEX IF NOT EXISTS "qa_lanes_status_idx" ON "qa_lanes" USING btree ("status");
CREATE INDEX IF NOT EXISTS "qa_lanes_run_idx" ON "qa_lanes" USING btree ("run_id");
