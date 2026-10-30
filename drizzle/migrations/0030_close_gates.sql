-- PLA-I18-5: gates were removed in 2.17 (PLA-I18). Close the gate questions still open, as the
-- system, so they leave every open-question count. Nothing is dropped: the gate column, its check
-- and delegated_answers stay as read-only history, and answered rows are not touched.
-- Idempotent: a second run finds no open gate row and updates 0 rows.
UPDATE "questions"
SET "answer" = 'closed: gates removed',
	"answered_by" = '{"agent":"plania","session_id":"system"}'::jsonb,
	"answered_at" = now()
WHERE "gate" IS NOT NULL AND "answered_at" IS NULL;
