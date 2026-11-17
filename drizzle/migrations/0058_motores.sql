-- PLA-I59-1 (Motores): the model and effort each seat runs on, a company default, and what each run asked for.
-- Every column is nullable: null inherits (seat → company → the CLI's default), so nothing changes until the owner
-- sets one. Safe to leave on revert: only the runner and the screen read them.
ALTER TABLE "agents" ADD COLUMN "motor_model" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "motor_effort" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "consulta_model" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "consulta_effort" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_motor_model_check" CHECK ("agents"."motor_model" is null or "agents"."motor_model" ~ '^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]{3,60}(\[1m\])?)$');
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_consulta_model_check" CHECK ("agents"."consulta_model" is null or "agents"."consulta_model" ~ '^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]{3,60}(\[1m\])?)$');
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_motor_effort_check" CHECK ("agents"."motor_effort" is null or "agents"."motor_effort" in ('low', 'medium', 'high', 'xhigh', 'max'));
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_consulta_effort_check" CHECK ("agents"."consulta_effort" is null or "agents"."consulta_effort" in ('low', 'medium', 'high', 'xhigh', 'max'));
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "default_model" text;
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "default_effort" text;
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD CONSTRAINT "runner_settings_default_model_check" CHECK ("runner_settings"."default_model" is null or "runner_settings"."default_model" ~ '^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]{3,60}(\[1m\])?)$');
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD CONSTRAINT "runner_settings_default_effort_check" CHECK ("runner_settings"."default_effort" is null or "runner_settings"."default_effort" in ('low', 'medium', 'high', 'xhigh', 'max'));
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "requested_model" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "requested_effort" text;
