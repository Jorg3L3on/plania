-- PLA-06: Jorge marks a delegated answer as seen on the Bandeja. The row stays as the record; a
-- seen row leaves the Bandeja list and the DELEGATED_ANSWER audit. Idempotent: a second run adds nothing.
ALTER TABLE "delegated_answers" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
