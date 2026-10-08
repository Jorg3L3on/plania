CREATE TABLE "audit_runs" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"env" text NOT NULL,
	"commit" text NOT NULL,
	"deployed_at" timestamp with time zone,
	"source" jsonb,
	"task_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"prs" text[] DEFAULT '{}'::text[] NOT NULL,
	"migrations" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_env_commit_unique" UNIQUE("project_id","env","commit")
);
--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "derived_from" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "state_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "state_note_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handoff" jsonb;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;