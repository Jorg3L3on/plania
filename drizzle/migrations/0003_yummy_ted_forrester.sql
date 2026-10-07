ALTER TABLE "tasks" ADD COLUMN "owner" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workspace" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lease_pair" CHECK (("tasks"."owner" is null) = ("tasks"."lease_until" is null));