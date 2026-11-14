# The devva engine for plania

Plania keeps all of its data in devva. This folder runs the engine. The server does not start without it.

## Start

1. Write a token to a file only you can read. The engine reads it once at start.

   ```bash
   mkdir -p ~/.config/plania && openssl rand -hex 24 > ~/.config/plania/devva-token && chmod 600 ~/.config/plania/devva-token
   ```

2. Start the engine. It listens on `127.0.0.1:2505` and keeps its data in the volume `plania-devva_engine-data`.

   ```bash
   DEVVA_TOKEN_FILE=$HOME/.config/plania/devva-token docker compose -f deploy/devva/compose.yml up -d
   ```

3. Plania finds it with the defaults. To use another token file, host or port, set `DEVVA_TOKEN_FILE`,
   `DEVVA_HOST` and `DEVVA_PORT` in `.env` (see `.env.example`).

`DEVVA_IMAGE` picks another engine build; `DEVVA_PORT` another host port.

## What plania stores there

| Lobe | Holds |
|---|---|
| `<prefix>_log` | One record per committed write: the changes it made. This is the source of truth. |
| `<prefix>_ent` | One record per row, bucketed by project. A projection of the log, compared with it and rewritten at boot. |

`PLANIA_DEVVA_PREFIX` sets the prefix (default `plania`). Give every store its own: the service, a dev
server and a test run must not share lobes.

The server keeps every row in memory, rebuilt from the log at start, and answers reads from there. A write
is one record added to the log; it either lands whole or not at all.

## Backup

The nightly `backup` job writes the log as `~/plania-backups/plania-<YYYYMMDD>.devva.jsonl.gz`, after loading
it into a throwaway store and comparing it with the live one. Keep that folder: the engine's volume is the only
other copy.

## Search

`PLANIA_SEARCH=devva` adds the `search` tool: the tickets, docs and decisions of one project closest in
meaning to a question.

- It needs an embedding service. `--profile search` in the compose file starts sextant on
  `127.0.0.1:8080`; set `SEXTANT_URL=http://127.0.0.1:8080`.
- The index is the lobe `<prefix>_vec`, bucketed by project, so a search is exact inside its project and never
  leaves it. Results are ranked; the engine returns no score.
- It is rebuilt from the store at start and follows every commit. Changing the embedder re-embeds everything,
  and needs the lobe emptied first: its declared embedder is fixed when the lobe is created.
- Only the first 6,000 characters of a doc are embedded, so a long doc is found by how it starts.

## Limits to know

- The engine loses recent updates of an existing record across a restart; inserts survive. That is why the
  log is insert-only and `<prefix>_ent` is rebuilt from it. Do not read `<prefix>_ent` with other tools and
  trust it after an engine restart until plania has booted.
- One token can read, write and purge everything on the engine. Keep the port on loopback.
- The client has no reconnect: if the engine restarts, restart plania.
- The devva TypeScript client is not on npm. A built copy is in `vendor/devva-client`; `DEVVA_CLIENT` names
  another build's `index.js`.
