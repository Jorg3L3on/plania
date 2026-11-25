-- PLA-I75 (Conexiones, pass 1): the tools each agent may use beyond Plania (src/runner/conexiones.ts).
--   agent_connections    one row per seat and server: the catalog entry (or a custom npm package in expert mode,
--                        unreviewed until the owner accepts it), its pinned version, the key names it reads (a map of
--                        the variable the server expects to the key's name; never a value), the write tools the owner
--                        turned on, and the tools the accepted version showed (a new version is read against it).
--   connection_requests  an agent asks for a catalog entry with its reason (request_connection); only the owner's
--                        screen accepts or declines it.
--   agent_runs.mcp_calls what the run's stream showed of each mcp__ call: {server: {tool: {ok, failed, blocked}}}.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists agent_connections (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  server text not null check (server ~ '^[a-z][a-z0-9-]{1,39}$'),
  version text not null check (char_length(version) between 1 and 40),
  keys jsonb not null default '{}'::jsonb,
  writes_on text[] not null default '{}'::text[],
  custom jsonb,
  reviewed boolean not null default true,
  tools_seen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists agent_connections_agent_server_idx on agent_connections (agent_id, server);

create table if not exists connection_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  server text not null check (server ~ '^[a-z][a-z0-9-]{1,39}$'),
  reason text not null check (char_length(reason) between 3 and 600),
  state text not null default 'proposed' check (state in ('proposed', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists connection_requests_agent_idx on connection_requests (agent_id, state);

alter table agent_runs add column if not exists mcp_calls jsonb;
