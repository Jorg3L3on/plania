-- PLA-I36-7/10: Compañía v3 · Timón. A PO's proposal is stored as data on its thread message (the `propose`
-- tool; the body keeps a prose copy), and a PR remembers how many files it changes when the poller read it.
-- Plan approval, the picked next ticket and the preview address live in projects.settings (no column).
-- Additive and idempotent: a second run adds nothing.

ALTER TABLE "thread_messages" ADD COLUMN IF NOT EXISTS "proposal" jsonb;
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "changed_files" integer;

DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_proposal_check" CHECK ("proposal" is null or jsonb_typeof("proposal") = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
