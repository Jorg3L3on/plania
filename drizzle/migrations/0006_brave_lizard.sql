CREATE TABLE "write_requests" (
	"project_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"tool" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "write_requests_project_id_request_id_pk" PRIMARY KEY("project_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "write_requests" ADD CONSTRAINT "write_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;