-- PLA-I8-1: the task kind idea. 0025_push_subscriptions already exists, so this is 0026.
-- Additive: old rows keep stage, promoted_to and gate null, and human_only false.
ALTER TABLE "tasks" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "promoted_to" text;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_kind_check";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_kind_check" CHECK ("kind" in ('initiative', 'ticket', 'idea'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_stage_check" CHECK (("kind" = 'idea' AND "stage" in ('idea', 'research', 'design', 'planning', 'ready')) OR ("kind" <> 'idea' AND "stage" IS NULL));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_idea_no_parent" CHECK ("kind" <> 'idea' OR "parent_id" IS NULL);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_promoted_to_idea" CHECK ("promoted_to" IS NULL OR "kind" = 'idea');--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_idea_status_check" CHECK ("kind" <> 'idea' OR "status" in ('Open', 'Done', 'Won''t do'));--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "gate" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "human_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_gate_check" CHECK ("gate" IS NULL OR "gate" in ('A', 'B', 'C'));
