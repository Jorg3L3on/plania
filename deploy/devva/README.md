# The devva engine for plania

Plania can keep a second copy of its data in devva (a shadow of Postgres). This folder runs the engine.
Postgres stays the system of record.

## Start

1. Write a token to a file only you can read. The engine reads it once at start.

   ```bash
   mkdir -p ~/.config/plania && openssl rand -hex 24 > ~/.config/plania/devva-token && chmod 600 ~/.config/plania/devva-token
   ```

2. Start the engine. It listens on `127.0.0.1:2505` and keeps its data in the volume `plania-devva_engine-data`.

   ```bash
   DEVVA_TOKEN_FILE=$HOME/.config/plania/devva-token docker compose -f deploy/devva/compose.yml up -d
   ```

3. Point plania at it in `.env` (see `.env.example`): `DEVVA_TOKEN_FILE`, `DEVVA_CLIENT`, and `PLANIA_SHADOW=devva`.

`DEVVA_IMAGE` picks another engine build; `DEVVA_PORT` another host port.

## What plania stores there

| Lobe | Holds |
|---|---|
| `<prefix>_log` | One record per committed write: the changes it made. This is the source of truth on the devva side. |
| `<prefix>_ent` | One record per row, bucketed by project. A projection of the log, compared with it and rewritten at boot. |

`PLANIA_DEVVA_PREFIX` sets the prefix (default `plania`). Give every store its own: the service, a dev
server and a test run must not share lobes.

## Limits to know

- The engine loses recent updates of an existing record across a restart; inserts survive. That is why the
  log is insert-only and `<prefix>_ent` is rebuilt from it. Do not read `<prefix>_ent` with other tools and
  trust it after an engine restart until plania has booted.
- One token can read, write and purge everything on the engine. Keep the port on loopback.
- The devva TypeScript client is not an npm dependency of plania. `DEVVA_CLIENT` names a built copy's
  `dist/src/index.js`; `spike/devva-commit-log/setup.mjs` copies one.
