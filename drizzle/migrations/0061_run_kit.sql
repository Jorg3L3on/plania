-- AUDIT-2 / AUDIT-7: what each run was given, so results can be read per prompt version and per skill.
--   agent_runs.prompt_version  "<doc version>:<first 12 of the sha256 of the role prompt>"; null on a resumed session.
--   agent_runs.skills          "<slug>@<first 8 of its sha256>" for every skill in the run's kit.
--   agent_runs.skills_used     the slugs the run's stream showed it invoking.
--   agent_runs.context_tokens  the context the last turn carried; null when unknown.
-- Safe to run twice.
alter table agent_runs add column if not exists prompt_version text;
alter table agent_runs add column if not exists skills text[] not null default '{}'::text[];
alter table agent_runs add column if not exists skills_used text[] not null default '{}'::text[];
alter table agent_runs add column if not exists context_tokens bigint;
