-- PLA-I52-3: antes y después (El Probador). A delivery's stills say which side they show (antes = sandbox, después =
-- the delivery's copy), whether the path did not exist before (missing: a new screen), and the box around what
-- changed (diff, on the después row). tasks.probador keeps where the delivery's pictures stand. Safe to leave.
ALTER TABLE "capture_stills" ADD COLUMN "side" text;
--> statement-breakpoint
ALTER TABLE "capture_stills" ADD COLUMN "missing" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "capture_stills" ADD COLUMN "diff" jsonb;
--> statement-breakpoint
ALTER TABLE "capture_stills" ADD CONSTRAINT "capture_stills_side_check" CHECK ("capture_stills"."side" is null or "capture_stills"."side" in ('antes', 'despues'));
--> statement-breakpoint
CREATE INDEX "capture_stills_side_idx" ON "capture_stills" USING btree ("task_id","side","page_key","viewport","taken_at");
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "probador" jsonb;
