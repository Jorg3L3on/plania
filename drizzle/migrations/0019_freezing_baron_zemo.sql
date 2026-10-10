CREATE TABLE "footprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine" text NOT NULL,
	"kind" text NOT NULL,
	"locator" text NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"session_id" text,
	"holder" jsonb,
	"source" text DEFAULT 'observed' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"teardown" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'orphan' NOT NULL,
	"misses" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"declared_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "footprints_kind_check" CHECK ("footprints"."kind" in ('worktree', 'server', 'db_server', 'database', 'container', 'browser', 'service', 'tunnel', 'cache')),
	CONSTRAINT "footprints_source_check" CHECK ("footprints"."source" in ('observed', 'declared', 'both')),
	CONSTRAINT "footprints_state_check" CHECK ("footprints"."state" in ('live', 'orphan', 'stale', 'ghost', 'gone', 'released', 'self', 'system'))
);
--> statement-breakpoint
ALTER TABLE "footprints" ADD CONSTRAINT "footprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "footprints" ADD CONSTRAINT "footprints_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "footprints_live_locator_idx" ON "footprints" USING btree ("machine","kind","locator") WHERE "footprints"."released_at" is null;--> statement-breakpoint
CREATE INDEX "footprints_project_idx" ON "footprints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "footprints_task_idx" ON "footprints" USING btree ("task_id");