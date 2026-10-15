-- 2.11 (PLA-I4-1): the headline is generated from the data; what agents and Jorge wrote is now its note.
ALTER TABLE "projects" RENAME COLUMN "headline" TO "headline_note";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "headline_version" TO "headline_note_version";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "headline_at" TO "headline_note_at";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "headline_stale" TO "headline_note_stale";
