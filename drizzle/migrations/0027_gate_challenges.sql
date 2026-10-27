-- PLA-I8-2: one-time challenges for human-only gate answers. 0026_ideas already exists, so this is 0027.
-- The TOTP code and the secret are not columns. totp_step records the time step that was accepted
-- so the same code cannot be spent twice. Idempotent where a re-run would otherwise fail.
CREATE TABLE IF NOT EXISTS "gate_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"option" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"used_at" timestamp with time zone,
	"totp_step" bigint,
	CONSTRAINT "gate_challenges_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "gate_challenges_state_check" CHECK ("state" in ('open', 'used', 'expired', 'locked'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gate_challenges" ADD CONSTRAINT "gate_challenges_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gate_challenges_question_idx" ON "gate_challenges" USING btree ("question_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gate_challenges_totp_step_unique" ON "gate_challenges" USING btree ("totp_step") WHERE "gate_challenges"."totp_step" is not null;
