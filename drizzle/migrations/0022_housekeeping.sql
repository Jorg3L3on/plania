CREATE TABLE "machine_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 2.9 fix f: the v1 cleanup. Refuses to run while a project still has its v1 card (archive it first).
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "projects" WHERE "resume_in_progress" <> '' OR "resume_next_action" <> '' OR "resume_branch_or_prod" <> '' OR "resume_must_keep_decision" <> '') THEN
		RAISE EXCEPTION '0022: a project still has its v1 legacy card; archive it before the cleanup';
	END IF;
END $$;--> statement-breakpoint
-- Every v1 body that is left becomes a task doc, so no text is lost with the column.
INSERT INTO "docs" ("project_id", "task_id", "title", "markdown", "actor")
SELECT "project_id", "id", 'v1 body', "body", '{"agent": "plania", "session_id": "migration-0022"}'::jsonb
FROM "tasks" WHERE btrim("body") <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "design_pages" CASCADE;--> statement-breakpoint
DROP TABLE "env_blockers" CASCADE;--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT IF EXISTS "decisions_supersedes_id_decisions_id_fk";--> statement-breakpoint
ALTER TABLE "decisions" DROP COLUMN IF EXISTS "supersedes_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "resume_in_progress";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "resume_next_action";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "resume_branch_or_prod";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "resume_must_keep_decision";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "body";
