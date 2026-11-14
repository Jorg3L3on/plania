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
| `<prefix>_ent` | One record per row, bucketed by project. A projection of the log: each commit is applied to it, and one record (`~mark`) says how far it has got. |

`PLANIA_DEVVA_PREFIX` sets the prefix (default `plania`). Give every store its own: the service, a dev
server and a test run must not share lobes.

The server keeps every row in memory, rebuilt from the log at start, and answers reads from there: the engine
has no read snapshot, so only the log gives several rows as of one commit. A write is one record added to the
log; it either lands whole or not at all, and a second writer racing for the same commit id is refused.

At start plania applies to `<prefix>_ent` only the commits past its watermark. `PLANIA_DEVVA_VERIFY=1`
compares the whole projection instead; the nightly backup does the same comparison once a day.

Use an engine build that has the fix for updates lost across a restart (`69c72d8`; the image built from
`jl/dev01-integration-2` at `9924766` has it). On an older build the projection can fall behind after an
engine restart until the next comparison; the log is not affected.

## Backup

Two copies, written by the nightly `backup` job:

- Plania's log as `~/plania-backups/plania-<YYYYMMDD>.devva.jsonl.gz`, written only after it has been loaded
  into a throwaway store and compared with the live one. It restores plania's data into any engine.
- The engine's own export, `plania_<YYYYMMDD>.jsonl`: every lobe on the engine with its declarations (the
  search index included). The engine writes it under its data directory, in `meta/dumps`. To have it, start
  the engine with `PLANIA_DEVVA_DUMP_DIR=<absolute host folder>` (the compose file mounts it there) and put the
  same line in plania's `.env`. Without it plania asks for no export, because it could not remove old ones.

To rebuild an engine from an export: start an empty engine (a new volume) with the same folder mounted, then

```bash
pnpm devva:load plania_20261113
```

The engine checks the whole file first and applies all of it or nothing; it refuses an engine that holds any
lobe. Then start plania. This was run once by hand on 13 November 2026: the loaded copy had the same rows and
plania's projection needed nothing rewritten.

There is also the engine's hot snapshot (`devva-cli admin snapshot`), a copy of its files. The engine image
does not ship `devva-cli`, so plania does not use it.

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

- No transactions across lobes and no compare-and-set. That is why one insert-only log record is the commit,
  and why `<prefix>_ent` is a projection that can be rebuilt.
- One token can read, write and purge everything on the engine. Keep the port on loopback.
- The client does not reconnect by itself. Plania opens a new connection when it finds the old one dead, and
  reads a commit back before deciding whether an interrupted write landed.
- A write the engine does not admit in time is answered `THROTTLED`; plania retries it.
- The engine cannot drop a lobe. A prefix that was used once leaves its (empty) lobes behind.
- `NEAREST` returns no score. The score in a search result is the cosine plania computes from the returned vectors.
- The devva TypeScript client is not on npm. A built copy is in `vendor/devva-client` (see its README for the
  commit); `DEVVA_CLIENT` names another build's `index.js`.
