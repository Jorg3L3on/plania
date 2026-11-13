-- PLA-25: a screen switch to go on past the plan guard (Jorge, 2026-11-13). Off by default. Idempotent.

ALTER TABLE "runner_settings" ADD COLUMN IF NOT EXISTS "guard_override" boolean DEFAULT false NOT NULL;
