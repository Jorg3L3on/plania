-- PLA-I2-2: first start without hand-made rows. One row (id 1) holds what an install made by `pnpm plania:install`
-- and the first-start screen needs, so nothing is pasted into .env and nothing needs a restart:
--   setup_code_hash   sha256 of the one-time code the install command printed; cleared once the owner exists
--   password_hash     the owner's argon2id hash (PLANIA_PASSWORD_HASH in .env still wins when it is set)
--   runner_token      the secret the runner hands its runs (PLANIA_RUNNER_TOKEN wins when set); its sha256 is also
--                     an agent_tokens row, so the MCP accepts it like any token issued on /tokens
--   brief_token       the brief's read-only secret (PLANIA_BRIEF_TOKEN wins when set), the same way
--   time_zone         the zone the browser sent at first start (PLANIA_TZ wins when set)
--   first_start_at    set by the first-start screen: this install starts with wakes on (PLANIA_JOBS unset = on)
-- Secrets sit in the database because the runner must hand the raw value to its runs; whoever can read this
-- database can already change every row Plania holds.
-- Safe to run twice. Never applied by an agent to a real database.

create table if not exists install_state (
  id integer primary key default 1,
  setup_code_hash text,
  setup_code_at timestamptz,
  password_hash text,
  runner_token text,
  brief_token text,
  time_zone text,
  first_start_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint install_state_singleton check (id = 1)
);
