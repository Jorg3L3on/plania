-- PLA-I68-2: Camino, a project's path from code to people (configuration only).
--   camino          one row per project. config: what the owner set on Camino (branch roles, rules, conventions,
--                   environments, connection metadata). Never a secret: keys live in the OS keychain (or a 0600 file),
--                   config.connections holds only how a key was saved, its last 4 characters, its expiry and its last
--                   test. Old settings (github.repo, local.repo_path, release, capture, vercel) are read into it at
--                   read time, so nothing is lost when the row is still empty. discovery: what Plania read last from
--                   GitHub and this machine, with checked_at. version guards the owner's writes.
--   camino_history  every change applied from Camino (and changes noticed outside Plania): who, what, where it was
--                   applied (plania | proveedor | github | pr | llavero), and how to undo it.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists camino (
  project_id uuid primary key references projects(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  discovery jsonb,
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists camino_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  at timestamptz not null default now(),
  who text not null,
  label text not null,
  dest text not null,
  undo text,
  detail jsonb not null default '{}'::jsonb
);
alter table camino_history drop constraint if exists camino_history_dest_check;
alter table camino_history add constraint camino_history_dest_check check (dest in ('plania', 'proveedor', 'github', 'pr', 'llavero'));
create index if not exists camino_history_project_at on camino_history (project_id, at desc);
