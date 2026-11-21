-- PLA-I71-6: the team catalog and the whole company in a file.
--   team_templates     teams the owner saved from a project, and teams brought from a file or a public repository
--                      (the factory teams are files in kit/teams/, read at run time). spec: seats (role, title, line,
--                      base role, who it reports to, skills by name, motor, manner), owner skill texts it brings, and
--                      lessons and references only when the owner ticked them. hash: of the spec; source and commit:
--                      where a brought team came from.
--   team_adoptions     one row per adoption: the project, the template and its hash, the plan applied, when.
--   company_transfers  one row per export or import of the whole company: direction, state, the manifest
--                      (what was created, renamed, skipped or ignored) and the counts.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists team_templates (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  line text not null default '' check (char_length(line) <= 300),
  origin text not null check (origin in ('owner', 'imported')),
  spec jsonb not null,
  source text,
  source_commit text,
  hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_adoptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  template text not null,
  hash text not null,
  plan jsonb not null,
  at timestamptz not null default now()
);
create index if not exists team_adoptions_project_idx on team_adoptions (project_id, at);

create table if not exists company_transfers (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('export', 'import')),
  state text not null default 'done' check (state in ('previewed', 'done', 'failed')),
  manifest jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
