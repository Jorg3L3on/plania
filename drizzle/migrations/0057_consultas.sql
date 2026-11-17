-- PLA-I57-1: Preguntar en Pedir. A question the owner asks about a project; the project's PO answers it in a
-- read-only run (answer_consulta). Nothing else reads it: safe to leave on revert.
CREATE TABLE "consultas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid,
	"text" text NOT NULL,
	"run_id" uuid,
	"answer" jsonb,
	"answered_at" timestamp with time zone,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultas_text_check" CHECK (char_length("consultas"."text") between 3 and 2000)
);
--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "consultas_project_idx" ON "consultas" USING btree ("project_id","asked_at");
