-- PLA-I67-3: lessons the owner approves, the corrections they come from, and what each run carried.
--   feedback_events  one owner correction of a seat's delivery: a request for changes (El Probador's pins ride on it),
--                    an answer on an idea stage, or «Dile algo». source_event_id is the events row it was read from
--                    (unique, so one correction is read once). status: queued → reflecting → done | failed | skipped.
--                    verdict is the reflector's answer as Plania parsed it.
--   lessons          what an agent keeps. state: proposed (by the reflector, waiting on the owner) | active | one-off
--                    («fue solo esa vez») | rejected | retired | expired (a proposal not looked at in four weeks).
--                    Only the owner's screen moves a lesson to active. scope works as for skills (default: one agent).
--                    proposed_by: reflector | owner (typed in the teach bar). conflicts_with: an active lesson the
--                    reflector found this one contradicts.
--   lesson_versions  every text a lesson had; version on lessons is the newest n.
--   run_knowledge    one row per item a run carried: kind skill | lesson | manner | reference, item (slug, lesson id,
--                    "manner"), version ("slug@hash", lesson n, manner hash). opened: the stream showed it used.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists feedback_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  task_key text,
  kind text not null,
  words text not null,
  source_event_id bigint,
  run_id uuid,
  status text not null default 'queued',
  verdict jsonb,
  lesson_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_events_kind_check check (kind in ('changes', 'idea', 'dile')),
  constraint feedback_events_status_check check (status in ('queued', 'reflecting', 'done', 'failed', 'skipped'))
);
create unique index if not exists feedback_events_source_unique on feedback_events (source_event_id) where source_event_id is not null;
create index if not exists feedback_events_agent_idx on feedback_events (agent_id, created_at);
create index if not exists feedback_events_status_idx on feedback_events (status, created_at);

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  scope text not null default 'agent',
  role text,
  text text not null,
  applies_when text,
  state text not null default 'proposed',
  proposed_by text not null default 'reflector',
  feedback_id uuid references feedback_events(id) on delete set null,
  owner_words text,
  task_key text,
  run_id uuid,
  conflicts_with uuid references lessons(id) on delete set null,
  version integer not null default 1,
  approved_at timestamptz,
  decided_at timestamptz,
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lessons_state_check check (state in ('proposed', 'active', 'one-off', 'rejected', 'retired', 'expired')),
  constraint lessons_scope_check check (scope in ('company', 'seat', 'project', 'agent')),
  constraint lessons_proposed_by_check check (proposed_by in ('reflector', 'owner')),
  constraint lessons_text_check check (char_length(text) between 3 and 600)
);
create index if not exists lessons_agent_idx on lessons (agent_id, state);
create index if not exists lessons_project_idx on lessons (project_id, state);

create table if not exists lesson_versions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  n integer not null,
  text text not null,
  applies_when text,
  author text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists lesson_versions_lesson_n_unique on lesson_versions (lesson_id, n);

create table if not exists run_knowledge (
  run_id uuid not null references agent_runs(id) on delete cascade,
  kind text not null,
  item text not null,
  version text not null,
  opened boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (run_id, kind, item),
  constraint run_knowledge_kind_check check (kind in ('skill', 'lesson', 'manner', 'reference'))
);
create index if not exists run_knowledge_item_idx on run_knowledge (kind, item);
