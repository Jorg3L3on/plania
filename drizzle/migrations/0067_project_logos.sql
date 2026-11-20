-- PLA-I66-1: a project's logo, the original every icon of the app comes from. One row per version; the one active row
-- is what the screen shows. The file sits in the local capture store under _marca/<project>/<sha256>.<svg|png>, never
-- in a repo. source says where it came from: repo (found on the start branch), upload, artist.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists project_logos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  file text not null,
  mime text not null,
  bytes integer not null,
  width integer,
  height integer,
  variant text not null,
  source text not null,
  source_path text,
  source_commit text,
  colors text[] not null default '{}',
  active boolean not null default true,
  actor jsonb not null,
  created_at timestamptz not null default now(),
  constraint project_logos_mime_check check (mime in ('image/svg+xml', 'image/png')),
  constraint project_logos_variant_check check (variant in ('icon', 'mark')),
  constraint project_logos_source_check check (source in ('repo', 'upload', 'artist')),
  constraint project_logos_bytes_check check (bytes > 0 and bytes <= 2097152)
);

create unique index if not exists project_logos_version_unique on project_logos (project_id, version);
create unique index if not exists project_logos_one_active on project_logos (project_id) where active;
