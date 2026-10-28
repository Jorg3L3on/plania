-- PLA-I15-1: a human-only gate is a click on the screen session.
-- gate_challenges bound one accepted step to a question. A click does not use that row, so the table goes.
-- Idempotent: every drop is IF EXISTS, and the machine_state delete removes zero rows on a second run.
DROP INDEX IF EXISTS "gate_challenges_totp_step_unique";
--> statement-breakpoint
DO $$ BEGIN
	IF to_regclass('public.gate_challenges') IS NOT NULL THEN
		ALTER TABLE "gate_challenges" DROP COLUMN IF EXISTS "totp_step";
	END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "gate_challenges";
--> statement-breakpoint
DELETE FROM "machine_state" WHERE "key" = 'gate.totp';
