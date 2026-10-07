CREATE TABLE "env_blockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"env" text NOT NULL,
	"condition" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "env_blockers_condition_check" CHECK ("env_blockers"."condition" in ('contains_commit', 'migration_gte', 'deployed_after'))
);
--> statement-breakpoint
CREATE TABLE "env_commits" (
	"project_id" uuid NOT NULL,
	"env" text NOT NULL,
	"sha" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "env_commits_project_id_env_sha_pk" PRIMARY KEY("project_id","env","sha")
);
--> statement-breakpoint
CREATE TABLE "env_states" (
	"project_id" uuid NOT NULL,
	"env" text NOT NULL,
	"commit" text,
	"branch" text,
	"migrations_applied" integer,
	"deployed_at" timestamp with time zone,
	"by" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "env_states_project_id_env_pk" PRIMARY KEY("project_id","env")
);
--> statement-breakpoint
ALTER TABLE "env_blockers" ADD CONSTRAINT "env_blockers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_commits" ADD CONSTRAINT "env_commits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_states" ADD CONSTRAINT "env_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "env_blockers_task_idx" ON "env_blockers" USING btree ("task_id");