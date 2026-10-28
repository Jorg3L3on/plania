-- PLA-I15-2: evidence for one delegated answer (a named human_only option, or a wont_do / reopen decision).
-- The question or approval is still stored as the owner's. This row keeps the message id, the quote,
-- the delegating actor and the time. Idempotent: a second run adds nothing.
CREATE TABLE IF NOT EXISTS "delegated_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"question_id" uuid,
	"approval_id" uuid,
	"message_id" text NOT NULL,
	"quote" text NOT NULL,
	"actor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegated_answers_one_target" CHECK (("delegated_answers"."question_id" is not null and "delegated_answers"."approval_id" is null) or ("delegated_answers"."question_id" is null and "delegated_answers"."approval_id" is not null))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delegated_answers" ADD CONSTRAINT "delegated_answers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delegated_answers" ADD CONSTRAINT "delegated_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delegated_answers" ADD CONSTRAINT "delegated_answers_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delegated_answers_question_unique" ON "delegated_answers" USING btree ("question_id") WHERE "delegated_answers"."question_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delegated_answers_approval_unique" ON "delegated_answers" USING btree ("approval_id") WHERE "delegated_answers"."approval_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delegated_answers_created_idx" ON "delegated_answers" USING btree ("created_at");
