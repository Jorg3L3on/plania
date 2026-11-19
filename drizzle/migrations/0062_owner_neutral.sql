-- PLA-I2-14: the owner has a name of their own. Stored values become neutral; the display name gets a row.
--   owner_profile           one row (id 1): the display name the owner gave at first start. Null = the brief's
--                           owner_name, then PLANIA_CEO_NAME, then «el dueño» (src/owner.ts).
--   tasks.status            'Needs Jorge' → 'Needs owner'
--   tasks.origin            'jorge' → 'owner'
--   task_comments.author_agent, thread_messages.author_agent and author_role: 'jorge' → 'owner'
--   every jsonb column      the exact JSON strings below, wherever they sit (actor.agent, event payloads such as
--                           task.status from/to and a thread post's author, blocker spec assignee, audit findings'
--                           code, an env's deploy provider, a brief action's undo status):
--                             "jorge" → "owner", "Needs Jorge" → "Needs owner",
--                             "WAITING_ON_JORGE_FREE_TEXT" → "WAITING_ON_OWNER_FREE_TEXT",
--                             "JORGE_LINE_PARSED" → "OWNER_LINE_PARSED", "needs_jorge" → "needs_owner",
--                             "waiting_jorge" → "waiting_owner", "delegated_by_jorge" → "delegated_by_owner",
--                             "handed_to_jorge" → "handed_to_owner"
--                           Only whole JSON strings (quotes included) change, so free text that mentions the
--                           first owner is left as it was written.
-- Safe to run twice: the second run finds nothing to change. Never applied by an agent to a real database.

create table if not exists owner_profile (
  id integer primary key default 1,
  display_name text,
  updated_at timestamptz not null default now(),
  constraint owner_profile_singleton check (id = 1),
  constraint owner_profile_name_check check (display_name is null or char_length(display_name) between 1 and 80)
);

update tasks set status = 'Needs owner' where status = 'Needs Jorge';
update tasks set origin = 'owner' where origin = 'jorge';
update task_comments set author_agent = 'owner' where author_agent = 'jorge';
update thread_messages set author_agent = 'owner' where author_agent = 'jorge';
update thread_messages set author_role = 'owner' where author_role = 'jorge';

do $$
declare
  c record;
  pairs text[][] := array[
    array['"jorge"', '"owner"'],
    array['"Needs Jorge"', '"Needs owner"'],
    array['"WAITING_ON_JORGE_FREE_TEXT"', '"WAITING_ON_OWNER_FREE_TEXT"'],
    array['"JORGE_LINE_PARSED"', '"OWNER_LINE_PARSED"'],
    array['"needs_jorge"', '"needs_owner"'],
    array['"waiting_jorge"', '"waiting_owner"'],
    array['"delegated_by_jorge"', '"delegated_by_owner"'],
    array['"handed_to_jorge"', '"handed_to_owner"']
  ];
  expr text;
  cond text;
  i int;
begin
  for c in
    select table_name, column_name from information_schema.columns
    where table_schema = current_schema() and data_type = 'jsonb'
    order by table_name, column_name
  loop
    expr := format('%I::text', c.column_name);
    cond := '';
    for i in 1 .. array_length(pairs, 1) loop
      expr := format('replace(%s, %L, %L)', expr, pairs[i][1], pairs[i][2]);
      cond := cond || case when i > 1 then ' or ' else '' end || format('strpos(%I::text, %L) > 0', c.column_name, pairs[i][1]);
    end loop;
    execute format('update %I set %I = (%s)::jsonb where %I is not null and (%s)', c.table_name, c.column_name, expr, c.column_name, cond);
  end loop;
end
$$;
