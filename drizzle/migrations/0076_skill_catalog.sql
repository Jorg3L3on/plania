-- PLA-I71-5: the open skill catalog, reviewed before install. A skill brought from outside records where it came
-- from and what was checked, and stays pinned:
--   source_kind     link (any SKILL.md address) | github (a folder or file in a repository) | skills.sh (picked from the
--                   public catalog; fetched from its GitHub folder)
--   source_commit   the commit the GitHub folder was read at (null for a plain link: source_hash pins it)
--   publisher       who published it (the GitHub owner, or the link's host)
--   dropped_files   files the folder held that were not brought (programs and anything that is not text)
--   review          what Plania checked and showed before install (marks of secrets and outside links, word count)
--   upstream_hash   the content hash upstream has now when it differs from source_hash: «versión nueva». Nothing updates
--                   by itself; the owner sees the diff and accepts it, or declines and keeps the pin.
-- Safe to run twice. Never applied by an agent to a real database.

alter table skills add column if not exists source_kind text;
alter table skills add column if not exists source_commit text;
alter table skills add column if not exists publisher text;
alter table skills add column if not exists dropped_files text[] not null default '{}'::text[];
alter table skills add column if not exists review jsonb;
alter table skills add column if not exists upstream_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'skills_source_kind_check') then
    alter table skills add constraint skills_source_kind_check check (source_kind is null or source_kind in ('link', 'github', 'skills.sh'));
  end if;
end $$;
