CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" jsonb,
	"evidence_id" uuid,
	CONSTRAINT "checks_task_n_unique" UNIQUE("task_id","n")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "phase" integer;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;