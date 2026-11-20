-- PLA-I66-3: a logo the owner chose (uploaded, picked from the repo's candidates or from Artist's marks) is never
-- replaced by what the detector finds in the repo. adjust keeps how an upload was fitted into its icon: the raw file
-- in the store, the size inside the tile (40 to 100) and the background colour (null: transparent).
-- Safe to run twice. Never applied by an agent to a real database.

alter table project_logos add column if not exists chosen boolean not null default false;
alter table project_logos add column if not exists adjust jsonb;
