CREATE TABLE "sequence_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" integer NOT NULL,
	"task_id" uuid,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_reservations_value_unique" UNIQUE("project_id","name","value")
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"next_value" integer NOT NULL,
	"width" integer DEFAULT 4 NOT NULL,
	CONSTRAINT "sequences_project_id_name_pk" PRIMARY KEY("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "sequence_reservations" ADD CONSTRAINT "sequence_reservations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_reservations" ADD CONSTRAINT "sequence_reservations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;