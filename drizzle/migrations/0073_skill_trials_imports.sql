-- PLA-I67-6: try a skill on a past delivery («Probar»), and bring a skill from a link («Traer de un enlace»).
--   skills.source_url / source_hash / source_checked_at  an imported skill (origin imported): the link it was fetched
--                   from and the sha256 (64 hex) of the content the owner saw and saved. It is saved off; a later
--                   update is fetched again, shown as a diff, and written only when the owner confirms that hash.
--   skill_trials    one past delivery of an agent re-run with one version of a skill, in a throwaway copy of the work
--                   (a detached worktree at the commit the delivery started from; never its branch, ticket or PR). Its
--                   run is an agent_runs row with trigger 'trial', work_key trial:<id> and no task_key, admitted like
--                   any run (caps, plan guard). before_* is the delivery as it was, after_* the trial's result; *_skills
--                   are the "slug@hash" each run carried. status: queued | running | done | failed | skipped | stopped.
--   agent_runs.trigger  gains 'trial'.
-- Safe to run twice. Never applied by an agent to a real database.

alter table skills add column if not exists source_url text;
alter table skills add column if not exists source_hash text;
alter table skills add column if not exists source_checked_at timestamptz;
alter table skills drop constraint if exists skills_source_hash_check;
alter table skills add constraint skills_source_hash_check check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$');

create table if not exists skill_trials (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references skills(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  version_n integer not null,
  version_stamp text not null,
  task_key text not null,
  task_title text not null default '',
  before_run_id uuid references agent_runs(id) on delete set null,
  base_commit text,
  before_stamp text,
  before_skills text[] not null default '{}'::text[],
  before_output text,
  before_diff text,
  run_id uuid references agent_runs(id) on delete set null,
  after_skills text[] not null default '{}'::text[],
  after_output text,
  after_diff text,
  status text not null default 'queued',
  summary text not null default '',
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint skill_trials_status_check check (status in ('queued', 'running', 'done', 'failed', 'skipped', 'stopped'))
);
create index if not exists skill_trials_skill_idx on skill_trials (skill_id, created_at);
create index if not exists skill_trials_run_idx on skill_trials (run_id);

alter table agent_runs drop constraint if exists agent_runs_trigger_check;
alter table agent_runs add constraint agent_runs_trigger_check check (trigger in ('event', 'owner', 'cadence', 'consulta', 'retry', 'qa', 'brief', 'trial'));
