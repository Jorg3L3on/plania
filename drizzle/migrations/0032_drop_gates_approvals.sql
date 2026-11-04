-- PLA-I20-3: copy old approval rows and lettered questions into events, then drop them.
-- Idempotent: a second run finds nothing to copy and drops nothing that is already gone.
-- Take a dump before applying this. Do not run it against a database you have not copied.

DO $$
BEGIN
  IF to_regclass('public.approvals') IS NOT NULL THEN
    INSERT INTO events (project_id, task_id, task_key, type, actor, payload)
    SELECT a.project_id,
           a.task_id,
           a.task_key,
           'approval.archived',
           coalesce(a.decided_by, a.requested_by),
           jsonb_build_object(
             'approval_id', a.id,
             'action', a.action,
             'target', a.target,
             'reason', a.reason,
             'state', a.state,
             'requested_by', a.requested_by,
             'requested_at', a.requested_at,
             'decided_at', a.decided_at,
             'decision_note', a.decision_note,
             'used_at', a.used_at
           )
    FROM approvals a
    WHERE NOT EXISTS (
      SELECT 1 FROM events e
      WHERE e.type = 'approval.archived' AND e.payload->>'approval_id' = a.id::text
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'gate'
  ) THEN
    INSERT INTO events (project_id, task_id, task_key, type, actor, payload)
    SELECT q.project_id,
           q.task_id,
           t.key,
           'question.archived',
           q.asked_by,
           jsonb_build_object(
             'question_id', q.id,
             'question', q.question,
             'letter', q.gate,
             'options', to_jsonb(q.options),
             'answer', q.answer,
             'human_only', q.human_only
           )
    FROM questions q
    JOIN tasks t ON t.id = q.task_id
    WHERE q.gate IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.type = 'question.archived' AND e.payload->>'question_id' = q.id::text
      );
  END IF;
END $$;

ALTER TABLE delegated_answers DROP CONSTRAINT IF EXISTS delegated_answers_approval_id_approvals_id_fk;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_gate_check;
ALTER TABLE questions DROP COLUMN IF EXISTS gate;
DROP TABLE IF EXISTS approvals;
