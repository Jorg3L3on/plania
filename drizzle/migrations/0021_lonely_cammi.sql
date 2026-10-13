ALTER TABLE "questions" ADD COLUMN "blocks" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "urgency" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_on" date;