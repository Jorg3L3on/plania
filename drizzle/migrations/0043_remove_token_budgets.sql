-- PLA-21: weekly token budgets are gone (Jorge, 2026-11-12: "delete it from plania"). The runner no longer
-- checks a limit before a run or stops a live run for tokens; the week's tokens are only shown.
-- Drops the per-project budgets and Asistente's limit. Idempotent: a second run drops nothing.

DROP TABLE IF EXISTS "token_budgets";

ALTER TABLE "runner_settings" DROP CONSTRAINT IF EXISTS "runner_settings_asistente_limit_check";
ALTER TABLE "runner_settings" DROP COLUMN IF EXISTS "asistente_weekly_limit";
