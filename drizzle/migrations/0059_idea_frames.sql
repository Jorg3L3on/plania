-- PLA-I61-2 (La idea abierta): Artist's frames on an idea. One row per frame, in order; the file lives in the local
-- store next to the request pictures (<captures dir>/pedidos/<project>/<sha256>.<ext>, src/pedidos/frames.ts), never in
-- the database or a repo. attach_frames replaces an idea's whole set. Safe to leave on revert: nothing else reads it.
CREATE TABLE "idea_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"frame_id" text NOT NULL,
	"name" text NOT NULL,
	"grupo" text,
	"hace" text,
	"porque" text,
	"position" integer NOT NULL,
	"file" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_frames_mime_check" CHECK ("idea_frames"."mime" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "idea_frames_bytes_check" CHECK ("idea_frames"."bytes" > 0 and "idea_frames"."bytes" <= 5242880)
);
--> statement-breakpoint
ALTER TABLE "idea_frames" ADD CONSTRAINT "idea_frames_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "idea_frames" ADD CONSTRAINT "idea_frames_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "idea_frames_task_frame_unique" ON "idea_frames" USING btree ("task_id","frame_id");
--> statement-breakpoint
CREATE INDEX "idea_frames_task_idx" ON "idea_frames" USING btree ("task_id","position");
