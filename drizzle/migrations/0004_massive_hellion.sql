ALTER TABLE "decisions" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "actor" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "in_progress_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "next_action" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_task_idx" ON "decisions" USING btree ("task_id");