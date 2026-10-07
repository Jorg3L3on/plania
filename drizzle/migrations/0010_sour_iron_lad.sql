CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "docs_task_title_unique" ON "docs" USING btree ("task_id","title") WHERE "docs"."task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "docs_project_title_unique" ON "docs" USING btree ("project_id","title") WHERE "docs"."task_id" is null;--> statement-breakpoint
-- v1 design pages become project docs; design_pages stays until the cleanup migration.
INSERT INTO "docs" ("project_id", "title", "markdown", "actor", "created_at", "updated_at")
SELECT "project_id", "title", "body", '{"agent":"v1","session_id":"legacy"}'::jsonb, "created_at", "updated_at" FROM "design_pages"
ON CONFLICT DO NOTHING;