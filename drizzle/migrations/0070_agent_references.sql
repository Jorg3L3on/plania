-- PLA-I67-4: references, the links, images and files the owner gives one agent (sketch PLA-IDEA31 frame 7).
--   agent_references        one row per reference. A link keeps its address, the text snapshot the server fetched
--                           at save time and when (snapshot_at), and fetch_status ok | failed with the refusal code
--                           (fetch_error). An image or a file lives in the local store under
--                           <captures dir>/references/<project>/<sha256>.<ext> (src/references/store.ts), never in the
--                           database or a repo. note is the owner's «why»; stance follow | avoid; applies always |
--                           on_topic; scope agent (this seat only) | project (every seat of the project); state on | off.
--   agent_reference_uses    one row per run that carried a reference (the path it had in the run's temp folder);
--                           opened is set when the run's stream showed a Read of that path.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists agent_references (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  kind text not null,
  title text not null,
  url text,
  snapshot_text text,
  snapshot_at timestamptz,
  fetch_status text,
  fetch_error text,
  file text,
  mime text,
  bytes integer,
  width integer,
  height integer,
  original_bytes integer,
  note text not null default '',
  stance text not null default 'follow',
  applies text not null default 'always',
  scope text not null default 'agent',
  state text not null default 'on',
  actor jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_references_kind_check check (kind in ('link', 'image', 'file')),
  constraint agent_references_stance_check check (stance in ('follow', 'avoid')),
  constraint agent_references_applies_check check (applies in ('always', 'on_topic')),
  constraint agent_references_scope_check check (scope in ('agent', 'project')),
  constraint agent_references_state_check check (state in ('on', 'off')),
  constraint agent_references_fetch_check check (fetch_status is null or fetch_status in ('ok', 'failed')),
  constraint agent_references_mime_check check (mime is null or mime in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  constraint agent_references_bytes_check check (bytes is null or (bytes > 0 and bytes <= 5242880)),
  constraint agent_references_note_check check (char_length(note) <= 600),
  constraint agent_references_title_check check (char_length(title) between 1 and 160)
);

create index if not exists agent_references_agent_idx on agent_references (agent_id, created_at);
create index if not exists agent_references_project_idx on agent_references (project_id, scope);

create table if not exists agent_reference_uses (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references agent_references(id) on delete cascade,
  run_id uuid not null references agent_runs(id) on delete cascade,
  path text not null,
  opened boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists agent_reference_uses_run_ref_unique on agent_reference_uses (run_id, reference_id);
create index if not exists agent_reference_uses_ref_idx on agent_reference_uses (reference_id);
