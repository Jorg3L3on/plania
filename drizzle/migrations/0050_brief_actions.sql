-- PLA-I49-3: what the owner did from a brief row. Additive and idempotent. brief_checks stays (a check counts as
-- Not relevant). One row per action; request_id makes a retry or a double click write once.
--   action   answer, step_done, add_to_pr, publish, accept_pr, request_changes, resume_runs, postpone, put_first,
--            hold, fix_finding, later, dismiss (src/brief/actions.ts)
--   target   the Target the action ran on ({kind, project, key?, id?, pr?, env?, code?})
--   outcome  {status: running|done|failed|stale, line, ...}: what the row shows afterwards
--   undone_at  set when an instant action was undone

CREATE TABLE IF NOT EXISTS "brief_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brief_id" uuid NOT NULL REFERENCES "morning_briefs"("id") ON DELETE cascade,
  "item_id" text NOT NULL,
  "action" text NOT NULL,
  "target" jsonb,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "outcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "request_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "undone_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "brief_actions_request_idx" ON "brief_actions" ("request_id");
CREATE INDEX IF NOT EXISTS "brief_actions_item_idx" ON "brief_actions" ("item_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "brief_actions_brief_idx" ON "brief_actions" ("brief_id");
