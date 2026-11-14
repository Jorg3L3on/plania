-- PLA-I46-11: the PO's check list on each step of an accepted plan, for QA to tick. [{n, text, done, done_at, done_by}]. Idempotent.

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "po_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;
