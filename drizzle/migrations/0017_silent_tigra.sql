CREATE TABLE "blockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"type" text NOT NULL,
	"spec" jsonb NOT NULL,
	"satisfied_at" timestamp with time zone,
	"satisfied_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blockers_type_check" CHECK ("blockers"."type" in ('env', 'human_action', 'env_flag', 'time_after', 'metric_gte'))
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"owner_task_id" uuid,
	"shared" boolean DEFAULT false NOT NULL,
	"share_reason" text,
	"head_sha" text,
	"head_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"pr_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_project_id_name_pk" PRIMARY KEY("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "poll_state" (
	"project_id" uuid NOT NULL,
	"source" text NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"polled_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "poll_state_project_id_source_pk" PRIMARY KEY("project_id","source")
);
--> statement-breakpoint
CREATE TABLE "project_metrics" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" integer NOT NULL,
	"by" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_metrics_project_id_name_pk" PRIMARY KEY("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"project_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"task_id" uuid,
	"state" text NOT NULL,
	"head_sha" text,
	"head_branch" text,
	"base_branch" text,
	"merged_at" timestamp with time zone,
	"merge_sha" text,
	"ci_state" text,
	"ci_url" text,
	"gh_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_requests_project_id_repo_number_pk" PRIMARY KEY("project_id","repo","number")
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"day" date NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quota_usage_project_id_name_day_pk" PRIMARY KEY("project_id","name","day")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"holder" jsonb NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_project_id_name_pk" PRIMARY KEY("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_work_type_check";--> statement-breakpoint
ALTER TABLE "env_states" ADD COLUMN "migrations" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "env_states" ADD COLUMN "flags" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "env_states" ADD COLUMN "deploy_source" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "commit" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "env" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "command" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "exit_code" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "counts" jsonb;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "duration_s" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "attachments" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "viewport" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "device" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "areas" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "found_in" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "introduced_by" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "regression" boolean;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "cost_note" text;--> statement-breakpoint
ALTER TABLE "blockers" ADD CONSTRAINT "blockers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_owner_task_id_tasks_id_fk" FOREIGN KEY ("owner_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_state" ADD CONSTRAINT "poll_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_metrics" ADD CONSTRAINT "project_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_usage" ADD CONSTRAINT "quota_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blockers_task_idx" ON "blockers" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "branches_owner_idx" ON "branches" USING btree ("owner_task_id");--> statement-breakpoint
CREATE INDEX "pull_requests_task_idx" ON "pull_requests" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_work_type_check" CHECK ("tasks"."work_type" is null or "tasks"."work_type" in ('code', 'ops', 'research', 'decision-needed', 'bug', 'debt'));--> statement-breakpoint
-- 2.2 data: env blockers become typed blockers; status_changed_at for anything still missing it.
INSERT INTO "blockers" ("task_id", "type", "spec")
  SELECT "task_id", 'env', jsonb_build_object('env', "env", 'condition', "condition", 'value', "value") FROM "env_blockers";--> statement-breakpoint
DELETE FROM "env_blockers";
