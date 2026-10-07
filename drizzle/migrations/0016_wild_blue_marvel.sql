CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"agent" text NOT NULL,
	"machine" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"task_key" text,
	"action" text NOT NULL,
	"target" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"requested_by" jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" jsonb,
	"decision_note" text,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_by" jsonb,
	CONSTRAINT "approvals_action_check" CHECK ("approvals"."action" in ('done', 'wont_do', 'reopen', 'waive_check', 'runbook_step', 'lease_resource')),
	CONSTRAINT "approvals_state_check" CHECK ("approvals"."state" in ('pending', 'granted', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "decision_supersessions" (
	"decision_id" uuid NOT NULL,
	"supersedes_id" uuid NOT NULL,
	CONSTRAINT "decision_supersessions_decision_id_supersedes_id_pk" PRIMARY KEY("decision_id","supersedes_id")
);
--> statement-breakpoint
DROP INDEX "decisions_supersedes_unique";--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "waived_by" jsonb;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "waive_reason" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "retired_by" jsonb;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "retired_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "token_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "headline" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "headline_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "headline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "headline_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "expiring_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_supersessions" ADD CONSTRAINT "decision_supersessions_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_supersessions" ADD CONSTRAINT "decision_supersessions_supersedes_id_decisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_project_pending_idx" ON "approvals" USING btree ("project_id") WHERE "approvals"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "approvals_task_idx" ON "approvals" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_supersessions_old_unique" ON "decision_supersessions" USING btree ("supersedes_id");--> statement-breakpoint
-- 2.1 data: reversals move into decision_supersessions; status_changed_at starts from the last update.
INSERT INTO "decision_supersessions" ("decision_id", "supersedes_id") SELECT "id", "supersedes_id" FROM "decisions" WHERE "supersedes_id" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "tasks" SET "status_changed_at" = "updated_at" WHERE "status_changed_at" IS NULL;
