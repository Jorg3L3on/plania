-- PLA-I72-1: one copy per open initiative, kept so a Plania restart lists them again.
--   maquina_copias  one row per initiative copy this machine has made: its branch, worktree and database names,
--                   «No apagarla sola» (keep), what the owner last asked (state on|off) and when it was deleted.
--                   The processes stay in memory (src/captures/prueba.ts); the server, base and worktree are
--                   footprints too. At start Plania marks every live row off (nothing it started survives a stop).
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists maquina_copias (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  initiative_id uuid references tasks(id) on delete set null,
  initiative_key text not null check (char_length(initiative_key) between 1 and 60),
  branch text not null check (char_length(branch) between 1 and 200),
  worktree text,
  database text check (database is null or database ~ '^[A-Za-z0-9_]{1,90}$'),
  keep boolean not null default false,
  state text not null default 'off' check (state in ('on', 'off')),
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists maquina_copias_live_idx on maquina_copias (project_id, initiative_key) where deleted_at is null;
create index if not exists maquina_copias_project_idx on maquina_copias (project_id, deleted_at);
