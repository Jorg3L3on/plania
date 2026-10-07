ALTER TABLE "tasks" ADD COLUMN "work_type" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_work_type_check" CHECK ("tasks"."work_type" is null or "tasks"."work_type" in ('code', 'ops', 'research', 'decision-needed'));--> statement-breakpoint
-- v1 tickets were all code work; ops/research ones are re-typed by hand with set_task.
UPDATE "tasks" SET "work_type" = 'code' WHERE "kind" = 'ticket' AND "work_type" IS NULL;