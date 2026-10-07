# Plania

Source of the plan for Jorge and his agents. A short resume card per project on screen, long bodies over MCP.
The plan lives here, not in each product repo.

- App: Hono on Vercel Hobby (`iad1`), one Node function at `api/index.ts`.
- DB: Neon Free (`aws-us-east-1`), Drizzle over `pg`, one pool per request.
- Screen: server-rendered HTML, password login (argon2id + `plania_session` cookie).
- Agents: `POST /mcp` with `Authorization: Bearer <MCP_BEARER_TOKEN>`.

## Setup

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
```

Fill `.env`:

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (or a local Postgres for dev) |
| `MCP_BEARER_TOKEN` | Random token, e.g. `openssl rand -hex 32`. Clients use it as `PLANIA_MCP_TOKEN`. |
| `SESSION_SECRET` | At least 32 bytes, e.g. `openssl rand -base64 48` |
| `PLANIA_PASSWORD_HASH` | Output of `pnpm hash-password`. Quote it in `.env`. Never a plain password. |

## Database

Migrations are generated here and applied by Jorge.

```bash
pnpm db:generate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/migrations/0000_curvy_wolfpack.sql
pnpm seed
```

`pnpm seed` is idempotent: it inserts `micasa`, `workia`, `filmia`, `zigzag` if missing.

## Dev

```bash
pnpm dev     # http://localhost:3737, reloads on change
pnpm start   # same server, no watch
pnpm build   # typecheck
```

Port 3737 avoids the 3000 that product repos use. The server only listens on 127.0.0.1.

## Running locally as a service

Plania currently runs on this Mac instead of Vercel.

- Database: local Postgres 14 (Homebrew service), database `plania`.
- Server: launchd agent `com.plania.server` at `~/Library/LaunchAgents/com.plania.server.plist`.
  It starts at login, restarts on crash, and logs to `~/Library/Logs/plania/server.log`.
  It runs nvm's Node by absolute path, so update the plist after switching Node versions.
- Clients, all pointing at `http://localhost:3737/mcp` with the Bearer from `.env`:
  Claude Code (user scope), Cursor (`~/.cursor/mcp.json`), Codex (`~/.codex/config.toml`).

```bash
launchctl kickstart -k gui/$(id -u)/com.plania.server   # restart after code or .env changes
launchctl bootout gui/$(id -u)/com.plania.server        # stop and unload
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.plania.server.plist  # load again
tail -f ~/Library/Logs/plania/server.log
```

Change the screen password with `pnpm hash-password`, paste the result into `.env` as
`PLANIA_PASSWORD_HASH='...'`, then restart. Rotating `MCP_BEARER_TOKEN` means updating all three client configs.

## MCP

`POST /mcp`, stateless JSON (no sessions, no GET listen stream). Every call needs
`Authorization: Bearer <MCP_BEARER_TOKEN>`; otherwise `401 {"error":"UNAUTHORIZED"}`.
The screen cookie is never accepted here.

Read tools (slice 3): `get_resume`, `get_project`, `list_tasks`, `get_task`, `get_memory`, `get_next`.
Write tools arrive in slice 4. The ceiling is 12 tools.

Contract errors come back as an MCP tool error (`isError: true`) whose text is
`{"error":"<CODE>","status":<404|409|400>}`, e.g. `{"error":"PROJECT_NOT_FOUND","status":404}`.

Local client against the dev server:

```bash
claude mcp add --transport http plania http://localhost:3000/mcp --header "Authorization: Bearer ${PLANIA_MCP_TOKEN}"
```

## Deviations from the handoff

- The handoff says "SDK MCP v2". No 2.x of `@modelcontextprotocol/sdk` is published.
  Plania uses the latest 1.x with `@hono/mcp`, approved by Jorge on 2026-10-06.
- Contract errors listed as HTTP codes (404, 409, 400) are returned inside the MCP tool result,
  because JSON-RPC calls share one HTTP 200 response. Only the missing-Bearer case is a real HTTP 401.

## Open before deploy

- `api/index.ts` only receives `/api/*` on Vercel by default. `/`, `/login` and `/mcp` need a rewrite
  to `/api`, which `vercel.json` (fixed by the handoff as regions only) does not have.
- `hono/vercel`'s `handle` takes a Web `Request`. On the Node runtime, a bare `export default` may receive
  Node's `req, res` instead. Hono's Node examples export named `GET`/`POST` handlers. Confirm on a preview.
