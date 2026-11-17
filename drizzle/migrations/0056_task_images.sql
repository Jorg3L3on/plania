-- PLA-I54-2: pictures on a request. One row per picture on a task; the file lives in the local store
-- (<captures dir>/pedidos/<project>/<sha256>.<ext>, src/pedidos/images.ts), never in the database or a repo.
-- Safe to leave on revert: nothing else reads it.
CREATE TABLE "task_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"file" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_images_mime_check" CHECK ("task_images"."mime" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "task_images_bytes_check" CHECK ("task_images"."bytes" > 0 and "task_images"."bytes" <= 5242880)
);
--> statement-breakpoint
ALTER TABLE "task_images" ADD CONSTRAINT "task_images_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_images" ADD CONSTRAINT "task_images_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "task_images_task_file_unique" ON "task_images" USING btree ("task_id","file");
--> statement-breakpoint
CREATE INDEX "task_images_task_idx" ON "task_images" USING btree ("task_id","created_at");
