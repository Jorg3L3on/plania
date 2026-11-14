-- PLA-I46-12: a role on a project carries a list of skill packs (slugs of `Pack: <name>` docs in Plania).
-- The runner writes each pack's body into the run's scratch worktree only. Idempotent.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "skill_packs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_skill_packs_check" CHECK (cardinality("agents"."skill_packs") <= 10);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
