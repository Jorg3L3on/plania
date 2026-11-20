-- PLA-I67-5: watch and clean what agents learned. One row per time a lesson's correction came back.
--   lesson_repeats  lesson_id, the delivery (task_key) and the owner's words when there are any, by: owner (marked by
--                   hand) | reflector (its «repeats lesson X» verdict). confirmed: the owner's mark counts at once; a
--                   reflector suggestion counts only after the owner confirms it (the trial was not run: decision on
--                   PLA-I67-5). dismissed_at: the owner said it was not a repeat.
--   lessons.kept_at the owner said «mantener» to a 90-day retirement proposal; the clock starts again from there.
--   lessons.merged_into  the skill slug a lesson was merged into (it is retired at the same time).
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists lesson_repeats (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  feedback_id uuid references feedback_events(id) on delete set null,
  task_key text,
  words text,
  by text not null default 'owner',
  confirmed boolean not null default false,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lesson_repeats_by_check check (by in ('owner', 'reflector'))
);
create index if not exists lesson_repeats_lesson_idx on lesson_repeats (lesson_id, created_at);
create unique index if not exists lesson_repeats_feedback_unique on lesson_repeats (feedback_id) where feedback_id is not null;

alter table lessons add column if not exists kept_at timestamptz;
alter table lessons add column if not exists merged_into text;
