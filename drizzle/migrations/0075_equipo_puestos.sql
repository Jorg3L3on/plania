-- PLA-I71-3: Equipo de verdad, step 3 (move, pause, retire and add a seat; the PO proposes one).
--   agents.paused_at   the owner paused this seat: it starts no run until resumed (null: it works).
--   agents.position    the owner's order among a manager's reports on the chart (null: by role).
--   agents.from_team   the team template a seat came from when a team was adopted (PLA-I71-6); null otherwise.
--   puestos            the role catalog as data: the factory roles (seeded from src/runner/team.ts) and the owner's
--                      own roles (two lines of text on a base role). prompt_ref is the role prompt a seat runs on.
--   seat_proposals     a PO's proposal of a seat, with its reason; only the owner's screen accepts or declines it.
-- Safe to run twice. Never applied by an agent to a real database.

alter table agents add column if not exists paused_at timestamptz;
alter table agents add column if not exists position integer;
alter table agents add column if not exists from_team text;

create table if not exists puestos (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{0,39}$'),
  title text not null check (char_length(title) between 1 and 60),
  line text not null default '' check (char_length(line) <= 200),
  origin text not null default 'owner' check (origin in ('factory', 'owner')),
  default_skills text[] not null default '{}'::text[],
  default_motor jsonb,
  prompt_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into puestos (slug, title, line, origin, prompt_ref) values
  ('product-owner', 'Product owner', '', 'factory', 'product-owner'),
  ('research', 'Research', '', 'factory', 'research'),
  ('artist', 'Artist', '', 'factory', 'artist'),
  ('taller', 'Builder', '', 'factory', 'taller'),
  ('qa', 'QA', '', 'factory', 'qa'),
  ('copy', 'Copy', '', 'factory', 'copy'),
  ('seguridad', 'Seguridad', '', 'factory', 'seguridad'),
  ('marketing', 'Marketing', '', 'factory', 'marketing'),
  ('data', 'Data', '', 'factory', 'data')
on conflict (slug) do nothing;

create table if not exists seat_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (char_length(role) between 1 and 60),
  reason text not null check (char_length(reason) between 3 and 600),
  proposed_by text not null,
  state text not null default 'proposed' check (state in ('proposed', 'accepted', 'declined')),
  agent_id uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists seat_proposals_project_idx on seat_proposals (project_id, state);
