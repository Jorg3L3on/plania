-- PLA-I51-1: the Morning brief speaks Spanish by default (Plan on PLA-IDEA17, decision 4). New installs get es from
-- the column default; the saved settings row moves from en to es once. Safe to leave if the release is reverted.
ALTER TABLE "brief_settings" ALTER COLUMN "language" SET DEFAULT 'es';
--> statement-breakpoint
UPDATE "brief_settings" SET "language" = 'es', "updated_at" = now() WHERE "language" = 'en';
