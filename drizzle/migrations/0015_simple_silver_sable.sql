CREATE TABLE "key_counters" (
	"project_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"next" integer NOT NULL,
	CONSTRAINT "key_counters_project_id_scope_pk" PRIMARY KEY("project_id","scope")
);
--> statement-breakpoint
CREATE TABLE "task_aliases" (
	"project_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_aliases_project_id_alias_pk" PRIMARY KEY("project_id","alias")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "key_prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "key_counters" ADD CONSTRAINT "key_counters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_aliases" ADD CONSTRAINT "task_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_aliases" ADD CONSTRAINT "task_aliases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_aliases_task_idx" ON "task_aliases" USING btree ("task_id");--> statement-breakpoint
-- Key prefixes for the day-one projects (keys.ts falls back to the first three letters of the slug).
UPDATE "projects" SET "key_prefix" = CASE "slug" WHEN 'workia' THEN 'WRK' ELSE upper(left("slug", 3)) END WHERE "key_prefix" = '';
