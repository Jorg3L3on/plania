-- PLA-I60 (muchos agentes a la vez): what a run is about, enforced in the database.
--   agent_runs.work_key   the work item for that agent: task:<KEY>, consulta:<uuid> or general. One active run per
--                         (agent, project, work_key) is a partial unique index, so a duplicate wake coalesces in SQL.
--   agent_runs.trigger    why it was queued (event, owner, cadence, consulta, retry, qa, brief); summary is display only.
--   agent_runs.lane       which cap it counts against (work or consulta).
--   agent_runs.reason     what the prompt says the run is for (was sliced out of summary).
--   agent_runs.absorbed   wakes that arrived while the run was live; finishing queues one retry for them.
--   held_code/held_detail why a queued run waits; worker_id/lease_until who supervises it; stop_requested a stop
--                         asked from any process; not_before a retry backoff; plan_weight its share of the plan guess.
--   status 'starting'     admitted, process not up yet.
--   run_locks             one live run per folder, branch or ticket (lock_key primary key).
--   runner_workers        processes that spawn runs, with their capacity.
--   runner_reservations   slots held for something else (the Morning brief), in the database instead of memory.
--   agent_sessions        one resumable session per work item, not per agent.
--   agents.max_parallel   a seat's own «a la vez» (null: the project's «por agente»).
--   runner_settings       starts per minute, plan weight per run, memory and disk floors.
-- Everything new has a default or is nullable; behaviour stays the same until the owner raises a number.
ALTER TABLE "agent_runs" ADD COLUMN "work_key" text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "trigger" text DEFAULT 'owner' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "lane" text DEFAULT 'work' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "reason" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "absorbed" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "held_code" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "held_detail" jsonb;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "worker_id" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "lease_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "stop_requested" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "not_before" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "plan_weight" real;
--> statement-breakpoint
UPDATE "agent_runs" SET "work_key" = 'task:' || "task_key" WHERE "task_key" IS NOT NULL;
--> statement-breakpoint
UPDATE "agent_runs" r SET "work_key" = 'consulta:' || c."id", "lane" = 'consulta', "trigger" = 'consulta'
  FROM "consultas" c WHERE c."run_id" = r."id";
--> statement-breakpoint
UPDATE "agent_runs" SET "trigger" = 'event', "reason" = nullif(btrim(substr("summary", 14)), '')
  WHERE "lane" = 'work' AND "summary" LIKE 'queued: event%';
--> statement-breakpoint
UPDATE "agent_runs" SET "reason" = nullif(btrim(substr("summary", 14)), '')
  WHERE "lane" = 'consulta' AND "summary" LIKE 'queued: event%';
--> statement-breakpoint
UPDATE "agent_runs" SET "status" = 'skipped', "summary" = 'skipped: duplicate before the work-key index', "ended_at" = now()
  WHERE "id" IN (
    SELECT "id" FROM (
      SELECT "id", row_number() OVER (PARTITION BY "agent_id", "project_id", "work_key" ORDER BY ("status" = 'running') DESC, "queued_at") AS rn
      FROM "agent_runs" WHERE "status" IN ('queued', 'running')
    ) x WHERE x.rn > 1
  );
--> statement-breakpoint
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_status_check";
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" in ('queued', 'starting', 'running', 'ok', 'fail', 'skipped', 'stopped'));
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_trigger_check" CHECK ("agent_runs"."trigger" in ('event', 'owner', 'cadence', 'consulta', 'retry', 'qa', 'brief'));
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_lane_check" CHECK ("agent_runs"."lane" in ('work', 'consulta'));
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_work_key_check" CHECK (char_length("agent_runs"."work_key") between 1 and 200);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_active_work_unique" ON "agent_runs" ("agent_id", "project_id", "work_key") WHERE "status" IN ('queued', 'starting', 'running');
--> statement-breakpoint
CREATE INDEX "agent_runs_live_project_idx" ON "agent_runs" ("project_id", "lane") WHERE "status" IN ('starting', 'running');
--> statement-breakpoint
CREATE INDEX "agent_runs_live_worker_idx" ON "agent_runs" ("worker_id") WHERE "status" IN ('starting', 'running');
--> statement-breakpoint
CREATE TABLE "run_locks" (
  "lock_key" text PRIMARY KEY NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "run_locks_run_idx" ON "run_locks" ("run_id");
--> statement-breakpoint
CREATE TABLE "runner_workers" (
  "id" text PRIMARY KEY NOT NULL,
  "machine" text NOT NULL,
  "capacity" integer NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "version" text,
  "draining" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label" text NOT NULL,
  "slots" integer DEFAULT 1 NOT NULL,
  "holder" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runner_reservations_slots_check" CHECK ("slots" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "work_key" text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_sessions" DROP CONSTRAINT "agent_sessions_agent_id_project_id_pk";
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_project_id_work_key_pk" PRIMARY KEY ("agent_id", "project_id", "work_key");
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "max_parallel" integer;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_max_parallel_check" CHECK ("agents"."max_parallel" is null or "agents"."max_parallel" between 1 and 50);
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "max_starts_per_minute" integer DEFAULT 6 NOT NULL;
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "est_pct_per_run" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "min_free_mb" integer DEFAULT 1500 NOT NULL;
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD COLUMN "min_free_disk_gb" integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE "runner_settings" DROP CONSTRAINT IF EXISTS "runner_settings_ranges";
--> statement-breakpoint
ALTER TABLE "runner_settings" ADD CONSTRAINT "runner_settings_ranges" CHECK (
  "max_concurrent" between 0 and 500
  and "cooldown_minutes" between 0 and 1440
  and "plan_guard_pct" between 0 and 100
  and "reserve_tokens" between 0 and 5000000
  and "max_turns" between 1 and 500
  and "timeout_minutes" between 1 and 600
  and "max_starts_per_minute" between 1 and 600
  and "est_pct_per_run" between 0 and 100
  and "min_free_mb" between 0 and 1000000
  and "min_free_disk_gb" between 0 and 100000
);
