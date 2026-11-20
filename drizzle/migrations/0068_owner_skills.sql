-- PLA-I67-2: skills the owner writes on screen, with immutable versions, and «tu manera» per agent.
-- The factory kit stays in git (kit/skills, ADR 0005); what the owner writes lives here (ADR 0006). A run carries the
-- resolved list (src/runner/skills.ts) and is stamped "slug@hash" in agent_runs.skills, as for the kit.
--   skills          one row per owner skill. origin: owner (written on screen), factory-copy (made by editing a factory
--                   skill; factory_sha is the kit version it was copied from), imported (a later step). scope: who
--                   carries it: company (every agent), seat (every agent of role, in every project), project (every
--                   agent of project_id), agent (agent_id only). state: on | off | archived (deleted, kept 30 days).
--   skill_versions  every saved content, never updated: n counts from 1, the newest n is what runs carry. A roll back
--                   writes a new version with an older content. hash is the first 8 of the sha256 of SKILL.md + files.
--   agents.manner   «tu manera»: the owner's instruction for this agent, appended after the role prompt on a fresh
--                   session. agent_runs.manner_version: the first 8 of its sha256 on the run that carried it.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  origin text not null default 'owner',
  scope text not null default 'agent',
  role text,
  project_id uuid references projects(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  state text not null default 'on',
  factory_sha text,
  archived_at timestamptz,
  created_by text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skills_slug_check check (slug ~ '^[a-z][a-z0-9-]{0,39}$'),
  constraint skills_origin_check check (origin in ('owner', 'factory-copy', 'imported')),
  constraint skills_scope_check check (scope in ('company', 'seat', 'project', 'agent')),
  constraint skills_state_check check (state in ('on', 'off', 'archived')),
  constraint skills_scope_target_check check (
    (scope = 'company')
    or (scope = 'seat' and role is not null)
    or (scope = 'project' and project_id is not null)
    or (scope = 'agent' and agent_id is not null)
  )
);
create unique index if not exists skills_slug_live_unique on skills (slug) where state <> 'archived';
create index if not exists skills_agent_idx on skills (agent_id);
create index if not exists skills_project_idx on skills (project_id);

create table if not exists skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references skills(id) on delete cascade,
  n integer not null,
  name text not null,
  description text not null,
  body text not null,
  files jsonb not null default '[]'::jsonb,
  hash text not null,
  author text not null default 'owner',
  note text,
  created_at timestamptz not null default now(),
  constraint skill_versions_n_check check (n >= 1),
  constraint skill_versions_description_check check (char_length(description) between 1 and 1024),
  constraint skill_versions_hash_check check (hash ~ '^[0-9a-f]{8}$')
);
create unique index if not exists skill_versions_skill_n_unique on skill_versions (skill_id, n);

alter table agents add column if not exists manner text;
alter table agents add column if not exists manner_updated_at timestamptz;
alter table agent_runs add column if not exists manner_version text;
