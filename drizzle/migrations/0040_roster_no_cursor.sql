-- PLA-I30-1: Claude Code only. The cursor_agent adapter leaves the enum: any agent or heartbeat run
-- that still names it becomes 'none' first, so the new check never rejects an existing row.
-- The roster cut itself (cursor, coach, the COO, claude-code folded into taller) is scripts/seed-org.ts.
-- Idempotent: a second run changes nothing.

UPDATE "agents" SET "adapter" = 'none', "adapter_config" = '{}'::jsonb, "updated_at" = now() WHERE "adapter" = 'cursor_agent';
UPDATE "heartbeat_runs" SET "adapter" = 'none' WHERE "adapter" = 'cursor_agent';

ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_adapter_check";
ALTER TABLE "agents" ADD CONSTRAINT "agents_adapter_check" CHECK ("adapter" in ('http', 'claude_code', 'grok_webhook', 'none'));

ALTER TABLE "heartbeat_runs" DROP CONSTRAINT IF EXISTS "heartbeat_runs_adapter_check";
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_adapter_check" CHECK ("adapter" in ('http', 'claude_code', 'grok_webhook', 'none'));
