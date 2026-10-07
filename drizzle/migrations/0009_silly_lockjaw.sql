CREATE TABLE "results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"verdict" text NOT NULL,
	"cite" text NOT NULL,
	"url" text,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "results_task_idx" ON "results" USING btree ("task_id","created_at");--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_evidence_id_results_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."results"("id") ON DELETE set null ON UPDATE no action;